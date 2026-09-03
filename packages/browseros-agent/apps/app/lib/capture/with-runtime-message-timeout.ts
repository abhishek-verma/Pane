/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * A hung offscreen document (or a runtime-message handler that never
 * resolves) must not block its caller forever — background/UI cleanup and
 * setup flows need to make progress even when the offscreen side is wedged.
 */
export function withRuntimeMessageTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}
