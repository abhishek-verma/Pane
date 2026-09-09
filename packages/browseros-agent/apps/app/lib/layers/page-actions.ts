import { layerActionBindingSchema } from '@browseros/shared/layers/action-protocol'
import type { InstalledLayer } from '@browseros/shared/layers/manifest'
import { LayerActionEvents } from './action-events'
import { LAYER_CHANNEL } from './messages'
import { LayerPageTaskSnapshot } from './page-task'
import { LayerTranslationSnapshot } from './translation'

interface Job {
  layer: InstalledLayer
  snapshot?: LayerTranslationSnapshot | LayerPageTaskSnapshot
  dispose: () => void
}

/** Packaged click harness: only the runtime's trusted user-event hook enters
 * here. The page cannot send instructions or choose a provider for an action. */
export class LayerPageActions {
  private readonly jobs = new Map<string, Job>()
  private activePageTask: string | undefined
  readonly completedActions = new Set<string>()
  constructor(
    private readonly context: () => { instanceId: string; routeEpoch: number },
  ) {}

  update(layers: InstalledLayer[]): void {
    for (const [key, job] of this.jobs) {
      if (
        !layers.some(
          (layer) =>
            layer.id === job.layer.id && layer.version === job.layer.version,
        )
      ) {
        job.dispose()
        this.jobs.delete(key)
      }
    }
  }
  dispose(): void {
    this.update([])
    this.completedActions.clear()
  }
  run(layer: InstalledLayer, actionId: string, anchor: HTMLElement): void {
    const action = layer.definition.actions.find((item) => item.id === actionId)
    if (!action || !['transform', 'page-task'].includes(action.kind)) return
    if (action.kind === 'transform' && !action.targetLanguage) return
    const isTask = action.kind === 'page-task'
    const key = `${layer.id}:${layer.version}:${action.id}`
    this.jobs.get(key)?.dispose()
    const doc = anchor.ownerDocument
    const host = doc.createElement('div')
    host.dataset.paneLayerOwned = 'action-status'
    const shadow = host.attachShadow({ mode: 'open' })
    const style = doc.createElement('style')
    style.textContent =
      ':host{display:block;margin:8px 0}div{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 12px;border:1px solid GrayText;border-radius:8px;background:Canvas;color:CanvasText;font:13px system-ui}span{overflow-wrap:anywhere;min-inline-size:0}button{cursor:pointer;font:inherit;color:inherit;background:transparent;border:1px solid GrayText;border-radius:5px;padding:4px 8px}button:focus-visible{outline:2px solid Highlight;outline-offset:2px}'
    const row = doc.createElement('div')
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', `Pane action: ${layer.definition.name}`)
    const label = doc.createElement('span')
    label.setAttribute('role', 'status')
    label.textContent = isTask
      ? 'Pane is adapting this section…'
      : 'Pane is translating this section…'
    const control = doc.createElement('button')
    control.type = 'button'
    control.textContent = 'Cancel'
    row.append(label, control)
    shadow.append(style, row)
    anchor.after(host)
    let snapshot: LayerTranslationSnapshot | LayerPageTaskSnapshot
    try {
      if (isTask && this.activePageTask)
        throw new Error(
          'Another page change is running. Wait or cancel it first.',
        )
      snapshot = isTask
        ? new LayerPageTaskSnapshot(anchor)
        : new LayerTranslationSnapshot(anchor, action.targetLanguage ?? '')
    } catch (error) {
      label.textContent =
        error instanceof Error
          ? error.message
          : 'This section cannot be translated.'
      control.textContent = 'Dismiss'
      this.jobs.set(key, { layer, dispose: () => host.remove() })
      control.addEventListener('click', (event) => {
        if (event.isTrusted) host.remove()
      })
      return
    }
    if (isTask) this.activePageTask = key
    const invocationId = crypto.randomUUID()
    const snapshotId = crypto.randomUUID()
    const captured = this.context()
    let disposed = false
    let settled = false
    const cancel = () => {
      void chrome.runtime
        .sendMessage({
          channel: LAYER_CHANNEL,
          kind: 'action-cancel',
          invocationId,
          ...captured,
        })
        .catch(() => undefined)
    }
    const dispose = () => {
      if (disposed) return
      disposed = true
      if (this.activePageTask === key) this.activePageTask = undefined
      if (!settled) cancel()
      clearInterval(watch)
      snapshot.dispose()
      host.remove()
    }
    const watch = setInterval(() => {
      if (
        !snapshot.current() ||
        this.context().routeEpoch !== captured.routeEpoch
      )
        dispose()
    }, 250)
    const job = { layer, snapshot, dispose }
    this.jobs.set(key, job)
    control.addEventListener('click', (event) => {
      if (!event.isTrusted) return
      dispose()
      if (this.jobs.get(key) === job) this.jobs.delete(key)
    })
    void chrome.runtime
      .sendMessage({
        channel: LAYER_CHANNEL,
        kind: 'action-run',
        invocationId,
        snapshotId,
        ...captured,
        layerId: layer.id,
        version: layer.version,
        actionId,
        input: snapshot.input,
      })
      .then((reply: unknown) => {
        if (
          disposed ||
          !snapshot.current() ||
          this.context().routeEpoch !== captured.routeEpoch
        )
          return
        const response = reply as {
          binding?: unknown
          events?: unknown[]
          error?: string
        }
        if (response?.error) throw new Error(response.error)
        const binding = layerActionBindingSchema.parse(response?.binding)
        if (
          binding.invocationId !== invocationId ||
          binding.instanceId !== captured.instanceId ||
          binding.routeEpoch !== captured.routeEpoch ||
          binding.snapshotId !== snapshotId ||
          binding.layerId !== layer.id ||
          binding.layerVersion !== layer.version ||
          binding.actionId !== actionId
        )
          throw new Error('The action returned for a different page context.')
        const receiver = new LayerActionEvents(binding)
        let rendered = false
        for (const event of response.events ?? []) {
          const result = receiver.receive(event, binding)
          if (result.status === 'completed') {
            if (snapshot.render(result.data) !== 'rendered')
              throw new Error(
                'The source changed or the effect could not be verified. Try again.',
              )
            rendered = true
          } else if (
            ['failed', 'cancelled', 'invalid', 'gap'].includes(result.status)
          )
            throw new Error(
              result.status === 'cancelled'
                ? 'Action cancelled.'
                : result.status === 'failed' &&
                    result.code === 'DEADLINE_EXCEEDED'
                  ? 'This action reached its time limit. Try a smaller section.'
                  : 'The provider did not return a complete valid result. Try again.',
            )
        }
        if (!rendered) throw new Error('The action did not complete.')
        this.completedActions.add(key)
        label.textContent = isTask
          ? 'Page changes applied and verified for this visit.'
          : 'Translation added. Original text is preserved.'
        control.textContent = isTask ? 'Undo changes' : 'Undo translation'
      })
      .catch((error) => {
        if (disposed) return
        label.textContent =
          error instanceof Error ? error.message : 'Action failed. Try again.'
        control.textContent = 'Dismiss'
      })
      .finally(() => {
        settled = true
        if (this.activePageTask === key) this.activePageTask = undefined
      })
  }
}
