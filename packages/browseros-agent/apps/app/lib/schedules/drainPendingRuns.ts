/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Pure pending-run drain (claim → chat → complete). No extension imports.
 */

export interface PendingScheduledRun {
  id: string
  prompt: string
  idempotencyKey: string
  status: string
}

export interface DrainServerRunsDeps {
  getBaseUrl: () => Promise<string>
  fetchFn: typeof fetch
  runChat: (input: {
    message: string
    scheduledRunId: string
    idempotencyKey: string
  }) => Promise<{ text: string; conversationId: string }>
}

export async function drainPendingRunsOnce(
  deps: DrainServerRunsDeps,
): Promise<{ claimed: number; completed: number; failed: number }> {
  const base = await deps.getBaseUrl()
  const listRes = await deps.fetchFn(`${base}/scheduler/runs?status=pending`)
  if (!listRes.ok) {
    throw new Error(`list pending runs failed: ${listRes.status}`)
  }
  const body = (await listRes.json()) as { runs?: PendingScheduledRun[] }
  const runs = body.runs ?? []

  let claimed = 0
  let completed = 0
  let failed = 0

  for (const run of runs) {
    const claimRes = await deps.fetchFn(
      `${base}/scheduler/runs/${encodeURIComponent(run.id)}/claim`,
      { method: 'POST' },
    )
    if (!claimRes.ok) continue
    claimed += 1

    try {
      const chat = await deps.runChat({
        message: run.prompt,
        scheduledRunId: run.id,
        idempotencyKey: run.idempotencyKey,
      })
      const completeRes = await deps.fetchFn(
        `${base}/scheduler/runs/${encodeURIComponent(run.id)}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'completed',
            result: chat.text,
            conversationId: chat.conversationId,
          }),
        },
      )
      if (!completeRes.ok) {
        failed += 1
        continue
      }
      completed += 1
    } catch (err) {
      failed += 1
      const error = err instanceof Error ? err.message : String(err)
      await deps
        .fetchFn(
          `${base}/scheduler/runs/${encodeURIComponent(run.id)}/complete`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'failed', error }),
          },
        )
        .catch(() => null)
    }
  }

  return { claimed, completed, failed }
}
