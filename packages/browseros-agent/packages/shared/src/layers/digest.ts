/** Canonical wire representation used by both SQLite versions and browser
 * execution. Keep this stable: changing it changes existing version hashes. */
export function canonicalLayerJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalLayerJson).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${canonicalLayerJson(item)}`,
      )
      .join(',')}}`
  const encoded = JSON.stringify(value)
  if (encoded === undefined)
    throw new Error('Layer hashes require JSON values.')
  return encoded
}

export async function layerVersionDigest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalLayerJson(value)),
  )
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
