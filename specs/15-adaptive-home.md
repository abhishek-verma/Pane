# 15 — Adaptive Home (the new tab that knows your day)

## Summary

The new tab is not a static homepage. It is the **visible surface where Pane's soul, memory, context graph, proactive work, and capture become something you feel**. Open a tab in the morning and see what actually matters: the meeting in twenty minutes with notes from last time, the three PRs still waiting, the research thread you left off yesterday, one-click actions for the report you run every Friday. The home **evolves** because Pane learns your rhythms — widgets, digests, and shortcuts rearrange themselves as your work changes.

This is the README's "A new tab that knows your day" and "auto-evolving widgets." It is not a new engine; it is the **presentation layer** over capabilities defined in [02](./02-the-context-graph.md), [04](./04-memory-and-learning-loop.md), [06](./06-task-and-work-management.md), [07](./07-proactive-and-scheduled-work.md), [11](./11-personalization-skills-marketplace.md), and [14](./14-passive-capture-and-context-buckets.md). It is intrinsic State A — everything it shows is computed locally from your graph, memory, tasks, and captures.

> **Build on BrowserOS, not from scratch.** BrowserOS already ships a single `app` entrypoint serving new tab + home (`entrypoints/app/App.tsx`) with a personalize screen and a `NewTabBranding` / `NewTabChat` surface. The agent-command home (`AgentCommandHome.tsx`) is the existing composer. This spec extends those into an adaptive widget host; it does not introduce a new entrypoint.

---

## Goals

- A new-tab home that shows **what matters now**, derived from local state — not a static list of shortcuts for everyone.
- **Widgets that evolve**: the set, order, and content of widgets change as Pane learns your rhythms (activity memory, layer 4) and as your persona/bucket shifts.
- **One-tap actionability**: every widget offers a next action (join the meeting, open the resumed thread, run the recurring report, approve the pending run).
- **Honest about what's ready**: widgets only appear for capabilities that exist; nothing fakes a feature that isn't shipped yet.
- **Quiet by default, expressive on demand**: a calm default, with personalization depth for power users.

## Non-goals

- A full dashboard builder / no-code widget editor in v1. Personalization first; a custom-widget SDK is a later extension point.
- Pulling data from Pane servers. Everything is local. A "team" widget surface is State B.
- Replacing the chat composer. The adaptive home surrounds and feeds the existing `NewTabChat` / `AgentCommandHome`; it doesn't replace it.

---

## User stories

- "I open a new tab at 9am. The top card is my 9:20 standup with a one-line recap of last week's decisions (from the meeting bucket) and a Join button. Below it: the three PRs I was reviewing yesterday, and the research thread I left mid-read on Thursday."
- "Every Friday I run the same competitor scan. This morning the home offered a one-click 'Run weekly competitor scan' — Pane wrote that skill from watching me ([04](./04-memory-and-learning-loop.md))."
- "I switched to my 'job hunt' bucket. The home reshaped: a fit-scored listing I had open yesterday, two applications in flight, and an interview-prep card built from pages I'd read about that company."
- "I don't want the home to be busy. I hid the digest widget; the home is just my resumed tabs and the chat box. Pane remembered that preference."

---

## Spec

### Widget model

A **widget** is a small, self-contained card with: a `type`, a `data source` (a local query over the graph/memory/tasks/captures), a `render`, and an optional `action`. Widgets are **derived, not authored**: the home engine selects and orders them from local state.

| Widget | Source | Action | Appears when |
|--------|--------|--------|--------------|
| **Next meeting** | Calendar via integration ([09](./09-integrations-mcp-developer-surface.md)) + meeting bucket ([14](./14-passive-capture-and-context-buckets.md)) | Join; open last meeting's notes | A meeting is within ~30 min (or started) |
| **Daily digest** | Proactive engine ([07](./07-proactive-and-scheduled-work.md)) | Open full digest; act on items | Morning / on first launch |
| **Resumed work** | Open tabs + graph "last active" thread ([02](./02-the-context-graph.md)) | Restore the tab set + files for that thread | There's an unfinished thread from a prior session |
| **Pending approvals / waiting** | Action log ([10](./10-trust-privacy-security.md)) + tasks ([06](./06-task-and-work-management.md)) | Approve/deny; jump to the run | Something needs you |
| **One-click recurring** | Skills with a detected cadence ([04](./04-memory-and-learning-loop.md)) | Run the skill now; schedule it | A skill matches a rhythm (e.g. "Fridays") |
| **Research thread** | Research bucket ([14](./14-passive-capture-and-context-buckets.md)) | Resume; draft an outline | An active research bucket exists |
| **Page-reshape hint** | Page-reshape engine ([16](./16-page-reshape-and-overlays.md)) | "Show fit score / margin notes on this page" | You're on a page Pane can reshape |

### How it evolves

