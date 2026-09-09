# Pane Layers — implementation plan

**Status:** implementation in progress; managed persistence, translation, bounded adaptive actions, public data badges, activity and version recovery are integrated. Native popup interaction has been verified. Full delivery and release remain gated. See [implementation status and evidence](./layers/IMPLEMENTATION-STATUS.md); LP completion checkboxes below remain open.
**Updated:** 2026-09-09.

**Scope:** persistent website customizations, agent-created buttons, structured transformations, adaptive on-demand page tasks, data enrichment, and advanced stored/generated JavaScript. Native, Claude Code and Codex are supported release paths, not optional follow-up integrations.

This is the authoritative work breakdown for Layers. [Product/UX](./21-pane-layers.md), [runtime contracts](./21-pane-layers-runtime-contract.md), and [capabilities/skills/provider parity](./21-pane-layers-capabilities-and-skills.md) remain the design references. Their L0–L7 labels group capabilities; use the LP work packages below for execution. Historical Phase 9 reshaping tasks are superseded for this feature's implementation detail, without asserting that previous browser release gates have passed.

## 1. Delivery contract

The completed feature must demonstrate these flows:

1. “Always hide recommendations here” → correct preview → saved rule → restart/revisit → immediate application → Show original/disable restores managed effects without an agent call.
2. “Add a Translate button” → button persists → click runs selected provider → validated block results appear in the originating document → original remains available → cancellation/stale-page handling works.
3. “Add a Focus button” → each click inspects the current layout, applies scoped managed changes, verifies them and offers Undo. The button/intent persists; generated effects default to the document session.
4. A verified data source enriches visible items, with batching, cache freshness, reconnect and unavailable states. A controlled API fixture establishes the platform; LinkedIn coverage remains conditional on a real usable data source.
5. A separately granted advanced action executes generated JavaScript on demand, and an advanced saved Layer reapplies its stored JavaScript. Recovery limitations are accurately shown. These are part of the complete requested scope, even if managed-only dogfood ships first.
6. The address-bar-adjacent Layers button controls the current site with the sidebar closed. Sidebar authoring/activity and the full library share the same state.
7. An already configured native, Claude Code or Codex provider can discover skills/tools, create, test, activate and invoke Layers with no Layer-specific manual setup or alternate provider key.
8. Unsupported requests are assessed before promises and blocked at activation. Unshipped automatic model-on-load behavior cannot be enabled by inventing a manifest or making a broad match rule.

**Initially excluded:** automatic model inference on page load, arbitrary all-language/all-content guarantees, cross-origin frames and special viewers, incognito, gallery/sharing/sync, automatic self-repair, full Tampermonkey API/import compatibility, and unverified third-party API adapters. Automatic deterministic Layer mounting is included. Distinguish these two uses of “automatic” in assessment/UI.

No fixed delivery date is asserted before LP-00 resolves native/runtime/provider feasibility. Plan estimates should follow those experiments, rather than hiding their uncertainty in optimistic task durations.

## 2. Verified starting point

All agent paths below are relative to `packages/browseros-agent/`. Native paths are relative to `packages/browseros/chromium_patches/`. “New” names later in this plan are proposed files, not claims that the functionality exists.

| Existing surface | What is available / what remains |
| --- | --- |
| `apps/app/wxt.config.ts` | Has scripting/storage/webNavigation and HTTP(S) access; no `userScripts` permission. Per-Layer scope and action policy do not exist. |
| `apps/app/entrypoints/background/index.ts`, `background/piHostOpened.ts`, `background/captureBridge.ts` | Background lifecycle and a PI host hook exist; the host hook is reached through capture. Layers need independent navigation lifecycle. |
| `apps/server/src/lib/db/{index,client}.ts`, `lib/profile-context.ts` | Lazy profile DBs, migrations and schema bootstrap exist. New Layer state must cover both migration and fallback bootstrap paths. |
| `apps/app/lib/browseros/{agent-fetch,profile-key}.ts` | Profile routing exists; a profile UUID/header is not an authorization credential. Handle initial profile-identity resolution instead of authoring under a transient fallback identity. |
| `apps/server/src/context/register-mcp.ts`, `agent/ai-sdk-agent.ts` | Product tool factories are currently assembled separately. Add a shared Layer registration source consumed by both, with equivalent trust wrapping. |
| `apps/server/src/memory/{builtin-skills,tools}.ts`, `agent/prompt.ts` | PI establishes canonical skill names and MCP loading. Main prompt supplies routing. |
| `apps/server/src/main.ts` | Seeds skills for known profiles at startup; verify new-profile/MCP-first seeding rather than assuming existing-profile startup covers it. |
| `apps/server/src/lib/agents/acpx/{agent-common,runtime-context,runtime-state,runtime-templates}.ts` | Managed external sessions have a separate prompt/skill path and session identity. Add canonical catalog routing and content-version invalidation. |
| `apps/server/src/lib/agents/acpx-provider/{buildAcpMcpServers,buildBrowserOsSelfMcp}.ts` | External providers receive Pane MCP. This is authoring discovery, not a proven constrained action runner. |
| `apps/server/src/agent/ai-sdk-agent.ts` | General chat combines browser/filesystem/external tools and memory. Do not reuse that unrestricted assembly for translation. |
| `chrome/browser/browseros/server/{process_controller_impl,browseros_server_proxy}.cc` | Native launch/proxy integration points. Inspected proxy forwards a limited header set and buffers responses; do not assume arbitrary profile headers or streaming replay work through it. |
| `chrome/common/extensions/api/browser_os.idl`, `chrome/browser/extensions/api/browser_os/` | Existing native extension API integration points, not an already-authenticated Layer broker. |
| `chrome/browser/ui/actions/chrome_action_id.h`, `chrome/browser/ui/views/toolbar/` | Fork modifies native toolbar actions. A second independent Layers control needs native work; changing the existing extension popup is insufficient. |
| `packages/shared/package.json` | Explicit exports and Zod 3. Server/shared use Zod 3; app also has Zod 4. Avoid incompatible validator instances crossing package boundaries. |

