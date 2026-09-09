import {
  type LayerActionBinding,
  layerActionBindingSchema,
  type PageTaskInput,
  type PageTaskResult,
  pageTaskInputSchema,
  pageTaskResultSchema,
  sameLayerActionBinding,
  type TranslationInput,
  type TranslationResult,
  translationInputSchema,
  translationResultSchema,
} from '@browseros/shared/layers/action-protocol'

export type ResultAcceptance =
  | { accepted: true; data: TranslationResult; duplicate: boolean }
  | {
      accepted: false
      code:
        | 'CANCELLED'
        | 'EXPIRED'
        | 'STALE_CONTEXT'
        | 'INVALID_RESULT'
        | 'CONFLICT'
      message: string
    }

/** An invocation-local terminal sink. Identity is captured by the runner,
 * never supplied as arguments to the model's result-submission tool. */
export class TranslationResultSink {
  private result: TranslationResult | null = null
  private cancelled = false
  private readonly input: TranslationInput
  private readonly binding: LayerActionBinding

  constructor(
    binding: LayerActionBinding,
    input: TranslationInput,
    private readonly deadline: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(deadline))
      throw new Error('A finite Layer action deadline is required.')
    this.binding = layerActionBindingSchema.parse(binding)
    this.input = translationInputSchema.parse(input)
  }

  cancel(): void {
    this.cancelled = true
  }

  submit(value: unknown, current: LayerActionBinding): ResultAcceptance {
    if (this.cancelled)
      return {
        accepted: false,
        code: 'CANCELLED',
        message: 'The invocation was cancelled.',
      }
    if (this.now() >= this.deadline)
      return {
        accepted: false,
        code: 'EXPIRED',
        message: 'The invocation deadline expired.',
      }
    if (!sameLayerActionBinding(this.binding, current))
      return {
        accepted: false,
        code: 'STALE_CONTEXT',
        message: 'The target or grant changed.',
      }
    const parsed = translationResultSchema.safeParse(value)
    if (!parsed.success)
      return {
        accepted: false,
        code: 'INVALID_RESULT',
        message: 'Result does not match the translation schema or size limits.',
      }
    const data = parsed.data
    const expected = new Set(this.input.blocks.map((block) => block.blockId))
    if (
      data.targetLanguage !== this.input.targetLanguage ||
      data.blocks.length !== expected.size ||
      new Set(data.blocks.map((block) => block.blockId)).size !==
        expected.size ||
      data.blocks.some((block) => !expected.has(block.blockId))
    ) {
      return {
        accepted: false,
        code: 'INVALID_RESULT',
        message:
          'Return each requested block exactly once, in the requested target language.',
      }
    }
    // Canonical source order also makes reordered retries idempotent.
    const byId = new Map(data.blocks.map((block) => [block.blockId, block]))
    data.blocks = this.input.blocks.flatMap((block) => {
      const result = byId.get(block.blockId)
      return result ? [result] : []
    })
    if (this.result) {
      return JSON.stringify(data) === JSON.stringify(this.result)
        ? {
            accepted: true,
            data: structuredClone(this.result),
            duplicate: true,
          }
        : {
            accepted: false,
            code: 'CONFLICT',
            message: 'A different result was already accepted.',
          }
    }
    this.result = structuredClone(data)
    return { accepted: true, data: structuredClone(data), duplicate: false }
  }
}

/** Page tasks can select only opaque handles captured by the content harness.
 * They cannot introduce selectors, scripts, URLs, or editable controls. */
export class PageTaskResultSink {
  private result: PageTaskResult | null = null
  private cancelled = false
  private readonly binding: LayerActionBinding
  private readonly input: PageTaskInput
  constructor(
    binding: LayerActionBinding,
    input: PageTaskInput,
    private readonly deadline: number,
    private readonly now = Date.now,
  ) {
    if (!Number.isFinite(deadline))
      throw new Error('A finite deadline is required.')
    this.binding = layerActionBindingSchema.parse(binding)
    this.input = pageTaskInputSchema.parse(input)
  }
  cancel() {
    this.cancelled = true
  }
  submit(value: unknown, current: LayerActionBinding): PageTaskAcceptance {
    const reject = (
      code: Exclude<PageTaskAcceptance, { accepted: true }>['code'],
      message: string,
    ): PageTaskAcceptance => ({ accepted: false, code, message })
    if (this.cancelled)
      return reject('CANCELLED', 'The invocation was cancelled.')
    if (this.now() >= this.deadline)
      return reject('EXPIRED', 'The invocation deadline expired.')
    if (!sameLayerActionBinding(this.binding, current))
      return reject('STALE_CONTEXT', 'The target or grant changed.')
    const parsed = pageTaskResultSchema.safeParse(value)
    const allowed = new Set(this.input.nodes.map((node) => node.nodeId))
    if (
      !parsed.success ||
      parsed.data.operations.some((op) => !allowed.has(op.nodeId))
    )
      return reject(
        'INVALID_RESULT',
        'Return bounded collapse or highlight operations using only the supplied node IDs.',
      )
    const data = parsed.data
    data.operations.sort((a, b) => a.nodeId.localeCompare(b.nodeId))
    if (this.result && JSON.stringify(this.result) !== JSON.stringify(data))
      return reject('CONFLICT', 'A different result was already accepted.')
    const duplicate = this.result !== null
    this.result = structuredClone(data)
    return { accepted: true, data: structuredClone(data), duplicate }
  }
}
export type PageTaskAcceptance =
  | Exclude<ResultAcceptance, { accepted: true }>
  | { accepted: true; data: PageTaskResult; duplicate: boolean }
