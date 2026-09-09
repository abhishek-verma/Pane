import { expect, it } from 'bun:test'
import type { TranslationResult } from '@browseros/shared/layers/action-protocol'
import { TranslationResultSink } from '../../src/layers/result-acceptance'
import { createTranslationResultTool } from '../../src/layers/result-tool'

const binding = {
  profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  invocationId: 'run',
  layerId: 'layer',
  layerVersion: 'a'.repeat(64),
  actionId: 'translate',
  tabId: 1,
  frameId: 0 as const,
  documentId: 'doc',
  instanceId: 'instance',
  routeEpoch: 0,
  snapshotId: 'snapshot',
  revocationGeneration: 0,
}
const input = {
  targetLanguage: 'en',
  blocks: [{ blockId: 'block', text: 'Bonjour' }],
}
const data: TranslationResult = {
  schema: 'pane.translation.v1',
  targetLanguage: 'en',
  blocks: [{ blockId: 'block', translatedText: 'Hello' }],
}

function setup() {
  const delivered: TranslationResult[] = []
  let current = { ...binding }
  const sink = new TranslationResultSink(binding, input, Date.now() + 10_000)
  const tool = createTranslationResultTool({
    sink,
    currentBinding: () => current,
    accepted: (data) => {
      delivered.push(data)
    },
  }).submit_layer_result
  const execute = async (data: unknown) => {
    if (!tool.execute) throw new Error('Missing result executor')
    return tool.execute(data, { toolCallId: 'test', messages: [] })
  }
  return {
    delivered,
    sink,
    execute,
    revoke: () => {
      current = { ...current, revocationGeneration: 1 }
    },
  }
}

it('publishes structured data once through the private terminal tool', async () => {
  const run = setup()
  expect(await run.execute(data)).toEqual({ accepted: true, duplicate: false })
  expect(await run.execute(data)).toEqual({ accepted: true, duplicate: true })
  expect(run.delivered).toEqual([data])
})

it('allows one semantic repair and closes after the second invalid submission', async () => {
  const run = setup()
  const invalid = { ...data, targetLanguage: 'fr' }
  expect(await run.execute(invalid)).toMatchObject({
    accepted: false,
    repairRemaining: true,
  })
  expect(await run.execute(invalid)).toMatchObject({
    accepted: false,
    repairRemaining: false,
  })
  expect(await run.execute(data)).toMatchObject({
    accepted: false,
    repairRemaining: false,
  })
  expect(run.delivered).toEqual([])
  const repaired = setup()
  await repaired.execute(invalid)
  expect(await repaired.execute(data)).toMatchObject({ accepted: true })
})

it('reads current authority from the harness at submission, not model arguments', async () => {
  const run = setup()
  run.revoke()
  expect(await run.execute(data)).toMatchObject({
    accepted: false,
    code: 'STALE_CONTEXT',
  })
  expect(run.delivered).toEqual([])
  const cancelled = setup()
  cancelled.sink.cancel()
  expect(await cancelled.execute(data)).toMatchObject({
    accepted: false,
    code: 'CANCELLED',
  })
})
