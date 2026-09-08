# Pane Layers — runtime contracts and verification

**Status:** proposed engineering contract, 2026-09-08; no implementation or test results claimed.  
**Parent:** [21 — Pane Layers](./21-pane-layers.md). This companion resolves that plan's abstract action protocol, UI placement, and authoring-verification details. Example TypeScript is a proposed interface, not an existing SDK.

## 1. Responsibility boundaries

There are two different agent activities:

1. **Authoring:** inspect a site, generate a Layer manifest/program, action schemas and renderer bindings, then preview and verify it. This agent can use the existing browser tools within the user's task authorization.
2. **Invocation:** run a saved action such as Translate. This receives a bounded input snapshot and an approved tool set. It returns typed data. It cannot change the saved Layer, select a different destination tab, or acquire the authoring agent's general tools/context.

The runtime owns page observation, identities, matching, DOM placement, cleanup, input capture, event handling, and rendering. The server owns validation, model execution, grants, result acceptance, and event creation. The model owns only the requested semantic transformation or task. An agent completion message is not a result transport.

## 2. Saved action and renderer contract

Each immutable Layer version includes separately versioned action definitions. For a starter translation Layer, the definition is:

```ts
type TranslationActionDefinition = {
  id: 'translate-article'
  revision: 1
  execution: 'transform'
  trigger: 'click'
  inputSchema: 'pane.article-input.v1'
  outputSchema: 'pane.translation.v1'
  captureBinding: 'article-readable-blocks'
  promptTemplate: string
  modelPolicy: 'selected-compatible-provider'
  tools: [] // Runtime adds its private result-submission tool.
  resultBinding: {
    renderer: 'parallel-translated-blocks.v1'
    surface: 'page'
    sourceBinding: 'article-readable-blocks'
    textField: 'translatedText'
    keyField: 'blockId'
  }
  limits: {
    maxInputBytes: number
    maxOutputBytes: number
    maxBlocks: number
    maxModelSteps: number
    maxOutputTokens: number
    deadlineMs: number
  }
}
```

The button and its binding are stored in the managed program: `button click → action translate-article → parallel-translated-blocks renderer`. The renderer is packaged code, not new HTML generated per click. Only validated data enters it. Changing the schema, prompt, tool set, or binding creates a new immutable version and invalidates affected verification receipts/cache entries; changed privileges need the normal grant update.

Other Layers may declare a custom `inputSchema`/`outputSchema` using a size/depth-bounded JSON Schema subset stored in their version. Disallow external `$ref`, unbounded recursion, arbitrary validation code, and expensive regex patterns. The shared validator/compiler accepts only supported constructs; server and client use matching schema/runtime versions. Standard renderers cover text, badges, lists, tables, panels, and buttons with registered action IDs. Generic results can bind fields to these components; they cannot contain executable DOM patches. New component types require a packaged runtime update or advanced JavaScript mode.

For advanced JavaScript, a proposed SDK shape is:

```ts
const result = await layer.actions.invoke('translate-article', {
  capture: articleCaptureHandle,
  targetLanguage: 'en',
}, { signal })

// result.data has already passed pane.translation.v1 and semantic checks.
layer.ui.render('article-translation', result.data)
```

`layer.actions.invoke` resolves a stored definition; it is not `agent.run(anyPrompt, anyTools)`. Capture handles bind a specific runtime instance, snapshot and grant and have short expiries; the broker checks them. Advanced scripts may inspect their permitted page directly, so this handle scheme protects broker authority, not secrecy from another script with the same page access. SDK helper cleanup cannot guarantee arbitrary JS reversibility.

## 3. Translation request, end to end

