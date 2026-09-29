import { describe, expect, it } from 'bun:test'
import { createHmac, randomUUID } from 'node:crypto'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import { LayerBroker, type LayerDocument } from '../../src/layers/broker'
import {
  getLayerAccess,
  LAYER_EXTENSION_ID,
  LayerAuthority,
  withLayerAccess,
} from '../../src/layers/broker-auth'

const profileId = randomUUID()
const secret = 'ab'.repeat(32)
function mint(claims: unknown, key = secret) {
  const message = `pane.layers.auth.v1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`
  return `Bearer ${message}.${createHmac('sha256', key).update(message).digest('base64url')}`
}
const document = (): LayerDocument => ({
  tabId: 7,
  documentId: randomUUID(),
  instanceId: randomUUID(),
  routeEpoch: 0,
  url: 'https://example.com/news',
  title: 'News',
  active: true,
})

describe('Native Layer authority', () => {
  it('accepts only signed, current, correctly scoped native claims', () => {
    const authority = new LayerAuthority(secret, () => 1000)
    const claims = {
      profileId,
      extensionId: LAYER_EXTENSION_ID,
      expiresAt: 2000,
    }
    expect(authority.verify(mint(claims))).toEqual(claims)
    expect(authority.verify(mint(claims, 'cd'.repeat(32)))).toBeNull()
    expect(authority.verify(mint({ ...claims, expiresAt: 1000 }))).toBeNull()
    expect(
      authority.verify(mint({ ...claims, expiresAt: 1_000_000 })),
    ).toBeNull()
    expect(
      authority.verify(mint({ ...claims, extensionId: 'another-extension' })),
    ).toBeNull()
    expect(
      authority.verify(mint({ ...claims, scopeId: randomUUID() })),
    ).toBeNull()
    expect(authority.verify(mint({ ...claims, extra: 'ignored?' }))).toBeNull()
    expect(authority.verify(`Bearer ${'x'.repeat(4096)}`)).toBeNull()
  })
  it('delegates authoring without broker authority or scope escalation', () => {
    const authority = new LayerAuthority(secret, () => 1000)
    const scopeId = randomUUID()
    const access = {
      profileId,
      extensionId: LAYER_EXTENSION_ID,
      expiresAt: 2000,
    } as const
    const token = authority.delegateAuthor(access, scopeId)
    const author = authority.verify(token)
    expect(author).toMatchObject({ profileId, role: 'author', scopeId })
    expect(author?.extensionId).toBeUndefined()
    expect(() => authority.delegateAuthor(author!, randomUUID())).toThrow(
      'current browser',
    )
    expect(() =>
      authority.delegateAuthor({ ...access, expiresAt: 500 }, scopeId),
    ).toThrow('current browser')
  })
  it('isolates concurrent request authority', async () => {
    const first = {
      profileId,
      extensionId: LAYER_EXTENSION_ID,
      expiresAt: Date.now() + 1000,
    } as const
    const second = { ...first, profileId: randomUUID() }
    const actual = await Promise.all(
      [first, second].map((value) =>
        withLayerAccess(value, 'private', async () => {
          await Promise.resolve()
          return getLayerAccess()?.profileId
        }),
      ),
    )
    expect(actual).toEqual([first.profileId, second.profileId])
    expect(getLayerAccess()).toBeNull()
  })
})

