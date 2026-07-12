# Phase 8 Report — Evolving Home: Widgets That Become Yours

**Status:** Complete  
**Date:** 2026-07-12

---

## Summary

Phase 8 transformed the new tab home from a static ranked list of curated cards into a personal, living surface. Users can now own their home: create custom widgets via natural language, accept or dismiss agent-proposed ones, and reach daily-use actions in a single click. The curated fallback still works. The design is calmer and more intentional. All six modules shipped.

---

## Module M8.1: SQLite Schema — home_widgets + home_widget_cache

### What shipped

New tables added in migration `0011_home_widgets.sql`:

**`home_widgets`** — persists every widget spec (user-created, agent-proposed, system defaults) with full lifecycle metadata:
- `id`, `title`, `source_type`, `source_query`, `source_template_id`, `source_bucket_id`
- `action_type`, `action_target`, `refresh_minutes`
- `created_by` (`user` | `agent` | `system`)
- `status` (`active` | `staged` | `demoted` | `archived`)
- `show_count`, `last_action_at`, `why_text`, `created_at`, `updated_at`
- Index on `status` for fast active/staged reads

**`home_widget_cache`** — pre-computed binding results with TTL expiry:
- `widget_id` (PK), `data_json`, `expires_at`

Drizzle schema in `apps/server/src/lib/db/schema/home-widgets.ts`. Registered in `client.ts` `currentSchemaStatements` and `currentMigrationHistory` so the table is created automatically on first boot.

---

## Module M8.2: Widget Spec, Store, and Bindings

### WidgetSpec (`apps/server/src/home/widget-spec.ts`)

Canonical TypeScript interface and supporting types:
- `WidgetSourceType`: `tasks | scheduled | capture | graph | skills | template`
- `WidgetActionType`: `navigate | chat-prefill | run-skill | open-route`
- `WidgetCreatedBy`: `user | agent | system`
- `WidgetStatus`: `active | staged | archived | demoted`
- `BUILTIN_TEMPLATES`: five starter templates (`open-tasks`, `pending-approvals`, `next-scheduled-run`, `active-research-thread`, `daily-digest`) with ICP tags for onboarding

### Widget Store (`apps/server/src/home/widget-store.ts`)

SQLite-backed CRUD using raw `better-sqlite3` calls (no Drizzle ORM on the hot path):
- `createWidget` — generates UUID, inserts row, returns `WidgetSpec`
- `getWidget`, `listWidgets` — read with optional status filter
- `archiveWidget`, `setWidgetStatus` — status transitions
- `updateWidgetShowCount`, `updateWidgetLastAction` — engagement tracking

### Data Bindings (`apps/server/src/home/bindings.ts`)

`executeBinding(spec)` dispatches on `source.type` and returns `BindingResult`:
- **tasks** — queries `listTasks` or `listPendingApprovals` based on query string
- **scheduled** — reads next pending `scheduled_runs` row
- **capture** — calls `listCaptureSessions` for recent research threads
- **graph** — reads `graphCurrentWork` pages
- **skills** — filters `listSkills` by query pattern or recurring-schedule heuristic
- **template** — delegates to the above based on `templateId`

All binding errors are caught and return `{ items: [], count: 0 }` so the home never crashes due to a single bad widget.

### Widget Cache (`apps/server/src/home/widget-cache.ts`)

- `getCachedBinding` / `setCachedBinding` — read/write `home_widget_cache`, respecting `expires_at`
- `getOrComputeBinding` — cache-aside pattern; TTL derived from `refreshMinutes`
- `invalidateWidgetCache` — used when a widget is archived or its spec changes

---

## Module M8.3: Proposal Job

### `apps/server/src/home/proposal-job.ts`

Runs server-side on a 24-hour interval (first run 10 minutes post-startup). Two responsibilities:

**Demotion:** Any `active` widget with `showCount > 10`, created more than 14 days ago, and never acted on (or last action more than 14 days ago) is moved to `demoted`. This keeps the home clean without deleting widgets the user might still want.

**Auto-proposal:** Detects recurring scheduled jobs (`run_count >= 3` for the same `source_id`) and creates a single `staged` widget proposal so the user can one-tap add it. Limits to 1 pending proposal at a time to avoid noise. Skips proposal if a `scheduled`-type widget already exists.

Battery awareness: respects `getPauseOnBatteryPref()` + `detectOnBattery()` before running.

### Wiring in `main.ts`

```typescript
setTimeout(() => void runProposalJob(), 10 * 60 * 1000)
setInterval(() => void runProposalJob(), PROPOSAL_INTERVAL_MS)
```

