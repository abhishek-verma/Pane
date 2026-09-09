/** Safe, actionable provider failures; raw account responses never reach pages. */
export class LayerProviderError extends Error {
  constructor(
    readonly code:
      | 'PROVIDER_ACCESS_DENIED'
      | 'PROVIDER_AUTH_REQUIRED'
      | 'PROVIDER_RATE_LIMITED',
    readonly retryable: boolean,
    message: string,
  ) {
    super(message)
  }
}

export function claudeAccountError(
  value: unknown,
): LayerProviderError | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.toLowerCase()
  if (
    text.includes('organization has disabled') &&
    text.includes('subscription access')
  )
    return new LayerProviderError(
      'PROVIDER_ACCESS_DENIED',
      false,
      'Your organization has disabled Claude subscription access for Claude Code. Ask your administrator to enable access; Pane has not switched providers.',
    )
  if (
    text.includes('not logged in') ||
    text.includes('invalid api key') ||
    text.includes('oauth token has expired')
  )
    return new LayerProviderError(
      'PROVIDER_AUTH_REQUIRED',
      false,
      'Sign in to the saved Claude provider before trying this action again.',
    )
  if (
    text.includes('hit your limit') ||
    text.includes('rate limit') ||
    text.includes('usage limit')
  )
    return new LayerProviderError(
      'PROVIDER_RATE_LIMITED',
      false,
      'The saved Claude provider has reached its usage limit. Try again when access resets.',
    )
  return undefined
}
