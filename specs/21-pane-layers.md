# 21 — Pane Layers

**Status:** proposed product and implementation plan; no runtime implementation in this change.  
**Date:** 2026-09-07.  
**Decision:** make persistent, agent-authored website customizations a first-class Pane capability.  
**Working brand:** **Pane Layers** — **Make any website work your way.**

**Engineering follow-up (2026-09-08):** [Runtime contracts, UI ownership, and authoring verification](./21-pane-layers-runtime-contract.md) specifies action request/result schemas, provider adapters, document-bound event delivery, native site controls, and the agent's test protocol. It is part of this proposal, not implemented functionality.

## 1. Product definition

A Layer is a saved customization that Pane applies whenever you visit matching pages. Ask for the change in natural language, see it on the actual page, and keep it. Manage it from the current site's Layers control or a central library.

The agent authors and repairs the customization. A small deterministic runtime applies it. Opening a page does not require an agent turn. Some layers add buttons that invoke a bounded agent task; others change presentation or load data from a permitted source.

Examples:

| User request | What persists | What happens on a visit | What needs an agent |
| --- | --- | --- | --- |
| “Hide the recommendations on this site.” | A scoped collapse rule | Recommendations collapse, with a Show control | Creation and requested repair only |
| “Always put a Translate button next to articles.” | An anchored button and translation action | The button appears | Translation when clicked |
| “Show follower counts beside feed authors.” | Entity extraction, a data source binding, a badge renderer | Visible authors resolve through cached/batched data | Creation; no model needed for routine lookups |
| “Add a ticket button to this internal dashboard.” | An action bound to the current record | The button appears | Drafting; actual external writes use the existing trust gate |

These are composable capabilities of one Layer, not separate products. One Layer may combine presentation, data, and agent actions.

### Relationship to the rest of Pane

- **Sites / Personalised Internet:** pages Pane creates for you.
- **Layers:** changes Pane adds to websites you already use.
- **Skills:** instructions the agent can use while creating a Layer or executing an action.
- **Tasks:** agent work initiated by a Layer can have a task and activity record; merely mounting a Layer is not a task.

This refines [16 — Page Reshape & Overlays](./16-page-reshape-and-overlays.md). It recommends an explicit, user-authored platform before proactive personalization or learned feed classification. Preserve [20 — Personalised Internet](./20-personalised-internet.md)'s separate document renderer; do not inject arbitrary website scripts into PI pages or reopen PI's HTML restrictions.

## 2. Branding and presentation