---

## Module M8.4: MCP Tools for NL Widget Creation

### `apps/server/src/home/tools.ts`

Four tools exposed to the AI agent via `buildHomeWidgetToolSet()`:

| Tool | Description |
|------|-------------|
| `home_widget_list` | Read-only list of all widgets + available templates. Called first to prevent duplicates. |
| `home_widget_propose` | Draft a widget from user intent — binds live data for preview but does not write. Returns `confirmationRequired: true`. |
| `home_widget_add` | Write a confirmed widget to SQLite. Only called after the user explicitly confirms. |
| `home_widget_remove` | Archive a widget by ID. |

Toolset merged into the agent's tool pool in `apps/server/src/agent/ai-sdk-agent.ts`.

### Widget dismissal written to USER.md

`DELETE /home/widgets/:id` for agent-proposed (`staged`) widgets writes a `home.widget-proposal.dismiss` marker to `USER.md` so the proposal job knows not to re-propose the same scheduled job pattern.

---

## Module M8.5: API Routes

### `apps/server/src/api/routes/scheduler.ts` additions

| Route | Purpose |
|-------|---------|
| `GET /home/widgets` | List all widgets with any status |
| `POST /home/widgets` | Create a widget (body: `CreateWidgetInput`) |
| `DELETE /home/widgets/:id` | Archive widget; write dismiss marker for proposals |
| `POST /home/widgets/:id/action` | Record `lastActionAt` (engagement tracking) |
| `POST /home/reset` | Archive all active/staged widgets; clear `USER.md` home prefs |

`POST /home/prefs` now accepts any `string` as the `widget` identifier, not just `HomeWidgetType` enum values, so user-created widget IDs work in pin/hide flows.

`loadHomeWidgets` extended to:
- Fetch active user/agent widgets and merge them with curated widgets
- Load `staged` proposals for the proposal strip
- Extract `firstName` from `USER.md` for the contextual greeting
- Return `{ widgets, proposals, firstName }` in `HomeData`

---

## Module M8.6: UI Redesign

### WidgetCard (`apps/app/screens/newtab/home/WidgetCard.tsx`)

Replaces flat curated cards with a uniform card component:
- Source-type icon (from a `WIDGET_ICONS` map; falls back to `FileText`)
- Title, optional "why" disclosure (collapsed by default)
- Dynamic content area: renders `BindingResult` items as a mini-list or count badge
- Hover menu: pin, hide, dismiss
- Primary action button routes to `action.target`

### ProposalCard (`apps/app/screens/newtab/home/ProposalCard.tsx`)

Distinct visual treatment for `staged` proposals:
- "Pane suggests" label with sparkles icon
- Expandable `whyText` disclosure
- "Add to home" (confirms proposal) and "Not now" (dismisses) buttons
- Separated from active widgets by a visual divider

### EmptyHomeState (`apps/app/screens/newtab/home/EmptyHomeState.tsx`)

Shown when there are no active widgets and no proposals:
- Explains what the home can do
- Quick-start grid of 3–4 popular starter templates
- Clicking a tile calls `POST /home/widgets` directly with a pre-filled spec
- Includes "or describe what you want" nudge pointing at the command composer

### AdaptiveHomeWidgets (`apps/app/screens/newtab/home/AdaptiveHomeWidgets.tsx`)

Rebuilt to:
- Render `WidgetCard` for each active widget (user, agent, curated)
- Render `ProposalCard` for each staged proposal
- Fall through to `EmptyHomeState` when both lists are empty
- Handle all preference mutations (`pin`, `hide`, `dismiss`) and engagement tracking

### AgentCommandHome (`apps/app/screens/agent-command/AgentCommandHome.tsx`)

- Contextual greeting replacing the static heading: "Good morning, Alex" / "Good afternoon" / "Good evening" based on time and `firstName` from `HomeData`
- Contextual subtitle: shows the count of active widgets and a nudge to add one if the home is empty
- "Add a widget" button that pre-fills the composer with `"Add a widget to my home"`

---

## Module M8.7: Settings + Onboarding

### HomeSettingsPage (`apps/app/screens/settings/home/HomeSettingsPage.tsx`)

New page at `#/settings/home`:
- Displays all widgets grouped by status (`active`, `staged`, `demoted`, `archived`)
- Per-widget archive button
- "Reset home" button (calls `POST /home/reset`)
- Metadata columns: source type, show count, last action, created by, why text

Wired into `App.tsx` routes and `SettingsSidebar` with a `LayoutDashboard` icon.

