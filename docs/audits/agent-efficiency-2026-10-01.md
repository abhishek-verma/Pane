# Pane agent efficiency audit

Pane has concrete opportunities to reduce unnecessary agent work. The strongest evidence concerns oversized tool results, retrieval that does not expose the relevant passage, and memory bookkeeping forced into user turns. Prompt contradictions and overly broad workflow triggers contribute, but a wholesale prompt rewrite would miss several underlying problems.

This audit was conducted on October 1, 2026 against checkout `984cc76d`. It is an analysis and implementation proposal; production behavior was not changed.

## Evidence and limits

Read-only inspection covered all 364 persisted conversations in the local Pane profile databases, dated July 12–October 1. There were 10,512 recorded tool parts, or 10,508 after deduplicating tool-call IDs within sessions. These are transcript events, not a reliable count of physical executions across ACP adapters.

For recent-task screening, the newest 80 conversations remaining after a heuristic exclusion of recurring-job templates and obvious diagnostic prompts were selected. The exclusion classified the full archive as 295 interactive candidates, 52 background templates, and 17 diagnostics. These labels are sampling aids, not ground-truth task classifications; the 80 include an explicit Home Refresh request. Session summaries, tool distributions, errors, and selected detailed call sequences were inspected. Examples below include small lookups, drafting, meeting retrieval, shopping, research, page editing, and browser automation.

Six of those 80 had ACP-shaped/provider-executed tool projections. To avoid comparing native model steps with ACP UI events, quantitative tool analysis uses the remaining 74 sessions, dated August 10–September 29:

| Measurement | Observed value | Interpretation |
|---|---:|---|
| Recorded tool calls | 2,360 | Includes successful, failed, and interrupted attempts |
| User-run records | 404 | A run is not an individual model inference |
| Completed run records with timing | 386 | `done` does not establish task success |
| Completed-run elapsed median / p90 | 34.5 / 126.8 seconds | Includes tools and possible approval waits; not model latency |
| Error-marked tool results | 75 across 39 sessions | Includes interruption and expected failure, not 75 harness bugs |
| Identical name-and-input repeat candidates | 242 across 26 sessions | Some are valid rereads after page changes; not a waste estimate |
| Context searches | 124 across 58 sessions | 16 sessions contain three or more searches |
| Memory budget rejections | 14 across 9 sessions | Ten adds and four replacements |
| Workspace-relative path rejections | 19 across 18 sessions | Several concern generated browser output files |
| Persisted context-truncation markers | 24 across 7 sessions | Evidence that the destructive guard path was exercised |

Timing uses `chat_turns.started_at` and `ended_at`. Message `created_at` is unsuitable: persistence rewrites it as checkpoint time plus message position. Background runs lasting hours were excluded from latency conclusions; stale runs can close only on restart. Two recent server logs identify models for a limited subset, not the whole archive. They do not supply enough per-step model, tool, reasoning, cache, and approval timing to assign percentages of latency to Gemini or any other provider.

All findings distinguish historical traces from current code. Session IDs below are short audit references, not links to public conversations. Raw transcripts and private financial/account values are not copied into this report.

## Findings ranked by value

### Large tool results bypass the size guard

**Confirmed in current code and reproduced.** `guard-ui-messages-for-context.ts` measures the whole output, but only shortens `content[].text`, selected structured fields, and `preview`. It misses the `{text: ...}` shape returned by PI and other internal tools. It nevertheless reports `truncated: true`.

A direct call to the current function with a 250,000-character synthetic payload produced:

| Output shape | Serialized input size | Serialized result size | Reported truncated |
|---|---:|---:|---|
| `{text: payload}` | 250,147 | 250,147 | true |
| `{content: [{type: "text", text: payload}]}` | 250,175 | 15,214 | true |

This affects real usage. Sessions `a1fb7188` and `3e196361` each contain a PI read response of **381,913 serialized characters**. One begins with a narrow question about what a worked example stores. Session `411303b3` repeatedly receives the entire growing page after edits: successful patch responses grow from about 46,000 to 213,000 characters. These are character counts with Unicode preserved, not token counts.

Current `personal-internet/tools.ts` serializes complete mutation results and adds a render preview. A full document, including SVG markup, is rarely needed to acknowledge a small patch. This is avoidable context growth even if the agent never repeats a tool call.

**Change:** return mutation receipts containing address, version, changed node IDs, and bounded render preview. Add section/node reads to `pi_read`. Normalize all tool-result shapes at the model boundary, and accurately report whether bytes were removed. Preserve full results outside the prompt with a supported retrieval handle.

### Retrieval finds sources without exposing enough evidence