Do not edit generated Chromium build outputs as the source of truth. Native changes belong in the maintained patch/build workflow. Use the current pinned and actually built Chromium versions during probes; top-level architectural prose may be stale.

## 3. Build decisions

- **Source of truth:** profile SQLite; immutable versions; server single write path; extension storage is a revisioned runtime cache plus offline disable tombstones.
- **Local effects:** packaged managed interpreter, declarative programs and a resource/ownership ledger; independent of the server/model/capture on ordinary page load.
- **Advanced scripts:** separate user-script execution world, separately granted page access, with native attestation/bootstrap work if required. Never evaluate agent source in the privileged extension world or call a wrapper a sandbox.
- **Actions:** `local`, `transform`, `page-task` are independent from whether the persistent Layer shell uses managed rendering or advanced JS.
- **Result contract:** strict shared schemas, semantic checks, invocation-bound private submission, typed replayable events; no parsing chat prose into renderable output.
- **Identity:** bind profile, tab/frame/document, instance, Layer version, route generation, action, snapshot/entity and revocation generation. Target identity is established by trusted code, not chosen by model output.
- **Provider policy:** common action contract and three tested adapters; no silent model switch. Restrict provider built-in tools/context as well as Pane MCP tools.
- **Authoring:** canonical skills + thin routing; shared tool factories; version-bound verification receipts. Assessment and validators enforce actual capability even if instructions are ignored.
- **UI:** native toolbar button/popover for quick management; on-page effects/actions; sidebar creation/details/approvals; `#/layers` library. No sidebar dependency for execution.
- **Migrations:** additive upgrade; no automatic down migration or clearing user state on feature rollback. Old clients reject unknown runtime/schema versions.

## 4. Work packages and dependencies

Each package should produce a focused reviewable change or a small sequence of changes. Checkboxes are intentionally empty. Dependencies permit independent engineering work after interfaces settle; this document does not dispatch agents or create tasks.

| Package | Deliverable | Depends on |
| --- | --- | --- |
| LP-00 | Runtime, native, authentication and provider experiments | None |
| LP-01 | Shared contracts and executable capability policy | LP-00 contract decisions |
| LP-02 | Profile store, migration, versions and desired-state service | LP-01 |
| LP-03 | Authenticated native/extension/server broker | LP-00, LP-01 |
| LP-04 | Managed page runtime and local persistence loop | LP-02, LP-03 |
| LP-05 | Native site controls, sidebar/library and recovery UI | LP-01, LP-03; completion needs LP-04 |
| LP-06 | Shared authoring tools, canonical skills, prompt routing | LP-01–LP-04 |
| LP-07 | Authoring preview, test harness, activation receipts and repair | LP-04, LP-06 |
| LP-08 | Action service, typed output, translation and native adapter | LP-01–LP-04 |
| LP-09 | Claude Code/Codex action adapters and provider parity | LP-03, LP-06, LP-08 |
| LP-10 | Adaptive managed page tasks | LP-07–LP-09 |
| LP-11 | Data operations and enrichment | LP-03, LP-04, LP-08 |
| LP-12 | Advanced persistent and generated JavaScript | LP-00, LP-03, LP-07–LP-10 |
| LP-13 | Integrated release verification, packaging and rollout | All packages |

Critical experiments LP-00 precede expensive UI polish. The first runnable increment ends at LP-04. A managed-only checkpoint after LP-05–LP-11 is internal/beta progress, not completion of advanced JavaScript scope. Full delivery includes LP-12 and LP-13.

### LP-00 — Resolve the architectural risks with executable probes

**Outputs:** small feature-gated probes/fixtures and three recorded decisions under `specs/layers/decisions/` (new): broker/bootstrap, user-script identity/lifecycle, and provider action isolation/native controls. Record the tested browser build, provider adapter versions, traces and remaining limitations. Avoid adding shipped skill instructions in this package.