1. The managed event handler receives the click. Resolve the currently active Layer version and action binding. Do not resolve the target using whichever tab is active later.
2. Capture readable article blocks through the named capture binding. Assign snapshot-local block IDs. Store the mapping from IDs to live node references, original text fingerprints and anchor/entity identity in the trusted content runtime. Avoid injecting mapping tokens or secrets into the DOM.
3. The background broker validates actual message sender, installed version, grants, preview status, action input and instance identity. It binds a profile and authenticates the sidecar request. The browser supplies document identity; content-supplied IDs are checked against that identity and current registration state.
4. The server revalidates and snapshots the action definition/input, chooses a compatible provider under the saved policy, and persists invocation metadata. It atomically deduplicates before starting work. Reusing a key with different inputs returns a conflict.
5. The server executes a constrained transformation and accepts only a validated submission. It wraps that submission with broker-owned identity and provenance before emitting events.
6. The runtime checks the envelope and the live source mapping again, then displays the translated result. Original site content remains available and is never reconstructed from translated text.

Proposed internal request after broker enrichment:

```ts
type LayerActionRequest = {
  protocol: 'pane.layer-action.v1'
  invocationId: string
  idempotencyKey: string
  layerId: string
  layerVersion: string
  actionId: string
  actionRevision: number
  context: {
    profileKey: string
    tabId: number
    frameId: number
    documentId: string
    instanceId: string
    routeEpoch: number
    entityKey: string
    snapshotId: string
  }
  input: {
    targetLanguage: string
    blocks: Array<{ blockId: string; text: string }>
  }
}
```

Authentication is outside this body. Field possession conveys no authority. The server context is bound to the authenticated broker, approved document session and active grants. Keep the full URL out of the model request when it is unnecessary. Snapshot fingerprints that are not needed for translation stay out too.

## 4. How the agent returns structured data

Use a private terminal tool for result submission. The server dynamically installs its argument schema from the immutable action definition. For this action:

```ts
// Tool exposed only inside this invocation/chunk's constrained model run.
submit_layer_result({
  schema: 'pane.translation.v1',
  targetLanguage: 'en',
  blocks: [
    { blockId: 'b1', translatedText: 'A city reveals itself on foot.' },
    { blockId: 'b2', translatedText: 'Quiet streets become places to meet.' },
  ],
})
```

The tool implementation captures the invocation/chunk identity in a server closure. The model cannot supply a target tab, credential, callback URL, selector, arbitrary HTML, CSS, or action to execute. This tool is not published on Pane's general MCP endpoint or exposed to other agent sessions.

Acceptance checks, in order:

1. Invocation is still running, deadline/budget unexpired, active version/grant valid, and no result has already been accepted for this chunk.
2. Strict shape: expected schema tag, no unknown fields, bounded depth/bytes/array sizes, valid strings.
3. Semantic consistency: target language equals the requested language; exact expected set of block IDs for the chunk; no missing, duplicate or invented IDs. Whitespace-only results for nonempty prose are invalid. Length bounds catch gross expansion, not translation quality.
4. A successful compare-and-set accepts the result once. Identical retries return the same acknowledgement; conflicting second submissions are rejected.

On invalid output, return machine-readable validation errors to the model for **one bounded repair attempt** within the original budget. If it still fails, emit `INVALID_RESULT`. An ordinary final chat response without an accepted submission emits `NO_RESULT`. Do not scrape JSON out of Markdown or “repair” it with arbitrary string heuristics. A refusal, empty stream, context overflow, timeout, and authentication failure each have explicit result errors.

Schema validation guarantees structure, not meaning. Translation quality needs independent checks and user-visible Original/Translation comparison. Do not claim that a syntactically correct JSON result proves the translation is good.

### Provider adapters

Keep the action protocol independent of provider response formats:

- Preferred baseline: reliable schema-defined tool calling plus the private submission tool. The server still validates every call.
- Native constrained structured output can be an adapter optimization, fed through the **same** acceptance function; do not depend on it across all providers.
- Providers without a supported structured-result path are **unsupported for this action**. Show a compatible-provider choice before starting. Never silently switch providers or transmit page content elsewhere.
- Reuse model/provider resolution and cancellation infrastructure, not the general chat tool assembly. In the inspected code, `AiSdkAgent.create` merges browser, filesystem, scheduler, memory and external tools and loads memory/context. A translation runner must not inherit those defaults.
- ACP/external harness providers need an explicit capability check: can tools, context, workspace access and termination be constrained for this invocation? If not, they cannot back managed transform actions in v1. A prompt telling an unrestricted harness to behave is insufficient. Keep that limitation visible while adding a tested dedicated adapter later.

For a multi-step agent action, install the declared allowlisted tools plus this same terminal result tool. It can research or prepare a draft within scope and ultimately submit a typed result. External writes still go through the existing trust gate. Neither “read-only tool” metadata nor the model's claimed intent can grant extra authority.

## 5. Harness event protocol and delivery

Proposed transport: an authenticated `POST /layers/invocations` returns `{ invocationId, status, nextSequence }`; `GET /layers/invocations/:id/events?after=N` streams application events, with a status/snapshot read for reconnect; `POST /layers/invocations/:id/cancel` is idempotent. The extension broker forwards a restricted event subset over a runtime port to the specific originating document. The web page never gets the sidecar endpoint or credential.

Do not reuse the full chat transcript stream as a rendering protocol. Define a discriminated event union:

```ts
type TranslationResult = {
  schema: 'pane.translation.v1'
  targetLanguage: string
  blocks: Array<{ blockId: string; translatedText: string }>
}

type LayerEventPayload =
  | { type: 'accepted' }
  | { type: 'progress'; completedBlocks: number; totalBlocks: number }
  | { type: 'result'; chunkId: string; data: TranslationResult }
  | { type: 'approval-required'; approvalRef: string }
  | { type: 'completed'; chunkCount: number }
  | { type: 'failed'; code: string; retryable: boolean }
  | { type: 'cancelled'; reason: string }

type LayerEvent = {
  protocol: 'pane.layer-action.v1'
  invocationId: string
  sequence: number
  layerVersion: string
  instanceId: string
  documentId: string
  routeEpoch: number
  snapshotId: string
  payload: LayerEventPayload
}
```

Envelope fields, progress counts, chunk IDs, user-facing error descriptions and terminal events come from the server, never from model narration. For tools requiring approval, the event contains a reference; approval details and controls live in trusted Pane UI. A Layer receives status, not an approval credential.

The service worker is a delivery coordinator, not a process whose lifetime we assume. The server owns execution. If the worker suspends or a port disconnects, the runtime requests a status/cursor catch-up when it reconnects. The server keeps bounded validated payloads/event replay in memory for a proposed 30 minutes from completion, plus durable minimal status metadata. No raw payload persistence by default. Replay expiry returns `RESULT_EXPIRED`, not a new model run. A sidecar restart marks unfinished local invocations interrupted; restart is not automatic resubmission. Provider cancellation is best effort and may not undo already-incurred cost.

Consumers apply each `(invocationId, sequence)` once; gaps trigger replay/status, duplicate events do nothing. A terminal result snapshot can replace missing prior events without replaying DOM effects twice. Any version, instance, document, route or snapshot mismatch rejects delivery to the page. Additionally check current block fingerprints and entity identity immediately before rendering; the same URL/document is not sufficient on a changing feed.

For long articles, the server partitions a frozen snapshot into bounded chunks and runs them under one global deadline/token budget. Each chunk is a complete schema-validated unit. Render only sealed chunks, never partial JSON tokens. Display real completed-block progress. `completed` is emitted only when every required chunk has been accepted. On failure, already translated blocks remain explicitly labeled **Partial translation**, with unprocessed blocks readable in the original. A retry targets only failed chunks of the same still-valid snapshot. Limit chunk concurrency; budget reservations prevent parallel runs overspending the total.

