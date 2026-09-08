# Pane Layers — capability honesty, skills, and provider parity

**Implementation:** these requirements are assigned to concrete work packages in the [Pane Layers implementation plan](./PANE-LAYERS-IMPLEMENTATION-PLAN.md).

**Status:** design requirements, 2026-09-08; no implementation claimed.  
**Parent:** [Pane Layers](./21-pane-layers.md). Complements the [runtime contract](./21-pane-layers-runtime-contract.md). These requirements apply to every exposed authoring path and are release gates.

## 1. Assess the request before promising it

Pane must distinguish the user's desired outcome from a feature it can actually deliver. For example, “translate every language into English automatically every time” combines language coverage, automatic triggers, page coverage, persistence, credentials, latency, and availability. Some bounded forms may be feasible; the unlimited guarantee is not justified by one successful translation.

Add a read-class `layer_assess` tool before drafting or committing behavior. It receives structured requirements extracted from the request and consults actual runtime support, current profile/provider capabilities, site evidence and required connections. Language-model inference is not a substitute for this capability check.

Assessment dimensions:

- Trigger: manual click, document load, SPA route change, incremental visible content.
- Scope: specific page/site, selected sites, explicit global scope; unsupported schemes/frames remain excluded.
- Content coverage: accessible page text versus images, video, canvas, closed roots, editor fields, PDFs or inaccessible frames.
- Execution: local, transform, adaptive page task, arbitrary script; correct registered tools and runtime flag must exist.
- Provider/data: current configured provider, validated structured-action path, supported languages where known, credentials, source coverage, network/local availability and costs.
- Persistence and resource policy: automatic model trigger available, visibility/refresh policy, quotas, cache invalidation, cancellation and recovery.
- Evidence: inspected this page, fixture-only validation, observed current provider compatibility, or still unverified.

Proposed response:

```ts
type LayerAssessment = {
  assessmentId: string
  requirementHash: string
  capabilityRevision: string
  disposition:
    | 'supported'
    | 'supported-with-limits'
    | 'needs-input'
    | 'unverified'
    | 'unsupported'
  checks: Array<{
    requirement: string
    status: 'supported' | 'unsupported' | 'unknown' | 'missing-setup'
    reasonCode?: string
    evidenceRefs: string[]
  }>
  feasibleScope?: Record<string, unknown>
  limitations: string[]
  alternatives: Array<{
    description: string
    changesToRequest: string[]
  }>
}
```

An assessment records what is currently known, not a perpetual compatibility certificate. Missing documentation/evidence is `unknown`, not fabricated support. A failed credential request is a setup problem, not proof the website feature is impossible. A known runtime prohibition is unsupported, even if the model thinks it could improvise a script.

### User flow for automatic translation

If automatic model execution is not shipped/enabled in this runtime, say:

> “I can add a Translate button that returns on every visit. Automatic translation on page load isn't supported yet, so I can't save the automatic behavior you asked for. Would you like the button instead?”

That is a material change in trigger, so the user chooses whether to accept the alternative. Pane can prepare a local preview, but must not silently activate the substitute. Do not make a universal script match and claim that establishes universal coverage.

If automatic execution is supported and verified on the selected site, narrow the promise to the supported result:

> “I can automatically translate readable article text on this site into English. Text inside images and inaccessible embedded content will stay unchanged. Translation also needs your configured model to be available.”

Expose meaningful constraints during setup: pages affected, automatic model use, provider, spending/work limits and excluded content. “All languages” must become supported/detected languages with an honest failure state, never a guarantee of perfect translation. An unavailable provider must show pending/unavailable status and leave the original readable. Offline behavior depends on the actual installed local model/cache, not a blanket claim.

If the request clearly covers only the supported case and existing grants/budgets apply, proceed without an extra approval. If narrowing removes requested content, changes automatic to manual, adds a new data destination, or materially changes scope, explain the difference and obtain the needed choice. One concise clarification should resolve the meaningful decision, not a large setup questionnaire.

### Enforcement beyond prompt wording

The saved manifest references the requirements and capability assessment. Draft validation and activation independently check trigger/runtime support, scopes, grants and provider compatibility. Block unsupported definitions through UI, AI SDK, MCP, import and direct mutation paths alike. A prompt saying “be honest” is insufficient.

Activation returns a machine-authored receipt of **what was actually enabled**, including exact trigger, scope, coverage limits and verification status. The agent's final message must match that receipt. A working button does not prove automatic execution. A successful current page does not prove all routes or languages. Unknown quality is not converted to certainty by schema validation.

