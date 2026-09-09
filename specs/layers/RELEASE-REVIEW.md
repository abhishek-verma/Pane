# Combined Layers PR review

Updated 2026-09-09. The PR includes all tracked and untracked source changes from the shared workspace, including the chat composer, scheduled jobs and dead-code cleanup from other sessions. Ignored builds, local credentials and disposable profiles are not source changes.

## Fixes during the final review

- Connected Codex translation, managed page tasks and generated page tasks through the production dispatcher. Its private MCP/transport boundary excludes general tools. Capabilities stay unverified until the configured model successfully completes a preview action. Canonical skill distribution continues to use the shared provider path.
- Added account-budget disclosure to capability assessment, authoring skills and the exact Layer's review UI. Codex bounds steps, time and accepted output; it cannot promise a hard account token-spend ceiling.
- Fixed managed reload verification so it never depends on the optional userscript engine.
- Fixed completed-result expiry: repeated retries no longer extend private payload retention. Payloads expire five minutes after completion and are dropped even without further traffic. Durable invocation metadata prevents silent replay billing after expiry/restart.
- Added an authenticated, binding-checked event replay endpoint and one recovery attempt after a lost transport response. Ordinary HTTP errors retain their actionable explanation. The real browser fixture truncates a successful response and verifies recovery without a second model call.
- Distinguish deadline failures from user cancellation, preserve structured failure codes, and finish activity metadata when a late provider result is rejected.
- Deleted Layers and their versions/grants are recoverable for 30 days, then pruned when trash is accessed. Restored Layers stay disabled. Active version history is retained locally. The UI and skill disclose retention.
- Corrected keyboard Show focus/temporary tabindex cleanup, independent translated-text direction, long-name wrapping, viewport bounds, contrast and accessible control names.
- Fixed two incomplete Claw framework mocks discovered by combined regression tests. Preserved the real helper exports while mocking only execution.
- Registered the executable Layer probes as dead-code entry points and added server Layers tests to the PR CI matrix.

## Verification

- All workspace type checks pass. Biome has no errors; Fallow reports no issues.
- Broader server regressions: 1,163 tests across 132 isolated files pass. Additional API/capture/shared/build-package regressions: 256 tests across 47 isolated files pass.
- Combined app/Claw/eval/build/release suites: **1240 tests across 218 isolated files pass** after the Claw mock and structured-event assertion fixes.
- Layers unit/contract suite: **110 tests across 16 isolated files pass**. It covers actual result expiry, replay, deadline status, deleted-version retention and Codex capability disclosure.
- API, installed Claude CLI and installed Codex CLI: **52 browser checks pass each**, all against local deterministic model fixtures. Includes source grants, trusted buttons, translation, generated inspect/fail/repair/complete, Keep, reload, revocation, truncated-response recovery, two-window updates, actual service-worker termination, offline disable/reload/reconnect and library accessibility.
- Native arm64 binary: **36 checks pass** across disposable launches. Includes native credentials, profile/launch binding, opt-out persistence, registry restoration, owned/unowned cleanup, stale actions, real BFCache and four repeated BFCache transitions preserving source identity, forms and working actions.
- Native UI checked through CUA: popup opens with sidebar closed, controls expose AX names, Tab enters the controls, Escape dismisses, and Layers opens in fullscreen. Focused library checks cover 200% zoom, narrow layouts, RTL, dark/light contrast and named controls. This is not a claim of a comprehensive screen-reader certification.
- Synthetic performance probe: 5,000 nodes / 20 verified mounted targets, 25 mount samples. Mount p95 **0.4 ms**, maximum **0.9 ms**; 60 feed-churn frames measured **489.4 ms** baseline and **499.8 ms** with Layers. Disposal leaves **zero** owned nodes/classes. These are local fixture measurements, not guarantees for arbitrary sites or scripts.
- Production extension builds successfully. Arm64 server compiles and packages through the supported CI path. The full distribution build currently requires unavailable R2 download credentials. No release tag, upload, installation or appcast change has been performed.

## Remaining gates before merge/release

1. **Live Codex account verification remains unresolved.** The earlier account request rejected `max_output_tokens`, and a later request rejected the tool declaration. The adapter now omits the unsupported cap, strips inherited parent-agent control settings and includes the namespace description. Local protocol/browser checks pass, but the corrected live request has not run. Automatic approval review rejected the test as an unauthorized export of generic Layer instructions and private tool schemas. The user must explicitly authorize the fixed “Bonjour” sample and these generic schemas/instructions going to their configured Codex account before that request can be retried. Do not treat local fixtures as proof this backend incompatibility is fixed.
2. Live service/account smoke checks and final distribution signing/notarization remain release checks. CI server packaging does not prove the complete R2-backed distribution artifact. Do not call this shipped or merge with the known Codex incompatibility unverified.

The earlier implementation status documents record historical open coverage. Multi-window, actual worker stop, offline recovery, native fullscreen access, focused accessibility, measured managed-runtime performance, repeated BFCache, result replay and deleted-version retention now have the evidence above. Unsupported universal automatic inference and unverified LinkedIn APIs remain explicitly excluded product capabilities, not working features.
