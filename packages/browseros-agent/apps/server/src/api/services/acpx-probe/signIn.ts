import { spawn } from 'node:child_process'
import { splitArgv } from 'acp-probe'
import { resolveAcpSpawnCommand } from '../../../lib/agents/host-acp/launcher'
import { getBrowserosDir } from '../../../lib/browseros-dir'

let signingIn = false

/** Use the same runtime and credentials as conversations, only on an explicit click. */
export async function signInToCodex(
  input: {
    resourcesDir?: string | null
    signal: AbortSignal
  },
  dependencies: {
    resolveLauncher?: typeof resolveAcpSpawnCommand
    run?: typeof runSignInProcess
  } = {},
) {
  if (signingIn)
    throw new Error('Codex sign-in is already open. Finish it in your browser.')
  signingIn = true
  try {
    input.signal.throwIfAborted()
    const launcher = await (
      dependencies.resolveLauncher ?? resolveAcpSpawnCommand
    )({
      agentType: 'codex',
      browserosDir: getBrowserosDir(),
      resourcesDir: input.resourcesDir,
    })
    if (!launcher) throw new Error('The Codex sign-in runtime is unavailable.')
    await (dependencies.run ?? runSignInProcess)(
      [
        ...splitArgv(launcher.command),
        'login',
        '--client-name=pane',
        '--client-title=Pane',
      ],
      input.signal,
    )
  } finally {
    signingIn = false
  }
}

export function runSignInProcess(
  argv: string[],
  signal: AbortSignal,
  timeoutMs = 300_000,
): Promise<void> {
  signal.throwIfAborted()
  const [command, ...args] = argv
  if (!command) throw new Error('The Codex sign-in runtime is unavailable.')
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      // The adapter owns an app-server child. Stop the whole process group on
      // cancellation/timeout so an abandoned browser callback cannot linger.
      try {
        if (process.platform !== 'win32' && child.pid)
          process.kill(-child.pid, 'SIGKILL')
        else if (child.pid && process.platform === 'win32') {
          const killer = spawn(
            'taskkill',
            ['/pid', String(child.pid), '/T', '/F'],
            { stdio: 'ignore', windowsHide: true },
          )
          killer.on('error', () => child.kill('SIGKILL'))
        } else child.kill('SIGKILL')
      } catch {
        /* Already exited. */
      }
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(new Error('Codex sign-in was cancelled.'))
    const timer = setTimeout(
      () => finish(new Error('Codex sign-in timed out. Try again.')),
      timeoutMs,
    )
    signal.addEventListener('abort', abort, { once: true })
    child.once('error', () =>
      finish(new Error('Could not start Codex sign-in.')),
    )
    child.once('exit', (code) =>
      finish(
        code === 0
          ? undefined
          : new Error('Codex sign-in did not complete. Try again.'),
      ),
    )
    if (signal.aborted) abort()
  })
}