- [ ] Probe `userScripts` with Pane's bundled extension: availability/enablement, per-Layer worlds, dedicated messaging sender metadata, registration restoration, active-document cleanup and script interruption limits.
- [ ] Prove how a broker distinguishes one script instance from another. If sender metadata lacks trustworthy world/registration identity, specify the native attestation addition. A user-supplied Layer ID or static DOM nonce is not acceptable.
- [ ] Choose secure browser→sidecar bootstrap using native-owned process launch/IPC. Preferred direction: per-launch secret transferred through a protected inherited channel; a known-extension-only native API provisions short-lived profile-scoped credentials. Prove extension ID, profile ownership, rotation and development-mode setup. No token in URL/command line/public discovery file.
- [ ] Prototype the Layers native toolbar action and browser-owned bubble with a trusted extension view. Verify two-window/tab rebinding, renderer ownership and the existing Ask Pane action remaining intact. If this embedding is unsuitable, choose a native view consuming the same typed view model here, not halfway through LP-05.
- [ ] For a native model, Claude Code and Codex, complete one private typed result submission with no manual Layer setup. Prove restricted tools/context, cancellation and invocation isolation; inventory permissions the provider controls outside MCP. An unrestricted provider failing this check is a release blocker to solve, not an excuse for a prompt-only restriction.
- [ ] Establish profile-aware authoring transport and invocation transport. Prefer direct authenticated local service traffic for bounded events; if native proxy is used, prove required headers, authentication, routing and buffering behavior rather than assuming it streams.

**Exit:** each selected path has executable evidence and an implementation decision. A failing experiment ends with a concrete prerequisite work item and keeps its capability false. Independent store/runtime design can proceed; publishing privileged scripting or claiming provider parity cannot.

### LP-01 — Define contracts and capability assessment first

**New:** `packages/shared/src/layers/{manifest,program,matching,capabilities,action-protocol,result-schemas,verification,errors}.ts`; `apps/server/src/layers/{capability-service,assess}.ts`. **Edit:** shared package exports and trust consequence classifications where necessary.

- [ ] Implement strict versioned schemas for Layer/version, requested behavior, managed program, action definition, grants, runtime manifest, event envelopes, receipts and error codes. Derive TS types from schemas; use JSON-compatible protocol boundaries to avoid app/server Zod major-version issues.
- [ ] Implement exact origin/path/exclusion matching with explicit query/hash predicates and ineligible schemes/frames. No default subdomain broadening.
- [ ] Capability inventory comes from feature flags, registered runtime features, current profile/grants and tested provider capabilities. Automatic model-on-load starts false.
- [ ] `layer_assess` separates supported, limited, missing setup, unknown and unsupported; carries evidence and requirements/capability hashes. It never says unknown data access is supported.
- [ ] Shared validation rejects unsupported triggers and modes independently of agent text. Activation cannot accept a manual-action substitute while claiming automatic behavior.
- [ ] Set bounded defaults: programs/input/output, selectors, model steps/tokens/deadlines, queued work, observation and payload retention. Exact defaults are measured/tuned in later packages; unset limits fail validation rather than become unlimited.

**Tests:** match lookalikes/excludes/SPA predicates; invalid/oversized manifests; unsupported automatic translation; provider change/stale assessment; requirement-to-activation receipt consistency. **Exit:** every feature promise is representable and checkable; all runtimes consume the same protocol.

### LP-02 — Persist state through one transactional write path

**New:** `apps/server/src/layers/{store,write-path,reconcile,paths}.ts`, `lib/db/schema/layers.ts`, a next-numbered migration generated at implementation time. **Edit:** DB schema exports, migration journal/packaging, and fallback bootstrap in `lib/db/client.ts`.

- [ ] Add Layers, immutable versions, grant/pause state, namespaced storage, invocation metadata, bounded cache, assessments and verification receipts. Index by origin/status/version and unique idempotency identity. Document deletion/Undo retention.
- [ ] Version activation transaction checks feature support, grants, exact candidate hash and test receipt; emits a new desired-state revision. Test-only fixtures may provide harness records; production has no bypass flag.
- [ ] Model applied state separately: persisted, pending application, acknowledged, failed. A database commit is not proof of live mount.
- [ ] Add revisioned manifest reads and acknowledgement handling. Never return private API credentials in manifests.
- [ ] Profile-scoped offline disable tombstones win over older enable revisions on reconnect. Re-enable requires reconciled authority.
- [ ] Durable migration + fallback-schema tests cover fresh install, existing profiles, late profile creation, packaged resources and repeat startup. Interrupted upgrade preserves last-known data; incompatible runtime versions pause execution.

**Exit:** deterministic store tests establish atomic replacement, profile isolation and stale-state rejection without requiring a browser/model.

### LP-03 — Build the authenticated broker and native recovery channel

**New:** server `layers/{broker-auth,instance-registry,broker}.ts`, API `routes/layers.ts`; extension `lib/layers/{broker-client,protocol-client}.ts`, `entrypoints/background/layers/broker.ts`. **Edit:** API route/profile registration, native API declarations/implementations and process bootstrap selected in LP-00.

