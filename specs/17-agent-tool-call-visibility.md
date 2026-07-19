# 17 — Agent Tool-Call Visibility in Chat

## Summary

When the Pane agent acts — editing a file, clicking a button, running a command, calling an MCP tool — the chat transcript today mostly says *"N actions completed"* with tool names. That fails principle 5 ("Show the work. Always."). This spec defines how tool calls become **visible, scannable evidence** in chat: specialized previews for file changes and browser actions, collapsed generics for everything else, progressive disclosure into full detail, without turning the side panel into a noisy log.

This is a **product refinement of the existing tool transcript**, not a new surface. It deepens what [03 — Agent Modes & The Loop](./03-agent-modes-and-the-loop.md) already calls for ("tool batches… with input/output") and what [01 — Product Principles](./01-product-principles.md) requires. It does **not** replace approvals ([10](./10-trust-privacy-security.md)), the Action Log, tab glow, or the claw-app cockpit screencast.

> **Status:** draft v0.1 — decision-ready product spec.
>
> **Primary ICP:** knowledge-worker expand path (side-panel Agent) and developer wedge (workspace file edits visible while browsing). Both need to *see* what just happened without leaving chat.
>
> **Substrate today:** `ToolBatch` collapses tools into a Task accordion showing only status + formatted tool name. Approvals get a richer `ApprovalCard`. Specialized AI Elements (`Tool` / `ToolInput` / `ToolOutput`) exist but are unused in the chat path. File tools already return text diffs (`filesystem_edit`); browser `act` returns page diffs via `includeDiff`; `screenshot` returns inline images — **none of that evidence is rendered in chat**.

---

## Problem

### What users experience today

1. Agent mode runs a multi-step loop (navigate → snapshot → click → type → edit file).
2. Chat shows a collapsible **"3/3 actions completed"** batch (`ToolBatch`).
3. Expanding reveals rows like `Filesystem Edit`, `Act`, `Navigate` — status icons only.
4. There is **no diff preview**, **no screenshot**, **no tool input/output**, unless the call is paused for approval (`ApprovalCard`).
5. After the run, the only durable audit of consequential actions is the separate **Action Log** page — not the conversation the user just watched.

### Why this matters

- **Trust:** Users cannot verify the agent did the right thing without re-checking the page or opening files themselves. Invisible work erodes the trust story in [10](./10-trust-privacy-security.md).
- **Debuggability:** When something goes wrong, the transcript does not help the user (or support) reconstruct the steps.
- **Differentiation:** Cursor/Hermes-class agents show file diffs and action evidence inline. Pane *is* the browser — browser evidence should be *better*, not worse.
- **Existing promise gap:** Spec 03 already lists "tool batches with input/output" and a "live snapshot / watch view." The UI has not caught up.

### Evidence from the codebase (current state)

| Area | Path | Reality |
|------|------|---------|
| Message segmentation | `packages/browseros-agent/apps/app/screens/sidepanel/index/getMessageSegments.ts` | Groups tool parts into `tool-batch` segments; preserves `input` / `output` / `state` |
| Chat rendering | `.../ChatMessages.tsx` → `ToolBatch.tsx` | Renders name + status only; ignores output content |
| Approvals | `.../ApprovalCard.tsx` | Shows `describeToolCall` preview + edit-args; only when gated |
| Generic tool UI (unused in chat) | `.../components/ai-elements/tool.tsx` | Collapsible parameters/result JSON — reference, not product |
| Agent Command | `.../screens/agent-command/ConversationMessage.tsx` | Same pattern: Task list of tool labels, no evidence |
| File edit results | `apps/server/src/tools/filesystem/edit.ts` | Returns text unified-ish diff of `old_string`/`new_string` |
| File write results | `.../filesystem/write.ts` | Returns byte count only — **no content/diff for UI** |
| Browser act | `packages/browser-mcp/src/tools/act.ts` | Returns `ok (kind)` + page DOM diff via `includeDiff` |
| Screenshots | `.../tools/screenshot.ts` | Returns image content blocks — not shown in chat |
| Human labels | `packages/shared/src/trust/consequence-class.ts` → `describeToolCall` | Good short descriptions for bash/files/act — underused outside approvals |
| Cockpit (separate product) | `apps/claw-app` MiniScreencast | Live JPEG frames exist for multi-agent cockpit — **not wired into side-panel chat** |