Provider changes, runtime upgrades, grant revocation and credential expiry re-evaluate dependent capabilities. Pause only the affected action, retain the Layer definition, and show the actionable reason. Never fall back to a different paid provider or broaden scope silently.

If automatic translation is later shipped, its dedicated gate includes repeated visits, SPA/incremental content, visibility-based scheduling, global and per-Layer budgets, cache keys, observer feedback-loop prevention (exclude Pane's translated output from source capture), retries/backoff, language detection uncertainty, mixed-language pages, cancellation and offline states. Automatic inference remains unshipped until that gate passes; a user's broad request is not a feature flag.

## 2. Skills hold workflow instructions

Follow the PI pattern: concise routing guidance in the shared operating prompt and focused built-in skills loaded on demand. Do not paste the full Layer design into the main prompt or every action invocation.

Proposed routing sentence, sourced once and included in the relevant native and managed-harness instruction builders:

> For persistent website customizations or saved on-page actions, load the Pane `layers` skill through `skills_load`; assess capabilities before promising behavior, and verify the exact version before activation. Load `layers-repair` when fixing an existing Layer.

Skill catalog:

| Skill | Responsibility |
| --- | --- |
| `layers` | Entry workflow: distinguish one-time/persistent intent, assess feasibility, inspect existing Layers, choose an action type, scope, preview, verify, activate and report the actual receipt. |
| `layers-authoring` | Manifest, bindings, anchors, managed operations, match/exclude semantics and component interfaces. |
| `layers-actions` | Transform/page-task contracts, structured result schemas, data operations, automatic-trigger eligibility and advanced-script boundaries. |
| `layers-verify` | Independent acceptance checks, browser-driven testing, live-versus-fixture evidence, receipts, test budgets and cleanup. |
| `layers-repair` | Diagnose the installed version, reproduce failures, make bounded changes, retest, restore/rollback, preserve grants and intent. |

Use progressive loading: normally the entry skill plus the skill for the current stage. Do not inject every body at startup or force all five into a single turn's context. Stable names and one-line descriptions belong in the discoverable skill index. Detailed schemas can be returned by a definition/contract tool or skill references that the loader actually resolves; inaccessible filesystem-relative references are not acceptable across MCP.

The schema validators, action permissions, budgets, tool availability and lifecycle rules remain executable policy. Skills explain how to use them and how to communicate limitations. An archived/missing skill must not cause a bypass via unrestricted `evaluate`; report the missing guidance and use explicit installed capability diagnostics. Preserve user archive choices under the existing skill lifecycle.

Do not install these proposed skills in production before the referenced tools exist. Ship the catalog entries, tools, thin routing text and tests together behind the same feature/version gate. Keep detailed behavior out of the prompt until that feature is present.

## 3. One implementation for native and external providers

**Product requirement:** switching an already configured Pane provider to Claude Code or Codex requires no Layer-specific installation, copying of skills, manual MCP edits or extra API key. Normal provider authentication and feature grants still apply. This requirement covers both authoring/management and the action modes advertised for those providers.

Inspected existing integration points, relative to `packages/browseros-agent/`:

| File | Observed role and required change |
| --- | --- |
| `apps/server/src/memory/builtin-skills.ts` | PI skill bodies and stable IDs are seeded here. Add Layer skills through the same canonical catalog or an extracted module consumed by it. |
| `apps/server/src/memory/tools.ts` | `skills_list` and `skills_load` serve active skill metadata/bodies. Reuse these across providers. |
| `apps/server/src/agent/prompt.ts` | PI uses skill routing; the external-agent guidance explicitly distinguishes Pane MCP `skills_load` from the provider's own native Skill tool. Extend that thin route for Layers. |
| `apps/server/src/agent/ai-sdk-agent.ts` | Native agent currently assembles product tool factories. Add the shared Layer tool factory through a canonical product-tool registry. |
| `apps/server/src/context/register-mcp.ts` | MCP registers the same PI/memory tool factories and wraps them in the trust gate. Add the same Layer tools, without separate handler logic. |
| `apps/server/src/lib/agents/acpx/agent-common.ts` / `runtime-context.ts` / `runtime-templates.ts` | Managed Claude/Codex contexts have their own prompt-prefix and materialized runtime skill path. Route these to the canonical catalog; adding native-agent prompt text alone does not cover them. |
| `apps/server/src/lib/agents/acpx/agent-common.ts` / `runtime-state.ts` | Session identity includes skill names/prompt version. Include a catalog content/version digest so same-name skill updates invalidate stale instructions appropriately. |
| `apps/server/src/api/services/chat-service.ts` / `agent/provider-factory.ts` | ACP providers receive MCP configuration. Verify profile/header/auth forwarding and automatic product-tool discovery here. |

### Tool and skill distribution

Define `buildLayerToolSet(context)` once: schemas, descriptions, handlers and policy metadata. Both native and MCP paths consume a shared product-tool registry. Do not maintain independent lists that require developers to remember a second registration when adding a tool. Mode restrictions remain explicit; read-only chat does not acquire mutation tools just to make provider counts equal.

Use Pane MCP `skills_list` / `skills_load` as the canonical cross-provider skill interface. If a harness requires filesystem skill discovery, generate the required entry files from the same catalog or generate thin pointers to its MCP loader. Never maintain a hand-copied Claude variant and Codex variant. Ensure bodies/references actually load through each harness; telling a provider to invoke an unregistered native Skill is a known failure mode, not compatibility.

Skill seeding/discovery must run on profile/service initialization used by MCP-only sessions, not only when native chat builds its prompt. Both a fresh profile and an upgraded existing profile must expose the enabled feature correctly. Respect archive state, and propagate catalog/version changes without requiring users to restart or reinstall skills manually; controlled session refresh may be necessary and should preserve conversation state where supported.

### Authoring parity is not invocation parity

An external agent being able to call `layer_draft` does not prove it can safely execute a Translate action. Implement dedicated adapters for native models, Claude Code and Codex that bind a scoped invocation, provide the declared tool/context access, support cancellation and deliver the same validated result protocol.

For external harness result submission, create an authenticated **invocation-scoped** MCP surface or an equivalently authenticated provider channel. Expose `submit_layer_result` there, bound to the current invocation; keep it off the general authoring MCP surface. A global result tool accepting arbitrary invocation IDs would break isolation. Route all results through the same server acceptance function regardless of provider transport.

If a harness cannot constrain its own built-in filesystem/network/browser tools, do not claim managed-transform isolation based on a prompt or restricted Pane MCP tool list. Implement the necessary adapter/process controls or mark that combination unsupported internally and block the all-provider release gate until resolved. Do not make users compensate by installing a separate provider. For optional third-party providers outside the supported release matrix, surface accurate capability limits without silent fallback.

This revises the earlier suggestion to defer Claude/Codex adapters: **they are required release work for the Layer capabilities advertised as provider-independent**. Runtime capability errors remain necessary for expired auth, missing versions or broken installations, but are not permission to market unfinished parity.

## 4. Tests and release gates

Automated contract tests must compare feature availability and behavior, not just tool counts:

1. Canonical tool schemas/names match between native and MCP for the same profile/mode/grants; new registry entries automatically appear in both.
2. On a fresh profile using only a managed Claude or Codex session, discover and load Layer skills and their references without a preceding native chat.
3. Same skill IDs resolve to the same catalog revision across native, MCP and any generated filesystem views; upgrades refresh content without reactivating archived skills.
4. Load the entry skill, assess an unsupported automatic request, and verify that every provider explains the unsupported trigger instead of claiming an installed automatic feature.
5. Each supported provider authors a Layer, previews it, invokes its action, returns structured output, verifies it, enables/disables it and reloads safely without manual setup.
6. All mutation paths reject unsupported trigger/mode manifests and stale capability receipts. Test misleading generated descriptions against the actual activation receipt.
7. Claude/Codex invocation adapters prove isolated result delivery, denied undeclared tools, profile binding, cancellation, no cross-run result injection, and no silent fallback provider.
8. Closing/reopening chat and switching providers leaves existing Layers usable. Refresh provider compatibility without losing saved state.

Mock protocol tests run in CI; a bounded authenticated end-to-end smoke matrix for native, Claude Code and Codex is required before release. If credentials or a provider are unavailable during validation, report the test as not run. A green mocked adapter does not establish live compatibility.

Implementation sequencing: L0 adds capability inventory/provider contract experiments; L2 ships the canonical skills and shared authoring registry together; L3 includes all three supported action adapters and private result delivery; L5 requires the fresh-install, upgrade, unsupported-request and provider-switching matrix. No additional user setup is the acceptance criterion, not a claim that engineering integration happens automatically.
