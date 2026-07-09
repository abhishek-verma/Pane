# Phase 1 Completion Report — Bedrock

> Replaces the prior all-green report. This version is grounded in a code audit + actual gate-command output run on 2026-06-30. Grades are **Done / Partial / Blocked** per `PHASE-1-PROMPT.md`. Phase 1 is **substantially landed but not fully passed** — two modules are Partial and one is off-spec. See *Deviations* and *Blockers*.

## Ship gate (Pane v0.1) — status

| Gate criterion | Status | Evidence |
|----------------|--------|---------|
| `pane` build profile | **Pass** | `PANE_BUILD` hard-falses cloud flags; `product-features.test.ts` passes; `env.ts` forces `BROWSEROS_CONFIG_URL`/`AGENT_RUNNER_JWT_SECRET`/`SENTRY_DSN`/`POSTHOG_API_KEY` unset in pane builds |
| Sidepanel + new-tab chat (BYOK / OAuth / local) | **Pass (unverified end-to-end)** | Routes + provider plumbing present; not manually clicked through this pass |
| Pane-as-MCP wedge end-to-end (`claude mcp add`) | **Partial** | `/mcp` alias + ungated `QuickSetupSection` + shared `BROWSER_TOOLS` registry wired; `tool-spec.test.ts` passes; **no `claude mcp add` E2E run recorded** |
| Chat survives a server restart | **Partial** | Server persists `chat_sessions`/`chat_messages` and exposes `GET /chat/history`; `session-store.test.ts` passes. **But the sidepanel history UI still reads `chrome.storage.local`, not the server route** (see M1.5) |
| Telemetry honest + off-by-default | **Pass (native) / Unverified (network)** | Native `browseros_metrics_service.cc` skips PostHog when pref key empty; app `posthog.ts` gates on opt-in pref. No network-monitor run this pass |
| CDP secured to loopback + token | **Pass** | `generateCdpToken` + `validateCdpToken`; `cdp-token.test.ts` (18 cases) passes |
| No Pane-server dead-end visible anywhere | **Pass (B1 + B2 resolved this pass)** | `transcribe-audio.ts` gateway URL is behind `PANE_BUILD ? null : …` and tree-shaken out of pane bundles; voice UI hidden via `VOICE_SUPPORTED`. CLI self-update + install scripts repointed to GitHub Releases on `abhishek-verma/Pane`; R2/CDN made optional |
| `bun run check` green | **Pass** | typecheck exit 0 (all workspaces); biome exit 0 (13 `noExplicitAny` warnings in tests); fallow exit 0 (404 dead-code issues = tech debt) |
| Server test suite green | **Pass (after fix)** | `test:lib` 280/280 after fixing lock-file test isolation (was 276/280). See M1.7 |

**Gate verdict:** NOT yet passable. B1 (voice gateway) and B2 (CLI update URL) are both resolved this pass — no Pane-operated CDN/server dead-end remains in the CLI surface. M1.5 (history UI wiring) and M1.9 (ASR spike) are still Partial/off-spec. Everything else is in shape. See *Fixes applied*.

---

## Module status

### M1.1 — `pane` build profile + flag dead-strip — **Done**
`PANE_BUILD` compile-time constant; `product-features.ts` returns `false` for all five cloud flags under `PANE_BUILD=true` regardless of env; `product-features.test.ts` asserts it. Server `env.ts` forces Pane-server env unset in pane builds. `REQUIRED_FOR_PRODUCTION` is empty for pane builds.

### M1.2 — Disable & cleanup register (§9) — **Done**
Done: app routes `/login` `/profile` `/logout` `/settings/survey` `/settings/usage` are gone from `App.tsx`; server routes `/credits` `/remote-hermes` `/klavis` are not registered; `api.browseros.com`/`llm.browseros.com`/`jtbd-agent.fly.dev` absent from runtime app code; bundled extensions reduced to the Pane agent only (`bundled_extensions.py`); voice gateway gated off in pane builds (B1, resolved this pass); CLI self-update + install scripts repointed to GitHub Releases on `abhishek-verma/Pane` (B2, resolved this pass).
**Carry-forward (non-blocking):**
- `.env.production` still carries `BROWSEROS_CONFIG_URL=https://llm.browseros.com/...` (acceptable only because `env.ts` forces it unset in pane builds — worth a comment).

### M1.3 — Native telemetry + opt-in — **Done (network unverified)**
Native `browseros_metrics_service.cc` reads PostHog key from a pref and skips when empty. App `posthog.ts` inits only when `PANE_BUILD !== 'true' || optInPref`. No outbound-network verification run this pass.

### M1.4 — CDP security boundary — **Done**
`generateCdpToken` (UUID v4), `getCdpToken`, `validateCdpToken`; `cdp-token.test.ts` 18/18. Unix-domain socket / named pipe transport not present (plan allowed loopback-WS + token fallback); state this explicitly rather than imply the preferred transport shipped.

