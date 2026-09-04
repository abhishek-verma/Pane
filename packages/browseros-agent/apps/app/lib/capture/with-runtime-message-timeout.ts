/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Resolves with `fallback` after `ms` if `promise` hasn't settled by then —
 * a hung offscreen document (or any promise that never resolves) must not
 * block its caller forever.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

/** `withDeadline` specialized to the common "give up with null" case. */
export function withRuntimeMessageTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  return withDeadline(promise, ms, null)
}
