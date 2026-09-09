import {
  type DataEntry,
  type DataInput,
  type DataResult,
  dataInputSchema,
  dataResultSchema,
} from '@browseros/shared/layers/data'
import { z } from 'zod'

const countsSchema = z.object({
  stargazers_count: z.number().int().nonnegative(),
  forks_count: z.number().int().nonnegative(),
  private: z.literal(false),
})

/** Registered public operation. Page/model inputs cannot choose a destination,
 * method, headers, credentials or response projection. Redirects are denied. */
export class LayerDataBroker {
  private readonly cache = new Map<string, DataEntry>()
  private readonly retryAfter = new Map<string, number>()
  private readonly pending = new Map<string, Promise<DataEntry>>()
  private readonly requests = new Map<string, number[]>()
  private active = 0
  constructor(
    private readonly fetcher: (
      url: string,
      init: RequestInit,
    ) => Promise<Response> = fetch,
    private readonly now = Date.now,
  ) {}

  async read(
    profileId: string,
    raw: DataInput,
    current: () => boolean,
  ): Promise<DataResult> {
    const input = dataInputSchema.parse(raw)
    const entities = [
      ...new Set(input.entities.map((entity) => entity.toLowerCase())),
    ]
    const entries: DataEntry[] = []
    // At most four consumers per invocation; network concurrency is also
    // enforced globally so many tabs cannot fan out unbounded API requests.
    let index = 0
    const work = async () => {
      for (;;) {
        const entityId = entities[index++]
        if (!entityId) return
        if (!current()) throw new Error('The originating Layer changed.')
        entries.push(await this.entity(profileId, entityId))
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(4, entities.length) }, work),
    )
    if (!current()) throw new Error('The originating Layer changed.')
    const order = new Map(entities.map((entity, index) => [entity, index]))
    entries.sort(
      (a, b) => (order.get(a.entityId) ?? 0) - (order.get(b.entityId) ?? 0),
    )
    return dataResultSchema.parse({
      schema: 'pane.data.v1',
      operationId: input.operationId,
      entries,
    })
  }

  private async entity(
    profileId: string,
    entityId: string,
  ): Promise<DataEntry> {
    const key = `${profileId}:github.repository.stats:${entityId}`
    const existing = this.cache.get(key)
    if (
      existing &&
      Math.max(existing.expiresAt ?? 0, this.retryAfter.get(key) ?? 0) >
        this.now()
    )
      return structuredClone(existing)
    const inflight = this.pending.get(key)
    if (inflight) return structuredClone(await inflight)
    if (this.active >= 4) return { entityId, state: 'rate-limited' }
    for (const [profile, timestamps] of this.requests) {
      if ((timestamps.at(-1) ?? 0) <= this.now() - 60_000)
        this.requests.delete(profile)
    }
    const recent = (this.requests.get(profileId) ?? []).filter(
      (at) => at > this.now() - 60_000,
    )
    if (recent.length >= 60) return { entityId, state: 'rate-limited' }
    recent.push(this.now())
    this.requests.set(profileId, recent)
    const promise = this.fetchEntity(entityId)
      .then((value) => {
        const entry: DataEntry =
          value.state === 'unavailable' && existing?.values
            ? { ...existing, state: 'stale' }
            : value
        if (this.cache.size >= 1000) {
          const oldest = this.cache.keys().next().value
          if (oldest) {
            this.cache.delete(oldest)
            this.retryAfter.delete(oldest)
          }
        }
        this.retryAfter.set(
          key,
          this.now() + (entry.state === 'fresh' ? 5 * 60_000 : 30_000),
        )
        this.cache.set(key, structuredClone(entry))
        return entry
      })
      .finally(() => {
        this.pending.delete(key)
        this.active -= 1
      })
    this.active += 1
    this.pending.set(key, promise)
    return structuredClone(await promise)
  }

  private async fetchEntity(entityId: string): Promise<DataEntry> {
    const unavailable = (state: DataEntry['state']): DataEntry => ({
      entityId,
      state,
      expiresAt: this.now() + 30_000,
    })
    try {
      const [owner, repo] = entityId.split('/')
      const response = await this.fetcher(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          signal: AbortSignal.timeout(5000),
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Pane-Layers',
            'X-GitHub-Api-Version': '2026-03-10',
          },
        },
      )
      if (!response.ok) await response.body?.cancel()
      if (
        response.status === 429 ||
        (response.status === 403 &&
          response.headers.get('x-ratelimit-remaining') === '0')
      )
        return unavailable('rate-limited')
      if (response.status === 401 || response.status === 403)
        return unavailable('denied')
      if (!response.ok || !response.body) return unavailable('unavailable')
      const reader = response.body.getReader()
      let bytes = 0
      let text = ''
      const decoder = new TextDecoder()
      for (;;) {
        const item = await reader.read()
        if (item.done) break
        bytes += item.value.byteLength
        if (bytes > 128_000) {
          await reader.cancel()
          return unavailable('unavailable')
        }
        text += decoder.decode(item.value, { stream: true })
      }
      text += decoder.decode()
      const parsed = countsSchema.safeParse(JSON.parse(text))
      if (!parsed.success) return unavailable('unavailable')
      const fetchedAt = this.now()
      return {
        entityId,
        state: 'fresh',
        values: {
          stars: parsed.data.stargazers_count,
          forks: parsed.data.forks_count,
        },
        fetchedAt,
        expiresAt: fetchedAt + 5 * 60_000,
      }
    } catch {
      return unavailable('unavailable')
    }
  }
}
export const layerDataBroker = new LayerDataBroker()
