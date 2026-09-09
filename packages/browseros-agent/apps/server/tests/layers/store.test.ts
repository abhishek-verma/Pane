import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LayerCapabilities } from '@browseros/shared/layers/capabilities'
import { layerDefinitionSchema } from '@browseros/shared/layers/manifest'
import { validateLayerSource } from '../../src/layers/script-validation'
import { LayerStore, layerDigest } from '../../src/layers/store'
import { openBrowserOsDatabase } from '../../src/lib/db/client'
import { LAYER_ACTIVITY_SCHEMA_SQL } from '../../src/lib/db/schema/layer-activity'
import { LAYERS_SCHEMA_SQL } from '../../src/lib/db/schema/layers'

const profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const capabilities: LayerCapabilities = {
  revision: 'test',
  managed: true,
  authenticatedBroker: true,
  transform: false,
  pageTask: false,
  data: false,
  javascript: false,
  automaticInference: false,
  provider: 'unverified',
}
const definition = layerDefinitionSchema.parse({
  protocol: 'pane.layers.v1',
  name: 'Quiet',
  intent: 'Hide recommendations',
  mode: 'managed',
  scope: { origin: 'https://example.com', paths: ['/*'] },
  operations: [
    {
      id: 'hide',
      kind: 'collapse',
      label: 'Recommendations',
      anchor: { selector: 'aside' },
    },
  ],
})
const checks = {
  mounted: true,
  restored: true,
  actionContract: false,
  reloaded: true,
}
const scriptDefinition = layerDefinitionSchema.parse({
  ...definition,
  mode: 'javascript',
  operations: [],
  source:
    'paneLayer.own(document.body.appendChild(document.createElement("aside")));',
  assertions: [{ id: 'mounted', selector: 'aside', state: 'visible' }],
})
const scriptCapabilities = { ...capabilities, javascript: true }
const databases: Database[] = []
const dirs: string[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})
function setup(now?: () => number) {
  const db = new Database(':memory:')
  databases.push(db)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(LAYERS_SCHEMA_SQL + LAYER_ACTIVITY_SCHEMA_SQL)
  return { db, store: new LayerStore(db, now) }
}
function activate(store: LayerStore, id: string, version: string) {
  store.grant(id, version, store.revision())
  const receipt = store.recordVerification(id, version, capabilities, checks)
  store.activate(id, version, receipt, capabilities, store.revision())
}

