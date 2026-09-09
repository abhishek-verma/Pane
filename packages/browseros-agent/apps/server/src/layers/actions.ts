import {
  actionAcceptsInput,
  isDataInput,
  isPageTaskInput,
  isScriptTaskInput,
  type LayerActionBinding,
  type LayerEvent,
  layerActionBindingSchema,
  layerActionInputSchema,
  type ScriptTaskResult,
  sameLayerActionBinding,
  scriptTaskResultSchema,
} from '@browseros/shared/layers/action-protocol'
import { dataResultSchema } from '@browseros/shared/layers/data'
import { layerMatchesUrl } from '@browseros/shared/layers/matching'
import type { ScriptTaskExecution } from '@browseros/shared/layers/script-task'
import { LLMConfigSchema } from '@browseros/shared/schemas/llm'
import { z } from 'zod'
import { runLayerTranslation, type TranslationRun } from './action-runner'
import type { LayerBroker } from './broker'
import { LayerProviderError } from './provider-error'
import { PageTaskResultSink, TranslationResultSink } from './result-acceptance'
import { type LayerStore, LayerStoreError, layerDigest } from './store'

const actionRequestSchema = z
  .object({
    binding: layerActionBindingSchema,
    input: layerActionInputSchema,
    config: LLMConfigSchema,
  })
  .strict()
type ActionRequest = z.infer<typeof actionRequestSchema>
interface Invocation {
  kind: 'data' | 'model'
  fingerprint: string
  binding: ActionRequest['binding']
  controller: AbortController
  startedAt: number
  promise: Promise<LayerEvent[]>
  done: boolean
  current: () => boolean
  expiresAt?: number
}

/** In-memory results expire after five minutes and never enter chat history.
 * Idempotency is per profile and complete binding; reuse cannot start more work. */
export class LayerActions {
  private readonly cancellations = new Map<
    string,
    { binding: ActionRequest['binding']; expiresAt: number }
  >()
  private readonly invocations = new Map<string, Invocation>()
  constructor(
    private readonly broker: LayerBroker,
    private readonly runner: (
      run: TranslationRun,
    ) => ReturnType<typeof runLayerTranslation> = runLayerTranslation,
    private readonly now: () => number = Date.now,
  ) {}

