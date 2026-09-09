import { Database } from 'bun:sqlite'
import { afterEach, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { TranslationResult } from '@browseros/shared/layers/action-protocol'
import { layerDefinitionSchema } from '@browseros/shared/layers/manifest'
import { LayerActions } from '../../src/layers/actions'
import { LayerBroker } from '../../src/layers/broker'
import { LayerStore } from '../../src/layers/store'
import { LAYER_ACTIVITY_SCHEMA_SQL } from '../../src/lib/db/schema/layer-activity'
import { LAYERS_SCHEMA_SQL } from '../../src/lib/db/schema/layers'

const databases: Database[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function setup(deadlineMs = 5000) {
  const db = new Database(':memory:')
  databases.push(db)
  db.exec(LAYERS_SCHEMA_SQL + LAYER_ACTIVITY_SCHEMA_SQL)
  const store = new LayerStore(db)
  const profileId = randomUUID()
  const broker = new LayerBroker()
  const sessionId = randomUUID()
  const doc = {
    tabId: 5,
    documentId: randomUUID(),
    instanceId: randomUUID(),
    routeEpoch: 0,
    url: 'https://example.com/article',
    title: 'Article',
    active: true,
  }
  const provider = {
    id: 'chosen',
    type: 'openai',
    model: 'fixture',
    updatedAt: 1,
  }
  broker.connect(profileId, sessionId, [doc], false, [provider])
  const definition = layerDefinitionSchema.parse({
    protocol: 'pane.layers.v1',
    name: 'Translate',
    intent: 'Translate this article on click',
    mode: 'managed',
    scope: { origin: 'https://example.com', paths: ['/*'] },
    operations: [
      {
        id: 'button',
        kind: 'button',
        anchor: { selector: 'article' },
        label: 'Translate',
        actionId: 'translate',
      },
    ],
    actions: [
      {
        id: 'translate',
        kind: 'transform',
        trigger: 'click',
        instruction: 'Translate accurately.',
        outputSchema: 'pane.translation.v1',
        targetLanguage: 'en',
        providerId: 'chosen',
        limits: { maxSteps: 2, maxOutputTokens: 1000, deadlineMs },
      },
    ],
  })
  const record = store.draft(definition, 0)
  broker.registerPreview(profileId, doc, record.id, record.latestVersion)
  const binding = {
    profileId,
    invocationId: randomUUID(),
    layerId: record.id,
    layerVersion: record.latestVersion,
    actionId: 'translate',
    tabId: doc.tabId,
    frameId: 0 as const,
    documentId: doc.documentId,
    instanceId: doc.instanceId,
    routeEpoch: 0,
    snapshotId: randomUUID(),
    revocationGeneration: store.revision(),
  }
  const request = {
    binding,
    input: {
      targetLanguage: 'en',
      blocks: [{ blockId: 'first', text: 'Bonjour' }],
    },
    config: {
      provider: 'openai' as const,
      providerId: 'chosen',
      model: 'fixture',
    },
  }
  const output: TranslationResult = {
    schema: 'pane.translation.v1',
    targetLanguage: 'en',
    blocks: [{ blockId: 'first', translatedText: 'Hello' }],
  }
  return { store, profileId, broker, doc, provider, sessionId, request, output }
}

it('returns ordered typed events and replays retries without another provider call', async () => {
  const f = setup()
  let calls = 0
  const service = new LayerActions(f.broker, async () => {
    calls += 1
    return f.output
  })
  const [a, b] = await Promise.all([
    service.run(f.profileId, f.request, f.store),
    service.run(f.profileId, f.request, f.store),
  ])
  expect(calls).toBe(1)
  expect(a).toEqual(b)
  expect(a.map((event) => event.payload.type)).toEqual([
    'accepted',
    'result',
    'completed',
  ])
  expect(f.broker.capabilities(f.profileId, 'chosen').provider).toBe('ready')
  await expect(
    service.run(
      f.profileId,
      {
        ...f.request,
        input: {
          ...f.request.input,
          blocks: [{ blockId: 'first', text: 'Changed' }],
        },
      },
      f.store,
    ),
  ).rejects.toThrow('Conflicting')
})

it('rejects forged profiles, document bindings, disabled state and provider fallback before model execution', async () => {
  const f = setup()
  let calls = 0
  const service = new LayerActions(f.broker, async () => {
    calls += 1
    return f.output
  })
  await expect(service.run(randomUUID(), f.request, f.store)).rejects.toThrow(
    'profile mismatch',
  )
  await expect(
    service.run(
      f.profileId,
      {
        ...f.request,
        binding: { ...f.request.binding, documentId: randomUUID() },
      },
      f.store,
    ),
  ).rejects.toThrow('no longer active')
  await expect(
    service.run(
      f.profileId,
      { ...f.request, config: { ...f.request.config, providerId: 'fallback' } },
      f.store,
    ),
  ).rejects.toThrow('No provider fallback')
  f.store.setPaused(true, f.store.revision())
  await expect(service.run(f.profileId, f.request, f.store)).rejects.toThrow(
    'no longer active',
  )
  expect(calls).toBe(0)
})

it('cancels on route changes and rejects late output', async () => {
  const f = setup()
  let release: () => void = () => undefined
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  const service = new LayerActions(f.broker, async () => {
    await wait
    return f.output
  })
  const run = service.run(f.profileId, f.request, f.store)
  f.broker.connect(
    f.profileId,
    f.sessionId,
    [{ ...f.doc, routeEpoch: 1 }],
    false,
    [f.provider],
  )
  release()
  expect((await run).map((event) => event.payload.type)).toEqual([
    'accepted',
    'cancelled',
  ])
  expect(f.broker.capabilities(f.profileId, 'chosen').provider).toBe(
    'unverified',
  )
})

it('validates output independently and preserves cancellation that arrives before start', async () => {
  const f = setup()
  const service = new LayerActions(f.broker, async () => ({
    ...f.output,
    blocks: [{ blockId: 'forged', translatedText: 'Hello' }],
  }))
  expect(
    (await service.run(f.profileId, f.request, f.store)).at(-1)?.payload.type,
  ).toBe('failed')
  const binding = { ...f.request.binding, invocationId: randomUUID() }
  expect(service.cancel(f.profileId, binding)).toBe(true)
  await expect(
    service.run(f.profileId, { ...f.request, binding }, f.store),
  ).rejects.toThrow('cancelled before starting')
})

it('persists metadata and prevents a restarted harness from silently rerunning an invocation', async () => {
  const f = setup()
  const first = new LayerActions(f.broker, async () => f.output)
  await first.run(f.profileId, f.request, f.store)
  const activity = f.store.activity()
  expect(activity).toHaveLength(1)
  expect(activity[0]).toMatchObject({
    invocationId: f.request.binding.invocationId,
    status: 'completed',
    provider: 'openai',
  })
  expect(JSON.stringify(activity)).not.toContain('Bonjour')
  expect(JSON.stringify(activity)).not.toContain('Hello')
  let calls = 0
  const restarted = new LayerActions(f.broker, async () => {
    calls++
    return f.output
  })
  await expect(restarted.run(f.profileId, f.request, f.store)).rejects.toThrow(
    'already started',
  )
  expect(calls).toBe(0)
})

it('expires cached payloads from completion and never reruns an expired invocation', async () => {
  const f = setup()
  let now = Date.now(),
    calls = 0
  const service = new LayerActions(
    f.broker,
    async () => {
      calls++
      return f.output
    },
    () => now,
  )
  const result = await service.run(f.profileId, f.request, f.store)
  now += 299_999
  expect(await service.run(f.profileId, f.request, f.store)).toEqual(result)
  now += 1
  await expect(service.run(f.profileId, f.request, f.store)).rejects.toThrow(
    'no longer replayable',
  )
  expect(calls).toBe(1)
})

it('recovers ordered results through replay without rerunning and rejects another document', async () => {
  const f = setup()
  let calls = 0
  const service = new LayerActions(f.broker, async () => {
    calls++
    return f.output
  })
  const result = await service.run(f.profileId, f.request, f.store)
  expect(await service.replay(f.profileId, f.request.binding, 1)).toEqual(
    result.slice(1),
  )
  expect(await service.replay(f.profileId, f.request.binding, 3)).toEqual([])
  await expect(
    service.replay(
      f.profileId,
      { ...f.request.binding, documentId: 'different' },
      0,
    ),
  ).rejects.toThrow('changed')
  await expect(
    new LayerActions(f.broker).replay(f.profileId, f.request.binding, 0),
  ).rejects.toThrow('expired')
  expect(calls).toBe(1)
})

it('reports the deadline separately from cancellation and finishes activity', async () => {
  const f = setup(1000)
  const service = new LayerActions(
    f.broker,
    async (run) =>
      new Promise((_, reject) => {
        run.signal.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        )
      }),
  )
  const events = await service.run(f.profileId, f.request, f.store)
  expect(events.at(-1)?.payload).toEqual({
    type: 'failed',
    code: 'DEADLINE_EXCEEDED',
    retryable: true,
  })
  expect(
    f.store
      .activity()
      .find((run) => run.invocationId === f.request.binding.invocationId)
      ?.status,
  ).toBe('failed')
})
