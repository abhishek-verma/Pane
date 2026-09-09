import { z } from 'zod'
import { DATA_OPERATIONS } from './data'
import type { LayerDefinition } from './manifest'
import { layerOriginSchema } from './manifest'

export const layerRequirementsSchema = z
  .object({
    origin: layerOriginSchema,
    execution: z.enum([
      'local',
      'transform',
      'page-task',
      'data',
      'javascript',
      'generated-script',
    ]),
    trigger: z.enum(['click', 'document-load']),
    content: z.enum(['readable-text', 'page-elements', 'all-content']),
    languages: z.enum(['selected', 'all']).default('selected'),
    dataOperationId: z.string().min(1).max(128).optional(),
  })
  .strict()
export type LayerRequirements = z.infer<typeof layerRequirementsSchema>

export interface LayerCapabilities {
  revision: string
  managed: boolean
  authenticatedBroker: boolean
  transform: boolean
  pageTask: boolean
  data: boolean
  javascript: boolean
  generatedScript?: boolean
  outputBudget?: 'accepted-output' | 'provider-ceiling'
  automaticInference: boolean
  provider: 'ready' | 'missing-setup' | 'unsupported' | 'unverified'
}

export interface LayerCapabilityCheck {
  requirement: string
  status: 'supported' | 'unsupported' | 'missing-setup' | 'unknown'
  reason: string
}

export interface LayerAssessment {
  disposition:
    | 'supported'
    | 'supported-with-limits'
    | 'needs-input'
    | 'unverified'
    | 'unsupported'
  capabilityRevision: string
  checks: LayerCapabilityCheck[]
  limitations: string[]
  alternatives: string[]
}

/** Runtime facts are supplied by the host, never by tool arguments or a model. */
export function assessLayerRequirements(
  request: LayerRequirements,
  capabilities: LayerCapabilities,
): LayerAssessment {
  const checks: LayerCapabilityCheck[] = []
  const addCheck = (requirement: string, enabled: boolean, reason: string) =>
    checks.push({
      requirement,
      status: enabled ? 'supported' : 'unsupported',
      reason: enabled ? 'Available in this runtime.' : reason,
    })
  addCheck(
    'authenticated-runtime',
    capabilities.authenticatedBroker,
    'The authenticated Layer runtime is not available.',
  )
  const enabled = {
    local: capabilities.managed,
    transform: capabilities.transform,
    'page-task': capabilities.pageTask,
    data: capabilities.data,
    javascript: capabilities.javascript,
    'generated-script': capabilities.generatedScript === true,
  }[request.execution]
  addCheck(
    'execution',
    enabled,
    `${request.execution} execution is not available in this runtime.`,
  )
  const usesModel =
    request.execution === 'transform' ||
    request.execution === 'page-task' ||
    request.execution === 'generated-script'
  if (request.execution === 'data') {
    const sourceKnown =
      request.dataOperationId !== undefined &&
      Object.hasOwn(DATA_OPERATIONS, request.dataOperationId)
    checks.push({
      requirement: 'registered-data-source',
      status: sourceKnown
        ? 'supported'
        : request.dataOperationId
          ? 'unsupported'
          : 'unknown',
      reason: sourceKnown
        ? 'This public data operation is registered.'
        : request.dataOperationId
          ? 'This data source is not registered. Do not invent an API or substitute unrelated data.'
          : 'Choose an operation from layer_data_sources before promising data enrichment.',
    })
    addCheck(
      'data-trigger',
      request.trigger === 'document-load',
      'Data enrichment currently runs for visible matching entities on page load, not as a button action.',
    )
  }
  if (usesModel && request.trigger === 'document-load')
    addCheck(
      'automatic-inference',
      capabilities.automaticInference,
      'Automatic model execution on page load is not supported. A persistent button is a different behavior.',
    )
  if (usesModel)
    checks.push({
      requirement: 'provider',
      status:
        capabilities.provider === 'ready'
          ? 'supported'
          : capabilities.provider === 'unverified'
            ? 'unknown'
            : capabilities.provider,
      reason:
        capabilities.provider === 'ready'
          ? 'The configured action provider is available.'
          : 'A compatible configured action provider must be verified before enabling this action.',
    })
  addCheck(
    'content-coverage',
    request.content !== 'all-content',
    'All-content coverage cannot be guaranteed: inaccessible frames, images and special viewers may be unsupported.',
  )
  addCheck(
    'language-coverage',
    request.languages !== 'all',
    'Universal language coverage cannot be guaranteed.',
  )
  const unsupported = checks.some((check) => check.status === 'unsupported')
  const missing = checks.some((check) => check.status === 'missing-setup')
  const unknown = checks.some((check) => check.status === 'unknown')
  return {
    disposition: assessmentDisposition(
      unsupported,
      missing,
      unknown,
      usesModel ||
        request.execution === 'data' ||
        request.execution === 'javascript',
    ),
    capabilityRevision: capabilities.revision,
    checks,
    limitations: [
      ...layerLimitations(request, usesModel),
      ...(usesModel && capabilities.outputBudget === 'accepted-output'
        ? [
            'Codex account actions enforce step and time limits and bound accepted output. The account backend has no hard token-spend ceiling; provider usage may exceed the accepted-output limit.',
          ]
        : []),
    ],
    alternatives:
      usesModel &&
      request.trigger === 'document-load' &&
      !capabilities.automaticInference &&
      enabled &&
      capabilities.authenticatedBroker &&
      capabilities.provider === 'ready'
        ? [
            'Offer a persistent click-to-run button; obtain agreement before changing the requested trigger.',
          ]
        : [],
  }
}

