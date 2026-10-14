/** Chrome ports have a per-message size limit. Large attachment requests use
 * bounded chunks; live transcript snapshots remain bounded by projection. */
const CHUNK_CHARS = 512 * 1024
const MAX_CHARS = 192 * 1024 * 1024
export function sendRepositoryRequest(
  post: (message: unknown) => void,
  message: { requestId: string; [key: string]: unknown },
) {
  const json = JSON.stringify(message)
  if (json.length < CHUNK_CHARS) {
    post(message)
    return
  }
  if (json.length > MAX_CHARS)
    throw new Error(
      'This message is too large to send. Remove some attachments.',
    )
  for (let offset = 0; offset < json.length; offset += CHUNK_CHARS)
    post({
      type: 'request-chunk',
      requestId: message.requestId,
      data: json.slice(offset, offset + CHUNK_CHARS),
    })
  post({ type: 'request-complete', requestId: message.requestId })
}
export class RepositoryRequestChunks {
  private pending = new Map<
    string,
    { chunks: string[]; size: number; timer: ReturnType<typeof setTimeout> }
  >()
  accept(message: {
    type: string
    requestId?: unknown
    data?: unknown
  }): unknown {
    if (typeof message.requestId !== 'string')
      throw new Error('Invalid chat request')
    const id = message.requestId
    let entry = this.pending.get(id)
    if (message.type === 'request-chunk') {
      if (typeof message.data !== 'string' || message.data.length > CHUNK_CHARS)
        throw new Error('Invalid chat request chunk')
      if (!entry) {
        if (this.pending.size >= 4)
          throw new Error('Too many pending chat requests')
        entry = {
          chunks: [],
          size: 0,
          timer: setTimeout(() => this.drop(id), 30_000),
        }
        this.pending.set(id, entry)
      }
      entry.size += message.data.length
      if (entry.size > MAX_CHARS) {
        this.drop(id)
        throw new Error('Chat request exceeds the size limit')
      }
      entry.chunks.push(message.data)
      return undefined
    }
    if (!entry)
      throw new Error('Chat request expired before delivery. Send it again.')
    this.drop(id)
    const request = JSON.parse(entry.chunks.join(''))
    if (request.type !== 'request' || request.requestId !== id)
      throw new Error('Invalid assembled chat request')
    return request
  }
  private drop(id: string) {
    const entry = this.pending.get(id)
    if (entry) clearTimeout(entry.timer)
    this.pending.delete(id)
  }
  dispose() {
    for (const id of this.pending.keys()) this.drop(id)
  }
}