describe('Layer version persistence', () => {
  it('binds script consent to the source and scope without activating a preview', () => {
    const { store } = setup()
    const first = store.draft(scriptDefinition, 0)
    expect(store.hasGrant(first.id, first.latestVersion)).toBe(false)
    store.grant(first.id, first.latestVersion, store.revision())
    expect(store.hasGrant(first.id, first.latestVersion)).toBe(true)
    expect(store.manifest(profileId).layers).toEqual([])
    for (const changed of [
      {
        ...scriptDefinition,
        source: `${scriptDefinition.source}\nconsole.log("changed");`,
      },
      {
        ...scriptDefinition,
        scope: { ...scriptDefinition.scope, paths: ['/other/*'] },
      },
    ]) {
      const next = store.draft(changed, store.revision(), first.id)
      expect(store.hasGrant(next.id, next.latestVersion)).toBe(false)
    }
  })
  it('requires script DOM and reload evidence and never claims managed Undo', () => {
    const { store } = setup()
    const layer = store.draft(scriptDefinition, 0)
    store.grant(layer.id, layer.latestVersion, store.revision())
    const verified = {
      ...checks,
      restored: false,
      actionContract: true,
      recovery: 'reload-required' as const,
    }
    for (const failed of [
      { ...verified, mounted: false },
      { ...verified, reloaded: false },
      { ...verified, restored: true },
      { ...verified, recovery: undefined },
    ]) {
      const receipt = store.recordVerification(
        layer.id,
        layer.latestVersion,
        scriptCapabilities,
        failed,
      )
      expect(() =>
        store.activate(
          layer.id,
          layer.latestVersion,
          receipt,
          scriptCapabilities,
          store.revision(),
        ),
      ).toThrow('did not pass')
      expect(store.manifest(profileId).layers).toEqual([])
    }
    const receipt = store.recordVerification(
      layer.id,
      layer.latestVersion,
      scriptCapabilities,
      verified,
    )
    store.activate(
      layer.id,
      layer.latestVersion,
      receipt,
      scriptCapabilities,
      store.revision(),
    )
    expect(store.manifest(profileId).layers[0]?.version).toBe(
      layer.latestVersion,
    )
  })
  it('compiles script candidates without executing them and rejects module-only syntax', () => {
    expect(() =>
      validateLayerSource({
        ...scriptDefinition,
        source: 'throw new Error("must never run on server")',
      }),
    ).not.toThrow()
    for (const source of [
      'const = ;',
      'await Promise.resolve()',
      'import x from "remote"',
    ]) {
      expect(() =>
        validateLayerSource({ ...scriptDefinition, source }),
      ).toThrow('standalone script')
    }
  })
  it('requires a grant and exact successful verification before activation', () => {
    const { store } = setup()
    const layer = store.draft(definition, 0)
    expect(store.manifest(profileId).layers).toEqual([])
    expect(() =>
      store.activate(layer.id, layer.latestVersion, 'missing', capabilities, 1),
    ).toThrow('not been granted')
    expect(store.revision()).toBe(1)
    store.grant(layer.id, layer.latestVersion, 1)
    expect(() =>
      store.activate(layer.id, layer.latestVersion, 'missing', capabilities, 2),
    ).toThrow('verification receipt')
    const failed = store.recordVerification(
      layer.id,
      layer.latestVersion,
      capabilities,
      { ...checks, restored: false },
    )
    expect(() =>
      store.activate(layer.id, layer.latestVersion, failed, capabilities, 2),
    ).toThrow('did not pass')
    const receipt = store.recordVerification(
      layer.id,
      layer.latestVersion,
      capabilities,
      checks,
    )
    store.activate(layer.id, layer.latestVersion, receipt, capabilities, 2)
    expect(store.manifest(profileId).layers[0]?.version).toBe(
      layer.latestVersion,
    )
  })
  it('keeps the working version active while editing and rejects stale writers', () => {
    const { store } = setup()
    const layer = store.draft(definition, 0)
    activate(store, layer.id, layer.latestVersion)
    const edited = store.draft(
      { ...definition, name: 'New draft' },
      store.revision(),
      layer.id,
    )
    expect(edited.latestVersion).not.toBe(edited.activeVersion)
    expect(store.manifest(profileId).layers[0]?.definition.name).toBe('Quiet')
    const revision = store.revision()
    expect(() => store.disable(layer.id, revision - 1)).toThrow('state changed')
    expect(store.revision()).toBe(revision)
    expect(store.read(layer.id).enabled).toBe(true)
    store.disable(layer.id, revision)
    expect(store.manifest(profileId).layers).toEqual([])
  })
  it('invalidates verification after a version, capability or time change', () => {
    let time = 0
    const { store } = setup(() => time)
    const layer = store.draft(definition, 0)
    store.grant(layer.id, layer.latestVersion, 1)
    const receipt = store.recordVerification(
      layer.id,
      layer.latestVersion,
      capabilities,
      checks,
    )
    expect(() =>
      store.activate(
        layer.id,
        layer.latestVersion,
        receipt,
        { ...capabilities, revision: 'new' },
        2,
      ),
    ).toThrow('verification receipt')
    const edited = store.draft({ ...definition, name: 'Changed' }, 2, layer.id)
    expect(() =>
      store.activate(layer.id, edited.latestVersion, receipt, capabilities, 3),
    ).toThrow('verification receipt')
    time = 30 * 60_000
    expect(() =>
      store.activate(layer.id, layer.latestVersion, receipt, capabilities, 3),
    ).toThrow('verification receipt')
  })
  it('requires new scope consent and rechecks runtime support', () => {
    const { store } = setup()
    const layer = store.draft(definition, 0)
    activate(store, layer.id, layer.latestVersion)
    const edited = store.draft(
      {
        ...definition,
        scope: { ...definition.scope, origin: 'https://other.example' },
      },
      store.revision(),
      layer.id,
    )
    const receipt = store.recordVerification(
      layer.id,
      edited.latestVersion,
      capabilities,
      checks,
    )
    expect(() =>
      store.activate(
        layer.id,
        edited.latestVersion,
        receipt,
        capabilities,
        store.revision(),
      ),
    ).toThrow('not been granted')
    expect(() =>
      store.activate(
        layer.id,
        layer.latestVersion,
        receipt,
        { ...capabilities, authenticatedBroker: false },
        store.revision(),
      ),
    ).toThrow('authenticated Layer runtime')
  })
  it('isolates profiles and persists global and site pause states', () => {
    const { store } = setup()
    const other = setup().store
    const layer = store.draft(definition, 0)
    activate(store, layer.id, layer.latestVersion)
    store.setPaused(true, store.revision(), definition.scope.origin)
    store.setPaused(true, store.revision())
    expect(store.manifest(profileId)).toMatchObject({
      paused: true,
      pausedOrigins: [definition.scope.origin],
    })
    expect(other.list()).toEqual([])
    expect(() => other.read(layer.id)).toThrow('not found')
    store.remove(layer.id, store.revision())
    expect(store.list()).toEqual([])
  })
})

