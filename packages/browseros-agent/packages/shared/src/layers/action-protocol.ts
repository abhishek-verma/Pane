import { z } from 'zod'
import { type DataInput, dataInputSchema, dataResultSchema } from './data'
import { LAYER_LIMITS, type LayerAction, layerIdSchema } from './manifest'

export const layerActionBindingSchema = z
  .object({
    profileId: z.string().uuid(),
    invocationId: layerIdSchema,
    layerId: layerIdSchema,
    layerVersion: z.string().regex(/^[a-f0-9]{64}$/),
    actionId: layerIdSchema,
    tabId: z.number().int().nonnegative(),
    frameId: z.literal(0),
    documentId: z.string().min(1).max(128),
    instanceId: layerIdSchema,
    routeEpoch: z.number().int().nonnegative(),
    snapshotId: layerIdSchema,
    revocationGeneration: z.number().int().nonnegative(),
  })
  .strict()
export type LayerActionBinding = z.infer<typeof layerActionBindingSchema>

const textBlockSchema = z
  .object({
    blockId: layerIdSchema,
    text: z.string().min(1).max(LAYER_LIMITS.blockCharacters),
  })
  .strict()

export const translationInputSchema = z
  .object({
    targetLanguage: z.string().min(2).max(35),
    blocks: z.array(textBlockSchema).min(1).max(LAYER_LIMITS.blocks),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.blocks.map((block) => block.blockId)).size !==
      value.blocks.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Source block IDs must be unique.',
      })
    if (
      value.blocks.reduce((sum, block) => sum + block.text.length, 0) >
      LAYER_LIMITS.resultCharacters
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Input exceeds the character budget.',
      })
  })
export type TranslationInput = z.infer<typeof translationInputSchema>

export const translationResultSchema = z
  .object({
    schema: z.literal('pane.translation.v1'),
    targetLanguage: z.string().min(2).max(35),
    blocks: z
      .array(
        z
          .object({
            blockId: layerIdSchema,
            translatedText: z
              .string()
              .trim()
              .min(1)
              .max(LAYER_LIMITS.blockCharacters),
          })
          .strict(),
      )
      .min(1)
      .max(LAYER_LIMITS.blocks),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.blocks.reduce(
        (sum, block) => sum + block.translatedText.length,
        0,
      ) > LAYER_LIMITS.resultCharacters
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Result exceeds the character budget.',
      })
  })
export type TranslationResult = z.infer<typeof translationResultSchema>

export const pageTaskInputSchema = z
  .object({
    schema: z.literal('pane.page-task-input.v1'),
    nodes: z
      .array(
        z
          .object({
            nodeId: layerIdSchema,
            role: z.string().max(40),
            text: z.string().max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.nodes.map((node) => node.nodeId)).size !==
      value.nodes.length
    )
      ctx.addIssue({ code: 'custom', message: 'Node IDs must be unique.' })
  })
export type PageTaskInput = z.infer<typeof pageTaskInputSchema>
export const pageTaskResultSchema = z
  .object({
    schema: z.literal('pane.page-task-receipt.v1'),
    operations: z
      .array(
        z
          .object({
            nodeId: layerIdSchema,
            kind: z.enum(['collapse', 'highlight']),
            label: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.operations.map((op) => op.nodeId)).size !==
      value.operations.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Each node can be changed once.',
      })
  })
export type PageTaskResult = z.infer<typeof pageTaskResultSchema>
export const scriptTaskInputSchema = z
  .object({ schema: z.literal('pane.script-task-input.v1') })
  .strict()
export type ScriptTaskInput = z.infer<typeof scriptTaskInputSchema>
export const scriptTaskResultSchema = z
  .object({
    schema: z.literal('pane.script-task-receipt.v1'),
    executions: z
      .array(
        z
          .object({
            executionId: z.string().uuid(),
            sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
            checks: z
              .array(
                z
                  .object({
                    operationId: layerIdSchema,
                    affectedElements: z.number().int().nonnegative(),
                    intact: z.boolean(),
                  })
                  .strict(),
              )
              .min(1)
              .max(16),
            recovery: z.literal('reload-required'),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict()
export type ScriptTaskResult = z.infer<typeof scriptTaskResultSchema>
export function isScriptTaskInput(
  value: LayerActionInput,
): value is ScriptTaskInput {
  return 'schema' in value && value.schema === 'pane.script-task-input.v1'
}
export const layerActionInputSchema = z.union([
  scriptTaskInputSchema,
  translationInputSchema,
  pageTaskInputSchema,
  dataInputSchema,
])
export const layerActionResultSchema = z.union([
  scriptTaskResultSchema,
  translationResultSchema,
  pageTaskResultSchema,
  dataResultSchema,
])
export type LayerActionInput = z.infer<typeof layerActionInputSchema>
export type LayerActionResult = z.infer<typeof layerActionResultSchema>
export function isDataInput(value: LayerActionInput): value is DataInput {
  return 'schema' in value && value.schema === 'pane.data-input.v1'
}
export function isPageTaskInput(
  value: LayerActionInput,
): value is PageTaskInput {
  return 'schema' in value && value.schema === 'pane.page-task-input.v1'
}

/** Shared input/action binding policy for the trusted worker and server. */
export function actionAcceptsInput(
  action: LayerAction,
  input: LayerActionInput,
): boolean {
  if (isDataInput(input))
    return (
      action.kind === 'data' &&
      action.trigger === 'document-load' &&
      action.dataOperationId === input.operationId
    )
  if (action.trigger !== 'click') return false
  if (isScriptTaskInput(input))
    return action.kind === 'page-task' && action.execution === 'javascript'
  if (isPageTaskInput(input))
    return action.kind === 'page-task' && action.execution === undefined
  return (
    action.kind === 'transform' &&
    action.targetLanguage === input.targetLanguage
  )
}

export const layerEventSchema = z
  .object({
    protocol: z.literal('pane.layer-action.v1'),
    binding: layerActionBindingSchema,
    sequence: z.number().int().positive(),
    payload: z.discriminatedUnion('type', [
      z.object({ type: z.literal('accepted') }).strict(),
      z
        .object({ type: z.literal('result'), data: layerActionResultSchema })
        .strict(),
      z.object({ type: z.literal('completed') }).strict(),
      z
        .object({
          type: z.literal('failed'),
          code: z.string().min(1).max(80),
          retryable: z.boolean(),
        })
        .strict(),
      z.object({ type: z.literal('cancelled') }).strict(),
    ]),
  })
  .strict()
export type LayerEvent = z.infer<typeof layerEventSchema>

/** Compare the entire captured authority, not only the URL or active tab. */
export function sameLayerActionBinding(
  a: LayerActionBinding,
  b: LayerActionBinding,
): boolean {
  return (
    Object.keys(layerActionBindingSchema.shape) as Array<
      keyof LayerActionBinding
    >
  ).every((key) => a[key] === b[key])
}
