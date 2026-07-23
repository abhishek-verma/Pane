/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Local UX state types for the onboarding flow. These do not leave
 * the screen and are kept in `useState`. RHF owns the form values
 * separately.
 */

/** Welcome → Import → Providers → Connect → Capture → Ready */
export type Step = 0 | 1 | 2 | 3 | 4 | 5

export type ImportPhase =
  | 'pre-quit'
  | 'picker'
  | 'importing'
  | 'failed'
  | 'imported'

export type ConnectPhase = 'idle' | 'connecting' | 'connected'
