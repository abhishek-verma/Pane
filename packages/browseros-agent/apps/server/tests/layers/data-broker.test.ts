import { expect, it } from 'bun:test'
import {
  dataEntrySchema,
  dataInputSchema,
  repositoryEntityFromHref,
} from '@browseros/shared/layers/data'
import { LayerDataBroker } from '../../src/layers/data-broker'

const input = dataInputSchema.parse({
  schema: 'pane.data-input.v1',
  operationId: 'github.repository.stats',
  entities: ['openai/codex'],
})
it('fixes destination, method and projection, deduplicates and preserves zero', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const broker = new LayerDataBroker(async (url, init) => {
    calls.push({ url, init })
    return Response.json({
      stargazers_count: 0,
      forks_count: 12,
      private: false,
      token: 'do-not-return',
    })
  })
  const result = await broker.read(
    'profile',
    { ...input, entities: ['OpenAI/Codex', 'openai/codex'] },
    () => true,
  )
  expect(calls.length).toBe(1)
  expect(calls[0]?.url).toBe('https://api.github.com/repos/openai/codex')
  expect(calls[0]?.init).toMatchObject({
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
  })
  expect(result.entries).toHaveLength(1)
  expect(result.entries[0]).toMatchObject({
    state: 'fresh',
    values: { stars: 0, forks: 12 },
  })
  expect(JSON.stringify(result)).not.toContain('do-not-return')
  await broker.read('profile', input, () => true)
  expect(calls).toHaveLength(1)
  await broker.read('other-profile', input, () => true)
  expect(calls).toHaveLength(2)
})
it('rejects caller-chosen URLs, traversal, unknown operations and private data', async () => {
  let calls = 0
  const broker = new LayerDataBroker(async () => {
    calls++
    return Response.json({ stargazers_count: 1, forks_count: 1, private: true })
  })
  for (const entities of [
    ['http://127.0.0.1/secret'],
    ['org/..'],
    ['org/repo/../../secret'],
  ])
    await expect(
      broker.read('profile', { ...input, entities }, () => true),
    ).rejects.toThrow()
  await expect(
    broker.read(
      'profile',
      { ...input, operationId: 'invented' } as never,
      () => true,
    ),
  ).rejects.toThrow()
  expect(calls).toBe(0)
  expect(
    (await broker.read('profile', input, () => true)).entries[0]?.state,
  ).toBe('unavailable')
  expect(repositoryEntityFromHref('https://github.com/OpenAI/Codex')).toBe(
    'openai/codex',
  )
  expect(
    repositoryEntityFromHref('https://github.com.evil.test/openai/codex'),
  ).toBeUndefined()
  expect(
    repositoryEntityFromHref('https://github.com/openai/codex?secret=1'),
  ).toBeUndefined()
})
it('distinguishes denial, rate limiting and stale cached values with backoff', async () => {
  let now = 1000,
    status = 200,
    calls = 0
  const broker = new LayerDataBroker(
    async () => {
      calls++
      return status === 200
        ? Response.json({
            stargazers_count: 10,
            forks_count: 2,
            private: false,
          })
        : new Response('', { status })
    },
    () => now,
  )
  await broker.read('profile', input, () => true)
  now += 300001
  status = 503
  expect(
    (await broker.read('profile', input, () => true)).entries[0],
  ).toMatchObject({ state: 'stale', values: { stars: 10 } })
  await broker.read('profile', input, () => true)
  expect(calls).toBe(2)
  now += 30001
  status = 403
  expect(
    (await broker.read('profile', input, () => true)).entries[0]?.state,
  ).toBe('denied')
  now += 30001
  status = 429
  expect(
    (await broker.read('profile', input, () => true)).entries[0]?.state,
  ).toBe('rate-limited')
})
it('does not start work after revocation and rejects stale completion', async () => {
  let current = false,
    calls = 0
  const broker = new LayerDataBroker(async () => {
    calls++
    current = false
    return Response.json({
      stargazers_count: 1,
      forks_count: 1,
      private: false,
    })
  })
  await expect(broker.read('profile', input, () => current)).rejects.toThrow()
  expect(calls).toBe(0)
  current = true
  await expect(broker.read('profile', input, () => current)).rejects.toThrow()
})

it('coalesces concurrent consumers and rejects oversized source responses', async () => {
  let calls = 0,
    release: () => void = () => {}
  const broker = new LayerDataBroker(async () => {
    calls++
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return Response.json({
      private: false,
      stargazers_count: 8,
      forks_count: 2,
    })
  })
  const first = broker.read('profile', input, () => true),
    second = broker.read('profile', input, () => true)
  expect(calls).toBe(1)
  release()
  expect(await first).toEqual(await second)
  const oversized = new LayerDataBroker(
    async () => new Response('x'.repeat(128001)),
  )
  expect(
    (await oversized.read('profile', input, () => true)).entries[0]?.state,
  ).toBe('unavailable')
})
it('requires consistent data states and freshness metadata', () => {
  expect(
    dataEntrySchema.safeParse({
      entityId: 'openai/codex',
      state: 'fresh',
      values: { stars: 0, forks: 0 },
    }).success,
  ).toBe(false)
  expect(
    dataEntrySchema.safeParse({
      entityId: 'openai/codex',
      state: 'denied',
      values: { stars: 10, forks: 0 },
    }).success,
  ).toBe(false)
  expect(
    dataEntrySchema.safeParse({
      entityId: 'openai/codex',
      state: 'fresh',
      values: { stars: 0, forks: 0 },
      fetchedAt: 10,
      expiresAt: 9,
    }).success,
  ).toBe(false)
})
