# Meeting site adapters

Capability-based adapters live in `packages/capture/src/adapters/`.

## Speaker sources (priority)

1. **Caption rows** (`captionRows` / `caption-row`) — when platform CC is on, scrape the Captions region (`[role="region"][aria-label="Captions"]` or `aria-live="polite"`) using the OSS img→name→text / previousSibling patterns. Confidence **0.95**.
2. **Active-speaker UI** — aria “is speaking” / presenting / highlighted tile. Confidence 0.65–0.85.
3. **Zoom attendee map** — resolve initials / short labels via `attendees` roster (`attendee-map.ts`) before emitting a name.

Unlabeled is preferred over wrong names (`confidence >= 0.6`).

## Refreshing Meet / Zoom speaker fixtures

When live Meet (or Zoom/Teams) UI stops labeling speakers:

1. Join a two-person call; turn **Captions** on and inspect the Captions region in DevTools.
2. Confirm img→name→text (or previousSibling) still holds; note any new `aria-label` speaking patterns.
3. Update the selector allowlist in `adapters/dom-facts.ts` and scoring in the site adapter.
4. Add or update fact fixtures in `adapters/*.speaker.test.ts`.

Injected collectors must stay dependency-free (`collectMeetingDomFactsPage`). Decisions run in extension/server TypeScript via the adapter registry.
