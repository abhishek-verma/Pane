import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { buildLayerAuthoringTools } from '../../src/layers/authoring'
import { LayerBroker, type LayerDocument } from '../../src/layers/broker'
import {
  LAYER_EXTENSION_ID,
  withLayerAccess,
} from '../../src/layers/broker-auth'
import { LayerStore } from '../../src/layers/store'
import { LAYER_ACTIVITY_SCHEMA_SQL } from '../../src/lib/db/schema/layer-activity'
import { LAYERS_SCHEMA_SQL } from '../../src/lib/db/schema/layers'
import { runWithProfile } from '../../src/lib/profile-context'

const databases: Database[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
function fixture() {
  const db = new Database(':memory:')
  databases.push(db)
  db.exec(LAYERS_SCHEMA_SQL + LAYER_ACTIVITY_SCHEMA_SQL)
  const store = new LayerStore(db),
    broker = new LayerBroker()
  const profileId = randomUUID(),
    sessionId = randomUUID()
  const old: LayerDocument = {
    tabId: 7,
    documentId: 'old',
    instanceId: randomUUID(),
    routeEpoch: 0,
    url: 'https://example.com/article',
    title: 'Article',
    active: true,
  }
  const current = { ...old, documentId: 'current', instanceId: randomUUID() }
  broker.connect(profileId, sessionId, [old], true, [])
  const record = store.draft(
    {
      protocol: 'pane.layers.v1',
      name: 'Quiet',
      intent: 'Hide sidebar',
      mode: 'managed',
      scope: { origin: 'https://example.com', paths: ['/*'] },
      operations: [
        {
          id: 'hide',
          kind: 'collapse',
          label: 'Sidebar',
          anchor: { selector: 'aside' },
        },
      ],
    },
    0,
  )
  const tools = buildLayerAuthoringTools(undefined, {
    broker,
    store: () => store,
  })
  const preview = () => {
    const promise = runWithProfile(profileId, () =>
      withLayerAccess(
        {
          profileId,
          extensionId: LAYER_EXTENSION_ID,
          expiresAt: Date.now() + 60_000,
        },
        'fixture',
        () =>
          tools.layer_preview.execute!(
            { tabId: 7, id: record.id, version: record.latestVersion },
            { toolCallId: randomUUID(), messages: [] },
          ),
      ),
    ) as Promise<unknown>
    return promise.then(
      (value) => ({ value, error: undefined }),
      (error: Error) => ({ value: undefined, error }),
    )
  }
  const next = async (kind: string) => {
    const [command] = await broker.poll(
      profileId,
      AbortSignal.timeout(1000),
      true,
    )
    expect(command?.kind).toBe(kind)
    return command
  }
  const reply = (id: string, result?: unknown, error?: string) =>
    broker.complete(profileId, sessionId, id, result, error)
  return { broker, profileId, sessionId, old, current, preview, next, reply }
}

describe('Layer preview document synchronization', () => {
  it('refreshes stale registration before binding the first preview', async () => {
    const f = fixture(),
      outcome = f.preview()
    const snapshot = await f.next('documents')
    f.reply(snapshot.id, [f.current])
    const preview = await f.next('preview')
    expect(preview.documentId).toBe('current')
    expect(f.broker.document(f.profileId, 7)).toEqual(f.current)
    expect(f.reply(preview.id, { preview: true })).toBe(true)
    expect((await outcome).error).toBeUndefined()
  })
  it('refreshes again before retrying a document-change response instead of reusing the stale target', async () => {
    const f = fixture(),
      outcome = f.preview()
    f.reply((await f.next('documents')).id, [f.old])
    f.reply(
      (await f.next('preview')).id,
      undefined,
      'The originating document changed.',
    )
    f.reply((await f.next('documents')).id, [f.current])
    const retry = await f.next('preview')
    expect(retry.documentId).toBe('current')
    expect(f.reply(retry.id, { preview: true })).toBe(true)
    expect((await outcome).error).toBeUndefined()
  })
  it('does not redirect a retry to another matching URL', async () => {
    const f = fixture(),
      outcome = f.preview()
    f.reply((await f.next('documents')).id, [f.old])
    f.reply(
      (await f.next('preview')).id,
      undefined,
      'The originating document changed.',
    )
    f.reply((await f.next('documents')).id, [
      { ...f.current, url: 'https://example.com/different-article' },
    ])
    expect((await outcome).error?.message).toContain(
      'originating document changed',
    )
    expect(
      await f.broker.poll(f.profileId, new AbortController().signal, false),
    ).toEqual([])
  })
  it('fails closed if the requested tab disappeared while refreshing', async () => {
    const f = fixture(),
      outcome = f.preview()
    f.reply((await f.next('documents')).id, [])
    expect((await outcome).error?.message).toContain('unavailable to Layers')
  })
})