---

## Goals

1. **Every completed tool call leaves a visible trace in chat** that answers: *what happened?*
2. **Specialized tools get specialized, scannable previews** (file diffs, browser evidence) so users verify without expanding raw JSON.
3. **Generic tools stay quiet** — one-line summary collapsed by default; expand for input/output.
4. **Progressive disclosure** — chat stays readable during long runs; detail is one click away.
5. **Parity across surfaces** — Side panel Agent chat and Agent Command conversation share the same visibility model (adapted to width).
6. **Performance-safe** — large diffs/images never blow up scroll performance or conversation storage by default.
7. **Privacy-aware** — screenshots and file contents stay local; analytics stay masked (`ph-mask` already on conversation).

## Non-goals

- Replacing or redesigning the **approval / dry-run** flow ([10](./10-trust-privacy-security.md)). Approvals remain the interrupt path; this spec is about *after* (and alongside) execution visibility.
- Building a full **IDE diff editor** or file browser inside chat. Click-through to a modal (or open-in-editor later) is enough.
- Shipping the full **"live watch / screencast" pane** from spec 03 in v1 of this work (phase 3 below). Per-action evidence comes first.
- Changing **consequence classes**, trust pins, or Action Log schema.
- Showing every intermediate model-facing blob (full `snapshot` accessibility trees, huge `grep` dumps) as first-class UI — those stay generic/collapsed.
- Pixel-perfect Cursor clone. Match the *intent* (inline evidence + expand), not their chrome.

---

## User stories

1. **Verify a file edit:** "I asked the agent to fix a typo in `README.md`. In chat I see a short diff card for that file. I click it, read the full diff in a modal, and trust the change without opening my editor."
2. **Verify a browser click:** "The agent said it clicked 'Submit'. I see a thumbnail of the page after the click (or a clear 'Clicked Submit on example.com' card with before/after page-diff summary). I know it hit the right control."
3. **Scan a long run:** "A 20-step agent run does not flood my panel. I see a tight timeline of high-signal cards (files + browser) and a collapsed '8 other tools' group I can open if something feels wrong."
4. **Debug a failure:** "A tool failed. The card shows error state and, on expand, the error text and inputs. I can copy them."
5. **Approval still richer:** "When a write needs approval, I still get the ApprovalCard. After I approve, the completed card upgrades into the specialized preview (diff/screenshot), not a bare tool name."
6. **History replay:** "I reopen yesterday's conversation and still see the same previews (or honest placeholders if heavy media was pruned)."

---

## Information architecture

### Hierarchy (most → least important in the scroll)

1. **Assistant prose** — the agent's words remain the primary narrative.
2. **Specialized evidence cards** — file changes, browser actions (and later: terminal, app sends).
3. **Batch / step grouping chrome** — "Working…" / "N steps" as a light container, not the content.
4. **Generic tool rows** — collapsed one-liners.
5. **Raw input/output** — only inside an expanded generic tool or "Details" disclosure.

### Placement in the message stream

Keep the existing segment model from `getMessageSegments`:

- Tools still appear **inline where they occurred** relative to reasoning/text (do not hoist all tools to the end).
- Consecutive tools may still form a **batch**, but the batch is a *layout container*, not a black box. Users should see specialized cards **without expanding the batch** when those cards are high-signal.

**Decision:** High-signal specialized cards are **visible at the batch's collapsed surface** (or the batch auto-expands enough to show them). Low-signal generics remain behind the batch chevron.

### Surfaces in scope

| Surface | In scope | Notes |
|---------|----------|-------|
| Side panel Agent (`ChatMessages` / `ToolBatch`) | **Yes — primary** | Narrow width; cards must be dense |
| New tab chat (same chat session stack) | **Yes** | Same components |
| Agent Command (`ConversationMessage`) | **Yes — phase 1 parity** | Today even thinner (`ToolEntry` has no input/output) |
| Chat mode (read-only tools) | **Yes, lightly** | If Chat calls `context.search` / read tools, use generic collapsed rows |
| Action Log page | Out of scope (complementary) | Link from consequential cards: "View in Action Log" later |
| Claw cockpit screencast | Out of scope | Inspiration / future "watch" phase |
| External MCP clients (Claude Code) | Out of scope for UI | They have their own UIs; Pane still logs actions |

