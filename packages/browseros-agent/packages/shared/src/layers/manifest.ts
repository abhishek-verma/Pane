import { z } from 'zod'
import { dataOperationIdSchema } from './data'

export const LAYER_PROTOCOL = 'pane.layers.v1' as const
export const LAYER_LIMITS = {
  operations: 32,
  selectorLength: 512,
  matchesPerOperation: 100,
  blocks: 256,
  blockCharacters: 16_000,
  resultCharacters: 128_000,
} as const

export const layerIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,96}$/)

export const layerOriginSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        url.origin === value &&
        !url.username &&
        !url.password
      )
    } catch {
      return false
    }
  }, 'Use an exact HTTP(S) origin without path, credentials, or a trailing slash.')

const pathSchema = z
  .string()
  .min(1)
  .max(1024)
  .startsWith('/')
  .refine(
    (value) =>
      !/[?#]/.test(value) &&
      !Array.from(value).some((char) => char.charCodeAt(0) < 32),
    'Path patterns cannot contain queries, fragments or control characters.',
  )

export const layerScopeSchema = z
  .object({
    origin: layerOriginSchema,
    paths: z.array(pathSchema).min(1).max(16),
    excludePaths: z.array(pathSchema).max(16).default([]),
    query: z.record(z.string().max(128), z.string().max(512)).default({}),
    hash: z.string().max(512).optional(),
  })
  .strict()

export const layerAnchorSchema = z
  .object({
    selector: z.string().trim().min(1).max(LAYER_LIMITS.selectorLength),
    textIncludes: z.string().min(1).max(256).optional(),
    maxMatches: z
      .number()
      .int()
      .min(1)
      .max(LAYER_LIMITS.matchesPerOperation)
      .default(1),
  })
  .strict()

export const layerOperationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: layerIdSchema,
      kind: z.literal('data-badge'),
      anchor: layerAnchorSchema,
      label: z.string().trim().min(1).max(80),
      actionId: layerIdSchema,
      field: z.enum(['stars', 'forks']),
    })
    .strict(),
  z
    .object({
      id: layerIdSchema,
      kind: z.literal('collapse'),
      anchor: layerAnchorSchema,
      label: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      id: layerIdSchema,
      kind: z.literal('highlight'),
      anchor: layerAnchorSchema,
    })
    .strict(),
  z
    .object({
      id: layerIdSchema,
      kind: z.literal('button'),
      anchor: layerAnchorSchema,
      label: z.string().trim().min(1).max(80),
      actionId: layerIdSchema,
    })
    .strict(),
])

export const layerActionSchema = z
  .object({
    id: layerIdSchema,
    kind: z.enum(['transform', 'page-task', 'data']),
    execution: z.literal('javascript').optional(),
    trigger: z.enum(['click', 'document-load']),
    instruction: z.string().trim().min(1).max(8000),
    outputSchema: z.enum([
      'pane.translation.v1',
      'pane.page-task-receipt.v1',
      'pane.script-task-receipt.v1',
      'pane.data.v1',
    ]),
    dataOperationId: dataOperationIdSchema.optional(),
    targetLanguage: z.string().min(2).max(35).optional(),
    providerId: z.string().min(1).max(128).optional(),
    limits: z
      .object({
        maxSteps: z.number().int().min(1).max(16),
        maxOutputTokens: z.number().int().min(128).max(32_000),
        deadlineMs: z.number().int().min(1000).max(120_000),
      })
      .strict(),
  })
  .strict()

export const layerScriptAssertionsSchema = z
  .array(
    z
      .object({
        id: layerIdSchema,
        selector: z.string().trim().min(1).max(LAYER_LIMITS.selectorLength),
        state: z.enum(['present', 'visible', 'hidden', 'absent']),
        maxMatches: z.number().int().min(1).max(100).default(1),
        textIncludes: z.string().min(1).max(256).optional(),
        afterAction: layerIdSchema.optional(),
      })
      .strict(),
  )
  .min(1)
  .max(16)

