import {
  assessLayerRequirements,
  definitionCapabilityErrors,
  type LayerCapabilities,
  layerRequirementsSchema,
} from '@browseros/shared/layers/capabilities'
import { DATA_OPERATIONS } from '@browseros/shared/layers/data'
import { layerDefinitionSchema } from '@browseros/shared/layers/manifest'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { buildLayerAuthoringTools } from './authoring'
import { layerBroker } from './broker'
import { getLayerAccess } from './broker-auth'
import { validateLayerSource } from './script-validation'

/** Fail closed until native bootstrap, the broker and provider action adapters
 * are integrated and verified. Do not infer availability from provider names. */
const CURRENT_LAYER_CAPABILITIES: Readonly<LayerCapabilities> = Object.freeze({
  revision: 'layers-foundation-v1',
  managed: false,
  authenticatedBroker: false,
  transform: false,
  pageTask: false,
  data: false,
  javascript: false,
  automaticInference: false,
  provider: 'unverified',
})

export function buildLayerToolSet(
  getCapabilities?: () => LayerCapabilities,
  providerId?: string,
): ToolSet {
  const capabilities =
    getCapabilities ??
    (() => {
      const access = getLayerAccess()
      return access && access.expiresAt > Date.now()
        ? layerBroker.capabilities(access.profileId, providerId)
        : CURRENT_LAYER_CAPABILITIES
    })
  return {
    ...buildLayerAuthoringTools(providerId),
    layer_data_sources: tool({
      description:
        'List registered Layer data operations and their exact destination, available fields and disclosure. Only these named sources can run; never invent a third-party API.',
      inputSchema: z.object({}).strict(),
      execute: async () => ({
        text: JSON.stringify({
          sources: DATA_OPERATIONS,
          available: capabilities().data,
        }),
      }),
    }),
    layer_assess: tool({
      description:
        'Check whether this Pane build can fulfill a persistent website customization before promising it. Load the layers skill. Reports unsupported requests and unavailable providers explicitly. This read-only check does not install or enable a Layer.',
      inputSchema: layerRequirementsSchema,
      execute: async (requirements) => ({
        text: JSON.stringify(
          assessLayerRequirements(requirements, capabilities()),
        ),
      }),
    }),
    layer_validate: tool({
      description:
        'Validate a candidate Layer program and script syntax without saving or executing it. Load layers-managed or layers-javascript for its schema. A valid program is not proof of page behavior, verification, consent, or runtime availability.',
      inputSchema: z.object({ definition: z.unknown() }).strict(),
      execute: async ({ definition }) => {
        const parsed = layerDefinitionSchema.safeParse(definition)
        if (!parsed.success)
          return {
            text: JSON.stringify({
              valid: false,
              issues: parsed.error.issues.map(({ path, message }) => ({
                path,
                message,
              })),
            }),
          }
        try {
          validateLayerSource(parsed.data)
        } catch (error) {
          return {
            text: JSON.stringify({
              valid: false,
              issues: [{ path: ['source'], message: (error as Error).message }],
            }),
          }
        }
        const capabilityErrors = definitionCapabilityErrors(
          parsed.data,
          capabilities(),
        )
        return {
          text: JSON.stringify({
            valid: true,
            executable: capabilityErrors.length === 0,
            capabilityErrors,
            definition: parsed.data,
            saved: false,
            verified: false,
          }),
        }
      },
    }),
  }
}
