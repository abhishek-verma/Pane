import type {
  InstalledLayer,
  LayerOperation,
} from '@browseros/shared/layers/manifest'
import { layerMatchesUrl } from '@browseros/shared/layers/matching'

export interface LayerRuntimeStatus {
  layerId: string
  state: 'mounted' | 'waiting' | 'not-applicable' | 'unsupported' | 'error'
  affectedElements: number
  reason?: string
}

export interface AppliedEffect {
  node: HTMLElement
  identity?: string | null
  intact: () => boolean
  dispose: () => void
}

interface ActiveOperation {
  layer: InstalledLayer
  operation: LayerOperation
  effects: Map<HTMLElement, AppliedEffect>
  revealed: WeakSet<HTMLElement>
  repairs: WeakMap<HTMLElement, { count: number; since: number }>
  failed: boolean
}

/** Packaged interpreter. No model-authored HTML, styles or JavaScript execute
 * in this world. Every effect has ownership; disposal never rewrites a site
 * element's innerHTML, form values or inline style. */
export class ManagedLayerRuntime {
  private readonly prefix = `pane-layer-${crypto.randomUUID()}`
  private readonly hiddenClass = `${this.prefix}-hidden`
  private readonly highlightClass = `${this.prefix}-highlight`
  private readonly owners = new Map<HTMLElement, Map<string, Set<string>>>()
  private readonly operations = new Map<string, ActiveOperation>()
  private readonly observer: MutationObserver
  private readonly style: HTMLStyleElement
  private layers: InstalledLayer[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private styleRepairs = 0
  private currentUrl: string

  constructor(
    private readonly document: Document,
    private readonly hooks: {
      data?: (
        layer: InstalledLayer,
        operation: Extract<LayerOperation, { kind: 'data-badge' }>,
        anchor: HTMLElement,
      ) => Omit<AppliedEffect, 'node'>
      status?: (statuses: LayerRuntimeStatus[]) => void
      action?: (
        layer: InstalledLayer,
        actionId: string,
        anchor: HTMLElement,
      ) => void
    } = {},
  ) {
    this.currentUrl = document.location.href
    this.style = document.createElement('style')
    this.style.dataset.paneLayerOwned = 'true'
    this.style.textContent = `.${this.hiddenClass}{display:none!important}.${this.highlightClass}{outline:2px solid #718a35!important;outline-offset:2px!important}`
    document.documentElement.append(this.style)
    this.observer = new MutationObserver((records) => {
      if (records.every((record) => this.isOwned(record.target))) return
      this.schedule()
    })
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'contenteditable', 'href'],
    })
    document.addEventListener('focusout', this.schedule)
  }

  update(layers: InstalledLayer[], url = this.document.location.href): void {
    if (this.disposed) return
    if (url !== this.currentUrl) {
      this.clear()
      this.currentUrl = url
    }
    this.layers = layers
    this.reconcile()
  }

  /** Trusted harness evidence: report every operation, including unmatched ones. */
  inspect(layerId: string) {
    return [...this.operations.values()]
      .filter((entry) => entry.layer.id === layerId)
      .map((entry) => ({
        operationId: entry.operation.id,
        affectedElements: entry.effects.size,
        intact:
          !entry.failed &&
          [...entry.effects.values()].every((effect) => effect.intact()),
      }))
  }

  dispose(): void {
    this.disposed = true
    this.observer.disconnect()
    this.document.removeEventListener('focusout', this.schedule)
    if (this.timer) clearTimeout(this.timer)
    this.clear()
    this.style.remove()
  }

  private readonly schedule = (): void => {
    if (this.timer || this.disposed) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.reconcile()
    }, 32)
  }

  private clear(): void {
    for (const entry of this.operations.values()) {
      for (const effect of entry.effects.values()) effect.dispose()
    }
    this.operations.clear()
  }

  private isOwned(node: Node): boolean {
    return (
      node instanceof Element &&
      Boolean(node.closest('[data-pane-layer-owned]'))
    )
  }

  private safeTarget(node: Element): node is HTMLElement {
    return (
      node instanceof HTMLElement &&
      node !== this.document.documentElement &&
      node !== this.document.body &&
      !this.isOwned(node) &&
      ![
        'HEAD',
        'SCRIPT',
        'STYLE',
        'LINK',
        'META',
        'FORM',
        'INPUT',
        'TEXTAREA',
        'SELECT',
        'BUTTON',
        'OPTION',
        'TR',
        'TBODY',
        'THEAD',
      ].includes(node.tagName) &&
      !node.closest('form,[contenteditable]:not([contenteditable="false"])')
    )
  }

  private reconcile(): void {
    if (this.disposed) return
    if (!this.style.isConnected) {
      this.styleRepairs += 1
      if (this.styleRepairs > 5) {
        this.clear()
        this.hooks.status?.(
          this.layers.map((layer) => ({
            layerId: layer.id,
            state: 'error',
            affectedElements: 0,
            reason:
              'The page repeatedly removed Layer styling. Reload to retry.',
          })),
        )
        return
      }
      this.document.documentElement.append(this.style)
    }
    const expected = new Set<string>()
    for (const layer of this.layers) {
      if (
        layer.definition.mode !== 'managed' ||
        !layerMatchesUrl(layer.definition.scope, this.currentUrl)
      )
        continue
      for (const operation of layer.definition.operations)
        expected.add(`${layer.id}:${layer.version}:${operation.id}`)
    }
    for (const [key, entry] of this.operations) {
      if (!expected.has(key)) {
        for (const effect of entry.effects.values()) effect.dispose()
        this.operations.delete(key)
      }
    }
    const statuses: LayerRuntimeStatus[] = []
    for (const layer of this.layers) {
      if (layer.definition.mode !== 'managed') {
        statuses.push({
          layerId: layer.id,
          state: 'unsupported',
          affectedElements: 0,
        })
        continue
      }
      if (!layerMatchesUrl(layer.definition.scope, this.currentUrl)) {
        statuses.push({
          layerId: layer.id,
          state: 'not-applicable',
          affectedElements: 0,
        })
        continue
      }
      let count = 0
      let reason: string | undefined
      for (const operation of layer.definition.operations) {
        const key = `${layer.id}:${layer.version}:${operation.id}`
        let entry = this.operations.get(key)
        if (!entry) {
          entry = {
            layer,
            operation,
            effects: new Map(),
            revealed: new WeakSet(),
            repairs: new WeakMap(),
            failed: false,
          }
          this.operations.set(key, entry)
        }
        reason = this.reconcileOperation(key, entry) ?? reason
        count += entry.effects.size
      }
      statuses.push({
        layerId: layer.id,
        state: this.stateFor(reason, count),
        affectedElements: count,
        ...(reason ? { reason } : {}),
      })
    }
    this.hooks.status?.(statuses)
  }

  private stateFor(
    reason: string | undefined,
    count: number,
  ): LayerRuntimeStatus['state'] {
    if (reason) return 'error'
    return count ? 'mounted' : 'waiting'
  }

  private targets(operation: LayerOperation): Set<HTMLElement> {
    const matches = this.document.querySelectorAll(operation.anchor.selector)
    if (matches.length > 10_000)
      throw new Error(
        'Anchor search exceeds the page work limit. Use a narrower selector.',
      )
    const targets = new Set<HTMLElement>()
    for (const node of matches) {
      if (!this.safeTarget(node)) continue
      if (
        operation.anchor.textIncludes &&
        !node.textContent?.includes(operation.anchor.textIncludes)
      )
        continue
      targets.add(node)
      if (targets.size > operation.anchor.maxMatches)
        throw new Error(
          'Anchor is ambiguous; no changes applied to this operation.',
        )
    }
    return targets
  }

  private reconcileOperation(
    key: string,
    entry: ActiveOperation,
  ): string | undefined {
    if (entry.failed)
      return 'The page repeatedly removed this change. Disable and re-enable the Layer to retry.'
    try {
      const { operation } = entry
      const targets = this.targets(operation)
      for (const [node, effect] of entry.effects) {
        if (!node.isConnected || !targets.has(node) || !effect.intact()) {
          if (
            node.isConnected &&
            targets.has(node) &&
            !effect.intact() &&
            (operation.kind !== 'data-badge' ||
              effect.identity ===
                (node instanceof HTMLAnchorElement
                  ? node.href
                  : node.getAttribute('href')))
          )
            this.countRepair(entry, node)
          effect.dispose()
          entry.effects.delete(node)
        }
      }
      if (entry.failed)
        throw new Error(
          'The page repeatedly removed this change. Disable and re-enable the Layer to retry.',
        )
      if (operation.kind === 'button' && !this.hooks.action)
        throw new Error('Action runner is unavailable.')
      for (const node of targets) {
        if (entry.effects.has(node) || entry.revealed.has(node)) continue
        if (
          operation.kind === 'collapse' &&
          node.contains(this.document.activeElement)
        )
          continue
        entry.effects.set(node, this.apply(key, entry, node))
      }
    } catch (error) {
      for (const effect of entry.effects.values()) effect.dispose()
      entry.effects.clear()
      return error instanceof Error && error.name !== 'SyntaxError'
        ? error.message
        : 'Anchor could not be evaluated.'
    }
  }

  private countRepair(entry: ActiveOperation, node: HTMLElement): void {
    const now = performance.now()
    const previous = entry.repairs.get(node)
    const repair =
      previous && now - previous.since < 10_000
        ? previous
        : { count: 0, since: now }
    repair.count += 1
    entry.repairs.set(node, repair)
    if (repair.count > 5) entry.failed = true
  }

  private ownClass(
    node: HTMLElement,
    className: string,
    key: string,
  ): () => void {
    let classes = this.owners.get(node)
    if (!classes) {
      classes = new Map()
      this.owners.set(node, classes)
    }
    let owners = classes.get(className)
    if (!owners) {
      owners = new Set()
      classes.set(className, owners)
    }
    owners.add(key)
    node.classList.add(className)
    return () => {
      owners.delete(key)
      if (owners.size === 0) {
        node.classList.remove(className)
        classes.delete(className)
      }
      if (classes.size === 0) this.owners.delete(node)
    }
  }

  private apply(
    key: string,
    entry: ActiveOperation,
    node: HTMLElement,
  ): AppliedEffect {
    const { operation, layer } = entry
    if (operation.kind === 'data-badge') {
      if (!this.hooks.data) throw new Error('Data enrichment is unavailable.')
      return { node, ...this.hooks.data(layer, operation, node) }
    }
    if (operation.kind === 'highlight') {
      return {
        node,
        intact: () => node.classList.contains(this.highlightClass),
        dispose: this.ownClass(node, this.highlightClass, key),
      }
    }
    const host = this.document.createElement('span')
    host.dataset.paneLayerOwned = 'true'
    const shadow = host.attachShadow({ mode: 'open' })
    const button = this.document.createElement('button')
    button.type = 'button'
    button.dir = 'auto'
    button.textContent =
      operation.kind === 'collapse'
        ? `${operation.label} hidden by Pane · Show`
        : `${operation.label} · Pane`
    const style = this.document.createElement('style')
    style.textContent =
      ':host{display:inline-block;max-inline-size:100%;margin:6px 0}button{max-inline-size:100%;white-space:normal;overflow-wrap:anywhere;text-align:start;font:13px system-ui;padding:7px 10px;border:1px solid #8b917f;border-radius:6px;background:Canvas;color:CanvasText;cursor:pointer}button:focus-visible{outline:2px solid Highlight;outline-offset:2px}'
    shadow.append(style, button)
    const release =
      operation.kind === 'collapse'
        ? this.ownClass(node, this.hiddenClass, key)
        : () => {}
    const click = (event: MouseEvent) => {
      if (!event.isTrusted) return
      if (operation.kind === 'collapse') {
        const returnFocus = shadow.activeElement === button
        entry.revealed.add(node)
        entry.effects.get(node)?.dispose()
        entry.effects.delete(node)
        this.schedule()
        if (returnFocus) {
          // Revealing removes the focused Show control. Keep keyboard position
          // at the revealed region without permanently changing site markup.
          const temporary = !node.hasAttribute('tabindex')
          const restore = () => {
            if (temporary && node.getAttribute('tabindex') === '-1')
              node.removeAttribute('tabindex')
          }
          if (temporary) {
            node.setAttribute('tabindex', '-1')
            node.addEventListener('blur', restore, { once: true })
          }
          node.focus({ preventScroll: true })
          if (this.document.activeElement !== node) restore()
        }
      } else this.hooks.action?.(layer, operation.actionId, node)
    }
    button.addEventListener('click', click)
    node.after(host)
    return {
      node,
      intact: () =>
        host.isConnected &&
        host.parentNode === node.parentNode &&
        (operation.kind !== 'collapse' ||
          node.classList.contains(this.hiddenClass)),
      dispose: () => {
        release()
        button.removeEventListener('click', click)
        host.remove()
      },
    }
  }
}
