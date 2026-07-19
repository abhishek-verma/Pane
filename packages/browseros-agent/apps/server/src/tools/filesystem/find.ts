import { tool } from 'ai'
import { z } from 'zod'
import {
  DEFAULT_FIND_LIMIT,
  executeWithMetrics,
  resolveWorkspacePath,
  toModelOutput,
  walkFiles,
} from './utils'

const TOOL_NAME = 'filesystem_find'

/** Case-fold a glob pattern for insensitive matching. */
function foldPattern(pattern: string): string {
  return pattern.toLowerCase()
}

/**
 * Match path against glob; case-insensitive by default.
 * For simple star-star/leaf patterns (no directory constraint), also match
 * path segments so *interview* finds files under Interviews/.
 */
function pathMatches(
  relativePath: string,
  pattern: string,
  caseSensitive: boolean,
): boolean {
  const path = caseSensitive ? relativePath : relativePath.toLowerCase()
  const pat = caseSensitive ? pattern : foldPattern(pattern)
  if (new Bun.Glob(pat).match(path)) return true

  // Segment fallback only for unconstrained **/leaf patterns — not src/**/*.ts
  const unconstrained =
    !pat.includes('/') || /^\*\*\/[^/]+$/.test(pat) || /^[^/]+$/.test(pat)
  if (!unconstrained) return false

  const leaf = pat.replace(/^\*\*\//, '')
  const leafGlob = new Bun.Glob(leaf)
  for (const segment of path.split(/[/\\]/)) {
    if (segment && leafGlob.match(segment)) return true
  }
  return false
}

export function createFindTool(cwd: string) {
  return tool({
    description:
      'Find files matching a glob pattern (case-insensitive by default). Searches recursively, skipping common build directories (node_modules, .git, dist, etc.). Returns relative file paths.',
    inputSchema: z.object({
      pattern: z
        .string()
        .describe(
          'Glob pattern (e.g., "*.ts", "**/*.json", "*interview*", "src/**/*.test.ts")',
        ),
      path: z
        .string()
        .optional()
        .describe('Directory to search relative to the selected workspace'),
      limit: z
        .number()
        .optional()
        .describe(`Maximum results (default: ${DEFAULT_FIND_LIMIT})`),
      caseSensitive: z
        .boolean()
        .optional()
        .describe('When true, match exact case (default false)'),
    }),
    execute: (params) =>
      executeWithMetrics(TOOL_NAME, async () => {
        const searchPath = await resolveWorkspacePath(cwd, params.path || '.')
        const limit = params.limit || DEFAULT_FIND_LIMIT
        const caseSensitive = params.caseSensitive === true

        let effectivePattern = params.pattern
        if (
          !effectivePattern.includes('/') &&
          !effectivePattern.includes('**')
        ) {
          effectivePattern = `**/${effectivePattern}`
        }

        const matches: string[] = []

        for await (const file of walkFiles(searchPath, searchPath)) {
          if (pathMatches(file.path, effectivePattern, caseSensitive)) {
            matches.push(file.path)
            if (matches.length >= limit) break
          }
        }

        if (matches.length === 0) {
          return { text: `No files matching "${params.pattern}" found.` }
        }

        matches.sort()
        let result = matches.join('\n')
        if (matches.length >= limit) {
          result += `\n\n(Showing first ${limit} results. Use limit=${limit * 2} to see more.)`
        }

        return { text: result }
      }),
    toModelOutput,
  })
}
