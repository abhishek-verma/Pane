/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Global toggle for passive browsing capture.
 * Off by default per M6.4 consent model.
 * When on, all sites are observed except those on the indexing deny-list.
 */

import { storage } from '@wxt-dev/storage'

export const browsingCaptureModeStorage = storage.defineItem<boolean>(
  'local:capture-browsing-mode',
  { fallback: false },
)