**Observed repeatedly, with clear code support.** Session `cdd74b28`, asking for one person's LinkedIn, used **12 calls in 29.9 seconds**: three context searches, two chat searches, PI discovery, a newly created entity page, three PI reads, file grep, and opening the final URL. Both chat searches returned the same opening narration of an earlier conversation rather than its relevant passage. The URL was eventually found in an existing prep page. Creating another entity page was unnecessary to answer the lookup.

In `66acb5a0`, a short recommendation request led to **five context searches and one session search** before the user identified the HR profile. Results included other contacts, old scheduling details, and background harvest summaries. The eventual draft was also longer than requested, requiring another “small” correction. This combines weak retrieval with model instruction-following failure.

Current `retrieval/hybrid.ts` uses `content.slice(0, 500)` for chat and PI lexical hits; `context/tools.ts` returns the first 400 characters for chat search. Chat search returns an abbreviated session ID, and its tool set has no full-session read operation. `context_search` exposes no date or source-kind filter. Empty-result fallback cannot help much when unrelated results are nonempty.

**Change:** return match-centered snippets, full source IDs, date/version, and an explicit read handle; add bounded `session_read` or unified `context_read`. Add source/date/entity filters, canonical entity resolution, and relevance-aware fallback. Keep recent relevant user evidence ahead of generic assistant narration and automated summaries. Evaluate ranking changes on labeled queries; do not assume all semantic matches are useful.

### Memory management adds failures to ordinary tasks

**Confirmed in traces and current code.** Nine sampled sessions hit 14 memory-budget failures. The tools tell the agent to consolidate entries when the active store exceeds 2,200 characters. In `92f54579`, replacement attempts fail at 2,217 and 2,214 characters: the model is spending calls on tiny character-budget adjustments.

`memory/skills.ts:checkMemoryAddBudget` ties storage admission to the prompt budget. Yet `prompt-budget.ts` already has an allocation/eviction mechanism for what enters the prompt. These are separate concerns that are currently coupled.

There is also a correctness risk: `memory_replace` calls `forgetMemoryEntry` before validating the replacement budget and writing the new entry. If the new write fails, prior matching entries have already been removed from active memory. This code path is confirmed; the audit did not reconstruct which historical facts were lost.

**Change:** separate durable storage capacity from prompt selection; make replacement atomic and bucket-scoped. Perform curation outside the critical response path. Do not ask the model to shorten unrelated memories to finish an ordinary lookup or draft.

### Targeted transcript questions require sequential scanning

**Observed and still supported by the current interface.** Session `ce3a6b00` asks which SQS-related term came up in an interview. The first run takes **44.3 seconds and seven calls**, including five `capture_read` calls at offsets 0, 15,000, 30,000, 45,000, and 60,000. Those are different chunks, not duplicate reads, but the interface forces discovery by scanning.

`capture_read` supports offsets and a size bound, without a query parameter. General context search does not replace a reliable search scoped to a known capture.

**Change:** provide transcript search scoped by capture ID, returning timestamped matching segments with neighboring context and a continuation/read handle. Retain full reads for whole-meeting evaluations. A replay target for this example is one capture lookup plus one targeted search, with an additional context read only if needed.

### Context reduction can erase useful results before summarization

**Current code risk, with observed truncation but unproven causal attribution.** The pre-turn guard replaces `session.agent.messages` with shortened content and checkpoints it. Its truncation marker gives no tool-result retrieval handle. `compaction.ts` also prunes older tool calls/results before attempting an LLM summary; if pruning alone gets below threshold, it returns without summarizing those removed results.

Thus the summarizer cannot preserve facts it never receives. The sampled sessions contain persisted truncation markers, but the stored UI transcript does not establish the exact prompt seen at every model step. It would be unsound to label all repeated reads as amnesia caused by compaction.

**Change:** retain an immutable full transcript/output store; derive a bounded model projection. Preserve source handles, completed actions, failed approaches, key extracted facts, and artifact versions before removing bulky bodies. Summarize from original evidence. Add a controlled test where the decisive fact occurs beyond the truncation boundary and must remain recoverable after compaction and restart.

### Browser state and extraction failures cause recovery loops

**Observed; precise root cause needs a browser reproduction.** The September 29 EPFO task (`1aa5c49e`) took **24 calls across two runs, 137.7 seconds total**, with a user interruption suggesting web research. Action output reported navigation, while some subsequent reads carried an older origin or returned empty text. A later `evaluate` returned the needed content after reads and snapshots were empty. The task also spent time exploring an incorrect menu path before verifying it.

Current `read.ts` labels content with cached `pages.getInfo(...).url`, while `navigate.ts` explicitly refreshes page info. `Navigation.waitForLoad` polls `document.readyState` with a 30-second ceiling and no typed timeout result; it is not a guarantee that a dynamic page's relevant content is ready. The trace alone cannot distinguish stale origin metadata, loading races, frame/extraction issues, or user navigation.