describe('Layer database installation', () => {
  it('keeps the packaged migration and fallback schema identical', () => {
    expect(
      readFileSync(
        new URL('../../src/lib/db/migrations/0020_layers.sql', import.meta.url),
        'utf8',
      ),
    ).toBe(LAYERS_SCHEMA_SQL)
  })
  for (const fallback of [false, true]) {
    it(`opens and reopens persisted Layer state using ${fallback ? 'fallback bootstrap' : 'migrations'}`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'pane-layer-db-'))
      dirs.push(dir)
      const dbPath = join(dir, 'profile.sqlite')
      const first = openBrowserOsDatabase({
        dbPath,
        ...(fallback ? { migrationsDir: join(dir, 'missing') } : {}),
      })
      const store = new LayerStore(first.sqlite)
      const layer = store.draft(definition, 0)
      activate(store, layer.id, layer.latestVersion)
      first.sqlite.close()
      const reopened = openBrowserOsDatabase({ dbPath })
      databases.push(reopened.sqlite)
      expect(
        new LayerStore(reopened.sqlite).manifest(profileId).layers[0]?.version,
      ).toBe(layer.latestVersion)
    })
  }
})

it('deletes reversibly, blocks hidden activation and restores disabled', () => {
  const { store } = setup()
  const record = store.draft(definition, 0)
  activate(store, record.id, record.latestVersion)
  store.remove(record.id, store.revision())
  expect(store.list()).toEqual([])
  expect(store.deleted().map((item) => item.id)).toEqual([record.id])
  expect(store.manifest(profileId).layers).toEqual([])
  expect(() => store.enable(record.id, capabilities, store.revision())).toThrow(
    'not found',
  )
  store.restore(record.id, store.revision())
  expect(store.read(record.id).enabled).toBe(false)
  store.enable(record.id, capabilities, store.revision())
  expect(store.manifest(profileId).layers[0]?.id).toBe(record.id)
})

it('requires observed reload evidence before activation', () => {
  const { store } = setup()
  const record = store.draft(definition, 0)
  store.grant(record.id, record.latestVersion, store.revision())
  const receipt = store.recordVerification(
    record.id,
    record.latestVersion,
    capabilities,
    { ...checks, reloaded: false },
  )
  expect(() =>
    store.activate(
      record.id,
      record.latestVersion,
      receipt,
      capabilities,
      store.revision(),
    ),
  ).toThrow('did not pass')
})

it('keeps consent and activation atomic when verification fails', () => {
  const { db, store } = setup()
  const record = store.draft(definition, 0)
  const revision = store.revision()
  expect(() =>
    store.keep(
      record.id,
      record.latestVersion,
      'missing',
      capabilities,
      revision,
    ),
  ).toThrow('verification')
  expect(store.revision()).toBe(revision)
  expect(db.query('SELECT COUNT(*) AS n FROM layer_grants').get()).toEqual({
    n: 0,
  })
  const receipt = store.recordVerification(
    record.id,
    record.latestVersion,
    capabilities,
    checks,
  )
  store.keep(record.id, record.latestVersion, receipt, capabilities, revision)
  expect(store.read(record.id).enabled).toBe(true)
})