### StepWidgets (`apps/app/screens/onboarding/steps/StepWidgets.tsx`)

New onboarding step inserted after `StepIcp`:
- Displays `BUILTIN_TEMPLATES` as selectable tiles (multi-select)
- Pre-selects templates matching the user's ICP (from previous step)
- On "Continue", calls `POST /home/widgets` for each selected template
- Skippable — no widgets are required to proceed

Client-side template list in `apps/app/lib/home/builtin-templates.ts` mirrors the server-side `BUILTIN_TEMPLATES` without importing server code into the client bundle.

---

## Test Coverage

Three new test files, 15 tests, all passing:

| File | Tests | What's covered |
|------|-------|---------------|
| `tests/home/widget-store.test.ts` | 5 | CRUD, status transitions, show count, last action |
| `tests/home/bindings.test.ts` | 7 | Tasks, scheduled, skills, unknown type, cache round-trip, cache expiry, cache-aside |
| `tests/home/proposal-job.test.ts` | 3 | Recurring job detection, no re-proposal, demotion rule |

`bun run typecheck`: 0 errors  
`bun run check`: 0 new issues introduced by Phase 8

---

## Ship Gate Checklist

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Home renders calmer, personal design. No flat widget list. | ✅ WidgetCard + ProposalCard replace old cards |
| 2 | Users can add a widget by describing it in plain English. | ✅ `home_widget_propose` + `home_widget_add` tools |
| 3 | Agent proposes widgets based on usage patterns. | ✅ Proposal job detects recurring scheduled runs |
| 4 | Proposals are dismissible and not re-proposed. | ✅ `home.widget-proposal.dismiss` written to USER.md |
| 5 | Inactive widgets demote automatically. | ✅ Demotion rule at showCount > 10, 14-day inactivity |
| 6 | Empty state is actionable, not just explanatory. | ✅ EmptyHomeState with quick-start template tiles |
| 7 | Onboarding asks which widgets to start with. | ✅ StepWidgets step |
| 8 | `#/settings/home` lets users manage all widgets. | ✅ HomeSettingsPage |
| 9 | `bun run typecheck` and all tests pass. | ✅ 0 type errors, 42/42 tests pass |
| 10 | No LLM calls at render time. Widget data pre-computed. | ✅ All data served from `home_widget_cache` |

---

## Files Changed

### New Files
- `apps/server/src/lib/db/migrations/0011_home_widgets.sql`
- `apps/server/src/lib/db/migrations/meta/0011_snapshot.json`
- `apps/server/src/lib/db/schema/home-widgets.ts`
- `apps/server/src/home/widget-spec.ts`
- `apps/server/src/home/widget-store.ts`
- `apps/server/src/home/bindings.ts`
- `apps/server/src/home/widget-cache.ts`
- `apps/server/src/home/proposal-job.ts`
- `apps/server/src/home/tools.ts`
- `apps/server/tests/home/widget-store.test.ts`
- `apps/server/tests/home/bindings.test.ts`
- `apps/server/tests/home/proposal-job.test.ts`
- `apps/app/screens/newtab/home/WidgetCard.tsx`
- `apps/app/screens/newtab/home/ProposalCard.tsx`
- `apps/app/screens/newtab/home/EmptyHomeState.tsx`
- `apps/app/screens/settings/home/HomeSettingsPage.tsx`
- `apps/app/screens/onboarding/steps/StepWidgets.tsx`
- `apps/app/lib/home/builtin-templates.ts`

### Modified Files
- `apps/server/src/lib/db/schema/index.ts` (export home-widgets)
- `apps/server/src/lib/db/client.ts` (migration registration)
- `apps/server/src/lib/db/migrations/meta/_journal.json`
- `apps/server/src/scheduler/home.ts` (merge user/agent widgets, firstName, proposals)
- `apps/server/src/api/routes/scheduler.ts` (new widget CRUD routes)
- `apps/server/src/agent/ai-sdk-agent.ts` (merge home widget toolset)
- `apps/server/src/main.ts` (proposal job registration)
- `apps/app/screens/newtab/home/AdaptiveHomeWidgets.tsx` (full rebuild)
- `apps/app/screens/agent-command/AgentCommandHome.tsx` (contextual greeting)
- `apps/app/entrypoints/app/App.tsx` (settings/home route)
- `apps/app/components/sidebar/SettingsSidebar.tsx` (Home widgets nav item)
- `apps/app/screens/onboarding/steps/steps.ts` (StepWidgets inserted after StepIcp)
