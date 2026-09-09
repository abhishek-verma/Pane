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

  disable(id: string): void {
    this.disabledIds.add(id)
  }

  /** Requires the UI/broker to have completed authenticated enable first. */
  acknowledgeEnable(id: string, revision: number): boolean {
    if (
      !this.manifest ||
      this.manifest.revision !== revision ||
      !this.manifest.layers.some((layer) => layer.id === id)
    )
      return false
    this.disabledIds.delete(id)
    return true
  }

  pause(paused: boolean, origin?: string): void {
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
