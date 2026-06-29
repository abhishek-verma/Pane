# 04 — Memory & Learning Loop

## Summary

Pane remembers, and gets better at your work over time. This spec rebuilds the Memory and Skills surfaces that v0.46 pulled back, modeled on the strongest idea in Hermes — the self-improving learning loop — but **grounded in the Context Graph** so memory and skills are written from your real browsing, files, and terminal activity, not only from conversation. Pane's memory is open (plain files you can read and edit), local-first, permissioned, and auditable. Skills follow the agentskills.io standard so they are portable to Claude Code, Cursor, and other tools.

This is what makes Pane "get smarter every day" without becoming a black box.

> **Review v0.2 note.** Three decisions: (1) **`write_approval` default = `false` for conversation-derived writes, `true` for inferred (layer 4) writes** — inferred facts stage for review even when the gate is off, because injection/incorrect-inference risk is higher. (2) Added a concrete example of **why browser-grounded learning is strictly better** than conversation-only. (3) Strengthened the **"agent remembered something wrong"** trust handling. External memory providers move to a later phase.
>
> **Review v0.3 note.** Restated as a **system** fact: **auto-skill-creation and memory are intrinsic, day-one, zero-Pane-server capabilities.** The learning loop runs on-device, writes local files, and retrieves them locally — the "becomes smarter every day" promise is fully delivered in State A with no marketplace and no account. The hosted marketplace and external memory providers are **State B extension points**, not dependencies. Builds on the v0.46 pulled-back Skills/Soul/Memory (rebuild), not greenfield. **New feed in v0.3: passive capture** ([14](./14-passive-capture-and-context-buckets.md)) — meeting facts and browsing-learnings flow into the memory loop continuously, not only from explicit agent runs.
>
> **Review v0.4 note (HoP pass).** Added the **curation & pruning half** of the learning loop — auto-skill-creation is a storage leak without it (use-tracking demotes/archives, conflicts resolved, memory entries demoted when never recalled, a monthly curation digest). The rule: the system must get measurably *smarter*, not just *heavier*. Also added a performance-budget note: the continuous review loop + passive extraction run on a cheaper model with rate limits and pause-on-battery, so "always learning" doesn't mean "always draining."

---

## Goals

- Persistent, curated memory that survives across sessions and devices (with opt-in sync).
- A self-improving loop that extracts reusable **skills** from successful work.
- Ground memory and skills in the Context Graph (real activity), not just chat.
- Keep memory bounded, cheap, and inspectable; never auto-grow into a token monster.
- Make every memory/skill write visible, editable, and revocable (principles 4, 5, 8).

## Non-goals

- Fine-tuning models or training anything. The moat is accumulated knowledge, not weights.
- A semantic knowledge graph with entity extraction (the Context Graph stores activity; memory stores curated facts).
- Replacing the user's judgment. The loop proposes; the user can gate.

---

## The five memory layers

Adopted from the Hermes model, with a browser-grounded twist. Each layer is independently disableable.

| Layer | Purpose | Load timing | Storage |
|-------|---------|-------------|---------|
| **1. Prompt memory** | Always-on files: `SOUL.md` (agent identity/persona) + `USER.md` (user profile) + `MEMORY.md` (agent notes) | Every session, frozen snapshot at start | Plain files in `~/.browseros/memories/` |
| **2. Skills** | Procedural "how I do X" recipes (`SKILL.md`) | On-demand, only the index in the prompt | Plain files in `~/.browseros/memories/skills/` |
| **3. Session archive** | Episodic memory: every conversation + agent run | On retrieval (FTS5) | SQLite (`~/.browseros/db/`) |
| **4. Activity memory** | Browser/file/terminal/app events from the Context Graph | On retrieval + feeds the review | The Context Graph (see [02](./02-the-context-graph.md)) |
| **5. User model** | Derived preferences & patterns (optional) | Continuous, optional | Local store; external provider optional (Honcho-style) |

