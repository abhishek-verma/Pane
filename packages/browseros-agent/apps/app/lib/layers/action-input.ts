import {
  actionAcceptsInput,
  layerActionInputSchema,
} from '@browseros/shared/layers/action-protocol'
import type { LayerAction } from '@browseros/shared/layers/manifest'
import { LayerScriptRequestError } from './script-errors'

/** Report the host contract without forwarding a Zod error or page payload
 * into a script world. Invalid input must never reach a provider. */
export function parseLayerActionInput(
  action: LayerAction | undefined,
  input: unknown,
) {
  const parsed = layerActionInputSchema.safeParse(input)
  if (action && parsed.success && actionAcceptsInput(action, parsed.data))
    return parsed.data
  throw new LayerScriptRequestError(
    action?.kind === 'page-task' && action.execution === 'javascript'
      ? 'Invalid generated-script action input. Call paneLayer.request(actionId, {schema:"pane.script-task-input.v1"}) with no other fields. Put the task in the saved action instruction; briefSelector and briefBytes are not supported.'
      : 'The supplied input does not match the saved Layer action. Ask the agent to repair the action payload.',
  )
}