function assessmentDisposition(
  unsupported: boolean,
  missing: boolean,
  unknown: boolean,
  limited: boolean,
): LayerAssessment['disposition'] {
  if (unsupported) return 'unsupported'
  if (missing) return 'needs-input'
  if (unknown) return 'unverified'
  return limited ? 'supported-with-limits' : 'supported'
}

function layerLimitations(
  request: LayerRequirements,
  usesModel: boolean,
): string[] {
  if (usesModel)
    return [
      'Only the captured, accessible content is processed.',
      'Provider availability and configured work limits apply.',
      ...(request.execution === 'generated-script'
        ? [
            'The agent can generate new JavaScript for the approved page on each click. Existing effects may require reload to remove.',
          ]
        : []),
    ]
  if (request.execution === 'data')
    return [
      'Only the registered public fields and entity types are available.',
      'Values are cached and request limits apply. A source can be unavailable, denied or rate limited.',
    ]
  if (request.execution === 'javascript')
    return [
      'Scripts can read and change the matching page and make network requests. Isolated worlds share DOM.',
      'Disabling revokes agent requests and future injection; existing page effects may require a reload.',
      'Tracked work stops on route changes. Reload the matching route to run the script again.',
    ]
  return []
}

/** Re-run at activation: a plausible manifest is not evidence of runtime support. */
export function definitionCapabilityErrors(
  definition: LayerDefinition,
  capabilities: LayerCapabilities,
): string[] {
  const requirements: LayerRequirements[] = [
    {
      origin: definition.scope.origin,
      execution: definition.mode === 'javascript' ? 'javascript' : 'local',
      trigger: 'document-load',
      content: 'page-elements',
      languages: 'selected',
    },
    ...definition.actions.map((action) => ({
      origin: definition.scope.origin,
      execution:
        action.execution === 'javascript'
          ? ('generated-script' as const)
          : action.kind,
      trigger: action.trigger,
      content: 'readable-text' as const,
      languages: 'selected' as const,
      ...(action.dataOperationId
        ? { dataOperationId: action.dataOperationId }
        : {}),
    })),
  ]
  return [
    ...(definition.mode === 'javascript' && !definition.assertions?.length
      ? [
          'JavaScript Layers require independent DOM assertions before they can be previewed or enabled.',
        ]
      : []),
    ...(definition.mode === 'javascript' &&
    definition.assertions?.length &&
    !definition.assertions.some((item) => !item.afterAction)
      ? ['Include at least one script assertion for the initial page load.']
      : []),
    ...(definition.mode === 'javascript' &&
    definition.actions.some(
      (action) =>
        !definition.assertions?.some((item) => item.afterAction === action.id),
    )
      ? ['Each script action needs a DOM assertion tied to that action.']
      : []),
    ...new Set(
      requirements.flatMap((request) =>
        assessLayerRequirements(request, capabilities)
          .checks.filter((check) => check.status !== 'supported')
          .map((check) => check.reason),
      ),
    ),
  ]
}
