import {
  type LayerActionBinding,
  type LayerActionResult,
  layerEventSchema,
  sameLayerActionBinding,
} from '@browseros/shared/layers/action-protocol'

/** Per-invocation ordered receiver. Gaps require replay; an event cannot skip
 * ahead, render into a new document, or resurrect a locally cancelled action. */
export class LayerActionEvents {
  private sequence = 0
  private terminal = false
  private accepted = false
  private result: LayerActionResult | undefined

  private readonly binding: LayerActionBinding
  constructor(binding: LayerActionBinding) {
    this.binding = structuredClone(binding)
  }

  cancel(): void {
    this.terminal = true
    this.result = undefined
  }

  receive(
    value: unknown,
    currentBinding: LayerActionBinding,
  ):
    | { status: 'ignored' | 'invalid' | 'accepted' | 'cancelled' }
    | { status: 'failed'; code: string; retryable: boolean }
    | { status: 'gap'; after: number }
    | { status: 'completed'; data: LayerActionResult } {
    if (this.terminal) return { status: 'ignored' }
    const parsed = layerEventSchema.safeParse(value)
    if (!parsed.success) return { status: 'invalid' }
    const event = parsed.data
    if (
      !sameLayerActionBinding(this.binding, currentBinding) ||
      !sameLayerActionBinding(this.binding, event.binding)
    )
      return { status: 'ignored' }
    if (event.sequence <= this.sequence) return { status: 'ignored' }
    if (event.sequence !== this.sequence + 1)
      return { status: 'gap', after: this.sequence }
    switch (event.payload.type) {
      case 'accepted':
        if (this.accepted) return { status: 'invalid' }
        this.accepted = true
        break
      case 'result':
        if (!this.accepted || this.result) return { status: 'invalid' }
        this.result = event.payload.data
        break
      case 'completed':
        if (!this.accepted || !this.result) return { status: 'invalid' }
        this.sequence = event.sequence
        this.terminal = true
        return { status: 'completed', data: structuredClone(this.result) }
      case 'failed':
      case 'cancelled':
        this.sequence = event.sequence
        this.terminal = true
        this.result = undefined
        return event.payload.type === 'failed'
          ? {
              status: 'failed',
              code: event.payload.code,
              retryable: event.payload.retryable,
            }
          : { status: 'cancelled' }
    }
    this.sequence = event.sequence
    return { status: 'accepted' }
  }
}