- [ ] Require scoped authentication on Layer UI/broker mutations and private action endpoints, in addition to origin/profile checks. Bind managed-harness authoring credentials to profile/session; unauthenticated public MCP clients do not gain Layer mutations merely because tools are discoverable.
- [ ] Bind actual extension sender/document to runtime instances; allow only the known Pane extension through the native bridge. Do not expose a generic arbitrary native command endpoint.
- [ ] Implement credential renewal, sidecar restart rotation, grant revocation and instance expiry. Secrets never enter DOM, script logs, result bodies, page URLs or generic diagnostic snapshots.
- [ ] Authenticated commands bind current view revision and explicit tab/document. Cross-profile/window requests are rejected. Wait for stable native profile identity before initial grants/writes.
- [ ] Native recovery pause is readable by runtime startup and reachable when a page/script fails. It prevents new Layer execution on clean reload; it does not claim to undo already-executed arbitrary JS.
- [ ] Development supervisor provisions equivalent credentials automatically in disposable dev profiles; production cannot accept dev bypass credentials.

**Tests:** hostile page/other extension, forged profile/tab, replay, revoked instance, stale native-popover command, server restart and fresh profile. **Exit:** no action/broker access based only on guessed IDs, localhost or a broad extension-origin check.

### LP-04 — Complete the local hide-and-restore runtime

**New:** extension `entrypoints/layers.content/index.ts`, `entrypoints/background/layers/{lifecycle,cache,reconcile}.ts`, `lib/layers/{interpreter,anchors,runtime-ledger,mutation-queue}.ts`. **Edit:** WXT registration/background bootstrap; no user-script permission needed for managed programs.

- [ ] Package a managed interpreter for bounded capture, collapse, highlight and Pane-owned controls/results. No dynamic code evaluation or arbitrary HTML/style URLs.
- [ ] Add independent document/SPA lifecycle, route matching, generation identity and one mount per Layer/version/instance. Reconcile already-open tabs and removals.
- [ ] Cache only acknowledged executable versions for startup/offline use; cleanup previews and unsupported versions. Service-worker restarts rebuild from cache/manifest rather than duplicate effects.
- [ ] Use bounded semantic anchors, visible-first queues and shared observer management. Detect virtualized node/entity reuse and hydration churn; no whole-page polling loop.
- [ ] Maintain ownership/inverse effects across overlapping Layers. Disable removes owned UI/listeners/observers and only still-owned host mutations. Show-original state is per tab and persists through that tab's navigation until resumed/closed.
- [ ] Build static article, SPA, infinite-feed, form, duplicate-anchor and hostile-churn fixtures under the existing browser-fixtures directory. Bootstrap a known managed rule through internal tests and verify its actual effects; do not add a production test bypass.

**Exit demo:** hide → activate → new tab/reload/browser restart → disable/restore; two isolated profiles; capture and server off after activation; no model or external API calls. Unsaved form content is not read or destroyed. Repeated mount/unmount does not leak tracked resources.

### LP-05 — Ship the UI where people need it

**New:** app `modules/layers/{SiteLayersControls,LayerPreview,LayerRunStatus}.tsx`, `screens/layers/{LibraryPage,LayerDetailsPage}.tsx`, shared queries/view model and trusted popover entrypoint chosen in LP-00. **Edit:** app routes/navigation/document titles, sidepanel current-tab header, native toolbar action/controller and bubble implementation.

- [ ] Native button beside the address bar, mounted count/attention status, current-site popover, empty-state Add a layer. Preserve Ask Pane. Sidebar closed must not hide Layer management.
- [ ] Reuse the same React controls/view model in trusted popover and sidepanel where supported; derive state from the broker/cache rather than separate stores.
- [ ] Expose active, not-applicable, waiting-for-content, needs-connection, partial, paused/error and saved-not-applied states. Bind in-page progress and native summary to the same invocation.
- [ ] Implement Show original, per-Layer disable, site pause, global pause, Stop, Undo and advanced reload recovery with their distinct persistence semantics.
- [ ] Add library/detail routes, scope examples, settings, source/version history, capability summary and Edit/Fix with Pane. Do not expose unusable action modes before their runtime flag passes.
- [ ] Add preview controls and focus/selection handoff to the authoring composer; explicit “always” intent permits save-with-receipt/Undo without a redundant Keep step. Material scope/trigger changes require the user's choice.
- [ ] Test active-tab switching while the popover is open, two windows, long names/RTL, dark/light, 200% zoom, keyboard, screen reader, browser fullscreen access and page occlusion.

**Exit:** a user can discover, inspect, disable and recover a Layer without chat or a working model. Native controls communicate unavailability honestly when extension/server components are down.

### LP-06 — Expose one authoring surface and canonical skills

**New:** server `layers/{tools,tool-catalog}.ts`, `memory/layer-skills.ts` (or focused bundled skill sources imported by the existing catalog), shared thin routing text. **Edit:** `memory/builtin-skills.ts`, `memory/tools.ts`, `agent/prompt.ts`, `agent/ai-sdk-agent.ts`, `context/register-mcp.ts`, profile initialization, managed harness prompt/skill/session-identity builders.

