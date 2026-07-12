# Phase 8 — Evolving Home: Widgets That Become Yours

> **For the agent:** Phase 8 is about making the new tab home a place users actually want to open. You are building three things simultaneously and they must reinforce each other: (1) a **visual redesign** of the home that feels modern, calm, and personal — not a dashboard of cards; (2) the **infrastructure** for user-defined and agent-proposed widgets stored locally; and (3) the **NL and activity-detection surfaces** that make widget creation feel like talking, not configuring. Think as a PM about what actually earns a daily habit. Think as a UX designer about what "calm and personal" means in a browser new tab. Then implement.
>
> Phase 7 (polish + packaging) is already shipped. Build on it. Do not start Phase 9.

---



## Part 1: PM brief — what this phase has to earn

The home is the only surface Pane owns fully. Every other surface (the page, the sidebar, the task queue) competes with the browser itself. The home does not. When a user opens a new tab, they land here. **The question is whether they look at it or immediately type a URL and move on.**

Right now, the home fails to earn attention because:

- The widgets render as a flat text list that looks like a sidebar section, not a curated surface.
- There is no personality. The heading says "What should your agent work on next?" — that is a task-management frame, not a "your browser knows your day" frame.
- The widget set is fixed and curated. The home cannot yet reflect anything specific to the user's actual work.

**What Phase 8 earns:** The user opens a new tab in the morning and sees their day represented accurately. Not generically. The research thread they left on Tuesday is there. The Friday competitor scan they always run is one tap away. When Pane proposes a new widget, it is because it noticed something real — and the user can add it in one tap or ask in plain language.

**The retention mechanic:** The home becomes the first place the user asks Pane to do something, because it already knows what "something" is likely to be. Engagement at home = retained user.

**The creative constraint:** The home must still feel calm. Widgets are information, not notifications. A good home shows 2–4 things at most, and those things are right. Not 8 widgets competing for attention. Curation is a product feature, not a technical limitation.

---



## Part 2: UX design brief — what the home should look like

Read this section before writing a single line of code. This is the design intent. Use your judgment to implement it well; do not cargo-cult the current card layout.

### The current state (what to fix)

The current `AdaptiveHomeWidgets` renders widgets as:

```
h2 title + Pin / Hide / Dismiss ghost buttons
small italic "why" text
content (a plain <ul> or text paragraph)
hr separator
```

This is utility UI. It is not a home. It lacks visual hierarchy, spatial rhythm, and personality. The Pin/Hide/Dismiss buttons are exposed immediately even though most users will never use them.

### The target aesthetic

The home should feel like a well-designed morning briefing. Reference points: Linear's home, Notion's sidebar, Vercel's dashboard. Not a news feed. Not a widget grid. Key qualities:

- **Spatial breathing room.** Generous padding. Content that does not touch edges. White space is not wasted space.
- **Typographic hierarchy.** The primary information in a widget (the meeting title, the research topic, the task count) should be large and legible. Secondary info (timestamp, source, count) should be small and muted. The "why this is here" explanation should be invisible unless the user wants it.
- **Subtle depth, not flat cards.** Widgets can have a very light background (`bg-card`, not `border-dashed`). Shadow is fine — `shadow-sm` — but nothing heavy. Rounded corners at `var(--radius)`. They should feel like objects you could pick up, not dividers in a list.
- **One primary action per widget, clearly afforded.** Not three ghost buttons at the top. The action (Join, Resume, Run, Approve) is the widget's CTA. It sits at the bottom-right or inline, in the orange accent color or a clear primary button, not a ghost variant. The management actions (pin, hide, dismiss) live in a `⋮` overflow menu that only appears on hover.
- **The composer is the hero, not the widgets.** The current layout centers a large heading and the composer at the top, then shows widgets below. This is good. Keep this hierarchy. Widgets are support, not the main event.
- **The heading should change.** "What should your agent work on next?" is a blank-canvas prompt. Once widgets exist, replace it contextually: if it's morning, greet the user with their day ("Good morning — here's your day"). If there is no context yet, the blank-canvas prompt is fine. The greeting does not need to be AI-generated; it can be a simple time-of-day + first-name from `USER.md`.
- **Widget layout:** A single-column layout of 2–4 widget cards, each with enough vertical space to feel distinct. Not a grid. Not two-column. The home is a vertical scroll, calm and focused.



