/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Module-level registry for the last language model used in a chat session.
 * Background jobs (skill review, future digest enrichment) read from here
 * so they can produce LLM-quality output without a per-request config.
 *
 * The registry is intentionally ephemeral (in-process only). If the server
 * restarts before a review job fires, the job falls back to the template
 * drafter until the first chat request re-registers a model. That is
 * acceptable — correctness over completeness.
 */

import type { LanguageModel } from 'ai'

let _lastModel: LanguageModel | null = null

/** Called by the chat service after a successful model creation. */
export function registerLastUsedModel(model: LanguageModel): void {
  _lastModel = model
}

/** Returns the most recently registered model, or null if none yet. */
export function getLastUsedModel(): LanguageModel | null {
  return _lastModel
}

/** Test helper — reset between test cases. */
export function _resetLastUsedModelForTests(): void {
  _lastModel = null
}
