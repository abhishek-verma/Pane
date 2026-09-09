import { randomUUID } from 'node:crypto'
import type { LayerActionBinding } from '@browseros/shared/layers/action-protocol'
import type { LayerCapabilities } from '@browseros/shared/layers/capabilities'
import type { LLMConfig } from '@browseros/shared/schemas/llm'
import { z } from 'zod'
import { API_LAYER_PROVIDERS } from './action-runner'

export const layerDocumentSchema = z
  .object({
    tabId: z.number().int().nonnegative(),
    documentId: z.string().min(1).max(128),
    instanceId: z.string().uuid(),
    routeEpoch: z.number().int().nonnegative(),
    url: z.string().url().max(8192),
    title: z.string().max(300),
    active: z.boolean(),
  })
  .strict()
export type LayerDocument = z.infer<typeof layerDocumentSchema>
export interface LayerCommand {
  id: string
  kind: string
  tabId?: number
  documentId?: string
  instanceId?: string
  routeEpoch?: number
  payload: unknown
  expiresAt: number
}
interface Pending {
  command: LayerCommand
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
export const layerProviderSchema = z
  .object({
    id: z.string().min(1).max(128),
    type: z.string().max(80),
    model: z.string().max(256),
    updatedAt: z.number().finite(),
  })
  .strict()
export type Provider = z.infer<typeof layerProviderSchema>
interface Preview {
  target: LayerDocument
  layerId: string
  version: string
  expiresAt: number
  actions: Set<string>
}
interface Connection {
  sessionId: string
  documents: LayerDocument[]
  seenAt: number
  javascript: boolean
  generatedScript: boolean
  providers: Provider[]
  pending: Map<string, Pending>
  wake?: () => void
}

/** Authenticated extension service-worker channel. No page-facing HTTP route
 * accepts a claimed tab/document as proof of identity. */
export class LayerBroker {
  private readonly previews = new Map<string, Preview>()
  private readonly verifiedProviders = new Set<string>()
  private readonly profiles = new Map<string, Connection>()
  private readonly listeners = new Set<(profileId: string) => void>()

  connect(
    profileId: string,
    sessionId: string,
    documents: LayerDocument[],
    javascript: boolean,
    providers: Provider[],
    generatedScript = false,
  ): void {
    let connection = this.profiles.get(profileId)
    if (connection && connection.sessionId !== sessionId) {
      for (const pending of connection.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Layer browser connection restarted.'))
      }
      connection.wake?.()
      for (const key of this.previews.keys())
        if (key.startsWith(`${profileId}:`)) this.previews.delete(key)
      connection = undefined
    }
    if (!connection) {
      connection = {
        sessionId,
        documents: [],
        seenAt: Date.now(),
        javascript,
        generatedScript,
        providers,
        pending: new Map(),
      }
      this.profiles.set(profileId, connection)
    }
    connection.documents = documents
    connection.generatedScript = generatedScript
    connection.javascript = javascript
    connection.providers = providers
    connection.seenAt = Date.now()
    for (const listener of this.listeners) listener(profileId)
  }

