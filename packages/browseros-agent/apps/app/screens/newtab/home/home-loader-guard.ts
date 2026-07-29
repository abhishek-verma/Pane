/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Perf invariant: home open must never call /chat.
 */

/** Module-level flag for tests: home loader must not hit /chat. */
export let homeLoaderCalledChat = false

export function resetHomeLoaderChatFlag() {
  homeLoaderCalledChat = false
}

export function markHomeLoaderCalledChat() {
  homeLoaderCalledChat = true
}
