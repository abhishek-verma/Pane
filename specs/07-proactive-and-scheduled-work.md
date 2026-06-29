# 07 — Proactive & Scheduled Work

## Summary

Pane doesn't only act when you ask. It runs work on a schedule, watches for triggers, and nudges you at the right moment. This spec unifies three things: **scheduled tasks** (run on a clock), **triggered work** (run when something happens in the Context Graph), and **proactive nudges** (surface something useful without running a full task). It also addresses the hardest question for a browser-is-the-agent product: **what runs when the browser is closed?** This is where Pane earns the "always-on personal agent" claim without becoming a daemon you babysit.

> **Review v0.2 note.** The earlier draft offered four always-on modes without picking one. **Decision: v1 is in-app scheduler + optional OS keep-alive.** Cloud-headless is a later paid opt-in, not a launch dependency. We state the closed-laptop limitation honestly instead of hiding it. Graph mode (visual authoring) is deferred; "save as scheduled" is the v1 authoring path.
>
> **Review v0.3 note.** Reframed in system terms: **in-app + OS keep-alive is the intrinsic State A capability** (no Pane server). The **cloud-headless runner is a State B extension point** behind a runner-adapter interface with a no-server fallback — not a "phase." Scheduled tasks and smart nudges already exist in BrowserOS; this spec extends them with triggers and keep-alive.

---

## Goals

- Let the user turn any successful agent run into a repeatable, scheduled or triggered job.
- Let the agent propose schedules and triggers from observed activity patterns (layer 4 memory).
- Keep proactive behavior **visible, rate-limited, and dismissable** (principles 5, 6).
- Solve the "always-on" problem for a desktop-app product honestly.

## Non-goals

- Becoming a headless server product that competes with Hermes-on-a-VPS. Pane's always-on is a feature of an app you use, not a daemon you administer.
- Cron-grade enterprise scheduling (arbitrary orchestration, distributed scheduling). n8n and friends own that; Pane integrates (see [09](./09-integrations-mcp-developer-surface.md)).

---

## Three kinds of proactive work

| Kind | Trigger | Example |
|------|---------|---------|
| **Scheduled task** | Time (cron-like: every weekday 9am, hourly, every N min) | "Every morning, summarize overnight Slack #eng and file tickets." |
| **Triggered task** | Graph event (page changed, file updated, PR merged, email arrived, no progress on a task) | "When the staging deploy is green, run the smoke tests and post to #releases." |
| **Proactive nudge** | Inferred opportunity (no clock, no event) | "You've opened the analytics dashboard 5 mornings in a row — want me to automate the export?" |

Scheduled and triggered tasks **execute as agent runs** (see [03](./03-agent-modes-and-the-loop.md)); they can be authored in Agent mode ("save as scheduled") or visually in **Graph mode**. Proactive nudges are **cards**, not executions.

---

## Authoring

```mermaid
flowchart LR
    run[Successful agent run] --> save[Save as…]
    save --> sched[Scheduled task]
    save --> trig[Triggered task]
    save --> graph[Graph workflow]
    sched --> rt[Scheduler runtime]
    trig --> rt
    graph --> rt
    pat[Observed pattern<br/>layer 4 memory] --> suggest[Agent proposes<br/>a schedule/trigger]
    suggest --> confirm[User confirms]
    confirm --> rt
```

- **From an agent run**: "Save as scheduled task" pre-fills the prompt, model, workspace, and a guessed schedule from the run's timing.
- **From a Graph**: ~~the visual authoring surface~~ **deferred.** v1 authoring is "Save as scheduled" from an Agent run (text form) and the Scheduled Tasks UI. Graph mode returns only with authoring data (see [03](./03-agent-modes-and-the-loop.md) kill criteria).
- **From a pattern**: the learning loop detects repetition and proposes a scheduled task or nudge; the user confirms.

### Schedule spec

- Intervals: minute, hourly, daily, weekly, custom cron, "on weekdays", "every N days".
- Windows: "between 9am–5pm", "only on weekdays", "not on weekends".
- Timezone-aware (from `USER.md`).
- Jitter to avoid thundering-herd on integrations.

### Trigger spec

Triggers are Context Graph event subscriptions:

| Trigger | Event |
|---------|-------|
| Page changed | A watched page's content diff exceeds threshold |
| File updated | A granted file changed |
| PR/issue event | GitHub state change on a watched repo |
| Email arrived | Gmail filter match |
| Message arrived | Slack/Discord message match |
| Task stale | No progress on a task for N days |
| Agent-run completed | A watched agent run finished |
| External webhook | Pane exposes a webhook URL per task |

Triggers evaluate on-device against the graph; integration events arrive via the Connect Apps subscription model (see [09](./09-integrations-mcp-developer-surface.md)).

---

## The always-on problem (and our honest answer)

Pane is a desktop app. When the laptop is closed or the browser is quit, the scheduler stops. We do not pretend otherwise. **v1 ships two modes; a third is a later paid opt-in.**

| Mode | What it does | v1? | When to use |
|------|--------------|-----|-------------|
| **In-app scheduler** (default) | Runs while Pane is running. Missed runs catch up on next launch (configurable: run-on-catch-up or skip). | ✅ State A | Most users. The honest default. |
| **OS keep-alive** | Pane registers as a login item / launchd service / Windows Task Scheduler entry that runs a **minimal headless runtime** in the background (no UI, low resource). | ✅ State A (opt-in) | Users who want scheduled work to survive a closed window but not a powered-off machine. Offered during onboarding. |
| **Cloud scheduled runner** (opt-in, paid) | A Pane server runs the schedule; if Pane is offline, the cloud runs a **headless Pane runtime** in an isolated session and reports back. | **State B extension point** | Users who want true 24/7 without keeping a machine on. Plugs in behind the runner-adapter interface; the system is complete without it. |

