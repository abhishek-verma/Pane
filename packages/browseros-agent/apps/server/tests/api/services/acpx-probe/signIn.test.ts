import { describe, expect, it } from 'bun:test'
import { runSignInProcess } from '../../../../src/api/services/acpx-probe/signIn'

describe('Codex sign-in lifecycle', () => {
  it('succeeds only when the adapter exits successfully', async () => {
    await runSignInProcess(
      [process.execPath, '-e', 'process.exit(0)'],
      new AbortController().signal,
    )
    await expect(
      runSignInProcess(
        [process.execPath, '-e', 'process.exit(1)'],
        new AbortController().signal,
      ),
    ).rejects.toThrow('did not complete')
  })
  it('reports a missing runtime without exposing command details', async () => {
    await expect(
      runSignInProcess(
        ['/nonexistent/pane-codex-sign-in'],
        new AbortController().signal,
      ),
    ).rejects.toThrow('Could not start')
  })
  it('bounds an abandoned sign-in', async () => {
    await expect(
      runSignInProcess(
        [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
        new AbortController().signal,
        50,
      ),
    ).rejects.toThrow('timed out')
  })
  it('cancels a pending sign-in', async () => {
    const controller = new AbortController()
    const result = runSignInProcess(
      [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      controller.signal,
    )
    controller.abort()
    await expect(result).rejects.toThrow('cancelled')
  })
  it('does not launch after cancellation', () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    expect(() =>
      runSignInProcess(
        [process.execPath, '-e', 'process.exit(0)'],
        controller.signal,
      ),
    ).toThrow('cancelled')
  })
})

const { signInToCodex } = await import(
  '../../../../src/api/services/acpx-probe/signIn'
)

describe('Codex sign-in runtime', () => {
  it('uses the conversation launcher and preserves quoted paths without a shell', async () => {
    let argv: string[] = []
    await signInToCodex(
      { resourcesDir: '/release', signal: new AbortController().signal },
      {
        resolveLauncher: async (input) => {
          expect(input.agentType).toBe('codex')
          expect(input.resourcesDir).toBe('/release')
          return {
            source: 'packaged-runtime',
            command:
              'env "CODEX_PATH=/bundle/codex" "/bundle with spaces/bun" /bundle/adapter.js',
          }
        },
        run: async (args) => {
          argv = args
        },
      },
    )
    expect(argv).toEqual([
      'env',
      'CODEX_PATH=/bundle/codex',
      '/bundle with spaces/bun',
      '/bundle/adapter.js',
      'login',
      '--client-name=pane',
      '--client-title=Pane',
    ])
  })
  it('prevents concurrent logins and permits retry after failure', async () => {
    let fail!: (error: Error) => void
    const first = signInToCodex(
      { signal: new AbortController().signal },
      {
        resolveLauncher: () =>
          new Promise((_, reject) => {
            fail = reject
          }),
      },
    )
    await expect(
      signInToCodex({ signal: new AbortController().signal }),
    ).rejects.toThrow('already open')
    fail(new Error('Missing bundle'))
    await expect(first).rejects.toThrow('Missing bundle')
    await signInToCodex(
      { signal: new AbortController().signal },
      {
        resolveLauncher: async () => ({
          source: 'packaged-runtime',
          command: 'fake-adapter',
        }),
        run: async () => {},
      },
    )
  })
})

describe('sign-in process cleanup', () => {
  it.skipIf(process.platform === 'win32')(
    'stops the adapter and its app-server child on cancellation',
    async () => {
      const { mkdtemp, readFile, rm } = await import('node:fs/promises')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const dir = await mkdtemp(join(tmpdir(), 'pane-sign-in-test-'))
      const readyFile = join(dir, 'ready.json')
      const controller = new AbortController()
      let pids: number[] = []
      const source = `
      const { spawn } = require('node:child_process');
      const { writeFileSync } = require('node:fs');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      writeFileSync(${JSON.stringify(readyFile)}, JSON.stringify([process.pid, child.pid]));
      setInterval(() => {}, 1000);
    `
      const pending = runSignInProcess(
        [process.execPath, '-e', source],
        controller.signal,
        5000,
      )
      const outcome = pending.catch((error: Error) => error)
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          const ready = await readFile(readyFile, 'utf8').catch(() => null)
          if (ready) {
            pids = JSON.parse(ready)
            break
          }
          await Bun.sleep(10)
        }
        expect(pids).toHaveLength(2)
        controller.abort()
        expect(await outcome).toBeInstanceOf(Error)
        for (const pid of pids) {
          let alive = true
          for (let attempt = 0; attempt < 100 && alive; attempt++) {
            try {
              process.kill(pid, 0)
              await Bun.sleep(10)
            } catch {
              alive = false
            }
          }
          expect(alive).toBe(false)
        }
      } finally {
        controller.abort()
        await outcome
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})