Terminal state precedence is compare-and-set: cancellation/invalidated target cannot be undone by a later model response. Dismissing/disabling immediately suppresses rendering while server cancellation propagates. Closing the sidepanel is not cancellation. Switching to another tab does not retarget or cancel a valid existing document; navigating that document invalidates it.

## 6. Rendering details

Default translation is additive: show translated blocks adjacent to the corresponding original region, with Original/Translation controls. Managed renderer uses text nodes and packaged components, not `innerHTML`. Keep site-owned DOM and original values intact. A user may choose replacement-style presentation later only where controlled restoration is reliable.

Version 1 translates readable text blocks and retains access to the original rich formatting/links. It does not promise pixel-identical reconstruction of arbitrary inline markup. If inline link/emphasis preservation is needed, capture a typed token tree with immutable link IDs/allowlisted hrefs, and validate the returned token references. Do not ask the model to reproduce arbitrary HTML.

Each injected control/result owns a runtime resource record. Namespaced styles and a shadow root limit style collisions; surrounding page layout and overlapping elements still need measurement. No focus stealing; buttons have accessible names; working/error states announce via a bounded live region. Handle RTL output, text expansion, scrolling, zoom, responsive width, and mobile-sized layout. Never cover the site's main controls with a floating overlay by default.

On re-render, a block with changed source text becomes stale; do not display a stale translation as current. If the article entity changes, invalidate the entire snapshot. If a node is replaced with semantically equivalent content, reattach only after the known anchor/entity/source fingerprint checks succeed. Otherwise show **Page changed — translate again**. Do not trigger another paid run automatically.

## 7. Exactly where the user sees it

| Surface | Responsibility | Behavior |
| --- | --- | --- |
| **Dedicated toolbar button beside the address bar** | Discover/manage the current site's Layers | Always available on eligible web tabs, quiet when none exist; count of mounted Layers, distinct needs-attention state. Click opens current-site popover. No chat required. |
| **Anchored site popover in browser chrome** | Quick controls | Site name, active Layers/toggles, Show original, Pause on this site, Add a layer, Manage all. Action status may be shown here. |
| **The website itself** | The customization and its immediate result | Translate button beside the article; follower badge beside its author; collapse placeholder where content was hidden; local progress/retry. |
| **Pane sidepanel** | Creation, editing, substantial/private results, activity and approvals | Add/Edit opens a Layer-focused composer with the tab explicitly attached. Successful simple actions do not force it open. Clicking Details opens the run; approval status asks the user to open the trusted review. |
| **Full-page Layers library (`#/layers`)** | Cross-site management | Search, settings, versions, repairs, permissions and diagnostics. |

The button is **beside** the address field in the toolbar, not part of editable URL text and not an injected imitation of browser chrome. Keep the existing Ask Pane toolbar action separate. Reuse the same site-controls view model for popover and sidepanel; do not create two preference stores.

Native shell direction: add a browser action/controller through the fork's toolbar action infrastructure; host the site popover as a browser-owned bubble with an extension-owned trusted view for shared React controls. The existing extension action already opens Pane, so a second independent persistent toolbar affordance requires native work. Do not pretend `default_popup` alone adds a second action.

Inspected integration areas: Chromium `browser_actions` / action IDs and the checked-in `pinned_toolbar_actions_container` patches; `chrome/common/extensions/api/browser_os.idl` and its C++ implementation for a minimal Pane-extension-only bridge; WXT entrypoint for the trusted controls; existing sidepanel app for authoring/details. Exact new C++ class/file names and hosting mechanics must be resolved against the patched source during L0, not guessed from a version-independent Chromium recipe.

Proposed bridge operations: publish current tab's bounded Layer summary, open site controls, forward a typed command to the extension runtime, and report unavailable/disconnected status. Authorize only Pane's known bundled extension. Native controller derives profile/window/tab/document itself, validates revision, and resets state on navigation. It must not allow an arbitrary extension or page to publish a fake count or use the bridge as a new automation API.

