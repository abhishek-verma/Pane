import { expect, it } from 'bun:test'
import type { TranslationRun } from '../../src/layers/action-runner'
import { createScriptPageTools } from '../../src/layers/script-page-task'

function fixture() {
  let active = true,
    calls = 0,
    pass = false
  const controller = new AbortController()
  const accepted: unknown[] = []
  const run = {
    signal: controller.signal,
    current: () => active,
    pageHost: {
      inspect: async () => ({ candidates: [{ selector: '#target' }] }),
      execute: async () => {
        calls++
        return {
          checks: [
            { operationId: 'target', affectedElements: 1, intact: pass },
          ],
        }
      },
    },
  } as TranslationRun
  const tools = createScriptPageTools(run, (result) => accepted.push(result))
  const execute = async (name: keyof typeof tools, input: unknown = {}) => {
    const handler = tools[name].execute
    if (!handler) throw new Error('Missing private tool')
    return handler(input as never, { toolCallId: 'test', messages: [] })
  }
  const script = {
    source: '(() => {})();',
    assertions: [
      { id: 'target', selector: '#target', state: 'present', maxMatches: 1 },
    ],
  }
  return {
    execute,
    script,
    accepted,
    controller,
    calls: () => calls,
    setPass: () => {
      pass = true
    },
    revoke: () => {
      active = false
    },
    run,
  }
}
it('requires inspection, actual passing checks and explicit completion; supports a bounded repair', async () => {
  const f = fixture()
  await expect(f.execute('page_execute_script', f.script)).rejects.toThrow(
    'Inspect first',
  )
  await f.execute('page_inspect')
  expect(await f.execute('page_execute_script', f.script)).toMatchObject({
    passed: false,
    recovery: 'reload-required',
  })
  await expect(f.execute('complete_page_task')).rejects.toThrow(
    'No successfully',
  )
  await expect(f.execute('page_execute_script', f.script)).rejects.toThrow(
    'Inspect first',
  )
  f.setPass()
  await f.execute('page_inspect')
  await f.execute('page_execute_script', f.script)
  await f.execute('complete_page_task')
  expect(f.accepted).toHaveLength(1)
  expect(f.accepted[0]).toMatchObject({
    schema: 'pane.script-task-receipt.v1',
    executions: [
      { checks: [{ intact: false }] },
      { checks: [{ intact: true }] },
    ],
  })
  await expect(f.execute('page_execute_script', f.script)).rejects.toThrow(
    'no longer active',
  )
  expect(f.calls()).toBe(2)
})
it('rejects syntax without host execution and rejects revoked/cancelled work', async () => {
  const f = fixture()
  await f.execute('page_inspect')
  await expect(
    f.execute('page_execute_script', { ...f.script, source: 'const = ;' }),
  ).rejects.toThrow('standalone script')
  expect(f.calls()).toBe(0)
  f.revoke()
  await expect(f.execute('page_inspect')).rejects.toThrow('no longer active')
  const g = fixture()
  g.controller.abort()
  await expect(g.execute('page_inspect')).rejects.toThrow()
})
it('caps execution attempts and rejects a late receipt after revocation', async () => {
  const f = fixture()
  for (let n = 0; n < 3; n++) {
    await f.execute('page_inspect')
    await f.execute('page_execute_script', f.script)
  }
  await f.execute('page_inspect')
  await expect(f.execute('page_execute_script', f.script)).rejects.toThrow(
    'three sequential',
  )
  expect(f.calls()).toBe(3)
  const g = fixture()
  if (!g.run.pageHost) throw new Error('Missing page host')
  g.run.pageHost.execute = async () => {
    g.revoke()
    return {
      checks: [{ operationId: 'target', affectedElements: 1, intact: true }],
    }
  }
  await g.execute('page_inspect')
  await expect(g.execute('page_execute_script', g.script)).rejects.toThrow(
    'no longer active',
  )
  expect(g.accepted).toEqual([])
})

it('does not reuse an earlier success after a later execution fails', async () => {
  const f = fixture()
  f.setPass()
  await f.execute('page_inspect')
  await f.execute('page_execute_script', f.script)
  await f.execute('page_inspect')
  await expect(
    f.execute('page_execute_script', { ...f.script, source: 'const = ;' }),
  ).rejects.toThrow()
  await expect(f.execute('complete_page_task')).rejects.toThrow(
    'No successfully',
  )
  expect(f.accepted).toEqual([])
})
