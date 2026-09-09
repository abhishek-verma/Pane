import { describe, expect, it } from 'bun:test'
import { createHmac, randomUUID } from 'node:crypto'
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
