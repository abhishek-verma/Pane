import { layerActionBindingSchema } from '@browseros/shared/layers/action-protocol'
import {
  type DataEntry,
  dataResultSchema,
  repositoryEntityFromHref,
} from '@browseros/shared/layers/data'
import type {
  InstalledLayer,
  LayerOperation,
} from '@browseros/shared/layers/manifest'
import { LayerActionEvents } from './action-events'
import { LAYER_CHANNEL } from './messages'

export type Badge = Extract<LayerOperation, { kind: 'data-badge' }>
interface Item {
  id: string
  layer: InstalledLayer
  operation: Badge
  node: HTMLElement
  host: HTMLElement
  label: HTMLElement
  entityId: string
  href: string | null
  current: () => boolean
}

/** Deterministic visible-entity batching. No page text, HTML, API credentials or
 * caller-selected URLs are sent through this channel. */
export class LayerDataEnrichment {
  readonly completedActions = new Set<string>()
  private readonly queue = new Map<string, Item>()
  private readonly items = new Map<string, Item>()
  private readonly observer: IntersectionObserver
  private timer?: ReturnType<typeof setTimeout>
  private readonly refresh: ReturnType<typeof setInterval>
  constructor(
    private readonly context: () => { instanceId: string; routeEpoch: number },
  ) {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            for (const item of this.items.values())
              if (item.node === entry.target) this.enqueue(item)
            this.observer.unobserve(entry.target)
          }
      },
      { rootMargin: '200px' },
    )
    this.refresh = setInterval(() => {
      for (const item of this.items.values())
        if (
          item.current() &&
          item.node.getBoundingClientRect().top < innerHeight + 200 &&
          item.node.getBoundingClientRect().bottom > -200
        )
          this.enqueue(item)
    }, 5 * 60_000)
  }
  attach(layer: InstalledLayer, operation: Badge, node: HTMLElement) {
    const href =
      node instanceof HTMLAnchorElement ? node.href : node.getAttribute('href')
    const entityId = href
      ? repositoryEntityFromHref(new URL(href, node.ownerDocument.baseURI).href)
      : undefined
    const host = node.ownerDocument.createElement('span')
    host.dataset.paneLayerOwned = 'data'
    const shadow = host.attachShadow({ mode: 'open' })
    const style = node.ownerDocument.createElement('style')
    style.textContent =
      ':host{display:inline-block;margin:0 8px}span{font:12px system-ui;border:1px solid GrayText;border-radius:5px;padding:3px 6px;background:Canvas;color:CanvasText}'
    const label = node.ownerDocument.createElement('span')
    label.setAttribute('role', 'status')
    label.textContent = entityId
      ? `${operation.label}: loading…`
      : `${operation.label}: no supported repository link`
    shadow.append(style, label)
    node.after(host)
    let disposed = false
    const captured = this.context()
    const current = () =>
      !disposed &&
      node.isConnected &&
      host.isConnected &&
      (node instanceof HTMLAnchorElement
        ? node.href
        : node.getAttribute('href')) === href &&
      this.context().routeEpoch === captured.routeEpoch
    const item: Item | undefined = entityId
      ? {
          id: crypto.randomUUID(),
          layer,
          operation,
          node,
          host,
          label,
          entityId,
          href,
          current,
        }
      : undefined
    if (item) {
      this.items.set(item.id, item)
      this.observer.observe(node)
    }
    return {
      identity: href,
      intact: current,
      dispose: () => {
        disposed = true
        host.remove()
        this.observer.unobserve(node)
        if (item) {
          this.items.delete(item.id)
          this.queue.delete(item.id)
        }
      },
    }
  }
  dispose() {
    if (this.timer) clearTimeout(this.timer)
    clearInterval(this.refresh)
    this.observer.disconnect()
    this.queue.clear()
    this.items.clear()
    this.completedActions.clear()
  }
  private enqueue(item: Item) {
    if (!item.current()) return
    this.queue.set(item.id, item)
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined
        void this.flush()
      }, 100)
  }
  private async flush() {
    const groups = new Map<string, Item[]>()
    for (const item of this.queue.values()) {
      if (!item.current()) continue
      const key = `${item.layer.id}:${item.layer.version}:${item.operation.actionId}`
      const group = groups.get(key) ?? []
      group.push(item)
      groups.set(key, group)
    }
    this.queue.clear()
    for (const items of groups.values())
      for (let start = 0; start < items.length; start += 64)
        await this.run(items.slice(start, start + 64))
  }
  private async run(items: Item[]) {
    const first = items[0]
    if (!first) return
    const action = first.layer.definition.actions.find(
      (action) => action.id === first.operation.actionId,
    )
    if (action?.kind !== 'data' || !action.dataOperationId) return
    const captured = this.context()
    const invocationId = crypto.randomUUID(),
      snapshotId = crypto.randomUUID()
    try {
      const reply = await chrome.runtime.sendMessage({
        channel: LAYER_CHANNEL,
        kind: 'action-run',
        invocationId,
        snapshotId,
        ...captured,
        layerId: first.layer.id,
        version: first.layer.version,
        actionId: action.id,
        input: {
          schema: 'pane.data-input.v1',
          operationId: action.dataOperationId,
          entities: [...new Set(items.map((item) => item.entityId))],
        },
      })
      if (reply?.error) throw new Error('Data source unavailable.')
      const binding = layerActionBindingSchema.parse(reply?.binding)
      if (
        binding.invocationId !== invocationId ||
        binding.snapshotId !== snapshotId ||
        binding.layerId !== first.layer.id ||
        binding.layerVersion !== first.layer.version ||
        binding.actionId !== action.id ||
        binding.instanceId !== captured.instanceId ||
        binding.routeEpoch !== captured.routeEpoch
      )
        throw new Error('Stale data response.')
      const receiver = new LayerActionEvents(binding)
      let complete = false
      for (const event of reply.events ?? []) {
        const received = receiver.receive(event, binding)
        if (received.status !== 'completed') continue
        const result = dataResultSchema.parse(received.data)
        if (result.operationId !== action.dataOperationId)
          throw new Error('Wrong data operation.')
        const expected = new Set(items.map((item) => item.entityId))
        if (
          result.entries.length !== expected.size ||
          new Set(result.entries.map((entry) => entry.entityId)).size !==
            expected.size ||
          result.entries.some((entry) => !expected.has(entry.entityId))
        )
          throw new Error('Wrong entity response.')
        for (const item of items) {
          const entry = result.entries.find(
            (entry) => entry.entityId === item.entityId,
          )
          if (entry && item.current()) {
            this.render(item, entry)
            if (entry.state === 'fresh')
              this.completedActions.add(
                `${first.layer.id}:${first.layer.version}:${action.id}`,
              )
          }
        }
        complete = true
      }
      if (!complete) throw new Error('Data action did not complete.')
    } catch {
      for (const item of items)
        if (item.current())
          item.label.textContent = `${item.operation.label}: unavailable`
    }
  }
  private render(item: Item, entry: DataEntry) {
    const value = entry.values?.[item.operation.field]
    item.label.textContent =
      value === undefined
        ? `${item.operation.label}: ${entry.state}`
        : `${item.operation.label}: ${value.toLocaleString()}${entry.state === 'stale' ? ' · stale' : ''}`
    item.label.title =
      entry.fetchedAt === undefined
        ? 'Public GitHub data is unavailable.'
        : `Public GitHub data · fetched ${new Date(entry.fetchedAt).toLocaleString()}`
  }
}