- **Ranking from activity memory.** The home engine queries layer 4 ([04](./04-memory-and-learning-loop.md)) for what you actually do at this time of day / week, and surfaces the widgets whose sources match. "You open analytics every weekday ~9am" → the analytics/resume-work widget ranks up at 9am.
- **Persona + bucket shape the set.** The active `soul.md` persona and the active context bucket ([14](./14-passive-capture-and-context-buckets.md)) filter which widgets are eligible. Job-search partner + job-hunt bucket → fit-score and applications widgets; chief of staff + work bucket → meetings and PRs. This is the shape-shifting thesis made visible ([00](./00-vision-and-thesis.md)).
- **Rearrangement is gentle and explained.** Widgets don't jump around chaotically; ranking changes are smoothed (hysteresis). When a new widget appears for the first time, it carries a one-line "why this is here" so the home feels legible, not spooky. Users can pin, hide, or dismiss any widget; dismissals feed a preference into `USER.md` ([04](./04-memory-and-learning-loop.md)).
- **Auto-evolving, not auto-cluttering.** The home obeys the curation discipline from [04](./04-memory-and-learning-loop.md): a widget that's never acted on over a long window demotes and eventually hides (the user is told, undoable). The home gets more useful, not noisier.

### Privacy & consent

- Everything the home shows comes from local state only. No page content is sent anywhere; widget data is computed in-process from the graph/memory/SQLite.
- Widgets that reference capture (meetings, research) only appear if capture is consented for that bucket ([14](./14-passive-capture-and-context-buckets.md), [10](./10-trust-privacy-security.md)).
- A "what's on my home and why" view lists every active widget, its source query, and a one-tap hide — the same inspectability principle as memory.

### Performance budget

The home renders in **<150 ms** on open (principle 12). Widget queries are cheap (SQLite/FTS5, no LLM calls at render time). LLM-generated content (digest summaries, outline drafts) is **pre-computed** by the proactive engine ([07](./07-proactive-and-scheduled-work.md)) and cached, not generated on tab-open. On battery / low-resource, widget freshness relaxes (principle 12).

---

## Interactions with other specs

- **02 — Context Graph**: "resumed work" and "research thread" widgets read the graph's last-active threads and buckets.
- **04 — Memory & Learning Loop**: activity memory ranks widgets; the curation discipline demotes stale widgets; `USER.md` stores home preferences.
- **06 — Task & Work Management**: pending-approvals and waiting-on widgets read the task inbox + action log.
- **07 — Proactive & Scheduled Work**: the daily digest widget is the visible home for the digest; the proactive engine pre-computes widget content on a cadence.
- **09 — Integrations**: the next-meeting widget reads calendar via Connect Apps.
- **10 — Trust**: widget data is local + consented; capture-dependent widgets respect capture consent.
- **11 — Personalization**: the active `soul.md` persona + bucket shape the widget set.
- **14 — Passive Capture**: meeting and research widgets read the meeting and research buckets.
- **16 — Page Reshape**: the home surfaces a reshape hint when the active page can be reshaped.

---

## Edge cases

- **Nothing to show yet (new user / empty graph):** fall back to the existing BrowserOS new-tab — most-visited sites (from import) + the chat composer + a single "Summarize this page" prompt. No fake widgets. This is the day-one state ([12](./12-onboarding-activation-metrics.md)).
- **Capture disabled:** meeting/research widgets simply don't appear; the home degrades gracefully to graph + tasks + chat.
- **Persona/bucket with no relevant widgets:** show the calm default (resumed tabs + chat) rather than padding.
- **Conflicting rhythms:** if two widgets compete for the top slot, rank by recency × frequency × persona-relevance; never show both full-size.
- **Cold mornings (laptop was closed):** the home catches up on launch — the proactive engine runs the digest job and populates widgets then ([07](./07-proactive-and-scheduled-work.md)).

---

## Kill criteria

- If the home is dismissed/reset to default by >40% of WAU, the ranking/persona-driven set is wrong — rework ranking before adding widgets.
- If "one-click recurring" widget runs are rejected >50%, skill detection is too eager — tighten the cadence bar ([04](./04-memory-and-learning-loop.md)).
- If widget render time exceeds budget on median hardware, move more computation off the render path (cache harder).

---

## Open questions

1. **Widget SDK vs. fixed set in v1?** *Lean: fixed, curated set in v1; a widget extension point (local MCP/HTML) is a later State A extension once the ranking model is proven.*
2. **Does the home differ between the new-tab page and a dedicated "home" route?** *Lean: one adaptive home, same engine, rendered in both places (BrowserOS already routes both through the single `app` entrypoint).*
3. **How aggressively do widgets rearrange?** *Lean: smooth ranking with hysteresis; structural changes (a widget type appearing/disappearing) require user dismiss/confirm for the first occurrence.*

---

## Metrics

- **Home engagement**: actions-per-home-open (taps on widget actions), and % of sessions where the user acts on a home widget before opening the chat composer.
- **Widget adoption/retention**: per-widget show → action rate; hide/reset rate (kill-criterion input).
- **Evolution signal**: number of distinct widget layouts a user sees per week (too low = static, too high = chaotic).
- **"Why this is here" dismissal**: if users dismiss the explanation >30%, it's noise — reduce frequency.
- **Day-1 fallback health**: % of new-user sessions that start in the calm default and still reach activation (proves the fallback isn't a dead end).