export const layerDefinitionSchema = z
  .object({
    protocol: z.literal(LAYER_PROTOCOL),
    name: z.string().trim().min(1).max(120),
    intent: z.string().trim().min(1).max(8000),
    scope: layerScopeSchema,
    mode: z.enum(['managed', 'javascript']),
    operations: z.array(layerOperationSchema).max(LAYER_LIMITS.operations),
    actions: z.array(layerActionSchema).max(8).default([]),
    source: z.string().min(1).max(128_000).optional(),
    assertions: layerScriptAssertionsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const error = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.mode === 'managed' && value.source !== undefined)
      error('Managed layers cannot contain JavaScript.')
    if (value.mode === 'managed' && value.assertions !== undefined)
      error(
        'Managed Layers use interpreter verification, not custom assertions.',
      )
    if (
      value.assertions &&
      new Set(value.assertions.map((item) => item.id)).size !==
        value.assertions.length
    )
      error('Assertion IDs must be unique.')
    if (
      value.mode === 'javascript' &&
      (!value.source || value.operations.length > 0)
    )
      error(
        'JavaScript layers require source and cannot include managed operations.',
      )
    if (value.mode === 'managed' && value.operations.length === 0)
      error('Managed layers require at least one operation.')
    if (
      new Set(
        value.actions
          .filter((action) => action.kind !== 'data')
          .map((action) => action.providerId ?? ''),
      ).size > 1
    )
      error(
        'Actions in one Layer must use the same configured provider. Create separate Layers for different providers.',
      )
    const actionIds = new Set(value.actions.map((action) => action.id))
    for (const assertion of value.assertions ?? [])
      if (assertion.afterAction && !actionIds.has(assertion.afterAction))
        error(`Unknown assertion action: ${assertion.afterAction}`)
    if (actionIds.size !== value.actions.length)
      error('Action IDs must be unique.')
    if (
      new Set(value.operations.map((op) => op.id)).size !==
      value.operations.length
    )
      error('Operation IDs must be unique.')
    for (const op of value.operations) {
      if (
        ['button', 'data-badge'].includes(op.kind) &&
        'actionId' in op &&
        !actionIds.has(op.actionId)
      )
        error(`Unknown action binding: ${op.actionId}`)
    }
    for (const op of value.operations) {
      if (
        op.kind === 'data-badge' &&
        !value.actions.some(
          (action) =>
            action.id === op.actionId &&
            action.kind === 'data' &&
            action.trigger === 'document-load',
        )
      )
        error('Data badges require a named data action on document load.')
    }
    for (const action of value.actions) {
      if (action.execution === 'javascript' && action.limits.maxSteps < 3)
        error(
          'Generated page tasks require at least three steps for inspect, execute and complete.',
        )
      if (
        action.kind === 'transform' &&
        (action.outputSchema !== 'pane.translation.v1' ||
          !action.targetLanguage)
      )
        error(
          'Translation actions require a target language and translation output schema.',
        )
      if (
        action.execution &&
        (value.mode !== 'javascript' || action.kind !== 'page-task')
      )
        error(
          'Generated script actions require a JavaScript Layer and page-task kind.',
        )
      if (
        action.kind === 'page-task' &&
        action.outputSchema !==
          (action.execution === 'javascript'
            ? 'pane.script-task-receipt.v1'
            : 'pane.page-task-receipt.v1')
      )
        error('Page tasks require a page-task receipt.')
      if (
        action.kind === 'data' &&
        (action.outputSchema !== 'pane.data.v1' || !action.dataOperationId)
      )
        error('Data actions require a data schema.')
    }
  })

export type LayerScope = z.infer<typeof layerScopeSchema>
export type LayerAnchor = z.infer<typeof layerAnchorSchema>
export type LayerOperation = z.infer<typeof layerOperationSchema>
export type LayerAction = z.infer<typeof layerActionSchema>
export type LayerDefinition = z.infer<typeof layerDefinitionSchema>

export const installedLayerSchema = z
  .object({
    id: layerIdSchema,
    version: z.string().regex(/^[a-f0-9]{64}$/),
    definition: layerDefinitionSchema,
  })
  .strict()

export type InstalledLayer = z.infer<typeof installedLayerSchema>

export const layerManifestSchema = z
  .object({
    protocol: z.literal(LAYER_PROTOCOL),
    profileId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    paused: z.boolean(),
    pausedOrigins: z.array(layerOriginSchema).max(1000),
    layers: z.array(installedLayerSchema).max(1000),
  })
  .strict()

export type LayerManifest = z.infer<typeof layerManifestSchema>

export function layerProviderId(
  definition: LayerDefinition,
): string | undefined {
  return definition.actions.find((action) => action.kind !== 'data')?.providerId
}
