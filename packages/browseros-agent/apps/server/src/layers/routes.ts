import {
  isDataInput,
  layerActionBindingSchema,
} from '@browseros/shared/layers/action-protocol'
import { layerProviderId } from '@browseros/shared/layers/manifest'
import { layerMatchesUrl } from '@browseros/shared/layers/matching'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { getDbHandle } from '../lib/db'
import { runWithProfileAsync } from '../lib/profile-context'
import { runLayerTranslation } from './action-runner'
import { LayerActions } from './actions'
import {
  type LayerBroker,
  layerBroker,
  layerDocumentSchema,
  layerProviderSchema,
} from './broker'
import { type LayerAuthority, layerAuthority } from './broker-auth'
import type { LayerDataBroker } from './data-broker'
import { LayerStore, LayerStoreError } from './store'

const pollSchema = z
  .object({
    sessionId: z.string().uuid(),
    documents: z.array(layerDocumentSchema).max(500),
    javascript: z.boolean(),
    generatedScript: z.boolean().default(false),
    providers: z.array(layerProviderSchema).max(100),
    revision: z.number().int().min(-1),
    wait: z.boolean().default(true),
  })
  .strict()
const mutationSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    action: z.enum([
      'disable',
      'enable',
      'pause',
      'site-pause',
      'keep',
      'delete',
      'restore',
      'restore-version',
      'grant-preview',
    ]),
    id: z.string().optional(),
    version: z.string().optional(),
    receiptId: z.string().uuid().optional(),
    paused: z.boolean().optional(),
    origin: z.string().optional(),
  })
  .strict()