**Layer 4 is Pane's addition over Hermes.** It is what "the agent is the browser" buys: the loop learns from what you *did* (you opened the same dashboard at 9am five days running, you always export the same report), not only from what you *said*.

**`SOUL.md` is Pane's persona layer (the "browser with a soul").** Distinct from `USER.md` (who *you* are) and `MEMORY.md` (what the agent noticed), `SOUL.md` is who *Pane* is for you right now — its role, voice, boundaries, and active persona (e.g. "chief of staff" vs "job-search partner" vs "research buddy"). It is the file that makes Pane *become whatever you need it to be* (see [00](./00-vision-and-thesis.md) "A browser that becomes yours" and [11](./11-personalization-skills-marketplace.md)). The active persona is shaped in onboarding, switchable, and can shift with the active context bucket — but it is always a plain, readable, editable file, never a hidden knob.

**Why this is strictly better (concrete):** In Hermes, a skill "export the Acme weekly report" can only be written from a conversation where the user described the steps, or from a terminal script. In Pane, the agent watches you open `acme.example.com/analytics`, click Export, choose CSV, rename it `weekly.csv`, and move it to `~/Documents/q3-launch` — across five Mondays — and writes a `SKILL.md` capturing the *exact* clicks, selector paths, file rename, and destination, with the source runs linked. The next Monday it offers to do the whole thing in one click. Hermes cannot write that skill because it never saw the clicks; it only heard you talk about them.

---

## Prompt memory (layer 1)

Three files, injected into the system prompt as a frozen snapshot at session start (preserves prefix cache):

| File | Purpose | Char limit (default) |
|------|---------|----------------------|
| `SOUL.md` | Agent identity/persona: the role Pane plays for you right now, its voice, boundaries, active persona (chief of staff / job-search partner / research buddy / custom) | 1,500 (~550 tokens) |
| `MEMORY.md` | Agent's notes: environment, projects, conventions, lessons | 2,200 (~800 tokens) |
| `USER.md` | User profile: name, role, timezone, communication style, preferences | 1,375 (~500 tokens) |

- `SOUL.md` is the persona layer — see [11](./11-personalization-skills-marketplace.md). It is user-editable; the agent proposes persona shifts (e.g. "you're job-hunting now — switch to job-search partner?") gated by `write_approval`. The active persona can follow the active context bucket so Pane is one thing at work and another at home, without leaking buckets into each other.
- The agent manages memory via a `memory` tool with `add`, `replace`, `remove` actions and substring matching (same shape as Hermes).
- No `read` action — content is already in the prompt.
- **Capacity management**: when an `add` would overflow, the tool returns an error with current entries and the agent consolidates in the same turn. No silent drops.
- **Duplicate prevention** and **injection/exfiltration scanning** before accepting writes (content with prompt-injection patterns, credential exfil, invisible Unicode is blocked).

### What to save (proactively)

- User preferences ("I prefer terse replies", "TypeScript over JavaScript") → `USER.md`
- Environment facts ("machine is macOS, uses Homebrew, has Docker") → `MEMORY.md`
- Project conventions ("repo uses tabs, 120 cols, `make test`") → `MEMORY.md`
- Corrections ("don't use sudo for Docker, I'm in the docker group") → `MEMORY.md`
- Browser-grounded facts ("I always log in to Acme via SSO, never the password form") → `MEMORY.md` (from layer 4)

### What to skip

- Trivial/ephemeral info, easily re-discovered facts, raw dumps, anything already in a granted file or page.

---

## Skills (layer 2)