When the active tab changes while the popover is open, rebind its displayed site and controls atomically; a queued click carrying the old view revision fails rather than applying to the new tab. Multiple windows maintain independent active-tab models. If the server is down, the extension cache still serves local controls. If the extension is unavailable, display **Controls unavailable**; add a browser-owned recovery pause flag checked by runtime bootstrap so a reload can start without Layers. This flag should not disable the entire Pane extension or terminate unrelated agent work. Advanced JS already running still requires clean-document recovery.

A single agent action state is shared across its in-page button, popover summary and optional sidepanel detail. Closing any UI does not destroy the run. Pending approvals are visible but cannot be granted from shared-DOM page content. Browser-native controls remain reachable when a site is fullscreen or hostile through normal browser fullscreen/toolbar access; document exact platform behavior in native tests.

This revises the first proposal: sidebar-only controls are suitable for early dogfood, but the native button is a beta release gate.

## 8. How the authoring agent proves a Layer works

### Product-owned verification harness

Add `layer_test` and `layer_inspect_runtime` to the proposed authoring tools. `layer_test` accepts an immutable draft version, a target binding, an environment mode, and a bounded acceptance specification. It returns a receipt produced by the test runner, not an agent-written `{ passed: true }`.

The harness has independent observations: known managed-runtime resource state, actual page accessibility/DOM state, browser-driven interaction, request/event diagnostics and screenshots. A script's own success log is never sufficient evidence. For browser interactions, reuse Pane's existing `snapshot`, `act`, `screenshot`, `navigate` and bounded `evaluate` capabilities under the authoring task's grant. Do not expose these full authoring tools to the translation invocation.

### Required creation loop

1. **Define acceptance before generating code.** Convert user intent into checks: where the control belongs, when it appears, what clicking does, what should be preserved, and what persistence means. The agent proposes checks; the harness adds mandatory independent lifecycle/trust checks. The agent cannot remove mandatory checks to make a draft pass.
2. **Record a baseline.** Capture the relevant accessibility subtree, small region screenshot, layout/focus/scroll evidence, matching scope and bounded original-region fingerprints. Do not log form contents or take unnecessary whole-page snapshots.
3. **Validate offline.** Schema/program/size limits, renderer bindings, missing action/schema references, match examples, incompatible capabilities, prohibited managed operations, runtime compatibility and explicit test budget. Source scanning is advisory for arbitrary JavaScript, never a proof of safety.
4. **Mount a transient preview.** Bind a preview-only registration to the intended document; production activation stays untouched. Inspect exact mount count, accessible button name, anchor distance/visibility and whether site content is occluded. A button present offscreen or beneath another element does not pass clickability.
5. **Exercise it through browser input.** Snapshot → click the actual button → observe the handler, accepted invocation, progress, validated result and final DOM. Calling a renderer function directly is not a click test. An occluded target fails rather than falling back to synthetic JS `.click()` and declaring success.
6. **Inject controlled result/failure cases.** Use fixture-mode adapters for valid output, invalid schema, duplicate/unknown block IDs, delay, cancellation, timeout, out-of-order events, permission denial and stale source. These test the same broker/renderer code with test-scoped authority and no external effects. Test adapters are unavailable to normal pages and production invocations.
7. **Verify real action integration separately.** For translation, run one small, live, bounded model transformation when existing task authorization and provider/data grants cover it. A mock-only run is labeled mock-only. For external writes, use a draft/dry-run/sandbox; never submit a real post/payment merely to test a Layer. If safe live verification is unavailable, record it as not tested rather than silently substituting a mock.
8. **Test revisit behavior.** On a disposable test tab, reload and navigate within/outside scope; exercise SPA route changes and remounts. Use controlled fixtures for login/logout, BFCache, server restart and hostile-page tests. Never reload the user's editing tab to prove persistence. Duplicating a tab does not guarantee equivalent unsaved app state or permissions; report that distinction.
9. **Verify disable/cleanup.** Disable the Layer and inspect removal of owned nodes/listeners/observers and cancellation of work; verify the site remains usable, original content present, focus/scroll reasonable and other Layers preserved. Do not require the entire dynamic page to hash-identically match a baseline.
10. **Bound repair and retest.** At most two automatic draft-repair iterations for one authoring attempt, within a total test/model budget. Changes create new versions and rerun affected tests. Show unresolved failures, keep the old active version, and stop escalating selectors or permissions to make the test green.
11. **Activate the tested version.** Activation checks a harness-produced receipt tied to its exact source/program hash, action/schema hashes, scope, grants and runtime version. Perform a lightweight post-activation mount check. Do not promote a subsequently edited untested draft using a stale receipt.