### Widget visual anatomy (each card) (this is a suggestion, not a recommendation, use your own product and ux/ui intution) 

```
┌─────────────────────────────────────────────────────┐
│  [icon]  Title                          timestamp ⋮ │
│                                                     │
│  Primary content (1–3 lines max)                    │
│                                                     │
│  [Primary action button]                            │
└─────────────────────────────────────────────────────┘
```

- **Icon:** use a Lucide icon appropriate to the widget type (e.g. `CalendarClock` for meetings, `BookOpen` for research, `CheckCircle` for approvals, `RefreshCw` for recurring, `FileText` for digest, `Folder` for resumed work). The icon is small (`h-4 w-4`), muted foreground, sits to the left of the title.
- **Title:** `font-medium text-sm` foreground. The widget title (e.g. "Next meeting", "Research: Competitor pricing").
- **Timestamp:** `text-xs text-muted-foreground`, right-aligned. Shows recency ("in 12 min", "2h ago", "Tuesday").
- **⋮ menu:** `MoreHorizontal` icon, `text-muted-foreground`, appears only on card hover. Dropdown: Pin / Unpin / Hide / Dismiss / "Why this is here".
- **Primary content:** 1–3 lines of the actual information. For a meeting: "standup with eng team — notes from last Thursday available". For research: "Competitor pricing — 7 pages captured". For approvals: "2 actions waiting: `filesystem_write` in /projects, bash in /tmp". Do not show raw data structures; show human-readable summaries.
- **Primary action button:** `variant="default"` or `variant="secondary"` depending on urgency. For meetings: orange primary "Join". For research: "Resume thread". For approvals: "Review". For recurring: "Run now". For digest: "Read". For resumed work: "Restore tabs".



### The "why this is here" treatment

Instead of always showing the `why` italic text (which gets ignored quickly), move it to the `⋮` menu as "Why this is here". Show it inline **only** on first appearance (the first time a widget type surfaces) as a one-line annotation below the title, in `text-xs text-muted-foreground italic`. After the user has seen it once, stop showing it.

### Widget proposal card (new in Phase 8)

When Pane has staged a widget proposal, it surfaces as a **distinct card** — visually different from active widgets. It has:

- A `Sparkles` icon in the `--accent-orange` color (not muted foreground)
- The word "Pane suggests" in small caps above the title
- "Add to home" primary button + "Not now" ghost button
- "Why Pane is suggesting this" expandable (1–2 line explanation from the staged proposal's reasoning)



### Empty state

The current dashed-border empty state ("Your adaptive home will populate...") is fine as text but looks like a broken component. Replace it with something that looks intentional:

- A short sentence explaining what the home will show: "As you work, Pane will surface your meetings, open threads, and scheduled tasks here."
- Below: a list of 2–3 starter widget templates the user can one-tap to add (e.g. "Daily digest", "My open tasks", "Recent research thread"). These are instant adds from built-in templates with no further configuration.



### Performance constraint

All widget rendering must happen in **<150ms** from navigation. No LLM calls, no streaming. Widget data is pre-computed server-side and cached. The client fetches `/scheduler/home` once per tab-open (with 60s stale time via React Query, which is already wired). Keep this. The redesign must not add network round-trips or computation on the render path.

---



## Part 3: Implementation



### M8.1 — Widget definition model

Create the local widget spec format. This is the foundation for everything else in this phase.

**Server:** `~/.browseros/home/widgets/<id>.json` is the source of truth. SQLite `home_widgets` table (migration `0011_`*) is a rebuildable index.

Widget spec schema:

```typescript
interface WidgetSpec {
  id: string                           // ulid
  title: string                        // display title
  source: {
    type: 'tasks' | 'scheduled' | 'capture' | 'graph' | 'skills' | 'template'
    query?: string                     // human-readable filter (not raw SQL)
    templateId?: string                // for template-based widgets
    bucketId?: string                  // scope to bucket
  }
  action: {
    type: 'navigate' | 'chat-prefill' | 'run-skill' | 'open-route'
    target: string                     // URL, route, skill id, or chat prefill text
  }
  refreshMinutes: number               // how often data refreshes (default 5)
  createdBy: 'user' | 'agent' | 'system'
  status: 'active' | 'staged' | 'archived'
  showCount: number                    // times shown (for curation)
  lastActionAt: string | null          // ISO timestamp (for curation)
  whyText: string                      // human-readable explanation for ⋮ menu
  createdAt: string                    // ISO timestamp
}
```

Built-in templates (these exist as code, not files — the user can instantiate them):

- `open-tasks` — pending tasks from `listTasks`, action: navigate to `#/tasks`
- `pending-approvals` — extends the existing curated widget with this spec type
- `next-scheduled-run` — next run from `scheduled_runs`, action: navigate to `#/scheduled`
- `active-research-thread` — latest research bucket from capture, action: navigate to `#/capture`
- `daily-digest` — reads latest digest file, action: open full digest

Extend `loadHomeWidgets` in `scheduler/home.ts` to merge curated (existing Phase 5 logic) + user/agent widgets from the new table. Curated widgets run first; user widgets augment, do not replace. The ranking from `rankWidgets` applies to the merged set.

**App:** Extend `AdaptiveHomeWidgets.tsx` to handle the new `source.type` field and render accordingly. The new widget spec feeds into the same rendering pipeline; new widget types get new render branches.

### M8.2 — Natural-language widget creation

Let the user ask the home composer or the sidepanel chat to add a widget.

**Detection:** In `apps/server/src/agent/`, add intent detection that fires when the user says something like "add a widget for X", "show X on my home", "track X on the new tab". This does not require a separate intent-classification call — the LLM in the loop naturally handles this. What you need is the tool.

**Tools:**

- `home_widget_propose` (`write-local`) — agent drafts a `WidgetSpec` from the user's request mapped to a template or a bounded source query. Returns a preview JSON for user confirmation. Never writes without confirmation.
- `home_widget_add` (`write-local`) — writes the confirmed spec to disk and the SQLite index. Invalidates the home cache.
- `home_widget_remove` (`write-local`) — archives a widget by id. Soft delete: status → `archived`, file moved to `~/.browseros/home/widgets/archive/`.
- `home_widget_list` (`read`) — lists active widgets.

Wire these to MCP and CLI (`pane home widgets list|add|remove`).

**Bounded queries:** The agent must map user intent to a bounded source type, not generate arbitrary SQL or code. The tool schema enforces this: `source.type` is an enum and `source.query` is a human-readable filter string that the server maps to a predefined executor. If the user asks for something that cannot be expressed in the supported source types, the tool returns a friendly message explaining what is possible.

**Confirmation flow:** After `home_widget_propose`, the agent presents a card in the chat or home composer showing: widget title, source, preview data (1–3 items), action, and buttons: "Add to home" / "Edit" / "Cancel". The `home_widget_add` call only fires on explicit "Add to home" confirmation. This follows the same trust model as memory writes.

### M8.3 — Auto-widget proposals from activity

Pane should notice patterns and suggest widgets before the user asks.

**Pattern detection:** Add `apps/server/src/home/proposal-job.ts`, run by the existing server `setInterval` infrastructure (alongside the memory review job, 24h interval). The job reads:

- `scheduled_runs` — recurring jobs that have run ≥3 times and have no corresponding home widget
- Graph events in the last 7 days — domains visited repeatedly that correlate with an active bucket/task
- Skills — skills that have been invoked on a recurring cadence and have no widget
- Tasks — task clusters that have been manually checked repeatedly

For each pattern, draft a `WidgetSpec` with `status: 'staged'` and write it to `~/.browseros/home/widgets/staging/<id>.json`. Do not activate it. The user must confirm.

**Surfacing:** Staged widget proposals appear as a distinct "Pane suggests" card on the home (see UX section above). The home loader returns staged proposals separately from active widgets; the UI renders them at the top of the widget list (above curated widgets), styled distinctly.

**Dismissal:** Dismissing a proposal writes `home.widget-proposal.dismiss: <reason-hash>` to `USER.md` so the same pattern does not re-propose for 30 days.

**Volume limit:** Max 1 staged proposal surfaced at a time. If multiple patterns fire, the most confident one surfaces first; others stay in staging for the next day.

### M8.4 — Widget data bindings + actions

Make widget data loading concrete for all source types.

Add `apps/server/src/home/bindings.ts`. Each source type has a binding function that takes the widget spec and returns `{ items: Array<{ label: string, sublabel?: string, meta?: string }>, count: number }`.


| Source type | Binding                                                        | Data                      |
| ----------- | -------------------------------------------------------------- | ------------------------- |
| `tasks`     | `listTasks` filtered by `source.query` (e.g. "status:pending") | Task titles, count        |
| `scheduled` | `getNextScheduledRun` from `scheduled_runs`                    | Next run title, time      |
| `capture`   | `listCaptureSessions` filtered by bucket                       | Session title, page count |
| `graph`     | `graphCurrentWork` filtered by `source.bucketId`               | Thread titles             |
| `skills`    | `listSkills` filtered by cadence/tag                           | Skill names               |
| `template`  | Delegates to the named template's binding                      | Template-specific         |


The action type maps to:

- `navigate`: open a URL or chrome extension route (`window.open` or `window.location.hash`)
- `chat-prefill`: open the sidepanel with a pre-filled message
- `run-skill`: POST `/scheduler/runs` with the skill id
- `open-route`: navigate to an internal route

Pre-compute widget content on a server-side cadence (5 min for most, 1 min for `capture`/`scheduled`). Cache in SQLite `home_widget_cache` (key: widget id, value: JSON blob, expiry). The home loader reads from cache first, falls back to live query if cache is cold or stale.

### M8.5 — Curation for custom widgets

Extend the existing curation logic to apply to user/agent widgets.

**Per-widget tracking:** `home_widgets` table already has `showCount` and `lastActionAt`. Increment `showCount` on each home load. Update `lastActionAt` when the user triggers the widget's primary action (a call to a new `POST /scheduler/home/widgets/:id/action` endpoint).

**Demotion rule:** If `showCount > 10` and `lastActionAt` is null (or > 14 days ago), set `status: 'demoted'` in the next proposal-job run. The widget disappears from the home. The user is notified via a home banner: "A widget was hidden because you haven't used it. Undo?" (one-time, dismissible). Undo restores to active and resets the clock.

**Reset:** `POST /scheduler/home/reset` sets all user/agent widgets to `archived` and clears curated widget prefs. Returns the home to Phase 5 default state (curated only). Exposed via diagnostics page and CLI.

`#/settings/home` **route:** Add this settings page to the existing settings sidebar. It lists every active + demoted + archived widget with: title, source type, last action date, show count, and a status toggle (active/archived). Per widget: "Why this is here", "Edit", "Remove permanently". This is the power-user lens on the home.

### M8.6 — Home management UI and visual redesign

This module is split into two sub-tasks that must be done together because they are the same surface.

#### 6a: Visual redesign of AdaptiveHomeWidgets

Redesign `AdaptiveHomeWidgets.tsx` to match the UX brief in Part 2. Key changes:

- Replace the `border-b pb-4` separator style with proper card components (subtle background, rounded corners, light shadow)
- Move pin/hide/dismiss to a `MoreHorizontal` hover overflow menu
- Add a Lucide icon per widget type
- Render the primary content as a rich summary (not a raw `<ul>`) — see the widget anatomy spec
- Render proposal cards (status: `staged`) with the "Pane suggests" treatment
- Handle the new empty state with starter templates

Redesign `AgentCommandHome.tsx` contextual heading:

- Read `USER.md` from `/scheduler/home/prefs` response (extend the endpoint to include first name from `USER.md` if available) or just use time-of-day
- Replace the static "What should your agent work on next?" with: "Good morning, [name]" / "Good afternoon, [name]" if first name exists, otherwise keep the existing heading but make it slightly warmer: "What's on your mind today?"
- The `p` subtitle can become dynamically generated from what widgets are active: if there are widgets, replace the generic subtitle with something like "You have 2 items waiting and 1 meeting in 20 minutes" — computed from widget data, no LLM



#### 6b: "Add widget" affordance

Add a low-profile "Add widget" button to the home. It should not compete with the composer. Placement: small text button or icon below the widget list ("+ Add a widget"). On click, it opens a two-step modal:

1. **Template gallery:** a list of 4–6 built-in templates with short descriptions. Single-click to select.
2. **Configure:** the selected template's one or two parameters (e.g. "filter by bucket: [dropdown]"). Confirm adds the widget immediately.

Alternatively (the simpler path): clicking "Add widget" pre-fills the home composer with "Add a widget for " and focuses the input. The agent does the rest. Both paths should work; the template gallery is the non-agent path for users who do not have a model configured.

#### 6c: Onboarding extension

In the onboarding flow, after the ICP/persona step, add an optional "Pick starter widgets" step. It shows 3–4 template cards (based on the selected ICP — developer gets "My open PRs / Scheduled tasks / Active research"; chief of staff gets "Daily digest / Pending approvals / Next meeting"). Checking a template creates it immediately. This step is skippable.

---



## Part 4: What not to build in this phase

- **Phase 9 features.** No page overlays, fit scores, feed de-slop.
- **A visual workflow builder** or node-graph widget authoring.
- **Widgets that call LLMs at render time.** Everything is pre-computed.
- **Team or shared widgets.** Local only. No Pane servers.
- **A hosted widget marketplace.** That is State B.
- **The "home differs from new tab" question.** They are the same surface, same engine, same route. Do not split them.

---



## Ship gate (Pane v0.8)

All of the following must be true:

1. **Visual redesign is live.** The home looks like a designed product, not a utility list. Widget cards have icons, hierarchy, a primary action, and a hover-reveal management menu. The heading is contextual.
2. **The empty state is an invitation**, not an error message. Starter templates are visible and one-click to add.
3. **Widget proposal card is styled distinctly.** "Pane suggests" cards are visually different from active widgets. Add / Not now actions work.
4. **M8.1 is complete.** `home_widgets` migration is in, files are SoT, `loadHomeWidgets` merges curated + user widgets.
5. **M8.2 is complete.** `home_widget_propose/add/remove/list` tools exist, are classified `write-local` (except list), require confirmation before writing, and are wired to MCP and CLI.
6. **M8.3 is complete.** Proposal job detects at least one pattern type (recurring scheduled jobs) and stages proposals. Dismiss persists to `USER.md`. At most 1 staged proposal surfaces at a time.
7. **M8.4 is complete.** All source types have binding executors. Widget content is pre-computed and cached. Action deep-links work for all action types.
8. **M8.5 is complete.** Custom widget demotion after 14 days of zero action works (unit-tested). `#/settings/home` renders all active + archived widgets.
9. **M8.6 is complete.** "Add widget" affordance works via template gallery (no-model path) and chat prefill (model path). Onboarding ICP step includes starter widget selection.
10. **Performance:** home loads in <150ms (existing guard test still passes; extend it to cover custom widget cache-hit path).
11. **No LLM calls at tab-open.** The `homeLoaderCalledChat` guard flag in `AdaptiveHomeWidgets.tsx` must remain false in all tests.
12. `bun run check` **and the full test suite pass green.**

When all criteria are met, write `specs/PHASE-8-REPORT.md` and stop. Do not start Phase 9.

---



## Reading order before you start

1. `specs/PHASE-5-REPORT.md` — how the home foundation was built (scheduler split, adaptive home, `USER.md` prefs)
2. `specs/PHASE-6-REPORT.md` — capture/research context that feeds Phase 8 widgets
3. `packages/browseros-agent/apps/server/src/scheduler/home.ts` — the server-side home data loader
4. `packages/browseros-agent/apps/app/screens/newtab/home/` — the client-side widget renderer
5. `packages/browseros-agent/apps/app/screens/agent-command/AgentCommandHome.tsx` — the home layout
6. `packages/browseros-agent/apps/app/styles/global.css` — design tokens (Geist, `--accent-orange` OKLCH, color palette)
7. `specs/15-adaptive-home.md` — product spec for this phase
8. `specs/ARCHITECTURE-DESIGN.md` §4.10–4.12 — architectural constraints

Do not start with M8.1. Start with Part 2 (UX). Write down what the home will look like before touching the widget data model. The visual design shapes what the data model needs to expose.