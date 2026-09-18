/** Context-window selection is not part of the API model ID in modelUsage. */
export function claudeModelId(model: string): string {
  return model.replace(/\[1m\]$/i, '')
}

/** Let the installed CLI resolve moving aliases; do not pin Pane to a release's
 * model versions. Explicit deployments remain exact, including host alias pins. */
export function matchesSavedClaudeModel(
  saved: string,
  resolved: unknown,
  env: NodeJS.ProcessEnv,
): resolved is string {
  if (typeof resolved !== 'string' || !resolved.trim()) return false
  const requested = claudeModelId(saved)
  const actual = claudeModelId(resolved)
  if (requested === actual) return true
  // 'default' deliberately selects the host/account default. Pin its init ID
  // for the rest of this invocation, just as for any other resolved alias.
  if (requested === 'default') return true
  if (
    !['sonnet', 'opus', 'haiku', 'fable', 'best', 'opusplan'].includes(
      requested,
    )
  )
    return false
  const families =
    requested === 'best'
      ? ['fable', 'opus']
      : requested === 'opusplan'
        ? ['sonnet']
        : [requested]
  return families.some((family) => {
    const override =
      env[`ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`]?.trim()
    if (override) return claudeModelId(override) === actual
    // Covers both claude-sonnet-5 and older claude-3-5-sonnet IDs, including
    // Bedrock/Vertex provider prefixes, without accepting a different family.
    return new RegExp(
      `(?:^|[./:])claude-(?:\\d+-)*${family}(?:-\\d|@\\d)`,
    ).test(actual)
  })
}