### M1.5 — Session persistence + `produced_files` — **Partial**
Done: `chat_sessions` + `chat_messages` Drizzle schema; `SessionStore.persistMessages`/`loadMessages`; `GET /chat/history`; `session-store.test.ts` round-trip passes; `produced-files.ts` schema module exists.
**Not done:** the sidepanel history list (`LocalChatHistory` → `useConversations` → `conversationStorage`) still reads `chrome.storage.local`, not the server route. The spec said "the app reads history via a server route, not the removed GraphQL branch." Chat likely survives a restart today via `chrome.storage` (unaffected by server restart), but the server-as-source-of-truth wiring is incomplete. Live `AgentSession` objects remain in an in-memory `Map` (SQLite is the persistence mirror) — acceptable, but restart-survival is not verified end-to-end.

### M1.6 — `chrome://browseros/mcp` + QuickSetup + single tool spec — **Done (E2E unverified)**
`/mcp` route alias → `/settings/mcp`; `QuickSetupSection` rendered ungated; `tool-adapter.ts` and `browser-mcp/register.ts` both build from the shared `BROWSER_TOOLS` registry; `tool-spec.test.ts` confirms loop and MCP build from the identical spec. No `claude mcp add pane …` E2E run recorded.

### M1.7 — Process supervision basics — **Done (test was red, now fixed)**
SW `healthCheckLoop` health-checks `/health` and sets the restart pref to trigger native relaunch; server `LockFile` (PID lock under `getBrowserosDir()`); native per-profile lock already exists. **Fix applied this pass:** `tests/lib/lock-file.test.ts` was writing to the real `~/.browseros` and collided with other lib tests (4 failures when run in the group, passed in isolation). Pinned the test to a per-test temp `BROWSEROS_DIR`; `test:lib` now 280/280. Degraded-mode-on-browser-crash and CDP tab-reconnect are implemented in code but not evidenced by an integration test this pass.

### M1.8 — User-facing rebrand pass — **Done (no screenshot sweep)**
Grep of `screens/**/*.tsx` for user-visible `"BrowserOS"`/`'BrowserOS'` literals → none. Remaining `BrowserOS` hits are internal identifiers (`BrowserOSAction`, `getBrowserOSAdapter`, `createBrowserOSAction`) and code comments — allowed tech debt per the plan. No screenshot-sweep evidence recorded.

### M1.9 — Streaming-ASR de-risk spike — **Off-spec (Blocked for Phase 6 decision)**
`specs/ASR-BENCHMARK.md` evaluates the browser's native `SpeechRecognition` (Web Speech API) and decides to use it. This is **not** what M1.9 asked for:
- No whisper.cpp / faster-whisper candidate benchmarked.
- **No WER, latency, or CPU/battery numbers** on a 30-min sample.
- The decision ("use Chrome's cloud-backed SpeechRecognition") does not match the Phase 6 gate ("local streaming ASR usable → local default; else BYOK-only") and is in tension with the local-first thesis. It also does not resolve the voice-gateway Blocker B1.

### M1.10 — Eval harness scaffold + browsing-quality baseline — **Done (CI green unverified)**
`apps/eval/pane-thesis/` exists with `config.ts` + `scenarios/browsing-quality.ts` (one baseline task: navigate to example.com, assert heading). Scaffold present; not confirmed running green in CI this pass.

---

## Deviations from the plan

1. **History UI not wired to server.** M1.5 spec wanted the app to read history via a server route; today it reads `chrome.storage.local`. Carry into Phase 2 (or a Phase 1 patch).
2. **CLI update/install was pointing at `cdn.browseros.com` — RESOLVED this pass.** Repointed to GitHub Releases on `abhishek-verma/Pane`; R2/CDN upload made optional (skips when no R2 creds). M1.2(g) satisfied.
3. **M1.9 substituted Web Speech API for a local-ASR benchmark** with no numbers — does not satisfy the decision gate.
4. **CDP Unix-socket / named-pipe transport not shipped**; loopback-WS + token is the actual boundary (plan-allowed fallback, but the report should not claim the preferred transport).

## Blockers (must resolve before declaring Phase 1 passed)

