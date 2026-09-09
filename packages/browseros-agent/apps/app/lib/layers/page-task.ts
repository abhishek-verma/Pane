import {
  type PageTaskInput,
  pageTaskInputSchema,
  pageTaskResultSchema,
} from '@browseros/shared/layers/action-protocol'

const excluded =
  'form,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[data-pane-layer-owned]'
interface CapturedNode {
  nodeId: string
  element: HTMLElement
  text: string
}

/** A document-session plan over private live handles. The model receives no
 * selectors and cannot expand the captured scope or execute page code. */
export class LayerPageTaskSnapshot {
  private readonly nodes: CapturedNode[] = []
  private readonly outputs: HTMLElement[] = []
  private readonly effects: Array<() => void> = []
  private readonly url: string
  private invalid = false
  private readonly snapshotInput: PageTaskInput
  private readonly owner = `pane-task-${crypto.randomUUID()}`
  get input(): PageTaskInput {
    return structuredClone(this.snapshotInput)
  }

  constructor(private readonly anchor: HTMLElement) {
    this.url = anchor.ownerDocument.location.href
    // Landmark/section handles provide useful layout context while keeping
    // controls, forms, editable data and arbitrary DOM attributes private.
    const selector =
      'aside,nav,section,article,[role="complementary"],[role="navigation"]'
    const candidates = Array.from(
      anchor.querySelectorAll<HTMLElement>(selector),
    )
    if (anchor.matches(selector)) candidates.unshift(anchor)
    if (candidates.length > 2000)
      throw new Error('This page is too large. Choose a smaller section.')
    for (const element of candidates) {
      if (element.closest(excluded) || element.querySelector(excluded)) continue
      if (!element.checkVisibility({ checkVisibilityCSS: true })) continue
      // A plan cannot target both a container and a child. Prefer the smaller
      // section to avoid unintentionally collapsing the full article.
      if (element.querySelector(selector)) continue
      const text = element.textContent?.trim() ?? ''
      if (text.length > 2000) continue
      if (this.nodes.length === 64)
        throw new Error(
          'Too many sections. Choose a smaller part of this page.',
        )
      this.nodes.push({ nodeId: crypto.randomUUID(), element, text })
    }
    if (!this.nodes.length)
      throw new Error('No safe layout sections were found in this area.')
    this.snapshotInput = pageTaskInputSchema.parse({
      schema: 'pane.page-task-input.v1',
      nodes: this.nodes.map(({ nodeId, element, text }) => ({
        nodeId,
        role: element.getAttribute('role') ?? element.localName,
        text,
      })),
    })
  }

  current(): boolean {
    return (
      !this.invalid &&
      this.anchor.isConnected &&
      this.anchor.ownerDocument.location.href === this.url &&
      this.nodes.every(
        ({ element, text }) =>
          this.anchor.contains(element) &&
          element.textContent?.trim() === text &&
          !element.closest(excluded) &&
          !element.querySelector(excluded),
      )
    )
  }

  render(value: unknown): 'rendered' | 'stale' | 'invalid' {
    if (!this.current()) return 'stale'
    const result = pageTaskResultSchema.safeParse(value)
    if (!result.success) return 'invalid'
    const byId = new Map(this.nodes.map((node) => [node.nodeId, node.element]))
    if (result.data.operations.some((op) => !byId.has(op.nodeId)))
      return 'invalid'
    this.clear()
    const doc = this.anchor.ownerDocument
    const style = doc.createElement('style')
    style.dataset.paneLayerOwned = 'page-task'
    style.textContent = `.${this.owner}-collapse{display:none!important}.${this.owner}-highlight{outline:2px solid #718a35!important;outline-offset:2px!important}`
    doc.documentElement.append(style)
    this.outputs.push(style)
    for (const op of result.data.operations) {
      const element = byId.get(op.nodeId)
      if (!element) {
        this.clear()
        return 'invalid'
      }
      const className = `${this.owner}-${op.kind}`
      element.classList.add(className)
      this.effects.push(() => element.classList.remove(className))
      if (op.kind === 'collapse') {
        const host = doc.createElement('span')
        host.dataset.paneLayerOwned = 'page-task'
        const shadow = host.attachShadow({ mode: 'open' })
        const button = doc.createElement('button')
        button.type = 'button'
        button.textContent = `Show ${op.label}`
        button.addEventListener('click', (event) => {
          if (!event.isTrusted) return
          element.classList.remove(className)
          host.remove()
        })
        shadow.append(button)
        element.before(host)
        this.outputs.push(host)
      }
      const applied = doc.defaultView?.getComputedStyle(element)
      if (
        !element.classList.contains(className) ||
        (op.kind === 'collapse'
          ? applied?.display !== 'none'
          : applied?.outlineStyle !== 'solid')
      ) {
        this.clear()
        return 'invalid'
      }
    }
    return 'rendered'
  }

  dispose(): void {
    this.invalid = true
    this.clear()
  }
  private clear(): void {
    for (const dispose of this.effects.splice(0)) dispose()
    for (const output of this.outputs.splice(0)) output.remove()
  }
}