describe('Authenticated document command channel', () => {
  it('supports browser state and mutations without an open page, scoped to the owning session', async () => {
    const broker = new LayerBroker()
    const session = randomUUID()
    broker.connect(profileId, session, [], false, [])
    for (const kind of ['state', 'mutate']) {
      const result = broker.command(profileId, kind, {
        action: 'enable',
        id: 'quiet',
        revision: 1,
      })
      const [command] = await broker.poll(
        profileId,
        new AbortController().signal,
        false,
      )
      expect(command.tabId).toBeUndefined()
      expect(broker.complete(profileId, randomUUID(), command.id, {})).toBe(
        false,
      )
      expect(broker.complete(randomUUID(), session, command.id, {})).toBe(false)
      expect(
        broker.complete(profileId, session, command.id, { confirmed: true }),
      ).toBe(true)
      expect(await result).toEqual({ confirmed: true })
    }
  })

  it('binds commands to all document fields and accepts one completion', async () => {
    const broker = new LayerBroker()
    const doc = document()
    const session = randomUUID()
    broker.connect(profileId, session, [doc], false, [])
    const result = broker.command(profileId, 'inspect', undefined, doc)
    const [command] = await broker.poll(
      profileId,
      new AbortController().signal,
      false,
    )
    expect(command).toMatchObject({
      tabId: 7,
      documentId: doc.documentId,
      instanceId: doc.instanceId,
      routeEpoch: 0,
    })
    expect(
      broker.complete(profileId, randomUUID(), command.id, { forged: true }),
    ).toBe(false)
    expect(
      broker.complete(randomUUID(), session, command.id, { forged: true }),
    ).toBe(false)
    expect(
      broker.complete(profileId, session, command.id, {
        text: 'page evidence',
      }),
    ).toBe(true)
    expect(await result).toEqual({ text: 'page evidence' })
    expect(broker.complete(profileId, session, command.id, {})).toBe(false)
  })
  it('rejects a completion after navigation and cancels pending work on worker restart', async () => {
    const broker = new LayerBroker()
    const doc = document()
    const session = randomUUID()
    broker.connect(profileId, session, [doc], false, [])
    const result = broker
      .command(profileId, 'verify', {}, doc)
      .catch((error) => error.message)
    const [command] = await broker.poll(
      profileId,
      new AbortController().signal,
      false,
    )
    broker.connect(profileId, session, [{ ...doc, routeEpoch: 1 }], false, [])
    expect(
      broker.complete(profileId, session, command.id, { passed: true }),
    ).toBe(false)
    expect(await result).toContain('document changed')
    const restarted = broker
      .command(profileId, 'inspect', undefined, { ...doc, routeEpoch: 1 })
      .catch((error) => error.message)
    broker.connect(profileId, randomUUID(), [doc], false, [])
    expect(await restarted).toContain('restarted')
  })
  it('keeps action availability unverified until that exact configured provider succeeds', () => {
    const broker = new LayerBroker()
    const provider = {
      id: 'chosen',
      type: 'openai',
      model: 'test-model',
      updatedAt: 1,
    }
    broker.connect(profileId, randomUUID(), [document()], false, [provider])
    expect(broker.capabilities(profileId, 'chosen')).toMatchObject({
      transform: true,
      provider: 'unverified',
    })
    expect(broker.capabilities(profileId, 'other').transform).toBe(false)
    broker.markProviderReady(profileId, {
      provider: 'openai',
      providerId: 'chosen',
      model: 'wrong-model',
    })
    expect(broker.capabilities(profileId, 'chosen').provider).toBe('unverified')
    broker.markProviderReady(profileId, {
      provider: 'openai',
      providerId: 'chosen',
      model: 'test-model',
    })
    expect(broker.capabilities(profileId, 'chosen').provider).toBe('ready')
    broker.connect(profileId, randomUUID(), [document()], false, [
      { ...provider, updatedAt: 2 },
    ])
    expect(broker.capabilities(profileId, 'chosen').provider).toBe('unverified')
  })
})

it('does not infer generated-task support from userscript access in an older extension', () => {
  const broker = new LayerBroker(),
    session = randomUUID(),
    doc = document()
  const providers = [
    { id: 'chosen', type: 'openai', model: 'test', updatedAt: 1 },
  ]
  broker.connect(profileId, session, [doc], true, providers)
  const old = broker.capabilities(profileId, 'chosen')
  expect(old.javascript).toBe(true)
  expect(old.generatedScript).toBe(false)
  broker.connect(profileId, session, [doc], true, providers, true)
  const upgraded = broker.capabilities(profileId, 'chosen')
  expect(upgraded.generatedScript).toBe(true)
  expect(upgraded.revision).not.toBe(old.revision)
  broker.connect(profileId, session, [doc], false, providers, true)
  expect(broker.capabilities(profileId, 'chosen').generatedScript).toBe(false)
})