**Change:** return URL, document generation, loading state, and extraction outcome from the same observation. Distinguish selector miss, empty document, stale target, and loading. Support an explicit readiness condition with a bounded wait; do not let “empty” silently mean all four. Reproduce this on delayed navigation, redirects, iframes, and SPA updates before changing retry policy.

### The prompt imposes work regardless of task size

**Confirmed contradictions; benefit must be measured.** The generated base prompt is approximately **27,000–30,000 characters** depending on workspace/ACP mode, before personal memory, skill index, user customization, or tool schemas. Character/4 estimates are only rough token estimates.

Examples in current instructions:

- Retrieval is mandatory for anything containing “my”, “our”, “I”, or “we”; filesystem/web fallback is allowed only when results are empty. Existing relevant context and irrelevant-but-nonempty results need explicit treatment.
- Browser skill and execution guidance demand another snapshot after navigation, even though the navigation tool already returns a fresh snapshot. The ACP runtime skill repeats this contradiction.
- The research skill prescribes 3–6 search angles and says to exhaust local context first. This is reasonable for a deep research task but too broad for a narrow factual lookup.
- Long structured answers trigger PI creation and opening; structured or quantitative content encourages another visualization skill. This can add artifact work the user did not need.
- Meeting tool descriptions prefer `capture_list` first, while the general retrieval-first prompt mandates `context_search` first.
- `skills_load` says to prefer `skills_list` even though a skill index is already provided. PI tool descriptions say schema knowledge must be present “this turn,” rather than retained in valid context.

There were 68 skill loads in the 74-session cohort, but **no repeated identical skill IDs within a session**. There were also no immediately adjacent same-page `navigate` then `snapshot` pairs. Therefore, repeated skill loading and the snapshot contradiction are cleanup opportunities, not demonstrated dominant costs in this sample.

**Change:** use a compact core plus task-relevant modules. Add an explicit sufficient-context fast path. Reuse fresh tool observations. Scale research depth and artifact creation to the requested outcome. Preserve security boundaries and action verification; remove duplicate procedural instructions, not safeguards.

### The agent sometimes chooses expensive methods or misses the request

**Behavioral evidence, not automatically a harness defect.** Session `8c2f784a` has 267 tool calls across seven user messages, including 178 `act` calls. The slide-template portion triggers repeated user reports that the slides are empty, including a provider image-format error. This is a poor editing route and weak completion verification, rather than simply a large task needing many sources.

By contrast, 56 calls across ten telescope-shopping messages (`f314a6e4`) include explicit requests for deeper research, more stores, a revised budget, and community opinions. Those should not all be labeled redundant. Still, the assistant recommends beyond the budget and is corrected. In charger shopping (`e29b6358`), device compatibility is asked about only after a substantial first research pass; a later user message reveals a newer phone model. Those are task-state and constraint-tracking problems.

Company-culture research (`889069e7`) uses 111 calls in one research run and 40 in a positive-evidence follow-up. Some extra sources are requested, but blocked sites, repeated navigation, and tiny extraction scripts amplify cost. The prompt already permits parallel independent calls, and a `run` tool exists. “Add batching” is therefore incomplete advice: the missing piece is a reliable, discoverable operation for the actual workflow, with useful outputs.

**Change:** route document editing through an available document API/artifact workflow; otherwise verify one populated slide before repeating the action. Maintain a compact task state for hard constraints and unresolved decision-changing facts. Offer bounded browser batch operations and stable extraction helpers; stop when the evidence is sufficient. Preserve user-requested depth rather than enforcing a global call cap.

## Improvements already present and limits on attribution

- Durable SQLite tool history is loaded on session rebuild. ACP conversations use native persistence and receive only the new user message. It would be incorrect to claim Pane always loses history between turns.
- Screenshot bytes are stored separately and rehydrated for the model. A stripped image in a UI transcript is not proof the model never saw it.
- Generated browser output files are now supported by `filesystem_read`, including without a workspace. Historical path failures should become regression fixtures. Other workspace-relative path errors still need clearer path contracts.
- Current checkout includes named provider-schema recovery and ACP diagnostic recovery from October 1. A logged schema rejection from the earlier process is evidence for compatibility testing, not proof that current recovery is absent.
- Current ACP code refreshes shared memory and avoids resending unchanged system context. However, the regenerated prompt contains the current minute, so the system-context comparison may treat otherwise identical context as changed on later-minute turns. This is a code-supported optimization hypothesis; inspect actual prompt/cache traces before estimating its cost.
- Checkpoints rewrite all messages and final persistence clears/rebuilds session search indexes. That can amplify large-session I/O, but no local timing evidence establishes it as the primary delay. Instrument before replacing persistence.
- Recent logs advertise 75–76 native tools on ordinary requests. An irrelevant PI schema rejection can affect an unrelated task. Capability-specific tool sets and provider schema contract tests would reduce both payload and failure exposure; preserve an explicit route to discover omitted capabilities.

