import type { LayerScope } from './manifest'

/** Only '*' is special. Avoid generated regular expressions/backtracking. */
function matchesPath(pattern: string, path: string): boolean {
  let p = 0
  let index = 0
  let star = -1
  let retry = 0
  while (index < path.length) {
    if (pattern[p] === '*') {
      star = p++
      retry = index
    } else if (pattern[p] === path[index]) {
      p++
      index++
    } else if (star !== -1) {
      p = star + 1
      index = ++retry
    } else return false
  }
  while (pattern[p] === '*') p++
  return p === pattern.length
}

export function layerMatchesUrl(scope: LayerScope, input: string): boolean {
  try {
    if (input.length > 8192) return false
    const url = new URL(input)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return false
    if (url.origin !== scope.origin) return false
    if (!scope.paths.some((path) => matchesPath(path, url.pathname)))
      return false
    if (scope.excludePaths.some((path) => matchesPath(path, url.pathname)))
      return false
    for (const [key, expected] of Object.entries(scope.query)) {
      const values = url.searchParams.getAll(key)
      if (values.length !== 1 || values[0] !== expected) return false
    }
    return scope.hash === undefined || url.hash.slice(1) === scope.hash
  } catch {
    return false
  }
}