  onChange(listener: (profileId: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  ready(profileId: string): boolean {
    const c = this.profiles.get(profileId)
    return Boolean(c && Date.now() - c.seenAt < 45_000)
  }
  session(profileId: string): string | undefined {
    return this.ready(profileId)
      ? this.profiles.get(profileId)?.sessionId
      : undefined
  }
  documents(profileId: string): LayerDocument[] {
    return this.ready(profileId)
      ? structuredClone(this.profiles.get(profileId)?.documents ?? [])
      : []
  }
  document(profileId: string, tabId: number): LayerDocument {
    const document = this.documents(profileId).find(
      (item) => item.tabId === tabId,
    )
    if (!document)
      throw new Error(
        'This page is unavailable to Layers. Refresh its browser context before retrying.',
      )
    return document
  }
  registerPreview(
    profileId: string,
    target: LayerDocument,
    layerId: string,
    version: string,
  ): void {
    this.previews.set(`${profileId}:${target.tabId}`, {
      target,
      layerId,
      version,
      expiresAt: Date.now() + 5 * 60_000,
      actions: new Set(),
    })
  }
  clearPreview(profileId: string, tabId: number): void {
    this.previews.delete(`${profileId}:${tabId}`)
  }
  isPreview(
    profileId: string,
    binding: Pick<
      LayerActionBinding,
      'tabId' | 'documentId' | 'instanceId' | 'routeEpoch' | 'layerId'
    >,
    version: string,
  ): boolean {
    const preview = this.previews.get(`${profileId}:${binding.tabId}`)
    return Boolean(
      preview &&
        preview.expiresAt > Date.now() &&
        preview.layerId === binding.layerId &&
        preview.version === version &&
        preview.target.documentId === binding.documentId &&
        preview.target.instanceId === binding.instanceId &&
        preview.target.routeEpoch === binding.routeEpoch,
    )
  }
  recordActionProof(profileId: string, binding: LayerActionBinding): void {
    if (this.isPreview(profileId, binding, binding.layerVersion))
      this.previews
        .get(`${profileId}:${binding.tabId}`)
        ?.actions.add(binding.actionId)
  }
  hasActionProof(
    profileId: string,
    target: LayerDocument,
    id: string,
    version: string,
    actionIds: string[],
  ): boolean {
    const preview = this.previews.get(`${profileId}:${target.tabId}`)
    return (
      this.isPreview(profileId, { ...target, layerId: id }, version) &&
      actionIds.every((actionId) => preview?.actions.has(actionId))
    )
  }
  private providerKey(profileId: string, provider: Provider): string {
    return JSON.stringify([profileId, provider])
  }
  providerMatches(profileId: string, config: LLMConfig): boolean {
    const provider = this.profiles
      .get(profileId)
      ?.providers.find((item) => item.id === config.providerId)
    return Boolean(
      provider &&
        provider.type === config.provider &&
        provider.model === (config.model ?? ''),
    )
  }
  markProviderReady(profileId: string, config: LLMConfig): void {
    const provider = this.profiles
      .get(profileId)
      ?.providers.find((item) => item.id === config.providerId)
    if (provider && this.providerMatches(profileId, config))
      this.verifiedProviders.add(this.providerKey(profileId, provider))
  }
  capabilities(profileId: string, providerId?: string): LayerCapabilities {
    const c = this.profiles.get(profileId)
    const ready = this.ready(profileId)
    const provider = c?.providers.find((p) => p.id === providerId)
    return {
      revision: `layers-v8:${ready}:${c?.javascript ?? false}:${c?.generatedScript ?? false}:${provider ? this.providerKey(profileId, provider) : 'local'}`,
      managed: ready,
      authenticatedBroker: ready,
      transform: Boolean(
        ready &&
          provider &&
          (API_LAYER_PROVIDERS.has(provider.type) ||
            provider.type === 'claude-code' ||
            provider.type === 'codex'),
      ),
      pageTask: Boolean(
        ready &&
          provider &&
          (API_LAYER_PROVIDERS.has(provider.type) ||
            provider.type === 'claude-code' ||
            provider.type === 'codex'),
      ),
      data: ready,
      javascript: ready && Boolean(c?.javascript),
      generatedScript: Boolean(
        ready &&
          c?.javascript &&
          c.generatedScript &&
          provider &&
          (API_LAYER_PROVIDERS.has(provider.type) ||
            provider.type === 'claude-code' ||
            provider.type === 'codex'),
      ),
      automaticInference: false,
      outputBudget:
        provider?.type === 'codex' ? 'accepted-output' : 'provider-ceiling',
      provider: provider
        ? this.verifiedProviders.has(this.providerKey(profileId, provider))
          ? 'ready'
          : 'unverified'
        : 'missing-setup',
    }
  }
  async command(
    profileId: string,
    kind: string,
    payload: unknown,
    target?: LayerDocument,
  ): Promise<unknown> {
    const c = this.profiles.get(profileId)
    if (!c || !this.ready(profileId))
      throw new Error('The Layers browser connection is unavailable.')
    if (c.pending.size >= 32)
      throw new Error('Too many pending Layer operations.')
    const command: LayerCommand = {
      id: randomUUID(),
      kind,
      payload,
      expiresAt: Date.now() + 30_000,
      ...(target
        ? {
            tabId: target.tabId,
            documentId: target.documentId,
            instanceId: target.instanceId,
            routeEpoch: target.routeEpoch,
          }
        : {}),
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        c.pending.delete(command.id)
        reject(new Error('The Layer page operation timed out.'))
      }, 30_000)
      c.pending.set(command.id, { command, resolve, reject, timer })
      c.wake?.()
    })
  }
  complete(
    profileId: string,
    sessionId: string,
    id: string,
    result: unknown,
    error?: string,
  ): boolean {
    const c = this.profiles.get(profileId)
    if (!c || c.sessionId !== sessionId) return false
    const pending = c.pending.get(id)
    if (!pending) return false
    if (
      pending.command.tabId !== undefined &&
      !c.documents.some(
        (doc) =>
          doc.tabId === pending.command.tabId &&
          doc.documentId === pending.command.documentId &&
          doc.instanceId === pending.command.instanceId &&
          doc.routeEpoch === pending.command.routeEpoch,
      )
    ) {
      clearTimeout(pending.timer)
      c.pending.delete(id)
      pending.reject(new Error('The originating document changed.'))
      return false
    }
    clearTimeout(pending.timer)
    c.pending.delete(id)
    if (error) pending.reject(new Error(error.slice(0, 500)))
    else {
      c.seenAt = Date.now()
      pending.resolve(result)
    }
    return true
  }
  wake(profileId: string): void {
    this.profiles.get(profileId)?.wake?.()
  }
  async poll(
    profileId: string,
    signal: AbortSignal,
    wait: boolean,
  ): Promise<LayerCommand[]> {
    const c = this.profiles.get(profileId)
    if (!c) return []
    if (wait && !c.pending.size && !signal.aborted)
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', finish)
          if (c.wake === finish) c.wake = undefined
          resolve()
        }
        const timer = setTimeout(finish, 20_000)
        c.wake?.()
        c.wake = finish
        signal.addEventListener('abort', finish, { once: true })
      })
    return structuredClone(
      [...c.pending.values()].map((pending) => pending.command),
    )
  }
}
export const layerBroker = new LayerBroker()
