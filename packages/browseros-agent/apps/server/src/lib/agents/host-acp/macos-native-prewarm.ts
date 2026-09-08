import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Temporary data only. Production native modules are extracted at BUILD time
// and signed inside the app. Never ad-hoc sign user files, register spctl
// exceptions, or launch an administrator prompt from provider health checks.
export const BUN_PREWARM_SUBDIR = 'bun-tmp'

export async function ensurePrewarmDir(browserosDir: string): Promise<string> {
  const dir = join(browserosDir, BUN_PREWARM_SUBDIR)
  await mkdir(dir, { recursive: true })
  return dir
}

export function prewarmEnvOverrides(dir: string): Record<string, string> {
  return { TMPDIR: dir }
}

export function defaultPrewarmDir(): string {
  return tmpdir()
}
