/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { storage } from '@wxt-dev/storage'

export const researchModeStorage = storage.defineItem<boolean>(
  'local:capture-research-mode',
  { fallback: false },
)

export const researchThreadStorage = storage.defineItem<string | null>(
  'local:capture-research-thread-id',
  { fallback: null },
)
