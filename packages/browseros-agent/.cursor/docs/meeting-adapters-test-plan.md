# Meeting adapters — test plan

Companion to the implementation in `packages/capture/src/adapters/`. Open the live summary canvas beside chat for OSS alignment and results.

## Automated (CI / local)

```bash
cd packages/browseros-agent
bun test packages/capture apps/server/tests/capture apps/app/lib/capture
cd packages/capture && bun run typecheck
```

| Suite | What it covers |
|-------|----------------|
| `adapters/registry.test.ts` | Room URLs, call-state facts, resolveAdapter, consent subdomains |
| `adapters/meet.speaker.test.ts` | Meet/Zoom/Teams speaker confidence |
| `adapters/mic-energy.test.ts` | Mic self-boost helper |
| `speaker-timeline.test.ts` | Nearest-within-window, clear, participant filter |
| `speaker-route.test.ts` | POST `/meetings/:id/speaker` 404/400/200 |
| `meeting-pipeline.test.ts` | Stamp speaker on finals; generic site; no-obs regression |
| `continuity.test.ts` | Resume / dual-track / pause contracts |

**Last run:** 85 pass, 0 fail (2026-07-19).

## Manual dogfood

### Gate A — adapters / settings

1. **A-M1** Privacy → enable Meet only → join Meet → confirm capture starts only in-call.
2. **A-M2** Disable Meet → join → no auto-start.
3. **A-M3** Add a custom host → audible page ≥8s with unknown state → generic start.
4. **A-M4** Zoom web with Zoom toggle → capture works.

### Gate B — speakers (Meet)

1. **B-M1** Two people; alternate ~20s. Target ≥70% finals with `speaker`.
2. **B-M2** One muted → labels stick, no flip-flop.
3. **B-M3** Presenting → presenter name if Meet exposes it.
4. **B-M4** Leave/rejoin resume → poll restarts.
5. **B-M6** Check `transcript.jsonl` and optional `speaker-events.jsonl`.

**Ground truth tip:** Turn on Meet CC and compare names. If CC is right and Pane swaps, that is timeline lag (known gap vs caption scrapers), not Whisper failure.

## OSS alignment (summary)

| Strategy | Examples | Pane |
|----------|----------|------|
| Scrape platform captions (speaker+text) | Meet-Note-Taker, TranscripTonic, cc-to-srt | Not yet |
| UI active-speaker + own STT | IceCubes-style hybrids | **Current** |
| ML diarization | Deepgram / MeetScribe paid | Deferred by plan |

**In line:** DOM-only names, confidence gate, site adapters, fail soft.  
**Gap:** No Captions-region binding; Zoom attendee map incomplete.

## Follow-ups

1. Dogfood B-M1 with Meet CC **on** — expect `source: caption-row` in `speaker-events.jsonl` and higher label coverage.
2. ~~Optional CC scrape~~ — shipped: `captionRows` in dom-facts + Meet/Zoom/Teams prefer captions.
3. ~~Zoom attendee map~~ — shipped: `attendees` + `resolveAttendeeDisplayName`.
4. Capture a live Meet HTML fixture dump if Captions DOM churn breaks extraction.
