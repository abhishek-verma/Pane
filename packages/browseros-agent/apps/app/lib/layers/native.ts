import { z } from 'zod'
import { getAgentServerUrl } from '../browseros/helpers'

const credentialSchema = z
  .object({ profileId: z.string().uuid(), token: z.string().min(50).max(2048) })
  .strict()
export type Credential = z.infer<typeof credentialSchema>
let cached: { value: Credential; refreshAt: number } | undefined

/** Credential stays in extension-owned memory. Never storage, page messages,
 * DOM attributes, query strings or provider/model context. */
export async function getLayerCredential(force = false): Promise<Credential> {
  if (!force && cached && cached.refreshAt > Date.now()) return cached.value
  const api = (
    chrome as unknown as {
      browserOS?: {
        getLayerCredential?: (callback: (value: unknown) => void) => void
      }
    }
  ).browserOS
  if (!api?.getLayerCredential)
    throw new Error(
      'This browser build does not support Layers. Update Pane to continue.',
    )
  const value = await new Promise<unknown>((resolve, reject) => {
    api.getLayerCredential?.((value) => {
      if (chrome.runtime.lastError)
        reject(new Error(chrome.runtime.lastError.message))
      else resolve(value)
    })
  })
  const credential = credentialSchema.parse(value)
  cached = { value: credential, refreshAt: Date.now() + 4 * 60_000 }
  return credential
}

export async function layerFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new Error('Invalid Layer API path.')
  const server = await getAgentServerUrl()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const credential = await getLayerCredential(attempt > 0)
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${credential.token}`)
    headers.set('Content-Type', 'application/json')
    const response = await fetch(`${server}/layers${path}`, {
      ...init,
      headers,
    })
    if (response.status !== 401 || attempt > 0) return response
  }
  throw new Error('Layer authorization failed.')
}