A **skill** is a `SKILL.md` file encoding a reusable procedure. Pane skills follow the [agentskills.io](https://agentskills.io) standard (same as Claude Code, Cursor, Hermes), so they are portable.

```
~/.browseros/memories/skills/
  acme-export-report/
    SKILL.md          # frontmatter + steps
    examples/         # optional worked examples
```

- Only the **skill index** (name + one-line description) lives in the system prompt. Full bodies load on demand via a `skills.load` tool. This avoids the "heavy backpack" problem OpenClaw has (everything in the prompt at once).
- The agent retrieves relevant skills at the start of a turn via `context.search` over the skill index.
- Skills are **inspectable, editable, portable** — plain files, open format.

### Skill creation (the learning loop)

```mermaid
flowchart LR
    run[Successful agent run<br/>in Context Graph] --> review[Background review<br/>cheaper model]
    review --> propose{Worth a skill?}
    propose -->|yes| draft[Draft SKILL.md]
    draft --> gate{write_approval?}
    gate -->|off| write[Write to disk]
    gate -->|on| stage[Stage for review]
    stage --> approve[User: /skills approve|reject]
    approve --> write
    write --> index[Add to skill index]
```

- **Trigger**: after a multi-step agent run with ≥ N tool calls (default 5) and a successful outcome, a **background review** (cheaper model by default, configurable) replays a compact digest and decides whether the workflow is reusable.
- **Draft**: the review proposes a `SKILL.md` with a name, description, trigger conditions, and step-by-step procedure, including the browser/file/terminal tools used.
- **Gate**: `skills.write_approval` (default `false` = write freely; `true` = stage). Even when off, a short `💾 Skill 'foo' created` notification surfaces in chat (controllable via `display.memory_notifications`).
- **Patch, not just create**: the review can also **patch** an existing skill when a run reveals an improvement (e.g. an extra step that avoids a known failure). Patches show a one-line gist; full diff available in the CLI / Context panel.

### Skill provenance

Every skill records:
- `provenance`: `agent-written` | `user-written` | `marketplace` | `migrated`
- `source_run`: link to the Context Graph agent-run node it was extracted from
- `created_at`, `patched_at`, `uses`, `success_rate` (updated as it's used)

This lets the user see *why* a skill exists and delete the ones that came from a bad run.

### Curation & pruning (the anti-bloat loop)

Auto-skill-creation is a **storage leak** if it never prunes. A system that writes skills from every run but never retires them gets *worse* over time: the skill index bloats, retrieval loads the wrong skill, and the user concludes "the agent got dumber." So the learning loop has a matching **curation** half:

- **Use-tracking demotes, then retires.** A skill with `uses = 0` after N days (default 30) is **archived** (out of the active index, kept on disk with provenance). A skill with `success_rate < threshold` over its last K uses is **flagged** ("this skill keeps failing — re-derive or delete?") and, after another K failures, archived. Archived ≠ deleted — the user can restore.
- **Conflict resolution.** When two skills match the same trigger, the loop picks the higher `success_rate` / more-specific one and **tells the user**; the loser is a candidate for archive (see [11](./11-personalization-skills-marketplace.md) edge cases).
- **Memory has the same discipline.** Memory entries carry a `last_surfaced` timestamp + `usefulness` signal; entries never recalled and never confirmed over a long window are **demoted** out of the always-on prompt memory (still in the session archive, still searchable, just not loaded into every turn). Bounded memory is a feature, not a bug.
- **A monthly curation digest** (proactive, [07](./07-proactive-and-scheduled-work.md)): "I archived 4 skills you hadn't used and flagged 2 that kept failing — review?" One screen, undoable.

The rule: **the system should get measurably smarter, not just fuller.** Curation is what makes "becomes smarter every day" true instead of "becomes heavier every day."

---

## Session archive (layer 3)

- Every CLI, side-panel, command-center, and channel conversation is stored in SQLite with **FTS5** full-text search.
- `session_search` tool: discovery ("did we discuss X?"), scroll within a session, browse past sessions.
- Free retrieval (no LLM call), ~20ms FTS5 query.
- Distinguishes `memory` (always-on critical facts) from `session_search` (specific past conversations).

---

## Activity memory (layer 4) — the browser-grounded layer

The Context Graph's activity log **is** layer 4. The review loop reads it to find patterns the agent should remember or skill-ify:

- "User opens `acme.example.com/analytics` every weekday ~9am → surface a 'morning analytics' proactive card ([07](./07-proactive-and-scheduled-work.md))."
- "User always exports the same report after viewing analytics → propose a skill `acme-morning-export`."
- "User corrects the agent the same way twice → memory write."

Layer 4 is what makes Pane's loop strictly richer than Hermes's: Hermes learns from conversation + terminal; Pane learns from the full browser activity graph.

### Passive capture as a layer-4 feed (v0.3)

[14 — Passive Capture & Context Buckets](./14-passive-capture-and-context-buckets.md) adds two continuous feeds into layer 4, with consent:

- **Meeting facts/decisions** → written as memory items in the meeting + project buckets; action items become tasks ([06](./06-task-and-work-management.md)).
- **Browsing learnings** → repeated workflows become candidate `SKILL.md` files in the auto-skill loop; repeated facts become staged memory writes.

This makes the "becomes smarter from real activity" engine *continuous* (the loop runs while you browse and meet), not only triggered by explicit agent runs. Inferred writes from passive capture follow the layer-4 staging default (review before promotion).

---

## User model (layer 5, optional)

- Derived preferences and behavioral patterns, on-device by default.
- Optional external provider support (Honcho, Mem0, etc.) for users who want deeper user modeling, running **alongside** built-in memory, never replacing it.
- `hermes memory setup`-style onboarding: `pane memory setup` to pick a provider.

---

## The nudge engine

A **periodic review** that fires every N turns/tasks (default 10) — the Hermes nudge pattern, with the gateway-starvation bug fixed (the counter is derived from persisted session history, not an in-memory variable, so it survives session resets).

On a nudge, the agent:
1. Looks back at recent activity (conversation + graph events).
2. Decides what's worth persisting (memory) and what's a reusable procedure (skill).
3. Writes curated entries — not dumps.

Nudges respect `write_approval` and the global "suggest, don't nag" rate limit (principle 6).

### The learning loop runs on a budget

"Always learning" must not mean "always draining." The continuous review + passive-extraction loop obeys principle 12 (performance is a hard budget):

- **Cheaper model by default** for review/extraction (the Hermes ~3–5× cheaper lesson); configurable.
- **Rate-limited**, not streaming: extraction runs on a cadence (e.g. every N minutes of active browsing), not on every page load.
- **Pause on battery / low-resource**: on laptops unplugged or under load, passive extraction and background review suspend; the glow indicates "capture paused." Scheduled work still fires (it's user-requested).
- **On-device embeddings are opt-in** and run on the GPU/NPU when available, idle-priority (cross-ref [02](./02-the-context-graph.md)).

---

## Controlling memory and skills

```yaml
# ~/.browseros/config.yaml ( Pane-native config )
memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200
  user_char_limit: 1375
  write_approval: false        # gate memory writes
  nudge_interval: 10
skills:
  write_approval: false        # gate skill writes
  creation_nudge_interval: 15
  min_tool_calls: 5
display:
  memory_notifications: on     # off | on | verbose
auxiliary:
  background_review:
    model: auto                 # or a cheaper model
```

Commands (CLI + side panel + channels):

- `/memory` — view, `/memory pending`, `/memory approve|reject`, `/memory approval on|off`
- `/skills` — view, `/skills pending`, `/skills diff <id>`, `/skills approve|reject`, `/skills approval on|off`
- `/memory forget <substr>` — remove an entry (also available from the Context panel UI)

---

## Migration from Hermes / OpenClaw

- **Hermes → Pane**: import `MEMORY.md`, `USER.md`, skills (`~/.hermes/memories/skills/*`), and session DB. Skills are agentskills.io-compatible, so they import directly. Map Hermes toolsets to Pane tools (e.g. `browser_*` → Pane browser tools).
- **OpenClaw → Pane**: import persona (SOUL/IDENTITY → `soul.md`), hand-written skills (import as `provenance: migrated`), and API keys.

Migration is a one-time wizard in onboarding (see [12](./12-onboarding-activation-metrics.md)).

---

## Interactions with other specs

- **02 — Context Graph**: layer 4 *is* the graph's activity log; skills link to source runs; memory writes can reference graph nodes.
- **03 — Agent Modes & The Loop**: the loop loads the skill index and runs the background review.
- **07 — Proactive & Scheduled Work**: activity patterns surfaced by the review become proactive nudges and proposed schedules.
- **08 — Reach & Channels**: memory/skill notifications and `/memory` `/skills` commands work over channels.
- **10 — Trust**: injection scanning on writes; memory is trusted context, page content is not — the loop must never let untrusted page text become a memory entry without review.
- **11 — Personalization & Skills**: the marketplace for sharing and discovering skills; `soul.md` (the persona/identity layer) is defined there and feeds the system prompt alongside `USER.md`/`MEMORY.md`.

---

## Edge cases

- **Memory full during a scheduled run**: the run consolidates in-turn; if it still can't fit, it skips the write and logs it for the next interactive session (no silent drop).
- **A bad skill** (extracted from a run that was actually wrong): `source_run` + `success_rate` let the user (or the review) detect and delete it. A skill with `success_rate` below threshold is auto-flagged.
- **"The agent remembered something wrong about me"** (the top trust risk): every memory entry is shown in `verbose` notifications with a one-tap **Revert**; `/memory forget <substr>` removes it from any surface; the Context panel shows the full memory store with per-entry delete. Inferred entries that staged are never saved without a yes. We treat a wrong memory as a P1 trust bug, not a minor annoyance — if early data shows users finding wrong entries *we didn't surface*, the default flips to fully gated.
- **Conflicting memory entries**: the agent merges on `replace`; the user is shown the merge in `verbose` mode.
- **Channel sessions and the nudge counter**: counter derived from persisted history so it is not starved in gateway mode (the Hermes bug).
- **Privacy of activity memory**: layer 4 events from `denied` or `ephemeral` context never persist to memory; only `granted` sources feed the review.

---

## Kill criteria

- If `write_approval=false` leads to user reports of "the agent remembered something wrong about me" above a low threshold, flip the default to `true`.
- If skill `uses` per skill is near-zero (skills are created but never retrieved), the extraction trigger is too eager — raise `min_tool_calls` and tighten the "reusable" bar.
- If memory notifications generate "disable" actions >30%, lower verbosity default.

---

## Open questions

1. ~~**Default for `write_approval`**:~~ **Decision (v0.2): split default** — conversation-derived writes `false` (free) with `verbose` notifications; inferred (layer 4) writes stage (`true`) by default.
2. **Char limits** — keep Hermes's 2,200 / 1,375, or raise? *Lean: keep; bounded memory is a feature.*
3. ~~**Layer 4 stricter gate?**~~ **Decision (v0.2): yes — inferred writes stage by default.**
4. ~~**External memory providers in v1?**~~ **Decision (v0.3): no — they're a State B extension point.** The 5 local layers are the intrinsic system; external providers plug in later behind the memory interface.

---

## Metrics

- **Memory adoption**: % of WAU with ≥1 memory entry after 7 days.
- **Skills created per user** (and `provenance` mix: agent vs. user vs. marketplace).
- **Skill retrieval rate**: skills loaded per agent session (proxy for the loop paying off).
- **Skill success rate** distribution; auto-flagged bad skills count.
- **`write_approval` opt-in rate** and pending-queue health.
- **Notification disable rate** (signal for verbosity tuning).
- **Migration completion rate** for Hermes/OpenClaw importers.