it('reports Codex private adapters with honest account budgets and verification gating', () => {
  const broker = new LayerBroker()
  const provider = {
    id: 'codex-account',
    type: 'codex',
    model: 'gpt-5.5',
    updatedAt: 1,
  }
  broker.connect(profileId, randomUUID(), [document()], true, [provider], true)
  expect(broker.capabilities(profileId, provider.id)).toMatchObject({
    transform: true,
    pageTask: true,
    generatedScript: true,
    provider: 'unverified',
    outputBudget: 'accepted-output',
    automaticInference: false,
  })
  broker.markProviderReady(profileId, {
    provider: 'codex',
    providerId: provider.id,
    model: provider.model,
  })
  expect(broker.capabilities(profileId, provider.id).provider).toBe('ready')
})

it('reports adapter support and account budget limitations for every configured provider', () => {
  for (const type of Object.values(LLM_PROVIDERS)) {
    const broker = new LayerBroker()
    const provider = { id: 'saved', type, model: 'custom-alias', updatedAt: 1 }
    broker.connect(
      profileId,
      randomUUID(),
      [document()],
      true,
      [provider],
      true,
    )
    const supported = type !== 'remote-hermes'
    expect(broker.capabilities(profileId, 'saved')).toMatchObject({
      transform: supported,
      pageTask: supported,
      generatedScript: supported,
      provider: 'unverified',
      outputBudget: 'accepted-output',
    })
  }
})

it('holds a running preview past its old expiry and never resurrects a cleared preview', () => {
  const broker = new LayerBroker()
  const profileId = randomUUID()
  const doc = {
    tabId: 9,
    documentId: 'doc',
    instanceId: randomUUID(),
    routeEpoch: 0,
    url: 'https://example.com/',
    title: 'Fixture',
    active: true,
  }
  const binding = {
    ...doc,
    profileId,
    invocationId: randomUUID(),
    layerId: 'layer',
    layerVersion: 'a'.repeat(64),
    actionId: 'action',
    snapshotId: randomUUID(),
    revocationGeneration: 0,
    frameId: 0 as const,
  }
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  try {
    broker.registerPreview(
      profileId,
      doc,
      binding.layerId,
      binding.layerVersion,
    )
    const release = broker.holdPreview(profileId, binding)
    now += 6 * 60_000
    expect(broker.isPreview(profileId, binding, binding.layerVersion)).toBe(
      true,
    )
    broker.clearPreview(profileId, doc.tabId)
    release()
    expect(broker.isPreview(profileId, binding, binding.layerVersion)).toBe(
      false,
    )
  } finally {
    Date.now = realNow
  }
})

it('keeps a live execution author scope valid past credential expiry and revokes it on close', async () => {
  let now = 1000
  const authority = new LayerAuthority(secret, () => now)
  const scopeId = randomUUID()
  const delegated = authority.delegateAuthor(
    { profileId, extensionId: LAYER_EXTENSION_ID, expiresAt: now + 1000 },
    scopeId,
  )
  const session = authority.openAuthorSession(delegated, profileId, scopeId)
  const access = authority.verifyAuthorSession(session.authorization)!
  await withLayerAccess(
    access,
    session.authorization,
    async () => {
      now += 60 * 60_000
      expect(getLayerAccess()?.expiresAt).toBeGreaterThan(now)
      expect(getLayerAccess()?.scopeId).toBe(scopeId)
      session.close()
      expect(getLayerAccess()).toBeNull()
    },
    () => authority.verifyAuthorSession(session.authorization),
  )
})
