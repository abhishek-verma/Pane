import type { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import {
  definitionCapabilityErrors,
  type LayerCapabilities,
} from '@browseros/shared/layers/capabilities'
import { canonicalLayerJson } from '@browseros/shared/layers/digest'
import {
  type InstalledLayer,
  LAYER_PROTOCOL,
  type LayerDefinition,
  type LayerManifest,
  layerDefinitionSchema,
  layerIdSchema,
  layerOriginSchema,
} from '@browseros/shared/layers/manifest'
import { validateLayerSource } from './script-validation'

export class LayerStoreError extends Error {
  constructor(
    readonly code:
      | 'RESULT_EXPIRED'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'UNSUPPORTED'
      | 'GRANT_REQUIRED'
      | 'VERIFICATION_REQUIRED',
    message: string,
  ) {
    super(message)
  }
}

interface LayerRow {
  id: string
  latest_version: string
  active_version: string | null
  enabled: number
  created_at: number
  updated_at: number
}
interface VersionRow {
  definition_json: string
  policy_hash: string
}
interface VerificationRow {
  layer_id: string
  version: string
  capability_revision: string
  policy_hash: string
  checks_json: string
  expires_at: number
}
export interface LayerRecord {
  id: string
  latestVersion: string
  activeVersion: string | null
  enabled: boolean
  definition: LayerDefinition
  createdAt: number
  updatedAt: number
}
export interface LayerVerificationChecks {
  mounted: boolean
  restored: boolean
  actionContract: boolean
  reloaded: boolean
  recovery?: 'reload-required'
}
function recoveryVerified(
  definition: LayerDefinition,
  checks: LayerVerificationChecks,
): boolean {
  return definition.mode === 'javascript'
    ? checks.recovery === 'reload-required' && checks.restored === false
    : checks.restored === true && checks.recovery === undefined
}

export function layerDigest(value: unknown): string {
  return createHash('sha256').update(canonicalLayerJson(value)).digest('hex')
}
function policyDigest(definition: LayerDefinition): string {
  return layerDigest({
    scope: definition.scope,
    mode: definition.mode,
    actions: definition.actions,
    source: definition.source ?? null,
  })
}

/** Profile-owned database repository. Only trusted service/harness code may
 * grant policy or record verification; those are not public authoring tools. */
export class LayerStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  revision(): number {
    const state = this.db
      .query<{ revision: number }, []>(
        'SELECT revision FROM layer_state WHERE singleton=1',
      )
      .get()
    if (!state) throw new Error('Layer schema is not initialized.')
    return state.revision
  }

  list(): LayerRecord[] {
    return this.db
      .query<LayerRow, []>(
        'SELECT * FROM layers WHERE id NOT IN (SELECT layer_id FROM layer_trash) ORDER BY updated_at DESC, id',
      )
      .all()
      .map((row) => this.toRecord(row))
  }

  read(id: string): LayerRecord {
    const row = this.db
      .query<LayerRow, [string]>(
        'SELECT * FROM layers WHERE id=? AND id NOT IN (SELECT layer_id FROM layer_trash)',
      )
      .get(layerIdSchema.parse(id))
    if (!row) throw new LayerStoreError('NOT_FOUND', 'Layer not found.')
    return this.toRecord(row)
  }

  version(id: string, version: string): InstalledLayer {
    const row = this.db
      .query<VersionRow, [string, string]>(
        'SELECT definition_json, policy_hash FROM layer_versions WHERE layer_id=? AND version=?',
      )
      .get(id, version)
    if (!row) throw new LayerStoreError('NOT_FOUND', 'Layer version not found.')
    return {
      id,
      version,
      definition: layerDefinitionSchema.parse(JSON.parse(row.definition_json)),
    }
  }

  history(id: string) {
    this.read(id)
    return this.db
      .query<{ version: string; createdAt: number }, [string]>(
        'SELECT version, created_at AS createdAt FROM layer_versions WHERE layer_id=? ORDER BY created_at DESC, version LIMIT 100',
      )
      .all(id)
  }

  restoreVersion(id: string, version: string, revision: number): LayerRecord {
    this.read(id)
    return this.draft(this.version(id, version).definition, revision, id)
  }

  beginRun(input: {
    invocationId: string
    layerId: string
    version: string
    actionId: string
    fingerprint: string
    provider: string
    deadlineAt: number
  }): void {
    this.db
      .transaction(() => {
        this.db
          .query(
            "UPDATE layer_activity SET status='interrupted',finished_at=deadline_at WHERE status='running' AND deadline_at<=?",
          )
          .run(this.now())
        const running =
          this.db
            .query<{ count: number }, []>(
              "SELECT COUNT(*) AS count FROM layer_activity WHERE status='running'",
            )
            .get()?.count ?? 0
        if (running >= 1000)
          throw new Error(
            'Layer activity is at capacity. Wait for running actions to end.',
          )
        this.db
          .query(
            "DELETE FROM layer_activity WHERE status<>'running' AND (started_at<? OR invocation_id IN (SELECT invocation_id FROM layer_activity WHERE status<>'running' ORDER BY started_at DESC LIMIT -1 OFFSET ?))",
          )
          .run(this.now() - 7 * 24 * 60 * 60_000, 999 - running)
        const previous = this.db
          .query<{ fingerprint: string }, [string]>(
            'SELECT fingerprint FROM layer_activity WHERE invocation_id=?',
          )
          .get(input.invocationId)
        if (previous)
          throw new LayerStoreError(
            previous.fingerprint === input.fingerprint
              ? 'RESULT_EXPIRED'
              : 'CONFLICT',
            previous.fingerprint === input.fingerprint
              ? 'This action already started. Its response is no longer replayable; click again to start a new run.'
              : 'Conflicting Layer invocation retry.',
          )
        this.db
          .query(
            "INSERT INTO layer_activity(invocation_id,layer_id,version,action_id,fingerprint,provider,status,started_at,deadline_at) VALUES(?,?,?,?,?,?,'running',?,?)",
          )
          .run(
            input.invocationId,
            input.layerId,
            input.version,
            input.actionId,
            input.fingerprint,
            input.provider,
            this.now(),
            input.deadlineAt,
          )
      })
      .immediate()
  }

  finishRun(
    invocationId: string,
    status: 'completed' | 'failed' | 'cancelled',
  ): void {
    this.db
      .query(
        'UPDATE layer_activity SET status=?,finished_at=? WHERE invocation_id=?',
      )
      .run(status, this.now(), invocationId)
  }

  activity() {
    this.db
      .query('DELETE FROM layer_activity WHERE started_at<?')
      .run(this.now() - 7 * 24 * 60 * 60_000)
    return this.db
      .query<
        {
          invocationId: string
          layerId: string
          version: string
          actionId: string
          provider: string
          status: string
          startedAt: number
          finishedAt: number | null
          deadlineAt: number
          name: string
        },
        [number, number]
      >(`SELECT a.invocation_id AS invocationId,a.layer_id AS layerId,a.version,a.action_id AS actionId,a.provider,
      CASE WHEN a.status='running' AND a.deadline_at<=? THEN 'interrupted' ELSE a.status END AS status,
      a.started_at AS startedAt,a.finished_at AS finishedAt,a.deadline_at AS deadlineAt,
      json_extract(v.definition_json,'$.name') AS name
      FROM layer_activity a JOIN layer_versions v ON v.layer_id=a.layer_id AND v.version=a.version
      WHERE a.layer_id NOT IN (SELECT layer_id FROM layer_trash) AND a.started_at>?
      ORDER BY a.started_at DESC,a.invocation_id LIMIT 100`)
      .all(this.now(), this.now() - 7 * 24 * 60 * 60_000)
  }

  draft(
    input: unknown,
    expectedRevision: number,
    existingId?: string,
  ): LayerRecord {
    const definition = layerDefinitionSchema.parse(input)
    validateLayerSource(definition)
    const version = layerDigest(definition)
    const id = existingId ? layerIdSchema.parse(existingId) : randomUUID()
    this.write(expectedRevision, () => {
      const time = this.now()
      if (existingId) {
        this.read(id)
        this.db
          .query('UPDATE layers SET latest_version=?,updated_at=? WHERE id=?')
          .run(version, time, id)
      } else {
        this.db
          .query(
            'INSERT INTO layers(id,latest_version,created_at,updated_at) VALUES (?,?,?,?)',
          )
          .run(id, version, time, time)
      }
      this.db
        .query(
          'INSERT OR IGNORE INTO layer_versions(layer_id,version,definition_json,policy_hash,created_at) VALUES (?,?,?,?,?)',
        )
        .run(
          id,
          version,
          JSON.stringify(definition),
          policyDigest(definition),
          time,
        )
    })
    return this.read(id)
  }

  grant(id: string, version: string, expectedRevision: number): void {
    this.write(expectedRevision, () => {
      this.read(id)
      const { definition } = this.version(id, version)
      this.db
        .query(
          'INSERT OR REPLACE INTO layer_grants(layer_id,policy_hash,granted_at) VALUES (?,?,?)',
        )
        .run(id, policyDigest(definition), this.now())
    })
  }

  hasGrant(id: string, version: string): boolean {
    this.read(id)
    const { definition } = this.version(id, version)
    return Boolean(
      this.db
        .query('SELECT 1 FROM layer_grants WHERE layer_id=? AND policy_hash=?')
        .get(id, policyDigest(definition)),
    )
  }

  recordVerification(
    id: string,
    version: string,
    capabilities: LayerCapabilities,
    checks: LayerVerificationChecks,
  ): string {
    const { definition } = this.version(id, version)
    const receipt = randomUUID()
    this.db
      .query(
        'INSERT INTO layer_verifications(id,layer_id,version,capability_revision,policy_hash,checks_json,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        receipt,
        id,
        version,
        capabilities.revision,
        policyDigest(definition),
        JSON.stringify(checks),
        this.now() + 30 * 60_000,
        this.now(),
      )
    return receipt
  }

  verification(id: string, version: string, capabilities: LayerCapabilities) {
    const row = this.db
      .query<
        { id: string; checks_json: string; expires_at: number },
        [string, string, string, number]
      >(
        'SELECT id,checks_json,expires_at FROM layer_verifications WHERE layer_id=? AND version=? AND capability_revision=? AND expires_at>? ORDER BY created_at DESC LIMIT 1',
      )
      .get(id, version, capabilities.revision, this.now())
    if (!row) return null
    const checks = JSON.parse(row.checks_json) as LayerVerificationChecks
    const { definition } = this.version(id, version)
    return checks.mounted &&
      recoveryVerified(definition, checks) &&
      checks.actionContract &&
      checks.reloaded
      ? { receiptId: row.id, expiresAt: row.expires_at, checks }
      : null
  }

  /** Consent and activation commit together; failed validation retains neither. */
  keep(
    id: string,
    version: string,
    receiptId: string,
    capabilities: LayerCapabilities,
    expectedRevision: number,
  ): void {
    this.db
      .transaction(() => {
        this.grant(id, version, expectedRevision)
        this.activate(id, version, receiptId, capabilities, this.revision())
      })
      .immediate()
  }

  activate(
    id: string,
    version: string,
    receiptId: string,
    capabilities: LayerCapabilities,
    expectedRevision: number,
  ): void {
    this.write(expectedRevision, () => {
      this.read(id)
      const { definition } = this.version(id, version)
      const unsupported = definitionCapabilityErrors(definition, capabilities)
      validateLayerSource(definition)
      if (unsupported.length)
        throw new LayerStoreError('UNSUPPORTED', unsupported.join(' '))
      const policy = policyDigest(definition)
      if (
        !this.db
          .query(
            'SELECT 1 FROM layer_grants WHERE layer_id=? AND policy_hash=?',
          )
          .get(id, policy)
      )
        throw new LayerStoreError(
          'GRANT_REQUIRED',
          'This scope and action policy has not been granted.',
        )
      const receipt = this.db
        .query<VerificationRow, [string]>(
          'SELECT * FROM layer_verifications WHERE id=?',
        )
        .get(receiptId)
      if (
        !receipt ||
        receipt.layer_id !== id ||
        receipt.version !== version ||
        receipt.policy_hash !== policy ||
        receipt.capability_revision !== capabilities.revision ||
        receipt.expires_at <= this.now()
      )
        throw new LayerStoreError(
          'VERIFICATION_REQUIRED',
          'A current verification receipt for this exact version is required.',
        )
      const checks = JSON.parse(receipt.checks_json) as LayerVerificationChecks
      if (
        !checks.mounted ||
        !recoveryVerified(definition, checks) ||
        !checks.reloaded ||
        (definition.actions.length > 0 && !checks.actionContract)
      )
        throw new LayerStoreError(
          'VERIFICATION_REQUIRED',
          'Mandatory verification checks did not pass.',
        )
      this.db
        .query(
          'UPDATE layers SET active_version=?,enabled=1,updated_at=? WHERE id=?',
        )
        .run(version, this.now(), id)
    })
  }

  disable(id: string, expectedRevision: number): void {
    this.write(expectedRevision, () => {
      this.read(id)
      this.db
        .query('UPDATE layers SET enabled=0,updated_at=? WHERE id=?')
        .run(this.now(), id)
    })
  }

  enable(
    id: string,
    capabilities: LayerCapabilities,
    expectedRevision: number,
  ): void {
    this.write(expectedRevision, () => {
      const record = this.read(id)
      if (!record.activeVersion)
        throw new LayerStoreError(
          'VERIFICATION_REQUIRED',
          'Preview and keep this Layer first.',
        )
      const { definition } = this.version(id, record.activeVersion)
      const errors = definitionCapabilityErrors(definition, capabilities)
      if (errors.length)
        throw new LayerStoreError('UNSUPPORTED', errors.join(' '))
      if (
        !this.db
          .query(
            'SELECT 1 FROM layer_grants WHERE layer_id=? AND policy_hash=?',
          )
          .get(id, policyDigest(definition))
      )
        throw new LayerStoreError(
          'GRANT_REQUIRED',
          'This Layer needs a current site grant.',
        )
      this.db
        .query('UPDATE layers SET enabled=1,updated_at=? WHERE id=?')
        .run(this.now(), id)
    })
  }

  remove(id: string, expectedRevision: number): void {
    this.write(expectedRevision, () => {
      this.read(id)
      this.db
        .query('UPDATE layers SET enabled=0,updated_at=? WHERE id=?')
        .run(this.now(), id)
      this.db
        .query('INSERT INTO layer_trash(layer_id,deleted_at) VALUES (?,?)')
        .run(id, this.now())
    })
  }

  private pruneTrash(): void {
    // Deleted definitions and grants are recoverable locally for thirty days.
    // Explicit child deletion also supports fallback DBs without FK enforcement.
    this.db
      .transaction(() => {
        const expired = this.db
          .query<{ layer_id: string }, [number]>(
            'SELECT layer_id FROM layer_trash WHERE deleted_at<=?',
          )
          .all(this.now() - 30 * 24 * 60 * 60_000)
        for (const { layer_id: id } of expired) {
          for (const table of [
            'layer_verifications',
            'layer_grants',
            'layer_versions',
            'layer_trash',
          ])
            this.db.query(`DELETE FROM ${table} WHERE layer_id=?`).run(id)
          this.db.query('DELETE FROM layers WHERE id=?').run(id)
        }
      })
      .immediate()
  }

  deleted(): LayerRecord[] {
    this.pruneTrash()
    return this.db
      .query<LayerRow, []>(
        'SELECT layers.* FROM layers JOIN layer_trash ON layers.id=layer_trash.layer_id ORDER BY layer_trash.deleted_at DESC',
      )
      .all()
      .map((row) => this.toRecord(row))
  }

  restore(id: string, expectedRevision: number): void {
    this.pruneTrash()
    this.write(expectedRevision, () => {
      if (
        !this.db
          .query('SELECT 1 FROM layer_trash WHERE layer_id=?')
          .get(layerIdSchema.parse(id))
      )
        throw new LayerStoreError('NOT_FOUND', 'Deleted Layer not found.')
      this.db.query('DELETE FROM layer_trash WHERE layer_id=?').run(id)
      this.db
        .query('UPDATE layers SET enabled=0,updated_at=? WHERE id=?')
        .run(this.now(), id)
    })
  }

  setPaused(paused: boolean, expectedRevision: number, origin?: string): void {
    if (origin !== undefined) layerOriginSchema.parse(origin)
    this.write(expectedRevision, () => {
      if (origin)
        this.db
          .query(
            'INSERT OR REPLACE INTO layer_site_overrides(origin,paused) VALUES (?,?)',
          )
          .run(origin, Number(paused))
      else
        this.db
          .query('UPDATE layer_state SET paused=? WHERE singleton=1')
          .run(Number(paused))
    })
  }

  manifest(profileId: string): LayerManifest {
    const state = this.db
      .query<{ revision: number; paused: number }, []>(
        'SELECT revision,paused FROM layer_state WHERE singleton=1',
      )
      .get()
    if (!state) throw new Error('Layer schema is not initialized.')
    const layers = this.db
      .query<LayerRow, []>(
        'SELECT * FROM layers WHERE enabled=1 AND active_version IS NOT NULL ORDER BY id',
      )
      .all()
    return {
      protocol: LAYER_PROTOCOL,
      profileId,
      revision: state.revision,
      paused: Boolean(state.paused),
      pausedOrigins: this.db
        .query<{ origin: string }, []>(
          'SELECT origin FROM layer_site_overrides WHERE paused=1 ORDER BY origin',
        )
        .all()
        .map((row) => row.origin),
      layers: layers.map((row) => {
        if (!row.active_version)
          throw new Error('Enabled Layer has no active version.')
        return this.version(row.id, row.active_version)
      }),
    }
  }

  private toRecord(row: LayerRow): LayerRecord {
    return {
      id: row.id,
      latestVersion: row.latest_version,
      activeVersion: row.active_version,
      enabled: Boolean(row.enabled),
      definition: this.version(row.id, row.latest_version).definition,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private write(expectedRevision: number, body: () => void): void {
    this.db
      .transaction(() => {
        if (
          !Number.isSafeInteger(expectedRevision) ||
          this.revision() !== expectedRevision
        )
          throw new LayerStoreError(
            'CONFLICT',
            'Layer state changed. Refresh before retrying.',
          )
        body()
        this.db
          .query('UPDATE layer_state SET revision=revision+1 WHERE singleton=1')
          .run()
      })
      .immediate()
  }
}
