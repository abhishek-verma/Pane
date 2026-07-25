/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Client render loops that useChat can surface as chatError even when the
 * server turn succeeded. Not actionable as a "Try again" chat failure.
 */

export function isBenignClientRenderError(
  error: Error | null | undefined,
): boolean {
  const message = error?.message ?? ''
  return (
    message.includes('Minified React error #185') ||
    message.includes('Maximum update depth exceeded')
  )
}