- [ ] Register `layer_assess`, `layer_list/read`, `layer_draft/update`, `layer_preview/validate`, `layer_test/inspect_runtime`, `layer_activate/set_enabled/remove/diagnose`. Gate tools whose implementation is not ready; never publish nonfunctional placeholders as working tools.
- [ ] Consume one Layer tool catalog from native and MCP wrappers; preserve metadata, schemas and server policy. Avoid a broad unrelated refactor of all existing product tools. Parity tests fail if a Layer addition reaches only one path.
- [ ] Ship `layers`, `layers-authoring`, `layers-actions`, `layers-verify`, `layers-repair` with stable IDs, progressive loading and short descriptions. Bodies are loaded by Pane `skills_load`; no accidental invocation of an unregistered provider-native Skill.
- [ ] Seed on every relevant profile initialization, including a fresh MCP-only session. Generate any necessary filesystem entry points from the canonical catalog. Resolve references through the loader rather than assume the remote harness shares repository paths.
- [ ] Thin routing is included in native and managed-harness prompt builders. Add a named token/size budget assertion for the new routing text; detailed workflow/schema prose belongs in skills/contract responses.
- [ ] Include skill content/version digest in managed session identity. Refresh stale instructions with controlled context/session handling; preserve archive choices and avoid manual reinstall.
- [ ] Keep chat-mode reads and action-specific grants intact. Tests are not universally read-only; verification that executes an action must receive its scoped budget/grants.

**Exit:** fresh native/Claude/Codex sessions discover the same enabled authoring surface and load the same skill revision without prior native chat. Their activation receipts accurately describe trigger/scope/capability; unsupported auto-translation requests do not become fake working Layers.

### LP-07 — Make authoring prove its result

**New:** server `layers/{verification,verification-store,preview,repair}.ts`; extension runtime inspection/preview transport; server `tests/layers/verification/`. **Reuse:** existing browser `snapshot`, `act`, `screenshot`, navigation and bounded read/evaluation tools for the authoring task only.

- [ ] Build independent acceptance specifications: user outcome, match examples, target region, expected effects and restoration. Mandatory platform checks cannot be removed by generated code.
- [ ] Baseline limited region evidence, validate definition, mount preview bound to one document, inspect visible/accessible placement, click through real browser input and read the outcome. A DOM-present but occluded button fails clickability.
- [ ] Produce harness-owned receipts bound to program/action/schema/scope/grant/runtime hashes. Evidence distinguishes fixtures, live provider and safe revisit. No generated `passed:true` accepted as proof.
- [ ] Verify revisit in a disposable tab where safe; never reload an editing tab to satisfy a test. Record cases where a duplicate cannot reproduce unsaved/authenticated state.
- [ ] Test disable/cleanup and cross-Layer ownership; store cropped local evidence with retention/delete controls. Exclude sensitive input contents and unneeded full-page captures.
- [ ] Bounded repair: two candidate iterations within one budget, exact-version retest, preserve active version on failure. No silent grant or selector-scope expansion.
- [ ] Activate only the assessed/tested candidate; post-activation runtime acknowledgement is required before saying applied. Allow honest partially-verified status for missing optional live/revisit evidence, but never waive structural/capability/security failures.

**Exit:** the agent creates and verifies a real local Layer, preserves a prior working version on failed edits, and reports skipped tests honestly. Extend this same harness in LP-08–LP-12; do not fork a weaker test path per action type.

### LP-08 — Implement bounded actions and structured translation

**New:** server `layers/{action-runner,invocation-store,result-acceptance,invocation-events,provider-capabilities}.ts`, `layers/providers/native.ts`; extension `lib/layers/{capture-registry,result-reducer,invocations}.ts`, `renderers/translation.ts`.

- [ ] Introduce `LayerActionExecutor.start/cancel/status` with immutable definition, frozen input, scoped context, budgets and event sink. Reuse provider configuration/auth resolution without the full chat prompt/tool/memory assembly.
- [ ] Create authenticated invocation/status/events/cancel endpoints and dedupe transaction. Bind every operation to the originating instance. A changed active tab never redirects results.
- [ ] Private `submit_layer_result` closes over invocation/chunk identity; strict schema plus semantic ID/language checks; one bounded invalid-output repair; no Markdown extraction. Same acceptance function can support provider-native structured output later.
- [ ] Implement terminal compare-and-set, cancellation, sequenced event replay/snapshot recovery, payload expiry and server-restart interruption. Service-worker suspension does not rerun a model. Persist minimal metadata; raw results default to bounded in-memory retention.
- [ ] Capture readable article blocks without form/secret/Pane-generated content, assign IDs/source fingerprints, chunk under a global budget. Render complete validated chunks with explicit partial status and Original/Translation.
- [ ] Recheck entity/source fingerprints before application. Unknown IDs, stale routes/snapshots, stopped actions and revoked versions reject late data. Account/provider changes invalidate dependent cache entries.
- [ ] Route approvals to trusted UI, not a page-controlled flag. Button status shows Stop/Retry/Details; closing the sidebar does not stop execution. A retry after uncertain external effect never repeats that effect automatically.

