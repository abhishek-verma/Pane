/** Only fixed diagnostics cross the provider boundary or enter persistent history. */
export const LAYER_ACTION_FAILURES = {
  CLAUDE_MODEL_MISSING:
    'The saved Claude model is missing. Select a model in provider settings.',
  CLAUDE_UNAVAILABLE: 'Claude Code is unavailable on this computer.',
  CLAUDE_MODEL_MISMATCH:
    'Claude resolved a model that does not match the saved selection. Check the saved model and host model overrides.',
  CLAUDE_TOOL_BOUNDARY:
    'Claude did not expose exactly the private tools required for this action. Check the installed Claude Code version.',
  CLAUDE_MODEL_CHANGED:
    'Claude reported work on a different model during the action. Pane rejected the result.',
  CLAUDE_RESULT_FAILED:
    'Claude did not complete a valid action in the originating page.',
  CLAUDE_OUTPUT_BUDGET: 'Claude exceeded the saved output-token budget.',
  CLAUDE_PAGE_UNVERIFIED:
    'Claude completed without browser-verified page effects.',
  CLAUDE_INVALID_RESULT: 'Claude returned invalid structured Layer data.',
  CLAUDE_RUN_INCOMPLETE:
    'Claude exited without completing this action within its limits.',
  CLAUDE_STREAM_LIMIT: 'Claude exceeded the action output limit.',
  CLAUDE_INVALID_STREAM: 'Claude returned an invalid action stream.',
  PROVIDER_ACCESS_DENIED:
    'Your organization has disabled Claude subscription access for Claude Code. Ask your administrator to enable access.',
  PROVIDER_AUTH_REQUIRED:
    'Sign in to the saved Claude provider before trying this action again.',
  PROVIDER_RATE_LIMITED:
    'The saved Claude provider has reached its usage limit. Try again when access resets.',
  DEADLINE_EXCEEDED: 'The action exceeded its saved time limit.',
  PROVIDER_RESULT_FAILED:
    'The provider did not complete a valid Layer action. Check the saved provider and retry.',
} as const

export type LayerActionFailureCode = keyof typeof LAYER_ACTION_FAILURES
export function layerActionFailureMessage(code: string): string {
  return Object.hasOwn(LAYER_ACTION_FAILURES, code)
    ? LAYER_ACTION_FAILURES[code as LayerActionFailureCode]
    : LAYER_ACTION_FAILURES.PROVIDER_RESULT_FAILED
}