it('hashes omitted optional JSON fields identically across transport serialization', () => {
  const value = {
    config: { provider: 'browseros', model: 'none', providerId: undefined },
  }
  expect(layerDigest(value)).toBe(
    layerDigest(JSON.parse(JSON.stringify(value))),
  )
  expect(layerDigest(value)).not.toBe(
    layerDigest({
      config: { provider: 'browseros', model: 'none', providerId: 'chosen' },
    }),
  )
})

it('retains immutable version history and restores a draft without replacing the active version', () => {
  const { store } = setup()
  const first = store.draft(definition, 0)
  activate(store, first.id, first.latestVersion)
  const second = store.draft(
    { ...definition, name: 'Second' },
    store.revision(),
    first.id,
  )
  activate(store, second.id, second.latestVersion)
  expect(store.history(first.id)).toHaveLength(2)
  const restored = store.restoreVersion(
    first.id,
    first.latestVersion,
    store.revision(),
  )
  expect(restored.latestVersion).toBe(first.latestVersion)
  expect(restored.activeVersion).toBe(second.latestVersion)
  expect(store.manifest(profileId).layers[0]?.definition.name).toBe('Second')
  expect(() =>
    store.restoreVersion(first.id, second.latestVersion, 0),
  ).toThrow()
  store.remove(first.id, store.revision())
  expect(() => store.history(first.id)).toThrow('not found')
})

it('installs the same activity schema through migration and fallback, bounds retention, and reports interrupted runs', () => {
  expect(
    readFileSync(
      join(
        import.meta.dir,
        '../../src/lib/db/migrations/0021_layer_activity.sql',
      ),
      'utf8',
    ),
  ).toBe(LAYER_ACTIVITY_SCHEMA_SQL)
  const db = new Database(':memory:')
  db.exec(LAYERS_SCHEMA_SQL + LAYER_ACTIVITY_SCHEMA_SQL)
  let now = 1_000_000
  const store = new LayerStore(db, () => now)
  try {
    const layer = store.draft(definition, 0)
    const run = {
      invocationId: 'run',
      layerId: layer.id,
      version: layer.latestVersion,
      actionId: 'action',
      fingerprint: 'hash',
      provider: 'openai',
      deadlineAt: now + 1000,
    }
    store.beginRun(run)
    expect(store.activity()[0]?.status).toBe('running')
    now += 1001
    expect(store.activity()[0]?.status).toBe('interrupted')
    now += 8 * 24 * 60 * 60_000
    store.beginRun({ ...run, invocationId: 'new', deadlineAt: now + 1000 })
    expect(store.activity()).toHaveLength(1)
    expect(db.query('SELECT * FROM layer_activity').all()).toHaveLength(1)
    store.finishRun('new', 'cancelled')
    expect(store.activity()[0]?.status).toBe('cancelled')
  } finally {
    db.close()
  }
})

it('purges deleted definitions after thirty days while preserving restored Layers', () => {
  let now = Date.now()
  const { store } = setup(() => now)
  const first = store.draft(definition, 0)
  store.remove(first.id, store.revision())
  const second = store.draft(
    { ...definition, name: 'Restored' },
    store.revision(),
  )
  store.remove(second.id, store.revision())
  store.restore(second.id, store.revision())
  now += 30 * 24 * 60 * 60_000 - 1
  expect(store.deleted()).toHaveLength(1)
  now++
  expect(store.deleted()).toHaveLength(0)
  expect(() => store.version(first.id, first.latestVersion)).toThrow(
    'not found',
  )
  expect(() => store.restore(first.id, store.revision())).toThrow('not found')
  expect(store.read(second.id).enabled).toBe(false)
  expect(store.version(second.id, second.latestVersion)).toBeDefined()
})
