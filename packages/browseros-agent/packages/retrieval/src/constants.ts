/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** Default / max hits returned by hybrid retrieve. */
export const RETRIEVE_DEFAULT_LIMIT = 10
export const RETRIEVE_MAX_LIMIT = 20

/** RRF constant (standard Cormack et al. k). */
export const RRF_K = 60

/** Prefer lexical hits covering at least this fraction of content tokens. */
export const COVERAGE_SOFT_MIN = 0.34

/** Default embedding dimensions for the local hash / MiniLM-class models. */
export const EMBED_DIMS = 384

/** Query embed timeout before skipping the semantic arm. */
export const EMBED_QUERY_TIMEOUT_MS = 200

/** Stopwords dropped from lexical tokens (kept out of FTS OR). */
export const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'am',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'she',
  'it',
  'they',
  'them',
  'their',
  'this',
  'that',
  'these',
  'those',
  'and',
  'or',
  'but',
  'if',
  'then',
  'so',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'from',
  'with',
  'as',
  'by',
  'about',
  'into',
  'over',
  'after',
  'before',
  'do',
  'does',
  'did',
  'doing',
  'have',
  'has',
  'had',
  'having',
  'can',
  'could',
  'should',
  'would',
  'will',
  'just',
  'also',
  'too',
  'very',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'when',
  'where',
  'why',
  'how',
  'any',
  'some',
  'all',
  'there',
])