---

## UX principles

1. **Evidence over machinery.** Prefer "Edited `src/foo.ts` (+12/−3)" or a page thumbnail over `tool-filesystem_edit` JSON.
2. **Collapsed by default for noise; expanded by default for consequence.** File writes/edits and browser mutations show a preview strip without a click. Reads, snapshots, waits stay collapsed.
3. **One primary click target per card.** Card body → open detail (diff modal / image lightbox / expand). Status icon and chevron are secondary.
4. **Never duplicate the approval UI.** If `approval-requested`, show ApprovalCard as today; do not also show a celebratory "completed" preview.
5. **Streaming honesty.** While `input-streaming` / `input-available`, show a running row ("Editing `foo.ts`…"). Swap to evidence when `output-available`.
6. **Fail visible.** Errors get a red/error treatment with expandable detail — never silently omit.
7. **Side panel is not a dashboard.** No stat strips, no multi-column tool grids. One column, chat rhythm.
8. **Build on substrate.** Extend `ToolBatch` / message segments / existing AI Elements patterns; do not invent a parallel transcript.

---

## Tool taxonomy for UI

Classify every tool into a **visibility kind** for rendering. This is a product mapping, not a new server type (engineering may derive it from tool name + output shape).

### A. File change

**Tools:** `filesystem_edit`, `filesystem_write` (and future `file.edit` / `file.write` aliases from [05](./05-workspace-files-terminal.md)).

**Not file-change (stay generic or terminal):** `filesystem_read`, `filesystem_ls`, `filesystem_grep`, `filesystem_find`, `filesystem_bash`.

### B. Browser action (mutating / navigational)

**Tools:** `act` (all kinds), `navigate`, `upload`, `download` (user-visible side effects).

**Borderline — treat as browser-evidence when a screenshot or page-diff is present, else generic:** `wait` (if it meaningfully changed readiness), tab focus changes via `tabs` when `action` mutates.

**Not browser-action cards (generic / omit preview):** `snapshot`, `diff` (meta), `screenshot` (the tool itself — but its *image output* should render; see below), `read`, `grep`, `pdf`, `evaluate`, `run`, `windows` list ops.

### C. Terminal / system

**Tools:** `filesystem_bash` (and future terminal session tools).

**Phase 1:** rich generic — show command one-liner (`describeToolCall` already formats `$ cmd`) + expandable stdout/stderr.
**Phase 2:** specialized terminal card (exit code, truncated output, copy).

### D. App / external write

**Tools:** Connect Apps / Klavis MCP tools that send or create external artifacts (email, Slack, tickets).

**Phase 2:** specialized "sent/created" card with destination summary.
**Phase 1:** generic with good `describeToolCall`-style summary when available.

### E. Nudge (already specialized)

`suggest_schedule`, `suggest_app_connection` — keep existing `ScheduleSuggestionCard` / `ConnectAppCard`. Out of this taxonomy's generic path.

### F. Generic (default)

Everything else, including unknown MCP tools and harness dynamic tools.

---

## Detailed UX

### Shared card chrome

Every tool row/card shares:

| Element | Behavior |
|---------|----------|
| **Status** | Running spinner / success / error / denied / awaiting approval (reuse today's semantics) |
| **Title** | Human verb + object, not raw snake_case. Prefer `describeToolCall` or a small label map ("Edited `path`", "Clicked Submit", "Ran `npm test`") |
| **Subtitle** (optional) | Host, workspace-relative path, duration |
| **Preview region** | Kind-specific (diff peek, thumbnail, command, none) |
| **Disclosure** | Chevron or "Details" for input/output JSON when needed |
| **Error** | Inline error text (clamped); full text in Details |

**Width:** design for ~320–420px side panel first; Agent Command can show slightly taller previews.

---

### 1. File change cards

#### In-chat (collapsed / default)

A compact **diff summary card**:

- File path (workspace-relative), monospace, truncated in the middle if needed.
- Change stats when available: `+12 −3` or "wrote 2.4 KB" / "new file".
- A **peek** of the diff: first ~8–12 lines of unified diff, faded/clipped at the bottom (Cursor/Hermes-style "top of the diff").
- Click anywhere on the card (except explicit copy buttons) → **Diff modal**.

#### Diff modal

- Title: file path + "Close".
- Full unified diff with syntax-friendly coloring (add/remove).
- Actions: **Copy diff**, **Copy path**. Optional later: "Open in editor" / reveal in workspace (non-blocking if unavailable).
- Modal is the only place full large diffs appear.

#### Content rules

| Case | Preview | Modal |
|------|---------|-------|
| `filesystem_edit` with diff in tool output | Use server-returned diff for peek + modal | Same |
| `filesystem_write` of new/small file | Show "Created `path`" + first N lines of `content` from **input** as a create-preview (treat as all additions) | Full content or full create-diff |
| `filesystem_write` overwrite, content huge | Stats only in chat ("Wrote 180 KB to `path`") | Modal: message that full content is omitted + show hash/size; optional "Show first 200 lines" |
| Binary / non-text | "Wrote binary/non-text file `path`" — no fake diff | Same |
| Edit failed / not found | Error card, no fake success diff | Details show error text |
| Multiple edits to same file in one batch | Prefer **one card per tool call** in phase 1 (honest timeline). Phase 2 may coalesce | — |

#### Privacy / safety

- Diffs may contain secrets. Cards live inside the existing `ph-mask` conversation region.
- Do not send diff bodies to analytics.
- Do not auto-upload diffs anywhere (State A local).

---

### 2. Browser action cards

#### Product intent

The user should see **concrete evidence of the page after (or of) the action** — ideally a screenshot thumbnail; otherwise a structured "what changed" summary from the page diff `act` already produces.

#### In-chat (default)

**Preferred:** thumbnail (16:10 or similar) of the page, with a one-line caption:

- `Clicked "Create issue" · github.com`
- `Typed into Search · amazon.com`
- `Navigated to https://…`

Caption uses `act.kind` + best-effort target label (from input `ref` / typed text / URL), not internal ref ids alone when a human string exists (`text`, `value`, URL).

**Click thumbnail** → lightbox (larger image, caption, page URL if known).

**Fallback when no image:**

- Show caption + **page-diff summary** (e.g. "URL changed…", "3 nodes added, heading now 'Thanks'") derived from structured/text diff already on the tool result.
- Still expandable to Details (raw tool I/O).

#### When do we show a screenshot?

**Decision (opinionated):**

1. If the tool result **already includes an image content part** (e.g. explicit `screenshot` tool, or future post-action capture), **render it**.
2. For `act` / `navigate` in phase 1, **do not require a second screenshot capture on every call** if that doubles latency. Ship caption + page-diff evidence first; add **optional post-action stills** in phase 2 when cheap enough (reuse screencast cache / last frame if present).
3. Explicit `screenshot` tool calls **always** show the image (this is currently a glaring gap — image is in the result and invisible).

This sequencing keeps phase 1 honest about performance while still meeting "concrete evidence" via page-diff + captions, and makes true screenshots shine when present.

#### Streaming

- Running: "Clicking…" / "Navigating…" with spinner; no stale thumbnail.
- Complete: swap in evidence.
- Error: error card ("Click failed: …").

#### Privacy

- Screenshots can include PII, banking, medical content. Same local + `ph-mask` rules.
- Incognito/private windows: still show in-chat (user's session) but **never** sync (State A has no sync; State B must exclude or encrypt — defer to [10](./10-trust-privacy-security.md)).
- User control (phase 2): setting "Show browser screenshots in chat" default ON.

---

### 3. Screenshot tool (special case)

Even though `screenshot` is read-only, its **output is the product**. Render as an image card (thumbnail + lightbox), not as a generic JSON tool. Title: "Screenshot · hostname".

---

### 4. Terminal cards (phase 1 = enriched generic)

Default collapsed row:

- `$ npm test` (from `describeToolCall`)
- Status + optional exit hint if present in output

Expand:

- Stdout/stderr text, clamped with "Show more"
- Copy command / copy output

Do not open a modal for terminal in phase 1.

---

### 5. Generic tool cards

**Default:** single line inside the batch:

`✓ Web Search · "pane agent"` / `✓ Snapshot` / `✓ filesystem_ls · src/`

**Expand (per row or per Details):**

- Parameters: pretty-printed JSON (from `input`), size-capped.
- Result: text extracted from MCP-style `{ content: [{ type: 'text', text }] }` or string output; if image parts exist, render them; if huge, truncate with "Show more".
- Errors: `errorText` / `isError` surfaced first.

**Use the existing AI Elements `Tool` / `ToolInput` / `ToolOutput` as visual reference**, but product styling should match Task/chat density (less border-heavy than the generated demo component if it fights the panel).

**Unknown MCP tools:** same generic path; title = prettified tool name.

---

### 6. Batch container behavior (revisiting `ToolBatch`)

Today: trigger title `3/3 actions completed`; body = name rows; auto-open only for last batch while streaming or when approval needed.

**New behavior:**

| Situation | Batch chrome | Body |
|-----------|--------------|------|
| Streaming last batch | Open (or partially open) | Running rows + completed specialized cards as they finish |
| Idle, only generics | Collapsed | Summary: `8 steps · 2 errors` |
| Idle, has file/browser cards | **Show specialized cards even when batch collapsed** — either pin them outside the chevron or keep batch open enough to show them | Generics remain nested |
| Approval pending | Open (unchanged) | ApprovalCard |
| Historical message | Collapsed summary + specialized cards visible | — |

**Decision:** Specialized cards are **first-class citizens of the transcript**, not trapped behind "actions completed." The batch summary becomes secondary chrome ("Also: 5 reads/snapshots").

Suggested visual structure for a mixed batch:

```
[ Diff card: Edited README.md +2 −1 ]
[ Browser card: Clicked "Star" · github.com ]
▸ 4 more steps (snapshot, wait, tabs, grep)
```

---

### 7. Agent Command parity

`ToolEntry` today is `{ id, name, label, subject?, status, durationMs? }` — too poor for evidence.

**Product requirement:** Agent Command must show the same specialized cards. If the harness stream does not carry full tool output, show the best available label/subject and an honest "Details unavailable for this run" rather than a fake diff.

---

## States

| State | File | Browser | Generic |
|-------|------|---------|---------|
| `input-streaming` / partial | "Preparing edit…" | "Preparing action…" | Tool name + pending |
| `input-available` / running | "Editing `path`…" | "`Clicking`…" | Running |
| `approval-requested` | ApprovalCard (existing) | ApprovalCard | ApprovalCard |
| `output-available` | Diff card | Evidence card | Collapsed success row |
| `output-error` | Error card | Error card | Error row + expand |
| `output-denied` | Denied treatment (existing icon) | Same | Same |
| Stale / pruned media | Diff text if kept; else placeholder | "Screenshot unavailable" placeholder | Text only |

---

## Interactions

| Action | Result |
|--------|--------|
| Click file card | Open diff modal |
| Click browser thumbnail | Open lightbox |
| Click generic row chevron | Expand input/output |
| Click batch "N more steps" | Expand generics list |
| Copy buttons | Copy path / diff / command / output |
| Approve / Deny / Promote | Unchanged (`ApprovalCard`) |
| Stop run | In-flight card settles to cancelled/error per runtime behavior; no fake success |

**Click-target rule:** Do not nest competing buttons on the preview. Primary = open detail. Secondary actions use explicit text buttons inside expanded/detail views.

---

## Content & truncation rules

| Content | Chat peek | Detail |
|---------|-----------|--------|
| Unified diff | ≤ 12 lines | Full up to soft cap (e.g. 2–5k lines); beyond that, paginate or "too large" |
| File create content | ≤ 12 lines | Soft cap |
| Screenshot | ~240–320px wide thumb | Lightbox up to capture size |
| Tool JSON | Hidden | ≤ ~20 KB rendered; truncate with notice |
| Snapshot a11y trees | Never as specialized card | Truncated in generic Details only |
| Secrets | No special redaction in v1 beyond local+mask | Document risk; optional redaction later |

---

## Edge cases

1. **Rapid-fire tools (20+ in one turn):** specialized cards for mutations only; generics aggressively collapsed into one "N more steps" group. Consider virtualization only if scroll jank is measured.
2. **Duplicate toolCallIds / acpx phantoms:** keep existing filter in `getMessageSegments` (drop `acpx-*` phantoms).
3. **Tool output shape variance:** MCP `content[]`, AI SDK tool parts, string outputs, dry-run prefixes — extractors must be tolerant (ApprovalCard's `extractOutputText` is a starting point).
4. **Dry-run / "Needs approval" text in output:** still ApprovalCard / promote path; do not render as a successful diff.
5. **Streaming partial JSON input:** never render a half-parsed diff; wait for output.
6. **Conversation reload:** if images were stripped from persisted history, show placeholders; file diff text should persist when stored in message parts.
7. **Incognito + screenshot:** show locally; do not weaken private mode elsewhere.
8. **Harness agents:** may emit different tool names; map when known, else generic.
9. **User runs Chat mode with read tools:** tiny collapsed rows OK; no browser action cards.
10. **Side panel width resize:** peeks reflow; modal/lightbox use overlay portal (not clipped by panel).
11. **Empty diff (no-op edit):** show success with "No textual change" rather than an empty peek.
12. **Multi-tab agent:** caption should include page/tab identity when `page` id or URL is known.

---

## Privacy, performance, storage

### Privacy

- All previews are **local UI over local tool results** (State A).
- Conversation region remains analytics-masked.
- Settings (phase 2): toggle browser screenshots in chat; optional "blur screenshots until click" for shared-screen anxiety.
- Align with [10](./10-trust-privacy-security.md): visibility increases trust; it must not become silent exfil.

### Performance budgets (product-level)

- Chat scroll should stay smooth with **≤ 50 tool cards** in a thread without noticeable jank.
- Thumbnails decoded/resized for display; do not keep full-res PNG strings mounted for every historical message (lazy-mount in viewport).
- Diff modal parses on open, not for every peek.
- Prefer **not** adding an extra screenshot CDP round-trip per `act` in phase 1.

### Storage

- Product expectation: message history keeps **textual** tool I/O needed for peeks; **large images** may be truncated in persistence with placeholders on reload (exact policy is an eng open question — see below).
- Do not require a new cloud store.

---

## Success metrics

| Metric | Intent | Target (directional) |
|--------|--------|----------------------|
| **Evidence coverage** | % of file-mutation tool calls that render a diff/create card | ≥ 95% when output/input available |
| **Browser evidence coverage** | % of `act`/`navigate` that show caption + (image or page-diff summary) | ≥ 90% |
| **Expand rate on generics** | Do users need raw I/O? | Monitor; high rate may mean summaries are weak |
| **Diff modal open rate** | Are peeks enough? | Inform peek length tuning |
| **Interrupt / undo adjacent** | Trust proxy | Qualitative + existing interrupt rate from [03](./03-agent-modes-and-the-loop.md) |
| **Perf** | p95 chat scroll FPS / interaction delay with heavy threads | No regression vs pre-change baseline |
| **Support / "what did it do?"** | Qualitative reduction in confusion | Founder/user feedback |

Instrumentation: local/anonymous events only if analytics opt-in; event names under existing `ui.*` patterns — no payload bodies.

---

## Phased rollout

### Phase 1 — "See the work" (ship first)

**Must ship:**

1. File change cards for `filesystem_edit` / `filesystem_write` with peek + diff modal.
2. Browser action cards for `act` / `navigate` with human caption + page-diff/fallback summary; render images when already present (including `screenshot` tool).
3. Generic collapsed rows with expandable input/output.
4. Batch restructuring so specialized cards are not hidden behind "N actions completed."
5. Side panel + shared chat path; Agent Command best-effort parity.

**Explicitly defer:** mandatory post-`act` screenshots, terminal specialized card, app-send cards, live watch pane, open-in-editor.

### Phase 2 — Richer evidence

- Post-action stills for browser mutations (screencast cache / cheap capture).
- Terminal specialized card.
- App/external send cards.
- Settings for screenshot visibility / blur-until-click.
- Coalesce multiple edits to the same file (optional).
- Link consequential cards to Action Log entries.

### Phase 3 — Watch & replay (ties to spec 03)

- Live "watch" view while agent runs (cockpit-like mini screencast in or beside chat).
- Step replay through a past run's evidence.

---

## Kill / pull-back criteria

- If specialized cards cause **measurable side-panel jank** or memory growth on long threads, collapse peeks (stats-only) and keep modal/lightbox only.
- If users routinely ignore cards and only read prose, simplify further (caption-only, no peek) rather than adding more chrome.
- If screenshot-in-chat creates privacy incidents or user complaints in shared-screen contexts, default screenshots to blur-until-click or OFF.

---

## Interactions with other specs

| Spec | Relationship |
|------|----------------|
| [01 Principles](./01-product-principles.md) | Directly implements "Show the work. Always." and performance budget tenets |
| [03 Loop](./03-agent-modes-and-the-loop.md) | Specializes the "tool transcript" and partially delivers "live snapshot" later |
| [05 Workspace](./05-workspace-files-terminal.md) | File card UX is the visibility layer for Cowork/workspace tools |
| [09 MCP / harness](./09-integrations-mcp-developer-surface.md) | Unknown tools → generic path; harness streams may lack full I/O |
| [10 Trust](./10-trust-privacy-security.md) | Complements approvals + Action Log; does not replace them |
| [12 Metrics](./12-onboarding-activation-metrics.md) | Visibility should improve Agent activation confidence (qualitative) |

---

## Open questions

### For product / design

1. **Batch pinning:** Are specialized cards *outside* the chevron (recommended above) or is "batch always expanded when it contains file/browser cards" enough?
2. **Peek length:** 8 vs 12 lines — validate with real side-panel width once UI exists.
3. **Open in editor:** Is phase 2 worth it for the developer ICP, or is copy-path enough?

### For architect / eng (non-blocking for this product draft, blocking for implementation)

1. **Canonical evidence extraction:** Single shared parser from AI SDK / MCP tool parts → `{ kind, title, peek, detail, media[] }` used by side panel and Agent Command?
2. **`filesystem_write` preview source:** Safe to read `input.content` for create-preview, or should the server return a structured diff/stat object?
3. **Image persistence:** Are image content parts stored in conversation history today? If not, what placeholder/reload behavior do we commit to?
4. **Page-diff structured payload:** Is `includeDiff`'s structured content available on the UI message `output`, or only text flattened for the model?
5. **Post-action screenshots:** Latency/cost of capturing after every `act` vs polling screencast cache (`claw-server` path) vs phase-1 fallback only?
6. **Agent Command stream fidelity:** Can harness/agent-command events carry tool output/media, or only labels?
7. **Virtualization:** Need for windowing tool cards in very long threads?
8. **Diff rendering library / component ownership:** Reuse something internal vs minimal custom renderer in app UI?

---

## Appendix A — Target mental model (one turn)

```
User: Star the Pane repo on GitHub

Assistant (reasoning, collapsed)
Browser card: Navigated to github.com/browseros-ai/... 
Browser card: Clicked "Star" · github.com   [thumbnail if available]
▸ 2 more steps (snapshot, wait)

Assistant: Starred. You're supporting Pane now.
```

```
User: Fix the typo in README

File card: Edited README.md  +1 −1
  - Pane is an agentic browswer
  + Pane is an agentic browser
  [click → full diff modal]

Assistant: Fixed the typo in the first paragraph.
```

---

## Appendix B — What "done" looks like for phase 1

- A user can complete an Agent task involving **at least one file edit and one browser act** and, without leaving chat, answer: *which file changed, what roughly changed, what the browser did.*
- Generic tools never require reading JSON to know the tool *name and status*, but JSON is available in one expand.
- Approvals still work unchanged.
- No new cloud dependency.
|