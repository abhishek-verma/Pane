import { PANE_BUILD } from '@/lib/constants/product-features'

/**
 * Whether voice input (dictation + voice mode) is available in this build.
 *
 * Voice transcription currently routes through a Pane-operated gateway
 * (`llm.browseros.com`), which is incompatible with the server-free `pane`
 * build. In `pane` builds voice is disabled; it returns in v0.6 once the
 * local `TranscriptionProvider` (Phase 6 M6.2) lands and replaces the gateway.
 *
 * `PANE_BUILD` is inlined by Vite/WXT, so `!PANE_BUILD` is a compile-time
 * constant and the gated branches (and the gateway URL) are tree-shaken out
 * of `pane` bundles.
 * @public
 */
export const VOICE_SUPPORTED: boolean = !PANE_BUILD
