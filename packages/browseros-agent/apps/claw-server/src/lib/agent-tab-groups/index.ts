/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createTabGroupTracker } from './tracker'

export { hexForSlug } from './group-color'
export type { TabGroupRecord } from './tracker'

import './tracker'

/** Process-wide singleton consumed by the v2 dispatch path and the focus route. */
export const tabGroupTracker = createTabGroupTracker()