## Implementation order and evaluation

| Priority | Work | Acceptance evidence |
|---|---|---|
| P0 | Compact PI receipts and section reads; normalize guard shapes; retain recoverable full outputs | Synthetic `{text}` reproduction passes; small edits do not echo the whole page; full evidence remains readable after restart |
| P0 | Separate memory storage from prompt selection; atomic replacement | Budget exhaustion causes no active-fact loss and no user-turn consolidation loop |
| P0 | Add local per-run and per-step diagnostics | Provider/model, prompt/skill/toolset versions, token/cache usage when available, model/tool/approval/checkpoint durations, result sizes, recovery reason, and completion outcome share stable IDs |
| P1 | Match-centered search, source handles, full conversation read, transcript query | Replay the contact, HR, and SQS cases with the correct evidence and fewer calls; measure recall and false matches |
| P1 | Resolve routing contradictions and add sufficient-context fast path | Supplied-text drafting avoids irrelevant retrieval; fresh navigation observations are reused; requested depth and approvals remain correct |
| P1 | Browser readiness and observation metadata | Delayed/redirected/SPA/frame fixtures produce consistent URL and document state; empty results have actionable reasons |
| P2 | Task-sized tool exposure and document/browser workflow operations | Reduced schema/context size and fewer physical interactions without missed capabilities or premature success claims |
| P2 | Versioned task state, compaction, and incremental persistence | Recovery retains constraints and completed work; measured checkpoint cost and context growth fall |

Build a fixed replay set from the case families above, with sanitized fixtures rather than live private accounts. Include easy controls: `5deec6f6` answers a concept question with zero tools, and the recommendation conversation edits already-provided text without tools on several follow-ups. Add one long research task and one multi-turn mock interview so optimization does not damage legitimate depth.

Compare current baseline and each intervention using the same model/settings and fixtures over repeated runs. Measure successful completion, corrections required, evidence accuracy, tool/model round trips, input/output/cache tokens, time to useful answer, total elapsed time, and approval wait separately. Review repeats semantically against document/page version: an identical read after a mutation is often necessary. Targets such as reducing the contact lookup to 1–3 reads and eliminating budget-related memory retries are proposed goals, not measured savings.

The recommendation is to fix output contracts and memory failures first, then improve retrieval and remove unnecessary prompt procedures. Model selection should be evaluated after these controls, because the current evidence cannot fairly separate provider speed from work imposed by Pane.

## Code references

All paths below are relative to `packages/browseros-agent`:

- `apps/server/src/agent/guard-ui-messages-for-context.ts` — output shape handling and size guard.
- `apps/server/src/api/services/chat-service.ts` — hydration, context guard checkpoint, ACP input, per-step persistence.
- `apps/server/src/agent/session-store.ts` — rewritten message timestamps and indexes.
- `apps/server/src/agent/compaction.ts` — prune before summarize.
- `apps/server/src/agent/tool-adapter.ts` and `tool-image-strip.ts` — model output and image rehydration.
- `apps/server/src/personal-internet/tools.ts` — complete page responses and artifact routing descriptions.
- `apps/server/src/context/tools.ts` and `retrieval/hybrid.ts` — search interfaces and leading snippets.
- `apps/server/src/capture/tools.ts` — transcript pagination.
- `apps/server/src/memory/tools.ts`, `skills.ts`, `prompt-budget.ts` — admission budget and replacement sequence.
- `apps/server/src/agent/prompt.ts`, `memory/builtin-skills.ts`, `lib/agents/acpx/runtime-templates.ts` — prompt and skill rules.
- `apps/server/src/lib/agents/acp/language-model.ts` — system-context comparison on continuation.
- `packages/browser-mcp/src/tools/read.ts`, `navigate.ts`, and `packages/browser-core/src/core/navigation.ts` — extraction metadata and navigation readiness.
- `apps/server/src/tools/filesystem/read.ts` and `agent/tool-schema-recovery.ts` — existing fixes to preserve.

## Reproducing the census

Run `python3 docs/audits/analyze-pane-sessions.py` from the repository root. It opens profile databases read-only and emits counts and the selected session IDs, without prompts or tool-output contents. Use `--root` to point it at a preserved copy of the local `.browseros` directory. Re-running against changed live databases may change the sample. The script was run after the analysis and reproduced all cohort counts and timing statistics above.

The size-guard reproduction imported the current `guardUiMessagesForContext` using Bun from `packages/browseros-agent`, passed one assistant tool result containing 250,000 `x` characters, and compared `JSON.stringify(messages).length` before and after for the two output shapes shown above. It exercised the actual implementation without modifying session data or invoking a provider.
