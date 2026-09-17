/** Only host-authored, non-sensitive messages may cross into a script world.
 * Never expose arbitrary provider/HTTP errors, which can contain credentials.
 */
export class LayerScriptRequestError extends Error {}

export function scriptActionFailureMessage(code: string): string {
  switch (code) {
    case 'PROVIDER_AUTH_REQUIRED':
      return 'Sign in to the saved provider in Settings, then retry this Layer action.'
    case 'PROVIDER_ACCESS_DENIED':
      return 'The saved provider denied this action. Check account or organization access; Pane has not switched providers.'
    case 'PROVIDER_RATE_LIMITED':
      return 'The saved provider reached its usage limit. Retry when access resets.'
    case 'DEADLINE_EXCEEDED':
      return 'The Layer agent action exceeded its time limit. Retry or ask the agent to adjust the action budget.'
    default:
      return 'The Layer agent action failed. Check Recent activity in Layers and the saved provider in Settings.'
  }
}

export function scriptRequestErrorMessage(error: unknown): string {
  return error instanceof LayerScriptRequestError
    ? error.message
    : 'The Layer request failed. Check Recent activity in Layers for action failures. If the page changed, reload it and retry.'
}