| Candidate | Assessment |
| --- | --- |
| **Layers** | Recommended. Describes adding personal behavior to an existing site, supports multiple independent changes, and implies reversibility. |
| Mods | Technically clear and short; more developer/gaming oriented. Suitable informal terminology, less suitable primary UI. |
| Actions | Good name for buttons inside a Layer; does not cover persistent visual changes. |
| Reshape | Useful internal history; suggests a whole-page transformation and reads awkwardly as a countable saved object. |
| Boosts | Already used by Arc for website customization; avoid borrowing an established competitor feature name. [Arc's description](https://start.arc.net/paint-the-internet) |

Use **Layers** in navigation, **Customize this site** at discovery, **Add a layer** in management, and **Keep on this site** for persistence. Name individual Layers by outcome: “Translate articles,” “Quiet feed,” “Author follower counts.” Keep “script,” permissions jargon, and source code in details/advanced views.

Suggested introduction: **“Tell Pane what you'd change. Keep it every time you visit.”**

Use a stacked-layers icon and the existing Pane accent sparingly. A small Pane attribution on added controls identifies authorship; it is not a security boundary. Do not theme a payment confirmation or other consequential control to impersonate the host website.

This is a working product name, not a trademark-clearance claim. Validate whether users understand “Layers” during first-use tests.

## 3. The UX

### 3.1 Create on the page

1. On an ordinary website, choose **Customize this site** from the sidepanel's current-tab area. Also accept normal chat requests. Add an element-picker entry point for “Hide this” or “Add a button here.”
2. Pane inspects the relevant DOM, page route, and existing Layers. For a specific element, capture several anchor signals instead of only a CSS selector. Inspection starts with that region, not the entire browser history or workspace.
3. Pane creates a draft, validates it, and previews it in the current document. An example receipt: **“Adds a Translate button beside article titles. Appears on example.com/articles/*. Uses your selected model when clicked.”**
4. The preview offers **Keep on this site**, **Adjust**, and **Discard**, with the proposed scope visible. Compare with the original without losing unsaved site state.
5. Keeping activates a version and immediately reconciles other matching open tabs. Reloading verifies that it returns. Report **“Saved · applies to articles on example.com.”**

An explicit request such as “always do this on this site” already authorizes persistence within that scope. The agent may validate and save directly, then show the receipt and Undo. Do not force a redundant Keep click. A one-time “hide this” request previews a temporary change and offers persistence. Previously granted capabilities do not need repeated approval on every visit; new data destinations or expanded capabilities get a specific review.

Preview applies only local reversible behavior by default. It does not trigger automatic paid/model/API calls just by being rendered. A user can click the proposed action to test it using the same authorization and disclosure rules as an installed action.

### 3.2 Control the current site

Primary product entry point: a dedicated **Layers** button in the browser toolbar immediately beside the address bar, opening a compact current-site popover without opening chat. Keep a **Layers · 2** chip in the sidepanel's current-tab header as a secondary entry point. Preserve the existing toolbar action that opens Pane. An extension-only sidebar entry is acceptable during L1–L4 dogfood; the native button and popover are an L5 beta release requirement. The [runtime companion](./21-pane-layers-runtime-contract.md) specifies surface ownership and native integration work.

The site panel displays:

```text
Layers                                      example.com
2 active here

Translate articles                          [on]
Articles · Uses your model when clicked

Hide recommendations                        [on]
This site · No agent needed

+ Add a layer
Show original                         Pause on this site
Manage all layers
```

Each row has a toggle and details: scope, capabilities, settings, recent activity, Edit with Pane, version history, and Delete. A layer can be enabled but **Not used on this page**, **Waiting for content**, **Needs connection**, **Paused after errors**, or **Needs an update**. Do not represent all of those as a generic green enabled state.

- **Toggle off:** persistently disable that Layer; remove managed effects from all affected live documents; cancel its in-flight work.
- **Show original:** temporarily suspend all effects and new requests in this tab. Keep enabled preferences intact. Remain in original view through same-tab navigation until resumed or the tab closes; disclose that persistence in the control label/details.
- **Pause on this site:** persistent origin-specific override, including Layers whose match scope is broader. Existing layer toggles remain saved.
- **Delete:** disable first, remove active registration and local stored data, with a short Undo window where appropriate. Delete is not the same as turning off.
- **Advanced JavaScript:** if cleanup cannot be guaranteed, offer **Reload to fully remove changes**. Never automatically reload a page with unsaved work.

### 3.3 Scope

Offer **This page**, **Pages like this**, and **This site**, with the actual host/path shown. Default to the narrowest reusable scope supported by the request. A selected article suggests its article route family; hiding a global navigation item may suggest the origin.

Match exact origins unless subdomains are explicitly included. Do not silently convert `www.example.com` into every subdomain. URL query strings and fragments are ignored unless a declared route predicate uses them; exact-page identity can retain chosen meaningful parameters without persisting tracking tokens. Explicit excludes take precedence. Internal browser pages, extension pages, and non-web schemes are not eligible in the initial release.

Show example matching/nonmatching URLs in details. The displayed count means **currently mounted**, not every saved Layer for that domain.

### 3.4 Library and editing

Add **Layers** beside the existing personal-site library in app navigation, at `#/layers`. Group by website, with a flat search across names and origins. Include Enabled, Paused, and Needs attention filters, and a global pause control. A details page holds editable human-readable settings, scopes, activity, versions, and an advanced source viewer.

Editing starts from the saved intent, current version, and current page evidence. The live version stays active while the candidate is tested. Successful replacement is atomic; failed validation keeps the previous version. Repair produces a candidate and concrete change receipt. Do not run autonomous model repair on every page error or silently broaden selectors/permissions.

Keyboard controls, visible focus, readable contrast, reduced motion, zoom, localization, and screen-reader announcements are acceptance requirements. Added UI must not steal focus on mount. In-page collapse placeholders expose what was hidden and let users restore it.

## 4. Runtime and trust model

### 4.1 Two execution modes, one product object

**Managed Layers are the default.** The agent authors a typed, versioned program of supported operations: observe a region, extract text/entity keys, collapse/highlight, mount a button/badge/panel, invoke a named data operation, or invoke a named agent action. A packaged interpreter executes that program. No model-authored code runs in the privileged extension world. This covers the three requested examples when a valid data source exists.

**Advanced JavaScript Layers provide the general userscript escape hatch.** The agent can author stored JavaScript for page logic beyond the managed operations. Run it in a separate `USER_SCRIPT` world per Layer, never in the privileged extension content-script world and never in `MAIN` in the initial advanced release. Show “Can read and change matching pages” when enabling it. Full Tampermonkey import/API compatibility is a separate later project.

Chrome's userScripts API provides runtime registration, distinct user-script messaging, configurable worlds, and a user enablement setting. Script registrations must be restored on extension update. Pane's checked-in Chromium version is 148; prove API availability and enablement behavior in the actual bundled extension. [Chrome userScripts reference](https://developer.chrome.com/docs/extensions/reference/api/userScripts)

**Important boundary:** isolated JavaScript worlds share the DOM. Arbitrary DOM JavaScript can read page data, change forms, synthesize interactions, and potentially leak data through page-visible channels. A scoped API wrapper, CSP, static scanning, or Shadow DOM does not turn it into a read-only or network-confined sandbox. Managed Layers can enforce their limited operations; advanced Layers cannot inherit those promises. [Chrome content-script model](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) and [Chromium security FAQ](https://chromium.googlesource.com/chromium/src/+/main/extensions/docs/security_faq.md)

The initial broad release should use managed mode. The implementation plan includes an advanced-JavaScript milestone with its own gate; do not describe the first milestone as full arbitrary-script support. If general JavaScript is required for day-one positioning, that milestone becomes a launch dependency.

### 4.2 Architecture

```text
Trusted Pane UI / agent authoring tools
               │ draft, preview, activate
               ▼
Profile-local Layer store + version/permission policy (server)
               │ revisioned desired-state manifest
               ▼
Extension background: policy cache, registrations, broker, reconciliation
          ┌────┴─────────────────────────┐
          ▼                              ▼
Managed content runtime             Advanced USER_SCRIPT world
packaged interpreter                stored agent/user JavaScript
          │                              │ restricted broker requests
          └──────────────┬───────────────┘
                         ▼
Action/data broker → scoped server run → existing trust/model/connectors
                         │ typed result, bound to originating document
                         ▼
Managed renderer / trusted Pane result surface
```

Use content scripts and extension registration for normal document startup, not CDP evaluation on every navigation. Existing CDP browser tools remain useful for authoring, inspection, and verification. No active agent session is required to apply saved local effects.

Do not couple Layer activation to capture, memory, a context bucket, a model connection, or the PI refresh scheduler. Layers belong to a browser profile. Optional context inputs are explicit per action.

### 4.3 Capability enforcement

Declare page scopes separately from data destinations and action permissions. Managed capabilities include `page.readText` for named regions, `page.collapse`, `page.decorate`, `storage.local`, named data reads, and named agent actions. Exclude password fields, editable/form values, hidden authentication material, arbitrary HTML, scripts, event-handler attributes, remote code, and arbitrary style URLs from managed inputs/programs.

The broker checks every request against the active version and grants, independently of what a script claims. Requests bind profile, Layer/version, tab, frame, document, route generation, action ID, invocation ID, and expiry. Validate actual extension message sender metadata. Neither the page URL nor a supplied Layer ID is authority. Keep per-instance credentials inside the isolated context; never put them in DOM attributes, URLs, or `postMessage` payloads visible to the page. Advanced mode requires a proven credential bootstrap; `worldId` alone is not sender authentication.

The server validates a broker credential bound to profile and permitted operations. CORS checks and an `X-BrowserOS-Profile-Id` header are not authentication. Bind broker enrollment to the installed Pane extension through the existing trusted browser/sidecar channel if it supports this, or implement explicit secure pairing. Investigate this first; do not mint credentials for any origin that happens to have an extension scheme or localhost address.

Credentials for external APIs stay in the server's connection layer. A page gets only approved response fields. Server requests use named operations or explicit HTTPS origin/path/method policy, with request/response size limits, timeouts, rate limits, redirect revalidation, and private-network/loopback protection. Local/intranet APIs require a distinct user-granted destination; default denial must not prevent deliberate internal-tool use.

Shared-DOM output is observable by the website. Keep private workspace/model context and confidential results in Pane's trusted sidepanel unless the user has chosen to place those results on the website. Shadow DOM provides styling encapsulation, not confidentiality.

### 4.4 Agent actions

A Layer button references a versioned action definition; it never sends arbitrary code to the server. Resolve its prompt template and tool allowlist from the store, validate bounded inputs, and create a cancellable run. Treat page content as untrusted data, never instruction authority. Tool scope, data destinations, context inputs, steps, tokens, and timeout come from the action policy, not the page text.

Translation uses a transform action: selected article text in, typed translated blocks out; no browser-control, filesystem, or external-write tools. Broader agent actions can reuse the existing agent runner and trust gate with a reduced tool set. The existing PI `/actions/invoke` returns an agent run hint; it is not an already-built secure Layer action executor.

A saved button authorizes its described bounded behavior, not unrestricted future agent work. Known harmless actions run without repeated prompts. Consequential operations follow existing session grants and action-level approval behavior in trusted Pane UI. A script-supplied “user clicked” flag and DOM `isTrusted` alone are not sufficient evidence for authorizing external writes.

Show idle, working, completed, cancelled, and actionable failure states beside the control; link to task details in Pane. Dedupe double-clicks. Cancel when disabled, when its document/route changes, or when a preview is discarded. Never inject late results into a different record or page. Do not retry external writes automatically after uncertain completion.

### 4.5 Privacy and cost

The runtime and saved definitions are local; calling a remote model or API transmits selected data. Correct the old spec's conflicting “no page content leaves the machine” / BYOK statement before implementation. Show the actual provider and data category, and honor local-model-only preferences.

Local presentation applies without a model or a server round trip. Agent work is click-triggered by default. Automatic data reads require a saved explicit grant, visibility gating, caching, and a request budget. Automatic model work is a later separately enabled behavior, with a per-Layer ceiling and an obvious stop control.

Store minimal activity metadata, with a proposed default retention of 7 days for local diagnostics; do not retain raw page snapshots or model inputs by default. Incognito is off in v1. Neither cross-device sync nor a public script gallery is required for local completeness.

## 5. Lifecycle, storage, and reliability

### 5.1 Durable records

Use profile-scoped SQLite as the authoritative store initially; avoid a second writable file authority. Export readable bundles on demand. Large immutable source blobs can move to content-addressed files later if size warrants it.

| Record | Fields and rules |
| --- | --- |
| `layers` | ID, name, original intent, origin/scopes/excludes, enabled state, active version, settings, timestamps, optional creation conversation |
| `layer_versions` | Immutable version ID, mode, managed program or JS source, manifest, source hash, runtime compatibility, requested capabilities, validation receipt, parent version |
| `layer_grants` | Layer/version policy digest, permitted sites, action/data capabilities, provider/destination identity, grant time and revocation generation |
| `layer_site_overrides` | Origin-specific pause; takes precedence over Layer enabled state |
| `layer_kv` | Namespaced, quota-limited per-Layer local state; separate from credentials |
| `layer_runs` | Action/version, status, dedupe key, originating document binding, bounded diagnostics, optional existing agent run reference |
| `layer_data_cache` | Profile/connection/account/operation/entity key, response subset, freshness and expiry; avoid cross-account leaks |

Browser extension storage holds the last acknowledged executable manifest, immutable programs, and local disable tombstones. It is a derived runtime cache, not an independent authoring database. Persist a monotonically increasing desired-state revision and acknowledgements.

Activation transaction: validate version and scope → persist version/grants and desired active version atomically → notify background → apply registration/runtime changes → acknowledge actual status. On partial failure, expose **Saved, not applied yet**, retry reconciliation idempotently, and keep the last safe version or disable. Never report success merely because a database write succeeded.

Disabling takes effect locally immediately even if the server is down. Record a tombstone/revocation generation so reconnect cannot re-enable a stale version. Re-enable waits for authoritative policy reconciliation. Activation/update swaps an entire version; the broker rejects stale-version action invocations. Uninstall revokes first, then removes registrations/cache and durable data.

### 5.2 Navigation and page identity

Use a dedicated background lifecycle module with `webNavigation` document/history/fragment events plus content-runtime readiness and bounded DOM observation. Do not depend on capture events. Each runtime instance uses `(profile, tab, frame, document, layer, version, routeGeneration)` identity.

- Handle reload, redirects, already-open tabs, duplicate tabs, back/forward, same-document route changes, BFCache restore, prerender activation, browser restart, extension update, and tab discard/restore.
- Mount once per eligible instance. Reconcile on route changes; remove effects when a route stops matching. Registration for an origin may be broad enough to detect SPA transitions; the runtime must enforce the finer path/query rule before reading or applying anything.
- Start managed runtime at document readiness; allow precompiled safe hiding styles earlier only after flash/layout testing. Default advanced JS to document idle; expose earlier execution as a reviewed advanced option later.
- Default to the top frame. Cross-origin frames, blank/srcdoc frames, and special document viewers are unsupported initially and shown honestly. Add frame support only with explicit frame scope and policy tests.
- During browser/server startup, last acknowledged local Layers continue to work. Action controls show a reconnect state while the broker/server is unavailable.

### 5.3 DOM anchoring and cleanup

Prefer semantic roles, labels, stable attributes, relative anchor structure, and a bounded fallback set. Avoid generated class names, positional selectors, and whole-document polling. Missing/ambiguous anchors produce a no-op and a useful status, not a guess at a nearby destructive target.

Observe the smallest stable container. Process visible feed items first, dedupe by entity key, and recognize virtualized node reuse: a DOM node may represent a different author after scroll. Cancel or rebind work when its entity fingerprint changes.

Managed mutations have ownership and inverse operations. Remove Pane-owned nodes/styles/listeners/observers on disable. For changes to host attributes/text, restore only values still owned by that Layer; do not overwrite a site's subsequent changes. Prefer additive translated blocks to bulk `innerHTML` replacement. Collapse rather than delete host elements.

When two Layers affect one element, maintain per-effect ownership/reference counts. Disabling one must not undo the other. Define deterministic mount order, but detect incompatible exclusive operations and surface the conflict; do not claim a universal semantic merge. Reordering host feed nodes is deferred because it complicates app state, focus, and cleanup.

Advanced scripts get SDK cleanup hooks, tracked resources where feasible, and cooperative cancellation. Unregistering stops future injections; it does not undo executed JavaScript or stop all existing timers. An arbitrary infinite loop cannot reliably be interrupted by a timeout on the same renderer thread. Recovery relies on browser-level controls and a clean document; do not promise hard isolation or seamless rollback for arbitrary scripts.

### 5.4 Failure and performance policy

Proposed starting budgets, to measure on representative hardware rather than claim as achieved:

- No model calls and no external API calls for a purely visual Layer on page open.
- Managed mutation batches target under 4 ms; added first-mount main-thread work targets p95 under 20 ms for five simple Layers on fixture pages. Record browser/layout work as well as JavaScript time. No recurring Layer-caused long tasks above 50 ms in the smoke corpus.
- One observer registry per document where possible; visible-first scheduling; initial defaults of two concurrent data requests per Layer and six per profile, with per-operation overrides.
- Named data reads default to 10-second deadlines and bounded responses; cache TTL is source-specific, not globally fixed. Agent actions default to one active invocation per action/document and a configured token/step/time budget.
- After three repeated runtime exceptions for the same version/origin during a session, suspend it there and expose **Needs an update**. Missing feed items or a login page are expected states, not exceptions that trigger repeated repair.
- Defer background refresh on hidden tabs, battery pressure, or disconnection. Keep cheap local Layers working. Cancel work and stop observers on teardown.

Diagnostics identify Layer/version, lifecycle stage, match/anchor failure, request status, and timing without raw page text. The site control, sidepanel, library, and global pause remain available even if page scripts misbehave. No automatic page reload on failure.

## 6. Walkthrough of the three requested use cases

### Translation button — first agentic demonstration

The agent identifies the article title/body and saves a managed button. On click, capture a bounded article snapshot, excluding forms and Pane's own UI; choose the configured target language; invoke the translation action with an explicit output schema. Render translated blocks with **Original / Translation**, preserving links and layout where supported. Keep sensitive or large results in the sidepanel if appropriate.

Use content fingerprint + target language + model/action version for result caching. Navigation, article mutation, or account change invalidates the binding. For long articles, chunk within the action's budget, show progress, and allow cancellation. A translation failure keeps the original readable. “Always show the button” does not mean “always translate automatically.”

### Hide a view — first complete vertical slice

Element picker → stable anchor → scoped collapse program → live preview → keep → reload → toggle off. This small flow exercises authoring, storage, matching, lifecycle, cleanup, and management without API or model invocation at runtime. Ship this complete loop before expanding to network-dependent examples.

### Follower counts — data-source feasibility gate

The official LinkedIn `memberFollowersCount` endpoint documents statistics for the **authenticated member** using `r_member_profileAnalytics`. It does not establish a general endpoint for every feed author's follower count; LinkedIn API access also depends on permissions and product approval. Treat arbitrary-author availability as unproven. [Follower statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/follower-statistics?view=li-lms-2026-04) and [API access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)

Resolve data through an ordered, explicit source policy: information already present in allowed page regions → an authorized connector/provider with actual field coverage → **Unavailable**. Do not guess private endpoints, promise “everyone,” or silently visit every profile in background tabs. A user-requested profile visit can be a separate bounded action; it is not an efficient feed data source.

Use stable author IDs/URLs, never names alone; distinguish people from organizations. Deduplicate visible authors, batch when the source supports it, cache with account/source/freshness keys, display freshness on demand, and distinguish unavailable from zero. Handle 401 with reconnect, 403 as unsupported/denied, 429 with backoff, and stale data with a label. Use a controlled fixture or an API the user already owns for the first general data-Layer demo. LinkedIn is a conditional adapter, not the platform's launch dependency.

## 7. Fit to the actual repository

Paths below are relative to `packages/browseros-agent/`. They distinguish inspected reuse points from proposed new modules.

| Existing code inspected | Reuse or required change |
| --- | --- |
| `apps/app/wxt.config.ts` | WXT extension already has scripting, storage, webNavigation, and broad HTTP(S) host permissions; `userScripts` is absent. Per-Layer scope enforcement must be added regardless of manifest breadth. |
| `apps/app/entrypoints/background/index.ts` | Register Layer lifecycle, cache reconciliation, broker listeners, and update recovery. Preserve toolbar sidepanel behavior. |
| `apps/app/entrypoints/glow.content/index.ts` | Existing page-injection precedent; do not reuse its bubble or styling as the Layer runtime. |
| `apps/app/entrypoints/background/piHostOpened.ts` and `captureBridge.ts` | Existing host hook is called from the capture bridge; it is not an independent navigation/matching engine. |
| `apps/app/lib/browseros/agent-fetch.ts` | Use profile-aware requests from trusted extension code; add real broker authentication for Layer endpoints. |
| `apps/server/src/lib/browseros-dir.ts` and `lib/profile-context.ts` | Profile-scoped runtime paths and DB context already exist. |
| `apps/server/src/api/routes/index.ts` and `api/middleware/require-profile.ts` | Add `/layers` to profile-required routes. Profile header validation is routing, not credential validation. |
| `apps/server/src/api/utils/request-auth.ts` | Existing origin helper accepts extension schemes/loopback broadly; do not treat it as sufficient broker identity. |
| `apps/server/src/personal-internet/tools.ts`, `write-path.ts`, and `api/routes/personal-internet.ts` | Reuse architectural patterns for typed authoring and a single mutation path. PI action dispatch currently returns hints; new Layer execution needs actual binding and enforcement. |
| `apps/server/src/agent/ai-sdk-agent.ts` and `context/register-mcp.ts` | Register Layer authoring tools in both native agent and MCP paths. |
| `packages/shared/src/trust/consequence-class.ts` and `apps/server/src/agent/trust/gate.ts` | Add explicit classifications and bounded action context. Do not copy PI materialization exceptions into Layers. |
| `apps/app/entrypoints/app/App.tsx`, `components/sidebar/SidebarNavigation.tsx` | Add library/detail routes and navigation. |

`packages/browseros/CHROMIUM_VERSION` currently pins **148.0.7778.97**. The top-level architecture document still says 146; use the pin and the actually built browser for compatibility decisions.

Proposed new modules:

```text
packages/shared/src/layers/               schemas, program types, matching, protocol
apps/server/src/layers/                   store, write path, validation, tools,
                                         grants, action runner, data broker, diagnostics
apps/server/src/api/routes/layers.ts      authenticated profile API
apps/server/src/lib/db/schema/layers.ts   records + numbered migration
apps/app/lib/layers/                      cache, managed interpreter, anchors,
                                         renderer, cleanup, broker client
apps/app/entrypoints/layers.content/      packaged managed runtime
apps/app/entrypoints/background/layers/  navigation, registration, broker, reconciliation
apps/app/screens/layers/                  library and details
apps/app/modules/layers/                  current-site controls and draft preview
apps/server/tests/layers/                 policy, storage, action and API tests
```

Keep the managed program and Layer protocol separate from PI's page-document DSL. Share safe rendering utilities only where dependencies and trust assumptions actually match. Do not create a new service/process or clone the whole scheduler for this feature.

### Tools and API contract

Agent tools: `layer_list`, `layer_read`, `layer_draft`, `layer_preview`, `layer_validate`, `layer_test`, `layer_inspect_runtime`, `layer_activate`, `layer_update`, `layer_set_enabled`, `layer_remove`, and `layer_diagnose`. Read/diagnose tools are read-class; draft and local managed activation are write-local under existing scope/grants. Tests require scoped preview/browser authority and explicit action/data budgets; they are not universally read-class just because they are called tests. New privilege grants require the policy path, not a tool-supplied boolean. External effects belong to the invoked action's consequence class. MCP callers cannot bypass draft validation, profile binding, or grant checks. See the [verification contract](./21-pane-layers-runtime-contract.md) for independent harness receipts and live-versus-fixture evidence.

Preview returns `{ layerId, versionId, previewId, targetDocument, scopeSummary, capabilityDiff, validation }`. Activation references that immutable version and validation receipt; reject mismatched/expired receipts when the page-dependent assumptions require revalidation. Source inspection and hash are integrity checks, not a proof of script safety.

HTTP surface: list/get/draft, preview/validate, activate/update, enabled/site-pause/global-pause, delete/undo, desired-state manifest with revision, runtime acknowledgements, diagnostics, and named action/data invocations with cancel/status. Use idempotency keys for activation and invocation. All mutation and broker routes enforce identity and profile policy. Document CLI/MCP activation grants before exposing external authoring.

## 8. Implementation sequence and gates

These are dependency-ordered milestones, not a delivery-date promise. They supersede the proposed Phase 9 vertical-first implementation shape only if this plan is adopted; they do not retroactively assert the old roadmap's release prerequisites are met.

| Milestone | Concrete work | Acceptance gate |
| --- | --- | --- |
| **L0 — Prove boundaries** | Probe userScripts on the actual Pane bundle, permission UX, message sender data, update behavior, and world isolation. Design authenticated extension→server pairing. Build static/SPA/hostile-page fixtures. Validate data-source options. | Written runtime ADR and demonstrable broker identity/revocation. Unknowns are resolved before privileged script bridging. |
| **L1 — Persistent local Layer** | Shared manifest, scoped SQLite store, versioned cache, managed collapse/decorate runtime, navigation lifecycle, complete cleanup, current-site toggle, minimal library, global/site pause. Use a manually supplied program first. | Hide → save → reload/restart → disable works in two profiles independently, with server off and capture off. No model/network on mount. |
| **L2 — Agent authoring and preview** | Register tools in agent + MCP, DOM anchor capture/picker, draft validation, independent `layer_test`/runtime inspection, verification receipts, explicit-persistence handling, version replacement, Edit with Pane, bounded repair and rollback. | Natural-language hide request produces a working durable Layer; activation references evidence for that exact version; failed edits leave the old version intact; wider scope cannot slip through silently. |
| **L3 — Agentic buttons** | Named action definitions, bounded runner, document binding, cancellation/dedupe, cost/provider UI, trusted approvals, translation renderer/cache. | Translation button appears after restart; click translates; original survives failures; forged requests and stale results are rejected. |
| **L4 — Data Layers** | Connector/HTTPS operation policy, credential isolation, entity extraction, visible-first batching, account-aware cache, 401/403/429 states. | Controlled data enrichment fixture works end-to-end with zero routine model calls; destination/redirect/account-isolation tests pass. |
| **L5 — Managed beta release** | Ship the native Layers button/current-site popover; finish library/settings/history, accessibility, lifecycle/performance tests, diagnostics and staged rollout. Bundle browser + server + extension through normal release process. | Two complete user demos (hide and translate), one controlled API demo, no known critical trust/lifecycle failures; controls work with the sidebar closed; kill controls tested. |
| **L6 — Advanced JavaScript** | Store/edit/preview JS, add userScripts permission/enablement UX, per-Layer worlds, authenticated capability bootstrap, restricted named-action bridge, cleanup API, explicit full-page trust receipt. | Hostile-script and cross-Layer tests, revocation while running, restart/update recovery, honest reload recovery, and separate user comprehension review. Required before claiming a general userscript engine. |
| **L7 — Expansion** | Verified site adapters, import/export, later GM compatibility, sharing with review, optional context-aware actions. | Each capability has its own source/access and trust gate; no automatic remote script updates. |

After L0/L1, UI and authoring can be developed against the stable shared protocol while action/data work proceeds. Integration still follows the gates above. The plan does not require starting several agents or separate Codex tasks now.

**Recommended first coding task:** implement L0 plus the L1 hide-and-restore slice. It exposes the hard persistence, lifecycle, isolation, and UX issues without waiting on a provider-specific API. Do not begin with a script editor or a marketplace.

## 9. Verification and rollout

| Test group | Required evidence |
| --- | --- |
| Matching | Scheme/host/port boundaries, exact host vs subdomain, path family, query/hash predicates, excludes, ineligible schemes, lookalike hosts, pause precedence |
| Lifecycle | Full/SPA navigation, route exit/reentry, BFCache, prerender activation, multiple tabs, virtualized content, restart, service-worker suspension, extension update, server reconnect |
| Reversibility | Unsaved form state survives managed preview/disable; owned effects removed; other Layers/site updates preserved; advanced reload state is explicit |
| Security | Forged page messages, guessed/replayed IDs, cross-Layer/profile requests, revoked/stale credentials, hostile inputs/results, prompt injection, private-network redirects, credential non-exposure, arbitrary HTML rejection |
| Actions/data | Double-click dedupe, cancellation, navigation during streaming, budget cutoff, offline/provider error, account switch, stale cache, 429 backoff, ambiguous external-write completion |
| Authoring | Semantically wrong/missing anchors, malformed program, excessive selectors/work, grant expansion, failed update/rollback, draft without unintended paid/API work |
| Accessibility | Keyboard/picker escape, focus preserved, screen-reader status, color contrast, dark/light theme, zoom, narrow sidepanel, translated text expansion |
| Performance | Browser-instrumented mount/scroll traces on static article, dense dashboard and infinite-feed fixtures; no-layer baseline vs five simple Layers; memory stable after repeated mounts |

Use deterministic fixture sites for CI and periodic manual smoke checks on opted-in real sites. Selector snapshots alone do not establish that a Layer achieves the user's requested outcome. Add malicious-page fixtures that can observe/alter DOM and try to call the broker. Budget guards must be tested by exceeding limits, not just inspecting configuration.

Start behind a profile feature flag, dogfood managed Layers, then opt-in beta. Keep advanced JavaScript separately flagged. No remote gallery, automatic site-wide enablement, automatic self-repair, or silent capability expansion in the initial beta. Imported/exported definitions omit credentials and private cached data; new profiles/devices grant access afresh.

Success metrics: creation→working preview, kept Layer still working after reload and at day 7, activation latency, successful action rate, breakage per matched visit, unexpected model/API spend, disable/restore success, and repair frequency. Instrument aggregate outcomes with existing consent settings, excluding page text/full URLs. Do not optimize raw agent-call volume; the useful result is a customization people keep using.

## 10. Decisions to carry into implementation

1. Adopt **Layers** as the working feature name; validate comprehension, not just aesthetic preference.
2. Default to managed programs; implement arbitrary JavaScript as a distinctly permissioned mode with a separate ship gate.
3. Apply saved code/programs deterministically; use agent work on explicit action triggers by default.
4. Keep page customization local, profile-scoped, reversible where the runtime controls effects, and independent of capture.
5. Ship hide + translate + one controlled data example before promising brittle third-party enrichments.
6. Treat LinkedIn follower coverage and bundled userScripts enablement as feasibility questions to verify, not product guarantees.
7. Before coding, update the adopted parts of spec 16 / Phase 9 to remove conflicting privacy, isolation, and proactive-only assumptions. This proposal leaves those historical documents intact apart from cross-references.
