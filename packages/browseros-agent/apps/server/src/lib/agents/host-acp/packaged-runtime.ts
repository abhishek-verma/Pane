import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { z } from 'zod'

const adapterSchema = z.object({
  entrypoint: z.string().min(1),
  executable: z.string().min(1).optional(),
})
const manifestSchema = z.object({
  schema: z.literal(1),
  platform: z.string(),
  arch: z.string(),
  adapters: z.object({ claude: adapterSchema, codex: adapterSchema }),
})

export function resolvePackagedAcpRuntime(input: {
  resourcesDir?: string | null
  agentType: 'claude' | 'codex'
  platform?: NodeJS.Platform
  arch?: string
}) {
  if (!input.resourcesDir) return null
  const root = join(input.resourcesDir, 'acp-runtime')
  const manifestPath = join(root, 'runtime.json')
  if (!existsSync(manifestPath)) return null
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
  )
  const platform = input.platform ?? process.platform
  if (
    manifest.platform !== platform ||
    manifest.arch !== (input.arch ?? process.arch)
  ) {
    throw new Error(
      'Pane provider runtime does not match this computer. Reinstall the correct Pane build.',
    )
  }
  const realRoot = realpathSync(root)
  const resolveFile = (path: string) => {
    if (isAbsolute(path))
      throw new Error('Invalid absolute path in Pane runtime manifest')
    const resolved = realpathSync(join(root, path))
    const rel = relative(realRoot, resolved)
    if (rel.startsWith('..') || isAbsolute(rel) || !statSync(resolved).isFile())
      throw new Error('Invalid path in Pane runtime manifest')
    return resolved
  }
  const adapter = manifest.adapters[input.agentType]
  return {
    entrypoint: resolveFile(adapter.entrypoint),
    executable: adapter.executable
      ? resolveFile(adapter.executable)
      : undefined,
    preload:
      platform === 'darwin' ? resolveFile('native-loader.cjs') : undefined,
  }
}
