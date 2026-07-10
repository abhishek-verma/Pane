/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Reach secrets in SQLite (same local-DB pattern as oauth_tokens).
 * Never store SMTP/Telegram secrets in prefs JSON.
 */

import { and, eq } from 'drizzle-orm'
import { getDb } from '../lib/db'
import { reachSecrets } from '../lib/db/schema/reach-secrets'
import type { ReachTransportId } from './types'

export function setReachSecret(
  transport: ReachTransportId,
  key: string,
  value: string,
): void {
  getDb()
    .insert(reachSecrets)
    .values({
      transport,
      key,
      value,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: [reachSecrets.transport, reachSecrets.key],
      set: { value, updatedAt: Date.now() },
    })
    .run()
}

export function getReachSecret(
  transport: ReachTransportId,
  key: string,
): string | null {
  const row = getDb()
    .select()
    .from(reachSecrets)
    .where(
      and(eq(reachSecrets.transport, transport), eq(reachSecrets.key, key)),
    )
    .get()
  return row?.value ?? null
}

export function deleteReachSecret(
  transport: ReachTransportId,
  key: string,
): void {
  getDb()
    .delete(reachSecrets)
    .where(
      and(eq(reachSecrets.transport, transport), eq(reachSecrets.key, key)),
    )
    .run()
}

export function listReachSecretKeys(transport: ReachTransportId): string[] {
  return getDb()
    .select({ key: reachSecrets.key })
    .from(reachSecrets)
    .where(eq(reachSecrets.transport, transport))
    .all()
    .map((r) => r.key)
}
