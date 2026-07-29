/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type PiEventName =
  | 'site-created'
  | 'site-updated'
  | 'entity-mutated'
  | 'site-archived'

export type PiEvent = {
  name: PiEventName
  siteId?: string
  pageId?: string
  recordId?: string
  at: number
}

type Listener = (event: PiEvent) => void

const listeners = new Set<Listener>()

export function onPiEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitPiEvent(
  name: PiEventName,
  payload: Omit<PiEvent, 'name' | 'at'> = {},
): void {
  const event: PiEvent = { name, at: Date.now(), ...payload }
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      /* ignore listener errors */
    }
  }
}