**Exit:** native-provider translation runs from the actual button, survives delivery reconnect, stops correctly and never corrupts the original document. Cover mixed-language, RTL, long text, wrong IDs, prose/refusal, partial timeout and double-click fixtures. This alone does not satisfy provider parity.

### LP-09 — Complete Claude Code and Codex action execution

**New:** `layers/providers/{claude-code,codex,scoped-mcp}.ts`. **Edit:** selected managed provider adapters, `acpx-provider/buildAcpMcpServers.ts`, `buildBrowserOsSelfMcp.ts`, host process configuration and session cleanup selected in LP-00. Changes are scoped to Layer invocation context; preserve normal chat behavior.

- [ ] Provision each provider automatically from existing configured authentication with declared tools/context and supported process isolation. Do not inherit all custom MCP servers, private workspace files, memory or full general browser authority into a transform action.
- [ ] Supply the private result-submission tool through an invocation-scoped authenticated channel. It is absent from public authoring MCP and cannot accept arbitrary invocation IDs.
- [ ] Disable/contain undeclared provider-native tools through actual supported controls verified in LP-00. A restricted MCP catalog plus “please don't use other tools” does not pass.
- [ ] Normalize errors/cancellation/usage and accepted results into the same executor contract. Tool names and schemas come from canonical sources; only transport/process adaptation differs.
- [ ] Test each installed adapter version on cold start, auth expiry, resume, cancellation, profile isolation, provider switch and result replay. Include managed-agent sessions and ACP-backed sidepanel selection if they use separate entry paths.
- [ ] Do not silently switch to a native API model or demand another key to make a provider test pass. Missing credentials during engineering validation produce an explicit not-run result, not a green release gate.

**Exit:** actual native, Claude Code and Codex runs demonstrate the same author→click→typed-result→verify lifecycle, without Layer-specific setup. If a necessary containment feature is unavailable, the all-provider release remains blocked until its adapter/prerequisite is implemented.

### LP-10 — Add adaptive on-demand page tasks

**New:** server `layers/{page-task-tools,page-task-runner,mutation-receipts}.ts`; extension `lib/layers/{page-task,document-lock}.ts`.

- [ ] Bind `page_inspect`, `page_apply`, `page_verify` to the originating live document. They use short-lived handles and immediate mutation preconditions; the model cannot select another tab.
- [ ] Execute observe → apply → inspect → bounded adjustment → finish. Track owned change sets and independently generated verification references. Receipt validation resolves those actual records.
- [ ] Serialize overlapping mutating page tasks per document in v1. User interaction is never locked; invalidate/reobserve assumptions when it changes the page. Nonmutating transformations remain independent.
- [ ] Track partial changes when a run fails or returns no result. Show what remains and Undo. Cancelling stops subsequent work; applied-change restoration follows the declared action policy.
- [ ] Save intent/button; generated effects are document-session state. “Keep this exact change” creates a new authoring candidate and verification, not a hidden runtime policy update.

**Exit:** Focus mode adapts to multiple fixture layouts, verifies the visible result, handles mid-run mutation and restores owned changes. All three providers use the same scoped tools. Arbitrary source execution remains disabled until LP-12.

### LP-11 — Add data-backed enrichment

**New:** server `layers/{data-broker,data-cache,data-operations}.ts`; extension `lib/layers/{entity-bindings,enrichment}.ts`; controlled HTTP fixture.

- [ ] Register named connector/HTTPS operations with input/output schemas and explicit destination/method/path policy. Keep credentials server-side and return only required fields.
- [ ] Revalidate redirect destinations and address policy at connection time; default deny private/loopback destinations except individually granted internal operations. Bound concurrency, bytes, timeouts and retry/backoff.
- [ ] Resolve stable entity keys, process visible items first, dedupe/batch, cache by profile/account/source/operation/parameters and TTL. Do not use display names as unique IDs.
- [ ] Show fresh/stale/unavailable/zero distinctly. Auth expiry, denied scope, rate limiting and unsupported fields have different states. No routine LLM calls for simple data reads.
- [ ] Test prompt-independent API policy, credential redaction, account switches and virtualized node reuse. No silent profile-visiting scraper fallback.

**Exit:** controlled per-author/product enrichment survives scroll, duplicate entities, stale cache, 401/403/429 and connection changes. Optional real adapters need their own access/coverage evidence; their absence does not block the general platform.

### LP-12 — Implement advanced stored and generated JavaScript

**New:** extension `background/layers/{user-script-registry,user-script-bootstrap}.ts`, `lib/layers/advanced-sdk.ts`; server `layers/script-validation.ts`, advanced source/version UI; native identity/enablement support decided in LP-00. **Edit:** WXT `userScripts` permission and relevant native extension API restrictions.