### Evidence and truthful status

```ts
type LayerVerificationReceipt = {
  receiptId: string
  layerId: string
  versionHash: string
  actionSchemaHash: string
  scopeHash: string
  grantPolicyHash: string
  runtimeVersion: string
  environment: 'fixture' | 'live-page' | 'mixed'
  testedAt: string
  checks: Array<{
    id: string
    status: 'passed' | 'failed' | 'not-tested' | 'not-applicable'
    evidenceRefs: string[]
    reason?: string
  }>
  coverage: {
    visualPlacement: boolean
    actualClick: boolean
    liveProvider: boolean
    safeRevisit: boolean
    restoration: boolean
  }
}
```

Treat this as a point-in-time receipt, not certification for every future page. Mandatory platform tests run in CI independently of per-Layer authoring. Per-Layer managed activation requires valid definition, expected mount and safe cleanup; action-bearing Layers also require their fixture contract/click checks. A missing safe real-provider or site revisit check is explicitly shown as **Partially verified** and is not called fully tested. Users may keep that Layer within existing grants; production capability and schema failures cannot be waived by an agent.

Suggested receipt: **“Button placement checked. Click and result rendering checked. Live translation checked on this article. Revisit checked in a separate tab. Original view restored.”** Never invent these statements if a check was skipped.

Evidence may contain private page content. Keep cropped images and bounded snapshots local with short retention, do not upload by default, and expose a clear delete path. Baseline/rerender checks must account for ordinary site mutation to avoid misleading false failures.

## 9. Failure matrix and acceptance expectations

