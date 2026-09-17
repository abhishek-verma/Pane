import {
  type LayerManifest,
  layerManifestSchema,
} from '@browseros/shared/layers/manifest'
import { layerMatchesUrl } from '@browseros/shared/layers/matching'
import { z } from 'zod'

const cacheSchema = z
  .object({
    profileId: z.string().uuid(),
    manifest: z.unknown().nullable(),
    disabledIds: z.array(z.string()).max(1000),
    pausedOrigins: z.array(z.string()).max(1000),
    paused: z.boolean(),
  })
  .strict()

/** Offline disable overrides are authoritative until an explicit user enable.
 * A server reconnect, stale response, or browser restart cannot clear them.
 * Only the background broker owns/persists this object; pages do not write it. */
export class LayerRuntimeCache {
  private manifest: LayerManifest | null = null
  private disabledIds = new Set<string>()
  private pausedOrigins = new Set<string>()
  private paused = false
  private readonly revocations = new Map<string, number>()

  constructor(
    readonly profileId: string,
    persisted?: unknown,
  ) {
    z.string().uuid().parse(profileId)
    const cached = cacheSchema.safeParse(persisted)
    if (!cached.success || cached.data.profileId !== profileId) return
    this.disabledIds = new Set(cached.data.disabledIds)
    this.pausedOrigins = new Set(cached.data.pausedOrigins)
    this.paused = cached.data.paused
    if (cached.data.manifest !== null) this.accept(cached.data.manifest)
  }

  accept(value: unknown): 'accepted' | 'duplicate' | 'stale' | 'invalid' {
    const parsed = layerManifestSchema.safeParse(value)
    if (!parsed.success || parsed.data.profileId !== this.profileId)
      return 'invalid'
    if (this.manifest) {
      if (parsed.data.revision < this.manifest.revision) return 'stale'
      if (parsed.data.revision === this.manifest.revision) {
        return JSON.stringify(parsed.data) === JSON.stringify(this.manifest)
          ? 'duplicate'
          : 'invalid'
      }
    }
    this.manifest = parsed.data
    return 'accepted'
  }

  disableGeneration(id: string): number {
    return this.revocations.get(`layer:${id}`) ?? 0
  }

  pauseGeneration(origin?: string): number {
    return this.revocations.get(`pause:${origin ?? '*'}`) ?? 0
  }

  disable(id: string): void {
    this.revocations.set(`layer:${id}`, this.disableGeneration(id) + 1)
    this.disabledIds.add(id)
  }

  /** Requires the UI/broker to have completed authenticated enable first. */
  acknowledgeEnable(id: string, revision: number, generation: number): boolean {
    if (
      generation !== this.disableGeneration(id) ||
      !this.manifest ||
      this.manifest.revision !== revision ||
      !this.manifest.layers.some((layer) => layer.id === id)
    )
      return false
    this.disabledIds.delete(id)
    return true
  }

  /** Caller has authenticated that this record has no active version. Clearing
   * a draft's local stop permits preview only; it cannot install a Layer. */
  acknowledgeDraftPreview(
    id: string,
    revision: number,
    generation: number,
  ): boolean {
    if (
      generation !== this.disableGeneration(id) ||
      !this.manifest ||
      this.manifest.revision !== revision ||
      this.manifest.layers.some((layer) => layer.id === id)
    )
      return false
    this.disabledIds.delete(id)
    return true
  }

  acknowledgeResume(
    revision: number,
    generation: number,
    origin?: string,
  ): boolean {
    if (
      generation !== this.pauseGeneration(origin) ||
      !this.manifest ||
      this.manifest.revision !== revision ||
      (origin
        ? this.manifest.pausedOrigins.includes(origin)
        : this.manifest.paused)
    )
      return false
    this.pause(false, origin)
    return true
  }

  pause(paused: boolean, origin?: string): void {
    if (paused)
      this.revocations.set(
        `pause:${origin ?? '*'}`,
        this.pauseGeneration(origin) + 1,
      )
    if (!origin) this.paused = paused
    else if (paused) this.pausedOrigins.add(origin)
    else this.pausedOrigins.delete(origin)
  }

  effective(url: string) {
    let origin: string
    try {
      origin = new URL(url).origin
    } catch {
      return []
    }
    if (
      !this.manifest ||
      this.paused ||
      this.manifest.paused ||
      this.pausedOrigins.has(origin) ||
      this.manifest.pausedOrigins.includes(origin)
    )
      return []
    return structuredClone(
      this.manifest.layers.filter(
        (layer) =>
          !this.disabledIds.has(layer.id) &&
          layerMatchesUrl(layer.definition.scope, url),
      ),
    )
  }

  scripts() {
    if (!this.manifest || this.paused || this.manifest.paused) return []
    return structuredClone(
      this.manifest.layers.filter(
        (layer) =>
          layer.definition.mode === 'javascript' &&
          !this.disabledIds.has(layer.id) &&
          !this.pausedOrigins.has(layer.definition.scope.origin) &&
          !this.manifest?.pausedOrigins.includes(layer.definition.scope.origin),
      ),
    )
  }

  serialize() {
    return structuredClone({
      profileId: this.profileId,
      manifest: this.manifest,
      disabledIds: [...this.disabledIds],
      pausedOrigins: [...this.pausedOrigins],
      paused: this.paused,
    })
  }
}
