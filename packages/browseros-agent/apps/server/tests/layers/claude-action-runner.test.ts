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
import { runClaudeLayerAction } from '../../src/layers/claude-action-runner'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true })
})
async function fixture(mode = 'valid') {
  const dir = await mkdtemp(join(tmpdir(), 'pane-claude-adapter-test-'))
  dirs.push(dir)
  const binary = join(dir, 'fake-claude')
  await writeFile(
    binary,
    `#!${process.execPath}\n` +
      `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.REPORT_PATH, process.cwd());
const mode = process.env.MODE;
console.log(JSON.stringify({type:'system',subtype:'init',tools:mode === 'tools' ? ['StructuredOutput','Bash'] : ['StructuredOutput'],mcp_servers:[],model:mode === 'model' ? 'different' : (process.env.INIT_MODEL ?? 'fixture')}));
if (mode === 'wait') await new Promise(resolve => setTimeout(resolve,30000));
else console.log(JSON.stringify({type:'result',subtype:'success',is_error:mode === 'blocked',result:mode === 'blocked' ? 'Your organization has disabled Claude subscription access for Claude Code private-account-detail' : undefined,modelUsage:{[process.env.USAGE_MODEL ?? process.env.INIT_MODEL ?? 'fixture']:{}},usage:{output_tokens:40},structured_output:mode === 'invalid' ? {html:'<script>no</script>'} : {schema:'pane.translation.v1',targetLanguage:'en',blocks:[{blockId:'first',translatedText:'Hello'}]}}));
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
    config: { provider: 'claude-code', model: 'fixture' },
    signal: controller.signal,
    current: () => true,
  }
  const report = join(dir, 'cwd')
  return {
    run,
    controller,
    report,
    options: {
      binary,
      env: { PATH: process.env.PATH, MODE: mode, REPORT_PATH: report },
    },
  }
}
async function expectWorkspaceRemoved(report: string) {
  const cwd = await readFile(report, 'utf8')
  await expect(access(cwd)).rejects.toThrow()
}
it('accepts typed results and removes its temporary workspace', async () => {
  const f = await fixture()
  expect(await runClaudeLayerAction(f.run, f.options)).toMatchObject({
    schema: 'pane.translation.v1',
    blocks: [{ blockId: 'first', translatedText: 'Hello' }],
  })
  await expectWorkspaceRemoved(f.report)
})
it('rejects a widened tool inventory, provider model fallback and invalid results', async () => {
  for (const mode of ['tools', 'model', 'invalid']) {
    const f = await fixture(mode)
    await expect(runClaudeLayerAction(f.run, f.options)).rejects.toThrow()
    await expectWorkspaceRemoved(f.report)
  }
})
it('kills a cancelled CLI run and removes its temporary workspace', async () => {
  const f = await fixture('wait')
  const result = runClaudeLayerAction(f.run, f.options)
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
  await expect(result).rejects.toThrow()
  await expectWorkspaceRemoved(f.report)
})

it('reports organization-disabled account access without raw provider details or fallback', async () => {
  const f = await fixture('blocked')
  let failure: any
  try {
    await runClaudeLayerAction(f.run, f.options)
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({
    code: 'PROVIDER_ACCESS_DENIED',
    retryable: false,
  })
  expect(failure.message).toContain('organization has disabled')
  expect(failure.message).not.toContain('private-account-detail')
  await expectWorkspaceRemoved(f.report)
})

for (const [saved, resolved] of [
  ['sonnet', 'claude-sonnet-5'],
  ['opus[1m]', 'claude-opus-5[1m]'],
  ['haiku', 'claude-haiku-4-5-20251001'],
  ['default', 'claude-sonnet-5'],
  ['claude-fable-5-1[1m]', 'claude-fable-5-1[1m]'],
]) {
  it(`accepts saved ${saved} resolving to ${resolved}`, async () => {
    const f = await fixture()
    f.run.config.model = saved
    const env = {
      ...f.options.env,
      INIT_MODEL: resolved,
      USAGE_MODEL: resolved.replace(/\[1m\]$/, ''),
    }
    expect(
      await runClaudeLayerAction(f.run, { ...f.options, env }),
    ).toMatchObject({ schema: 'pane.translation.v1' })
    await expectWorkspaceRemoved(f.report)
  })
}

it('honors a host-pinned alias without broadening arbitrary full model names', async () => {
  const f = await fixture()
  f.run.config.model = 'sonnet'
  expect(
    await runClaudeLayerAction(f.run, {
      ...f.options,
      env: {
        ...f.options.env,
        INIT_MODEL: 'deployment-42',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deployment-42',
      },
    }),
  ).toMatchObject({ schema: 'pane.translation.v1' })
  f.run.config.model = 'deployment-43'
  await expect(
    runClaudeLayerAction(f.run, {
      ...f.options,
      env: { ...f.options.env, INIT_MODEL: 'deployment-42' },
    }),
  ).rejects.toMatchObject({ code: 'CLAUDE_MODEL_MISMATCH' })
})

it('rejects wrong-family resolution and a model switch after a valid alias initialization', async () => {
  for (const [saved, init, usage, code] of [
    ['sonnet', 'claude-opus-5', 'claude-opus-5', 'CLAUDE_MODEL_MISMATCH'],
    ['sonnet', 'claude-sonnet-5', 'claude-sonnet-4-6', 'CLAUDE_MODEL_CHANGED'],
    ['sonnet', 'claude-sonnet-5', 'claude-opus-5', 'CLAUDE_MODEL_CHANGED'],
    ['default', 'claude-sonnet-5', 'claude-opus-5', 'CLAUDE_MODEL_CHANGED'],
    [
      'claude-sonnet-4-6',
      'claude-sonnet-5',
      'claude-sonnet-5',
      'CLAUDE_MODEL_MISMATCH',
    ],
  ]) {
    const f = await fixture()
    f.run.config.model = saved
    await expect(
      runClaudeLayerAction(f.run, {
        ...f.options,
        env: { ...f.options.env, INIT_MODEL: init, USAGE_MODEL: usage },
      }),
    ).rejects.toMatchObject({ code })
    await expectWorkspaceRemoved(f.report)
  }
})

it('still rejects extra tools when the saved alias resolves correctly', async () => {
  const f = await fixture('tools')
  f.run.config.model = 'sonnet'
  await expect(
    runClaudeLayerAction(f.run, {
      ...f.options,
      env: { ...f.options.env, INIT_MODEL: 'claude-sonnet-5' },
    }),
  ).rejects.toMatchObject({ code: 'CLAUDE_TOOL_BOUNDARY' })
})