export function createLayerRoutes(
  deps: {
    authority?: LayerAuthority | null
    broker?: LayerBroker
    store?: () => LayerStore
    dataBroker?: LayerDataBroker
    actionRunner?: typeof runLayerTranslation
  } = {},
) {
  const authority =
    deps.authority === undefined ? layerAuthority : deps.authority
  const broker = deps.broker ?? layerBroker
  const store = deps.store ?? (() => new LayerStore(getDbHandle().sqlite))
  const actions = new LayerActions(broker, (run) =>
    deps.dataBroker && isDataInput(run.input)
      ? deps.dataBroker.read(
          run.binding.profileId,
          run.input,
          () => !run.signal.aborted && run.current(),
        )
      : (deps.actionRunner ?? runLayerTranslation)(run),
  )
  const app = new Hono<{ Variables: { layerProfileId: string } }>()
    .use('*', bodyLimit({ maxSize: 2 * 1024 * 1024 }))
    .use('*', async (c, next) => {
      const access = authority?.verify(c.req.header('Authorization'))
      if (!access || access.role)
        return c.json(
          { error: 'A current browser-owned Layer credential is required.' },
          401,
        )
      c.set('layerProfileId', access.profileId)
      c.header('Cache-Control', 'no-store')
      return runWithProfileAsync(access.profileId, next)
    })
    .onError((error, c) => {
      if (error instanceof z.ZodError)
        return c.json(
          {
            error: 'Invalid Layer request.',
            issues: error.issues.map(({ path, message }) => ({
              path,
              message,
            })),
          },
          400,
        )
      if (error instanceof LayerStoreError)
        return c.json(
          { error: error.message, code: error.code },
          error.code === 'CONFLICT' ? 409 : 400,
        )
      return c.json(
        {
          error:
            error instanceof Error ? error.message : 'Layer operation failed.',
        },
        400,
      )
    })
    .post('/version', async (c) => {
      const input = z
        .object({
          id: z.string().max(96),
          version: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict()
        .parse(await c.req.json())
      const repository = store()
      repository.read(input.id)
      return c.json(
        input.version
          ? { layer: repository.version(input.id, input.version) }
          : { versions: repository.history(input.id) },
      )
    })
    .post('/preview-context', async (c) => {
      const input = z
        .object({
          id: z.string().max(96),
          version: z.string().regex(/^[a-f0-9]{64}$/),
          target: layerDocumentSchema,
        })
        .strict()
        .parse(await c.req.json())
      const profileId = c.get('layerProfileId'),
        repository = store()
      const layer = repository.version(input.id, input.version)
      const target = broker.document(profileId, input.target.tabId)
      if (
        target.documentId !== input.target.documentId ||
        target.instanceId !== input.target.instanceId ||
        target.routeEpoch !== input.target.routeEpoch ||
        target.url !== input.target.url ||
        !layerMatchesUrl(layer.definition.scope, target.url)
      )
        throw new Error('The preview document changed.')
      if (
        layer.definition.mode === 'javascript' &&
        !repository.hasGrant(layer.id, layer.version)
      )
        throw new Error('Approve this exact script before previewing it.')
      broker.registerPreview(profileId, target, layer.id, layer.version)
      return c.json({ accepted: true })
    })
    .post('/actions/run', async (c) =>
      c.json({
        events: await actions.run(
          c.get('layerProfileId'),
          await c.req.json(),
          store(),
        ),
      }),
    )
    .post('/actions/replay', async (c) => {
      const input = z
        .object({
          binding: layerActionBindingSchema,
          after: z.number().int().min(0).max(100).default(0),
        })
        .strict()
        .parse(await c.req.json())
      return c.json({
        events: await actions.replay(
          c.get('layerProfileId'),
          input.binding,
          input.after,
        ),
      })
    })
    .post('/actions/cancel', async (c) => {
      const binding = layerActionBindingSchema.parse(await c.req.json())
      return c.json({
        cancelled: actions.cancel(c.get('layerProfileId'), binding),
      })
    })
    .get('/state', (c) => {
      const repository = store()
      const profileId = c.get('layerProfileId')
      return c.json({
        ...repository.manifest(profileId),
        deleted: repository.deleted(),
        activity: repository.activity(),
        records: repository.list().map((record) => ({
          ...record,
          previewAllowed:
            record.definition.mode === 'javascript' &&
            repository.hasGrant(record.id, record.latestVersion),
          activeScope: record.activeVersion
            ? repository.version(record.id, record.activeVersion).definition
                .scope
            : null,
          activeName: record.activeVersion
            ? repository.version(record.id, record.activeVersion).definition
                .name
            : null,
          outputBudget: broker.capabilities(
            profileId,
            layerProviderId(record.definition),
          ).outputBudget,
          verification: repository.verification(
            record.id,
            record.latestVersion,
            broker.capabilities(profileId, layerProviderId(record.definition)),
          ),
        })),
        documents: broker.documents(profileId),
        capabilities: broker.capabilities(profileId),
      })
    })
    .post('/poll', async (c) => {
      const input = pollSchema.parse(await c.req.json())
      const profileId = c.get('layerProfileId')
      if (
        new Set(input.documents.map((d) => d.tabId)).size !==
        input.documents.length
      )
        return c.json({ error: 'Duplicate document registration.' }, 400)
      broker.connect(
        profileId,
        input.sessionId,
        input.documents,
        input.javascript,
        input.providers,
        input.generatedScript,
      )
      const commands = await broker.poll(
        profileId,
        c.req.raw.signal,
        input.wait && input.revision === store().revision(),
      )
      return c.json({ manifest: store().manifest(profileId), commands })
    })
    .post('/complete', async (c) => {
      const input = z
        .object({
          sessionId: z.string().uuid(),
          commandId: z.string().uuid(),
          result: z.unknown().optional(),
          error: z.string().max(500).optional(),
        })
        .strict()
        .parse(await c.req.json())
      return c.json({
        accepted: broker.complete(
          c.get('layerProfileId'),
          input.sessionId,
          input.commandId,
          input.result,
          input.error,
        ),
      })
    })
    .post('/mutate', async (c) => {
      const input = mutationSchema.parse(await c.req.json())
      const repository = store()
      const profileId = c.get('layerProfileId')
      if (input.action === 'pause')
        repository.setPaused(input.paused ?? true, input.revision)
      else if (input.action === 'site-pause') {
        if (!input.origin) throw new Error('A site origin is required.')
        repository.setPaused(input.paused ?? true, input.revision, input.origin)
      } else {
        if (!input.id) throw new Error('A Layer id is required.')
        if (input.action === 'disable')
          repository.disable(input.id, input.revision)
        else if (input.action === 'enable')
          repository.enable(
            input.id,
            broker.capabilities(
              profileId,
              layerProviderId(
                repository.version(
                  input.id,
                  repository.read(input.id).activeVersion ?? '',
                ).definition,
              ),
            ),
            input.revision,
          )
        else if (input.action === 'restore')
          repository.restore(input.id, input.revision)
        else if (input.action === 'delete')
          repository.remove(input.id, input.revision)
        else if (input.action === 'restore-version') {
          if (!input.version) throw new Error('Choose a version first.')
          repository.restoreVersion(input.id, input.version, input.revision)
        } else if (input.action === 'grant-preview') {
          if (!input.version)
            throw new Error('Choose the exact script version first.')
          const layer = repository.version(input.id, input.version)
          if (layer.definition.mode !== 'javascript')
            throw new Error(
              'This Layer does not need script preview permission.',
            )
          repository.grant(input.id, input.version, input.revision)
        } else {
          if (!input.version || !input.receiptId)
            throw new Error('Preview and verify this Layer before keeping it.')
          const layer = repository.version(input.id, input.version)
          const capabilities = broker.capabilities(
            profileId,
            layerProviderId(layer.definition),
          )
          // The trusted extension UI is the grant surface. Author tools cannot
          // issue this request with their narrower delegated credentials.
          repository.keep(
            input.id,
            input.version,
            input.receiptId,
            capabilities,
            input.revision,
          )
        }
      }
      broker.wake(profileId)
      return c.json({ manifest: repository.manifest(profileId) })
    })
  return app
}