**The honest promise we make in-product:** "Scheduled tasks run while Pane is running, or in the background if you turn on keep-alive. If your machine is off, tasks catch up when you return — unless you enable the cloud runner (paid, later)." We say this in onboarding and in the Scheduled Tasks UI, not in a footnote.

Key principle: **scheduled work that needs your real logins should prefer local execution.** Cloud-headless runs use a separate, user-granted cloud session, never your live cookies. The user is told which mode ran a given job.

---

## Proactive nudges

Nudges are cards, not executions. Examples:

- "Connect Gmail so I can triage your inbox in the morning digest."
- "You do this export every Monday — want me to schedule it?"
- "Task X has been blocked for 5 days — want me to draft a ping to the owner?"
- "I noticed a skill I could write from this run — review it?"

Rules (principle 6):

- **Rate-limited**: at most N nudges per day (default 3), globally configurable.
- **Dismissable**: each card has "not now" and "never suggest this."
- **Contextual**: only offered when the signal is strong (≥5 repetitions, or an explicit opportunity).
- **Quiet hours**: no nudges during user-configured focus/quiet windows.

---

## Visibility & audit

- **Scheduled Tasks view** (`/scheduled`): list of jobs, next run, last run, status, trigger type. Exists today; expanded with triggers and graph-authored jobs.
- **Run history**: every execution is an agent-run node in the Context Graph, replayable.
- **Proactive log**: a per-day record of nudges shown and outcomes, visible in the Context panel.
- **Notifications**: scheduled/triggered runs post a notification on completion (or on approval-needed) via in-app + channels ([08](./08-reach-and-channels.md)).

---

## Approval for unattended runs

A scheduled/triggered run that hits a `write-external` / `system` / `spend` action:

- **If pre-authorized** by a trust pin for that exact (action, target): proceeds.
- **Otherwise**: **pauses** and posts an approval request to a channel (Telegram/email/mobile). The user approves from their phone; the run resumes. Never auto-approves.
- **Timeout**: if not approved within a window, the run is skipped and logged.

This is the bridge between "always-on" and "always-in-control" (principle 7).

---

## User stories

- "I run a competitor-price scrape once in Agent mode, hit 'Save as scheduled → weekly', done."
- "Pane notices I open the analytics dashboard every weekday morning and offers to automate the export. I confirm. It's now a scheduled task."
- "When my PR merges on `myapi`, Pane runs the smoke tests and posts to #releases — fully triggered, no cron."
- "My laptop was closed at 9am. On launch, Pane tells me it caught up the morning Slack digest (or, with cloud runner on, that it ran in the cloud at 9am and the result is ready)."
- "A scheduled task wanted to post to a new Slack channel — Pane pinged me on Telegram, I approved from my phone, it finished."

---

## Interactions with other specs

- **02 — Context Graph**: triggers are graph event subscriptions; runs are graph nodes.
- **03 — Agent Modes & The Loop**: Graph mode is the visual authoring surface; runs execute via the loop.
- **04 — Memory & Learning Loop**: pattern detection proposes schedules and nudges.
- **06 — Task & Work Management**: agent-owned tasks are scheduled/triggered tasks; the daily triage digest is a scheduled task.
- **08 — Reach & Channels**: approval requests and digests delivered out-of-browser.
- **09 — Integrations & MCP**: integration events feed triggers; n8n can call Pane webhooks.
- **10 — Trust**: approval gating for unattended runs; cloud-headless runs use isolated sessions.

---

## Edge cases

- **Missed runs**: configurable catch-up policy; default skip for "every morning" runs, catch-up for "every hour" runs.
- **Run collision** (same job still running when next schedule fires): queue or skip (per-job config).
- **Trigger storm** (page changes rapidly): debounce + min-interval between runs.
- **Cloud-headless needs an integration the user hasn't granted in the cloud session**: fail clearly, request grant on next local wake.
- **Cost control**: scheduled runs consume model tokens; set per-job and global budgets with pause-on-budget-exceed.
- **Quiet hours vs. scheduled run**: scheduled runs still run; only *nudges* respect quiet hours.

---

## Kill criteria

- If triggered tasks are rarely used (users only use time schedules), triggers are over-built — keep the subscription surface minimal.
- If the cloud-headless runner sees low adoption and high infra cost, retreat to in-app + OS keep-alive only.
- If nudges are dismissed at >50%, the suggestion engine is too eager — raise thresholds before adding new nudge types.

---

## Open questions

1. ~~**Which always-on mode is the default?**~~ **Decision (v0.2/v0.3): in-app scheduler default; OS keep-alive offered during onboarding (both State A); cloud runner is a State B extension point, not a dependency.**
2. **Do we ship the cloud-headless runner at all**, given the local-first thesis? *Decision (v0.2): yes, but later and framed as "when you genuinely need 24/7" in an isolated session — it doesn't undermine the local-first promise because the local-only path is full-featured.*
3. **Catch-up policy defaults**: run-on-catch-up vs. skip? *Lean: skip for daily, catch-up for sub-hourly, all configurable.*
4. **Should the scheduler be exposed to external MCP clients** so Claude Code can register a scheduled Pane job? *Lean: yes — it strengthens the developer surface.*

---

## Metrics

- **Scheduled tasks created per user** and **still-enabled rate** at D30 (retention signal).
- **Runs per week per active scheduler user** (is it actually running?).
- **Triggered vs. scheduled mix** and trigger hit rate.
- **Nudge → action conversion** and **nudge dismiss rate**.
- **Missed-run / catch-up rate** and **cloud-runner adoption**.
- **Approval-needed-paused runs** and **approval latency** (how fast users approve via channels).
- **Cost per scheduled-run user** (token budget health).