  async run(
    profileId: string,
    raw: unknown,
    store: LayerStore,
  ): Promise<LayerEvent[]> {
    const request = actionRequestSchema.parse(raw)
    const { binding, input, config } = request
    if (binding.profileId !== profileId)
      throw new Error('Layer action profile mismatch.')
    const key = `${profileId}:${binding.invocationId}`
    const cancelled = this.cancellations.get(key)
    if (cancelled && cancelled.expiresAt > Date.now())
      throw new Error('This invocation was cancelled before starting.')
    const fingerprint = layerDigest({
      binding,
      input,
      config: {
        provider: config.provider,
        providerId: config.providerId,
        model: config.model,
      },
    })
    const cached = this.invocations.get(key)
    if (cached?.expiresAt !== undefined && cached.expiresAt <= this.now())
      this.invocations.delete(key)
    const existing = this.invocations.get(key)
    if (existing) {
      if (!existing.current())
        throw new Error('The originating Layer or page changed.')
      if (existing.fingerprint !== fingerprint)
        throw new Error('Conflicting Layer invocation retry.')
      return existing.promise
    }
    const layer = store.version(binding.layerId, binding.layerVersion)
    const action = layer.definition.actions.find(
      (entry) => entry.id === binding.actionId,
    )
    if (!action || !actionAcceptsInput(action, input))
      throw new Error('Unsupported Layer action.')
    if (
      !isDataInput(input) &&
      (!action.providerId ||
        config.providerId !== action.providerId ||
        !this.broker.providerMatches(profileId, config))
    )
      throw new Error(
        'The selected action provider changed or is missing. No provider fallback was used.',
      )
    if (
      isScriptTaskInput(input) &&
      (!this.broker.capabilities(profileId, action.providerId)
        .generatedScript ||
        !store.hasGrant(binding.layerId, binding.layerVersion))
    )
      throw new Error(
        'Generated scripts require explicit page access and a compatible provider.',
      )
    const sessionId = this.broker.session(profileId)
    const providerRevision = this.broker.capabilities(
      profileId,
      action.providerId,
    ).revision
    const current = () => {
      try {
        if (
          this.broker.session(profileId) !== sessionId ||
          this.broker.capabilities(profileId, action.providerId).revision !==
            providerRevision
        )
          return false
        store.read(binding.layerId)
        const doc = this.broker.document(profileId, binding.tabId)
        if (
          doc.documentId !== binding.documentId ||
          doc.instanceId !== binding.instanceId ||
          doc.routeEpoch !== binding.routeEpoch ||
          !layerMatchesUrl(layer.definition.scope, doc.url)
        )
          return false
        const manifest = store.manifest(profileId)
        if (
          manifest.revision !== binding.revocationGeneration ||
          manifest.paused ||
          manifest.pausedOrigins.includes(layer.definition.scope.origin)
        )
          return false
        return (
          manifest.layers.some(
            (item) =>
              item.id === binding.layerId &&
              item.version === binding.layerVersion,
          ) || this.broker.isPreview(profileId, binding, layer.version)
        )
      } catch {
        return false
      }
    }
    if (!current())
      throw new Error('The originating Layer or page is no longer active.')
    const now = this.now()
    for (const [id, item] of this.invocations)
      if (item.expiresAt !== undefined && item.expiresAt <= now)
        this.invocations.delete(id)
    const recent = [...this.invocations.values()].filter(
      (item) => item.binding.profileId === profileId,
    )
    const kind = isDataInput(input) ? 'data' : 'model'
    const sameKind = recent.filter((item) => item.kind === kind)
    if (
      recent.filter((item) => !item.done).length >= 4 ||
      (kind === 'data' && sameKind.filter((item) => !item.done).length >= 2) ||
      sameKind.filter((item) => now - item.startedAt < 60_000).length >=
        (kind === 'data' ? 60 : 12)
    )
      throw new Error('Layer action limit reached. Wait before trying again.')
    const controller = new AbortController()
    store.beginRun({
      invocationId: binding.invocationId,
      layerId: binding.layerId,
      version: binding.layerVersion,
      actionId: binding.actionId,
      fingerprint,
      provider: isDataInput(input) ? input.operationId : config.provider,
      deadlineAt: now + action.limits.deadlineMs,
    })
    const invocation: Invocation = {
      kind,
      binding,
      fingerprint,
      controller,
      startedAt: now,
      current,
      promise: Promise.resolve([]),
      done: false,
    }
    const event = (
      sequence: number,
      payload: LayerEvent['payload'],
    ): LayerEvent => ({
      protocol: 'pane.layer-action.v1',
      binding,
      sequence,
      payload,
    })
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, action.limits.deadlineMs)
    const watch = setInterval(() => {
      if (!current()) controller.abort()
    }, 250)
    invocation.promise = (async () => {
      try {
        const data = await this.runner({
          binding,
          input,
          action,
          config,
          signal: controller.signal,
          current,
          ...(isScriptTaskInput(input)
            ? {
                pageHost: {
                  inspect: async () => {
                    if (controller.signal.aborted || !current())
                      throw new Error('Script task revoked.')
                    return this.broker.command(
                      profileId,
                      'script-inspect',
                      { binding, layer },
                      this.broker.document(profileId, binding.tabId),
                    )
                  },
                  execute: async (execution: ScriptTaskExecution) => {
                    if (controller.signal.aborted || !current())
                      throw new Error('Script task revoked.')
                    return (await this.broker.command(
                      profileId,
                      'script-execute',
                      { binding, layer, execution },
                      this.broker.document(profileId, binding.tabId),
                    )) as {
                      checks: ScriptTaskResult['executions'][number]['checks']
                    }
                  },
                },
              }
            : {}),
        })
        if (controller.signal.aborted || !current()) {
          store.finishRun(
            binding.invocationId,
            timedOut ? 'failed' : 'cancelled',
          )
          return [
            event(1, { type: 'accepted' }),
            event(
              2,
              timedOut
                ? { type: 'failed', code: 'DEADLINE_EXCEEDED', retryable: true }
                : { type: 'cancelled' },
            ),
          ]
        }
        let acceptedData: LayerEvent['payload'] & { type: 'result' }
        if (isScriptTaskInput(input)) {
          const parsed = scriptTaskResultSchema.parse(data)
          if (!parsed.executions.at(-1)?.checks.every((check) => check.intact))
            throw new Error(
              'Generated page task did not pass its browser checks.',
            )
          acceptedData = { type: 'result', data: parsed }
          this.broker.markProviderReady(profileId, config)
        } else if (isDataInput(input)) {
          const parsed = dataResultSchema.parse(data)
          const expected = new Set(
            input.entities.map((entity) => entity.toLowerCase()),
          )
          if (
            parsed.operationId !== input.operationId ||
            parsed.entries.length !== expected.size ||
            new Set(parsed.entries.map((entry) => entry.entityId)).size !==
              expected.size ||
            parsed.entries.some((entry) => !expected.has(entry.entityId))
          )
            throw new Error('Invalid data entity binding.')
          acceptedData = { type: 'result', data: parsed }
        } else {
          const sink = isPageTaskInput(input)
            ? new PageTaskResultSink(
                binding,
                input,
                now + action.limits.deadlineMs,
              )
            : new TranslationResultSink(
                binding,
                input,
                now + action.limits.deadlineMs,
              )
          const accepted = sink.submit(data, binding)
          if (!accepted.accepted) throw new Error('Invalid provider result.')
          acceptedData = { type: 'result', data: accepted.data }
          this.broker.markProviderReady(profileId, config)
        }
        this.broker.recordActionProof(profileId, binding)
        store.finishRun(binding.invocationId, 'completed')
        return [
          event(1, { type: 'accepted' }),
          event(2, acceptedData),
          event(3, { type: 'completed' }),
        ]
      } catch (error) {
        store.finishRun(
          binding.invocationId,
          controller.signal.aborted && !timedOut ? 'cancelled' : 'failed',
        )
        return [
          event(1, { type: 'accepted' }),
          event(
            2,
            timedOut
              ? { type: 'failed', code: 'DEADLINE_EXCEEDED', retryable: true }
              : controller.signal.aborted
                ? { type: 'cancelled' }
                : {
                    type: 'failed',
                    code:
                      error instanceof LayerProviderError
                        ? error.code
                        : 'PROVIDER_RESULT_FAILED',
                    retryable:
                      error instanceof LayerProviderError
                        ? error.retryable
                        : true,
                  },
          ),
        ]
      } finally {
        invocation.done = true
        invocation.expiresAt = this.now() + 5 * 60_000
        // Drop private payloads even if no later invocation triggers pruning.
        setTimeout(() => {
          if (this.invocations.get(key) === invocation)
            this.invocations.delete(key)
        }, 5 * 60_000).unref()
        clearInterval(watch)
        clearTimeout(timeout)
      }
    })()
    this.invocations.set(key, invocation)
    return invocation.promise
  }

  async replay(
    profileId: string,
    binding: LayerActionBinding,
    after: number,
  ): Promise<LayerEvent[]> {
    const key = `${profileId}:${binding.invocationId}`
    const invocation = this.invocations.get(key)
    if (
      !invocation ||
      (invocation.expiresAt !== undefined && invocation.expiresAt <= this.now())
    ) {
      if (invocation) this.invocations.delete(key)
      throw new LayerStoreError(
        'RESULT_EXPIRED',
        'This result expired or the server restarted. Click again to start a new action.',
      )
    }
    if (
      profileId !== binding.profileId ||
      !sameLayerActionBinding(invocation.binding, binding) ||
      !invocation.current()
    )
      throw new Error('The originating Layer or page changed.')
    const events = await invocation.promise
    if (!invocation.current())
      throw new Error('The originating Layer or page changed.')
    return events.filter((event) => event.sequence > after)
  }

  cancel(profileId: string, binding: LayerActionBinding): boolean {
    const invocation = this.invocations.get(
      `${profileId}:${binding.invocationId}`,
    )
    if (!invocation) {
      if (profileId !== binding.profileId) return false
      for (const [key, value] of this.cancellations)
        if (value.expiresAt < Date.now()) this.cancellations.delete(key)
      if (this.cancellations.size >= 1000) return false
      this.cancellations.set(`${profileId}:${binding.invocationId}`, {
        binding,
        expiresAt: Date.now() + 5 * 60_000,
      })
      return true
    }
    if (!sameLayerActionBinding(invocation.binding, binding)) return false
    invocation.controller.abort()
    return true
  }
}