- [ ] Support persistent stored scripts and explicit one-shot `page_execute_script` for page tasks. Neither path evaluates code received through a general data-result field.
- [ ] Configure a per-Layer user-script world, bootstrap authenticated instance identity through the proven mechanism, restrict broker access to declared named actions/data, and prevent sibling-script impersonation. Isolated worlds still share DOM; do not promise page-data confidentiality or confined networking for arbitrary JS.
- [ ] Enable through a clear advanced page-access grant in Pane's supported setup. No manual developer-mode workaround presented as the finished experience; exact required native enablement behavior is a LP-00 deliverable.
- [ ] Store immutable source/hash and execute only an enabled compatible version. No remote dependencies/code updates, `MAIN` world mode, unrestricted GM API compatibility or silent escalation in this release.
- [ ] Provide optional SDK tracking/cleanup for timers, observers and owned UI plus cooperative cancellation. Display reload-required when complete restoration cannot be established. Native recovery pause must work independently of the blocked page's renderer.
- [ ] Restore registrations on extension update/startup and reconcile already-running versions. Unregistering affects future injections, not past mutations. Deletion/disable revoke broker access immediately and offer clean recovery.
- [ ] Test one-shot generated scripts through an actual button and persistent scripts across reload; hostile-script, cross-Layer message, infinite-loop and untracked-DOM tests run only in disposable fixtures/profiles. Code scanning is advisory, not a safety certificate.

**Exit:** the original general userscript intention is functional and tested, including on-demand generated scripts through native/Claude/Codex page tasks. User-facing limitations accurately distinguish managed Undo from arbitrary-script recovery.

### LP-13 — Integrate, verify and release

**Edit:** diagnostics/action-log integration, privacy filters, feature flag registration, fixture suites, build resource inclusion and release notes. Use the normal paired browser/server/extension release mechanism; this plan is not an instruction to publish a release now.

- [ ] Run the cross-provider user flows from section 1 using fresh and upgraded profiles; include sidebar closed, capture off and offline local effects.
- [ ] Test migration/resource packaging, protocol skew, downgrade/feature-disable behavior, extension update, sidecar restart and late profile creation. Disabled capability pauses execution but preserves recoverable definitions.
- [ ] Finish keyboard, screen-reader, zoom/RTL, two-window and current-site rebinding checks. Added controls must not steal focus or impersonate native site controls.
- [ ] Measure mount/scroll CPU, retained resources and end-to-end action latency against a no-Layers baseline. Tune bounded budgets with evidence; proposed targets from the runtime spec are not achieved numbers until measured.
- [ ] Verify logs/evidence do not expose page content, credentials, full sensitive URLs or private results by default. Exercise evidence/cache deletion and retention.
- [ ] Test global/site pause and native recovery under errors. Rollback is flag-off/registration removal/recovery UI, not a destructive schema downgrade.
- [ ] Produce `specs/PANE-LAYERS-IMPLEMENTATION-REPORT.md` with exact commits/builds/provider versions, capability matrix, executed checks, unrun checks and remaining known limitations.

**Exit:** all required gates pass; no mocked/untested provider is represented as supported. Managed-only beta can be labeled as such, but full completion cannot omit advanced scripts, native controls, verification or either external provider.

## 5. Cross-package integration contracts

These interfaces are implementation boundaries to settle in LP-01; names can change coherently, but consumers must not bypass their responsibilities.

| Interface | Producer → consumer | Required semantics |
| --- | --- | --- |
| `LayerAssessment` | Capability service → authoring/UI/activation | Requirements/evidence/capability revision; unsupported versus unknown; no model-authored support flags |
| `LayerVersion` | Single write path → store/cache/runtime | Immutable program/action/schema hashes, scopes/grants and runtime version |
| `RuntimeManifest` | Store → extension | Desired revision, safe executable definitions, pause/revocation state; no API/provider credentials |
| `RuntimeAck` | Extension → store/UI | Applied revision per instance and actual state/error; count mounted Layers accurately |
| `LayerInvocationContext` | Broker → executor/private MCP | Authenticated profile/document/action identity, tool/cost policy, cancellation generation |
| `LayerActionExecutor` | Provider adapter → invocation service | Start/cancel/status, validated result acceptance, errors/usage; no provider-specific rendering code |
| `LayerEvent` | Service → broker → document | Sequenced replayable accepted/progress/result/approval/terminal events; stale-context rejection |
| `MutationReceipt` | Managed runtime → page-task runner | Actual owned changes/partial application/cleanup capability; no agent-asserted success |
| `VerificationReceipt` | Independent harness → activation | Exact version/scope/grant/runtime evidence and explicit test coverage |
| `SiteLayersViewModel` | Runtime/cache → native/React controls | Site and view revision, status/count, commands bound to target, unavailable/recovery state |

Define API route schemas alongside these types. Group the proposed `/layers` surface into assessment/definitions, preview/verification, activation/state/manifest acknowledgements, and invocations/status/events/cancel. General authoring tools call the same services as UI routes. Private invocation submission is isolated from both. Durable state changes are idempotent; payload-changing reuse of an idempotency key returns a conflict.

State transitions to test explicitly:

```text
Definition: draft → assessed → previewed/tested → enabled → disabled/deleted
Runtime:    pending → mounted | not-applicable | waiting | failed | paused
Action:     accepted → running → [waiting-approval] → completed | partial | failed | cancelled
```

These are separate state machines. `enabled` never means every matching page successfully mounted; `running` never means code has not yet changed the page. Approval resumption rechecks target/grants; cancellation or document invalidation prevents a late result from restoring running/completed UI. A new candidate does not overwrite the prior active version until successful activation.

## 6. Test execution and evidence

Use the repository's Bun runners and browser fixture infrastructure. Do not introduce an unrelated test framework for Layers. New test code is required because this changes persistent execution, native privileges and provider behavior; shallow tests that merely mirror a schema are insufficient.

**Add with LP-02:** server script `test:layers` → `bun run ./tests/__helpers__/run-test-group.ts layers`. Existing runner discovers the `tests/layers` group. Confirm new shared tests are also included by the root suite instead of assuming workspace discovery.

From `packages/browseros-agent/`, the intended routine checks are:

```sh
# New script, available after LP-02:
bun run --filter @browseros/server test:layers

# Existing isolated runner; pass the actual changed test directories:
bun run ./scripts/run-bun-test.ts ./apps/app/lib/layers

# Existing quality gates, once per completed integration increment:
bun run check

# Local build verification; these are not publishing steps:
bun run build:agent:dev
bun run build:server:test
```

Run focused existing regressions when touching shared infrastructure: MCP registration, memory/built-in skills/prompt budget, ACP runtime context/session state/provider configuration, profile routing and DB boot. The final integrated build additionally runs the normal full suite once. Repeat/broaden only for new changes or unresolved failures.

LP-00 records the actual Chromium build/test commands for the current checkout. Native controller/API/auth changes require compiled native unit/browser tests as well as a running Pane smoke test; do not substitute extension-only tests or invent a portable GN target. LP-13 uses the supported release-platform matrix of the browser project and records which platforms were actually validated.

Maintain a local execution ledger in the eventual implementation report:

| Check | Native model | Claude Code | Codex |
| --- | --- | --- | --- |
| Fresh profile discovers/loads skills | Required | Required | Required |
| Unsupported automatic request handled honestly | Required | Required | Required |
| Create/test/activate local Layer | Required | Required | Required |
| Translation typed output + cancellation | Required | Required | Required |
| Managed adaptive page task + Undo | Required | Required | Required |
| Advanced generated script + recovery | Required | Required | Required |
| Provider switch / no extra Layer setup | Required | Required | Required |

Each cell records pass/fail/not-run, evidence and tested version. Fixture checks cover stale events, cross-profile attacks and provider faults deterministically; live authenticated smoke verifies real transport/execution. Output schema validity does not establish semantic translation quality: include curated multilingual/manual outcome review and disclose coverage.

## 7. Feature flags, rollout and rollback

Use the existing feature/config plumbing after locating its current owner; introduce versioned server capability flags for managed runtime, actions, data operations and advanced scripts. All clients receive one capability snapshot; UI/skills/tools/activation agree. Independent flags support internal integration, not contradictory public feature claims.

1. **Internal local runtime:** LP-00–LP-04, manually supplied fixture Layer, controls accessible through development UI. No claim of complete agent authoring.
2. **Managed dogfood:** LP-05–LP-11, all three providers and real native controls, explicit managed scope. Collect failures as regression fixtures; advanced mode still hidden.
3. **Full opt-in Layers release:** LP-12–LP-13, advanced capability remains an explicit per-scope choice. Ship browser/server/extension together and keep original-view/recovery accessible.

Do not silently enable existing profiles/sites or automatic paid inference. Disabling the feature revokes new work, removes/reconciles managed effects, stops future script registrations and preserves definitions for recovery. Re-enable requires compatible protocol/grants. Already-running arbitrary JS may require a clean reload; warn through the ordinary recovery state instead of reloading unsaved work automatically.

Completion metrics: successful kept Layer after revisit, accurate assessed/activated promise, successful action completion, restoration success, failures per mounted visit, bounded model/API cost and time to repair. Follow existing telemetry consent and avoid full URLs/page text. No invented KPI targets before dogfood baseline.

## 8. First execution packet

Start with **LP-00 and LP-01**, then LP-02/LP-03 and the LP-04 hide-and-restore slice. The first packet must produce:

- Runtime/native/provider decision notes and executable fixture probes, with unresolved blockers named.
- Shared protocol/assessment types and capability tests, including a rejected unsupported automatic-translation request.
- A selected authenticated broker bootstrap design with concrete native/sidecar integration points.
- A provider matrix distinguishing tool discovery from constrained action execution.

Then demonstrate one durable managed collapse rule before implementing rich renderers or a script editor. Keep later feature flags false until their acceptance gates pass. Update this plan/report as findings change implementation details; do not quietly remove user requirements to close a milestone.

When beginning coding, re-read repository instructions/status, preserve unrelated edits and use the existing development workflow. This planning change does not start coding, launch authenticated provider runs, alter user browser settings, commit, or publish a release.
