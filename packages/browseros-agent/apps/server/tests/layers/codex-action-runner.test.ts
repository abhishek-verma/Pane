import { afterEach, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TranslationRun } from '../../src/layers/action-runner'
import {
  codexLayerArguments,
  runCodexLayerAction,
} from '../../src/layers/codex-action-runner'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true })
})
async function fixture(mode: 'forged' | 'wait') {
  const dir = await mkdtemp(join(tmpdir(), 'pane-codex-action-test-'))
  dirs.push(dir)
  const binary = join(dir, 'codex'),
    report = join(dir, 'cwd')
  await writeFile(
    binary,
    `#!${process.execPath}\n
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.REPORT_PATH, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),parentSession:process.env.CODEX_SESSION_ID,parentPipe:process.env.CODEX_APP_TOOLS_PIPE_PATH,parentPermissions:process.env.CODEX_PERMISSION_PROFILE}));
if (process.env.MODE === 'wait') await new Promise(resolve => setTimeout(resolve, 30000));
else {
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({schema:'pane.translation.v1',targetLanguage:'en',blocks:[{blockId:'first',translatedText:'Hello'}]})}}));
  console.log(JSON.stringify({type:'turn.completed',usage:{output_tokens:20}}));
}
`,
  )
  await chmod(binary, 0o700)
  const controller = new AbortController()
  const run: TranslationRun = {
    binding: {
      profileId: randomUUID(),
      invocationId: randomUUID(),
      layerId: 'fixture',
      layerVersion: 'a'.repeat(64),
      actionId: 'translate',
      tabId: 1,
      frameId: 0,
      documentId: 'fixture',
      instanceId: randomUUID(),
      routeEpoch: 0,
      snapshotId: randomUUID(),
      revocationGeneration: 1,
    },
    input: {
      targetLanguage: 'en',
      blocks: [{ blockId: 'first', text: 'Bonjour' }],
    },
    action: {
      id: 'translate',
      kind: 'transform',
      trigger: 'click',
      instruction: 'Translate to English.',
      outputSchema: 'pane.translation.v1',
      targetLanguage: 'en',
      limits: { maxSteps: 1, maxOutputTokens: 512, deadlineMs: 10000 },
    },
    config: { provider: 'codex', model: 'fixture' },
    signal: controller.signal,
    current: () => true,
  }
  return {
    run,
    controller,
    report,
    options: {
      binary,
      nativeAuth: false,
      env: {
        PATH: process.env.PATH,
        MODE: mode,
        REPORT_PATH: report,
        CODEX_SESSION_ID: 'parent-session',
        CODEX_APP_TOOLS_PIPE_PATH: '/fixture-parent-pipe',
        CODEX_PERMISSION_PROFILE: 'parent-permissions',
      },
      upstream: async () => {
        throw new Error('Unexpected provider request')
      },
    },
  }
}
async function workspaceRemoved(report: string) {
  const value = JSON.parse(await readFile(report, 'utf8')) as {
    cwd: string
    args: string[]
    parentSession?: string
    parentPipe?: string
    parentPermissions?: string
  }
  expect(value.parentSession).toBeUndefined()
  expect(value.parentPipe).toBeUndefined()
  expect(value.parentPermissions).toBeUndefined()
  await expect(access(value.cwd)).rejects.toThrow()
  for (const config of value.args.filter(
    (arg) =>
      arg.startsWith('mcp_servers=') ||
      arg.startsWith('model_providers.pane_layer='),
  )) {
    const url = config.match(/(?:base_)?url="([^"]+)"/)?.[1]
    expect(url).toBeDefined()
    if (!url) throw new Error('Missing test endpoint')
    await expect(
      fetch(url, { signal: AbortSignal.timeout(500) }),
    ).rejects.toThrow()
  }
}
it('never accepts model-authored chat text as a private Layer result and cleans the workspace', async () => {
  const f = await fixture('forged')
  await expect(runCodexLayerAction(f.run, f.options)).rejects.toThrow(
    'private result',
  )
  await workspaceRemoved(f.report)
})
it('kills a cancelled child, revokes endpoints and removes the workspace', async () => {
  const f = await fixture('wait')
  const outcome = runCodexLayerAction(f.run, f.options)
  let started = false
  for (let i = 0; i < 100; i++) {
    try {
      await access(f.report)
      started = true
      break
    } catch {
      await Bun.sleep(10)
    }
  }
  expect(started).toBe(true)
  f.controller.abort()
  await expect(outcome).rejects.toThrow()
  await workspaceRemoved(f.report)
})
it('enforces the deadline even when the provider never returns', async () => {
  const f = await fixture('wait')
  f.run.action.limits.deadlineMs = 200
  await expect(runCodexLayerAction(f.run, f.options)).rejects.toThrow(
    'within its limits',
  )
  await workspaceRemoved(f.report)
})
it('configures only the private MCP grant, contains user context and keeps credentials out of arguments', () => {
  const args = codexLayerArguments(
    'saved',
    'http://127.0.0.1:123/v1',
    'http://127.0.0.1:456/mcp',
    true,
  )
  expect(args).toContain('--ignore-user-config')
  expect(args).toContain('--ignore-rules')
  expect(args).toContain('--ephemeral')
  expect(args).toContain('read-only')
  expect(args.join(' ')).toContain('default_tools_approval_mode="approve"')
  expect(args.join(' ')).toContain(
    'bearer_token_env_var="PANE_LAYER_MCP_TOKEN"',
  )
  expect(args.join(' ')).not.toContain('danger-full-access')
  expect(args.join(' ')).not.toContain('Bearer ')
})