- **B1 — Voice gateway to `llm.browseros.com` — RESOLVED this pass.** `apps/app/lib/voice/transcribe-audio.ts` now imports `PANE_BUILD`, sets `GATEWAY_URL = PANE_BUILD ? null : 'https://llm.browseros.com'`, and throws in pane builds; the URL sits in the dead branch so Vite tree-shakes it out of pane bundles. Mic UI hidden via `VOICE_SUPPORTED` (`lib/voice/voice-supported.ts`) in `ConversationInput`, `NewTabChat`, and sidepanel `ChatInput`. Voice returns in v0.6 via the Phase 6 `TranscriptionProvider`.
- **B2 — CLI update manifest URL — RESOLVED this pass.** Repointed every CLI distribution surface to GitHub Releases on `abhishek-verma/Pane` (no Pane-operated CDN needed; works on a free GitHub account):
  - `apps/cli/update/manager.go`: `DefaultManifestURL` → `https://github.com/abhishek-verma/Pane/releases/latest/download/manifest.json` (GitHub redirects `/releases/latest/download/<asset>` to the latest non-prerelease asset).
  - `scripts/build/cli/release-policy.ts`: `DEFAULT_LATEST_VERSION_URL` + `DEFAULT_LATEST_MANIFEST_URL` → the same `releases/latest/download/…` URLs (CI release gate).
  - `apps/cli/scripts/install.sh` + `install.ps1`: version.txt from `releases/latest/download/version.txt`; archives + checksums from `releases/download/cli/v<version>/<asset>`; self-host via `raw.githubusercontent.com/abhishek-verma/Pane/main/...`.
  - `apps/cli/npm/scripts/postinstall.js`: release repo `browseros-ai/BrowserOS` → `abhishek-verma/Pane`; fallback install URL → raw GitHub.
  - `scripts/build/cli/upload.ts`: default asset base → `https://github.com/abhishek-verma/Pane/releases/download`; `buildCliReleaseManifest` now emits version-pinned GitHub Release URLs; `runCliRelease` **always** writes `manifest.json` + `version.txt` into `apps/cli/dist/` so the existing `gh release upload dist/*` step attaches them as release assets; R2 upload made conditional on R2 creds being present (skips on a fork with no CDN).
  - `.github/workflows/release-cli.yml`: release-notes install URLs → raw GitHub.
  - `apps/cli/README.md` + `apps/cli/npm/README.md`: install + manifest inspect URLs updated.
  - Verified: `go vet`/`go test ./...` (CLI, incl. `update` package) green; `bun test scripts/build/cli/` 22/22 (added a default-base → GitHub Releases URL assertion); biome clean.

## Follow-ups for Phase 2

- Wire `LocalChatHistory` to `GET /chat/history` (or accept `chrome.storage` as the history source and update the spec — pick one).
- Re-run M1.9 as specified (local ASR candidate + WER/latency/battery) to gate Phase 6 M6.2.
- Record the manual click-through + `claude mcp add` E2E + a network-monitor run for telemetry-off as gate evidence.
- M2.0 profile-scoped data root (already planned) — note that `LockFile` and `getBrowserosDir()` already respond to `BROWSEROS_DIR`, so M2.0 is mostly the boot-time wiring.

## Evidence log (commands run 2026-06-30)

- `bun run typecheck` → exit 0 (all 11 workspaces).
- `bunx @biomejs/biome check` → exit 0, 13 warnings (test-only `noExplicitAny`).
- `bunx fallow check` → exit 0, 404 dead-code/private-type-leak issues (tech debt).
- `apps/server`: `bun run test:lib` → **280 pass / 0 fail** (after lock-file test fix; was 276/280).
- `bun test tests/agent/session-store.test.ts` → pass (M1.5 round-trip).
- `bun test tests/lib/cdp-token.test.ts` → 18/18 (M1.4).
- `bun test tests/agent/tool-spec.test.ts` → pass (M1.6 single-spec).
- `apps/app`: `bun test lib/constants/product-features.test.ts` → 2/2 (M1.1).
- Static: `grep api.browseros.com|llm.browseros.com|jtbd-agent.fly.dev` → only CLI/dogfood/internal + the voice gateway (B1).
- Static: `App.tsx` routes → no `/login` `/profile` `/logout` `/settings/survey` `/settings/usage`.
- Static: `routes/index.ts` → no `/credits` `/remote-hermes` `/klavis`.

## Fixes applied this pass

- `apps/server/tests/lib/lock-file.test.ts`: pin to a per-test temp `BROWSEROS_DIR` instead of the real `~/.browseros`; restored `BROWSEROS_DIR` in `afterEach`; clean up temp dir in `afterAll`. Resolves the 4 lib-group failures.
- **B1 — voice gateway gated off in pane builds.** New `apps/app/lib/voice/voice-supported.ts` exports `VOICE_SUPPORTED = !PANE_BUILD`. `transcribe-audio.ts` gates `GATEWAY_URL` behind `PANE_BUILD ? null : 'https://llm.browseros.com'` and throws in pane builds (URL tree-shaken out of pane bundles). Mic UI hidden under `VOICE_SUPPORTED` in `ConversationInput.tsx` (voice-mode entry + dictation), `NewTabChat.tsx` (`onOpenVoiceMode` + `?voice=open` deep link), and sidepanel `ChatInput.tsx`. Verified: `@browseros/app` typecheck exit 0, biome clean, app tests 285/285.
- **B2 — CLI update repointed to GitHub Releases.** See the Blockers entry above.

## Verdict

**Phase 1: substantially complete, NOT fully passed.** M1.1, M1.2, M1.3, M1.4, M1.6, M1.7, M1.8, M1.10 are Done (some with unverified manual evidence). M1.5 is Partial. M1.9 is off-spec. **B1 (voice gateway) and B2 (CLI update URL) are both resolved** — no Pane-operated server/CDN dead-end remains in the shipped surface. To fully pass Phase 1: wire the history UI (or update the spec), and re-run M1.9 as specified. Then the remaining gate evidence is manual (click-through, `claude mcp add` E2E, telemetry-off network run). Do not auto-proceed to Phase 2.