| Situation | Required behavior | Verification |
| --- | --- | --- |
| Double-click Translate | Reuse one in-flight invocation for the same action/snapshot; an explicit later refresh can start another | Actual rapid clicks plus broker concurrency test |
| User changes target language during run | Cancel/supersede old invocation; new generation; old result cannot replace new language | Delayed first result arrives last |
| User changes tabs/windows | Continue only for original live document; never use new active-tab ID | Two different pages with equal-looking anchors |
| Same URL now shows a different record | Entity/snapshot check invalidates result | Virtualized feed node and SPA record reuse |
| Page text changes during translation | Affected block becomes stale; preserve original; explicit retry | DOM mutation while provider is delayed |
| DOM changes but article text stays the same | Reattach only if bounded anchor/entity checks still identify the same content | Framework remount and duplicate article region |
| Layer turned off/deleted/updated mid-run | Immediate local removal; revoked generation; no late application | Turn off at each run state |
| Sidepanel closes | Run continues with in-page status | Close sidebar after clicking |
| Worker suspends or port disconnects | Resume from status/event cursor; no duplicate DOM insertion or model call | Suspend delivery, complete server work, reconnect |
| Server crashes or result expires | Mark interrupted/expired; original readable; explicit rerun | Restart/TTL fixture |
| Partial translation then timeout | Label partial, preserve originals for remaining blocks; bounded retry missing chunks | Fail second chunk |
| Model returns prose, invalid JSON shape, wrong IDs or a refusal | One bounded schema repair where applicable, then typed failure | Adversarial provider fixtures |
| Model returns valid but bad translation | Original comparison and user feedback; no structural test claims semantic correctness | Curated multilingual evaluation/manual review |
| Unsupported model/harness | Explain compatibility; user chooses supported provider | No silent fallback or full-tool session launch |
| Credential/account changes | Invalidate connection/account cache namespace and outstanding grants; no cross-account reuse | Two-account fixture |
| Anchor absent/ambiguous | Waiting/not applicable/needs update; do not guess dangerous target | Login screen, A/B layout, duplicate headings |
| Hydration removes injected root | Bounded retry only after stable anchor check; pause after repeated churn | Hostile/remount loop |
| Two Layers collapse the same block | Ownership count preserves collapse until both release | Enable/disable in both orders |
| Renderer error or oversized result | Isolate that Layer, show recoverable error, preserve page | Large/recursive/malformed payload fixtures |
| RTL, zoom, translated text expansion | Reflow, readable controls, retained focus and original view | Arabic/Hindi/German fixtures; narrow/wide/200% zoom |
| Closed shadow roots, cross-origin frames, PDF/canvas-only page | Explicitly unsupported initially or supported accessible-text fallback; no false success | Ineligible target fixtures |
| No network or battery pressure | Local changes keep working; expensive work defers/fails visibly | Offline and background tab tests |
| Browser extension update | Reconcile definitions/versions before actions; no duplicate mount; reject old protocol if incompatible | Extension-update lifecycle suite |
| Malicious page or advanced script calls broker | Reject forged sender, instance, capabilities, replay; no secrets/approvals from DOM | Dedicated security suite |
| Native popover switches sites mid-click | Command bound to old view revision rejected | Two-window/tab-switch native test |
| Advanced JS loops or changes untracked DOM | Native recovery pause + explicit clean reload; no guarantee of in-document rollback | Disposable renderer stress test |

## 10. Changes to the implementation work breakdown

- **L0:** settle native action/bubble hosting, secure broker bootstrap and provider capability matrix; prototype private typed submission with one compatible provider. Write protocol schemas before authoring tools. A schema demo is not itself the security gate.
- **L1:** instance identity, revisioned manifest/cache, resource ledger, native summary view model and managed lifecycle test fixtures. Start native controller work early even if dogfood uses the sidebar.
- **L2:** `layer_test`, `layer_inspect_runtime`, independent acceptance checks, evidence/receipts, safe test-tab workflow and bounded repair. Creation is not complete on source generation.
- **L3:** dedicated action runner, private submission adapter, strict semantic validation, event/status/replay endpoints, streaming reducer, translation renderer and live-provider test.
- **L4:** same typed-result bindings for data actions; account-aware caching and rate limits. Data results do not need an LLM unless their action explicitly declares a transformation.
- **L5:** native button/popover, library/sidepanel integration and the full lifecycle/provider/accessibility/security release matrix. Record tested platforms/provider combinations and unsupported cases.

Proposed additional implementation files under `packages/browseros-agent/`: shared `layers/action-protocol.ts` and `result-schemas.ts`; server `layers/action-runner.ts`, `result-acceptance.ts`, `invocation-events.ts`, `provider-capabilities.ts`, `verification.ts`; extension `lib/layers/result-reducer.ts`, `capture-registry.ts`, `runtime-ledger.ts`, and `renderers/translation.ts`; a trusted controls entrypoint and native bridge adapter. Add native files only after identifying the actual Chromium action integration points.

### Remaining feasibility work, stated explicitly

This document defines the intended interfaces and behavior. It does not prove the native bubble hosting, authenticated broker bootstrap, or structured-tool compatibility of every configured provider. Those are L0 experiments. Generalized selectors and good translation on arbitrary sites cannot be guaranteed by architecture; bounded matching, meaningful tests, visible failure, and repair are part of the product. Record new edge cases as regression fixtures when discovered instead of claiming an exhaustive list in advance.
