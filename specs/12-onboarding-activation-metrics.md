# 12 — Onboarding, Activation & Metrics

## Summary

This spec defines the first-run experience that turns a download into an activated Pane user, the activation loops that drive the thesis to its first proof, and the metrics we use to know the product is working. The activation bar is high: Pane asks the user to pick a model and grant a workspace. Onboarding must make that feel obvious and worth it, not like setup tax.

> **Review v0.2 note.** Three changes. (1) **ICP-specific onboarding paths** — devs and knowledge workers activate differently and see different first tasks. (2) **Re-calibrated activation bars** — T1 (Chat) is the mass-ICP activation; T2 (thesis) is the dev-ICP bar; the earlier single T2 bar conflated ICPs and was too high for everyone. (3) **Empty-Context-Graph cold start** is handled explicitly (an empty graph must not block the first useful action). Onboarding also leads with the **trust intro** so approvals don't surprise.
>
> **Review v0.3 note.** Onboarding runs entirely in **State A** — no account or Pane server required for activation. Default credits (Kimi) are an optional on-ramp (disabled in the Pane fork for now); BYOK/OAuth/local is the durable local path. The dev path leverages the **already-shipped** Pane-as-MCP one-line setup. Chrome import (already in BrowserOS) seeds the Context Graph so it isn't empty on minute one. **New in v0.3: a passive-capture opt-in step** (meeting capture + browsing learnings, OFF by default) and **bucket setup** (Work / Personal / per-project), per [14](./14-passive-capture-and-context-buckets.md).
>
> **Review v0.4 note (HoP pass).** The biggest gap in the whole set was **no daily-habit / retention loop** — activation was specified, the habit that turns activation into retention was not. Added "The habit loop" + a **north-star metric** (weekly thesis actions) + outcome-ized metrics. Also **fixed stale v0.2 content** that contradicted the v0.3 "no servers / credits disabled" decision (default-credits on-ramp, credit-exhaustion flows, cloud-sync stickiness metrics) — mass-ICP onboarding now leads with **OAuth subscriptions** (per the no-default-model tension in [00](./00-vision-and-thesis.md)). Activation tiers renamed to make the habit/compounding tiers first-class.

---

## Goals

- Get a new user to their **first successful agent interaction** in under 5 minutes.
- Make the **thesis tangible fast**: the user should *feel* "the agent knows my work" within the first session.
- Onboard the three high-value behaviors early: **context grounding**, **a workspace grant**, and **one scheduled/proactive thing**.
- Provide a clean **migration path** for Hermes/OpenClaw users.
- Define the metrics that tell us the thesis is or isn't working.

## Non-goals

- Forcing account creation before value. Cloud sync is opt-in post-activation.
- A long feature tour. Show, don't tell.
- Collecting more than the minimum needed for activation.

---

## Onboarding flow

Onboarding branches by ICP after the shared first steps. The shared steps are minimal; the ICP paths diverge at the "first success" step.

```mermaid
flowchart TD
    A[Download & install] --> B[Import from Chrome: optional, recommended]
    B --> C[Pick a model: OAuth subscription / BYOK / local]
    C --> D[Trust intro: "How Pane keeps you in control"]
    D --> E{ICP path?}
    E -->|Developer| F1[Copy MCP URL → connect Claude Code<br/>First wedge task: reproduce a bug]
    E -->|Knowledge worker / researcher| F2[First Chat on a real page<br/>Offer workspace + first Agent run<br/>Offer passive capture + research bucket]
    E -->|Tinkerer / privacy| F3[Pick local/BYOK model<br/>Grant workspace, run a first task]
    F1 --> G[Migration offer if Hermes/OpenClaw detected]
    F2 --> G
    F3 --> G
    G --> H[Channels offer: "want digests on Telegram?"]
    H --> I[Done — activated]
```

### Shared steps

1. **Import (optional)**: bookmarks, passwords, extensions. Existing. Keep friction low; "skip" is prominent. *Also seeds the Context Graph so it's not empty on minute one ([02](./02-the-context-graph.md) cold start).*
2. **Pick a model** — **no hosted-credits on-ramp in the Pane fork** (see the no-default-model tension in [00](./00-vision-and-thesis.md)). Order the picker by friction: **(a) OAuth subscription** ("use the ChatGPT Pro / Copilot / Qwen you already pay for" — often one click if already logged in) → **(b) BYOK** (paste a key) → **(c) local** (Ollama / LM Studio). Clear recommendation: "for Agent mode, a strong reasoning model works best; local is great for Chat."
3. **Trust intro**: a one-screen, honest "How Pane keeps you in control" — local-first, permissioned context, approvals, you-can-always-see-what-it-knows. **This runs before the first Agent action so approvals don't feel like surprises** (a cold-start approval-fatigue fix, [10](./10-trust-privacy-security.md)).
4. **ICP selection**: a single question ("What do you want Pane for first? — coding / research & writing / personal automation / privacy-first") sets the path. Recalls to `USER.md` and tunes trust defaults. **This also seeds `soul.md` with an initial persona** ([11](./11-personalization-skills-marketplace.md)) — e.g. "research & writing" → research/study buddy — so Pane's voice and what it proactively watches for fit the user from day one, and the **adaptive home** ([15](./15-adaptive-home.md)) renders in that persona's shape instead of a generic page.

### ICP path: Developer (wedge)

- Copy the Pane-as-MCP URL; one-click `claude mcp add` (or Cursor equivalent).
- Suggested first task: "open localhost:3000, reproduce the bug, read the console" — run from Claude Code against Pane.
- Workspace grant suggested for the user's most-active repo folder.
- First win: the dev sees Pane drive their real browser from their coding agent.

### ICP path: Knowledge worker / researcher (expand)

- Pre-load the new tab with the user's most-visited site (from import) and a prompt: "Summarize this page" or "What's on this page I should care about?"
- One click → first Chat win (T1 activation).
- The thesis upsell: "Pane can see the tab you're on. Grant it your workspace and it can act on your files too." → first Agent run with file context (T2).
- **Passive-capture offer (opt-in):** "Want Pane to remember what you read and capture your meetings?" → turns on browsing learnings + (per-domain) meeting capture + a Research bucket. OFF by default; this is where the "becomes smarter from real activity" story starts ([14](./14-passive-capture-and-context-buckets.md)).

### ICP path: Tinkerer / privacy-conscious

- Lean into BYOK / local model setup.
- Grant a workspace; run a first task; show the memory/skills surfaces will populate over time.
- Emphasize local-first + inspectability.

### Shared tail

5. **Migration (if detected)**: if `~/.hermes` or `~/.openclaw` exists (or the user says so), offer the migration wizard (see [04](./04-memory-and-learning-loop.md)).
6. **Channels offer**: after the first scheduled/agent-owned task, offer to deliver digests/approvals to Telegram/email (principle 6: at the moment it's useful).

### Smart nudges during onboarding

- After first Chat success: "Connect Gmail so I can triage your inbox?"
- After first workspace grant: "Want me to schedule the report you just built?"
- All dismissable, rate-limited, "never suggest again" available.

---

## Activation definition (ICP-aware)

Activation is not one bar — it's ICP-specific, because devs and knowledge workers activate differently. The shared spine: a user is **activated** when, within 7 days, they sent ≥1 assistant message **and** completed their ICP's thesis-bearing action.

| ICP | Thesis-bearing action (any one) | Why this bar |
|-----|----------------------------------|--------------|
| **Developer (wedge)** | Connected Claude Code/Cursor via MCP and ran ≥1 wedge task (browser + workspace), **OR** completed a Hermes/OpenClaw migration | This is the wedge proof — "my coding agent drives my real browser" |
| **Knowledge worker** | Ran ≥1 Agent task with file context (workspace granted), **OR** connected ≥1 app and ran an agent action on it, **OR** created ≥1 scheduled task | The "agent is the browser" feeling |
| **Tinkerer / privacy** | Granted a workspace + ran an Agent task on a BYOK/local model | Local-first thesis proof |

The earlier single T2 definition conflated these and was too high for the mass ICP. The dev bar is the wedge metric we optimize first.

### Activation tiers

| Tier | Definition | Purpose |
|------|------------|---------|
| **T0 — Installed** | App launched once | Top of funnel |
| **T1 — Chat activated** | ≥1 Chat message (page-grounded) | Basic value; **the mass-ICP activation bar** |
| **T2 — Thesis activated** | The ICP-specific thesis-bearing action above | **The dev-wedge bar; the bar that matters for the moat** |
| **T3 — Habituated** | T2 + return within 7 days with another thesis action | Retention signal |
| **T4 — Compounded** | T3 + ≥1 skill auto-created OR ≥1 memory write OR a scheduled task still enabled at D14 | The moat compounding |

We track T1 and T2 **separately by ICP** so the dev wedge doesn't get hidden by a large T1-only knowledge-worker population.

### The habit loop (activation → retention)

Activation gets a user to value once. **Retention needs a daily habit**, and a browser that's open anyway is *not* a habit by itself — the user must *invoke the agent* repeatedly. The habit loop is what makes that happen, and it's the spec the v0.2 set was missing.

The habit is **"Pane pings me with something useful I didn't ask for, and I act on it."** It's powered by the proactive/scheduled engine ([07](./07-proactive-and-scheduled-work.md)) + passive capture ([14](./14-passive-capture-and-context-buckets.md)):

1. **Morning digest** (scheduled, default-on after T2): "Here's what's on your calendar, the 3 PRs waiting on you, and the support thread that escalated overnight." One glance, one click to act.
2. **Capture-driven follow-ups** (passive): "You said 'let's circle back' in yesterday's 3pm meeting — want me to draft that email?" The meeting note becomes a task becomes an action.
3. **Research recall** (passive): "You were researching X last week — 3 new results came out." The research bucket earns its keep.
4. **Skill surfacing**: when the loop notices a repeated workflow, it offers to automate it — the user feels the agent getting smarter, which is the retention hook unique to Pane.

The habit collapses if any link is missing: no proactive engine → no ping → no return; no capture → no "it remembered" moment → no surprise. This is why [07](./07-proactive-and-scheduled-work.md) and [14](./14-passive-capture-and-context-buckets.md) are retention-critical, not just features.

**North-star metric: weekly thesis actions per active user** — the count of Chat/Agent/scheduled actions that exercised the browser + context + (workspace or capture) core, per WAU. It captures all three things that matter at once: people are using the agent (not just browsing), the agent is doing *Pane-shaped* work (not generic chat), and the moat (context) is being exercised. It moves when the product is genuinely winning and stalls when it isn't, regardless of ICP mix.

---

## Activation loops

| Loop | Trigger | Action | Reinforcement |
|------|---------|--------|---------------|
| **Chat → Agent** | First Chat success | Offer workspace grant + first Agent run | Show tool batches + glow ("see what it did") |
| **Agent → Scheduled** | First successful Agent run | "Save as scheduled" nudge | Next run delivers a digest (channel or in-app) |
| **App → Action** | Connect an app | Smart nudge to act on it | Triage digest or saved-time summary |
| **Migration → Activated** | Hermes/OpenClaw detected | Migration wizard | "Your skills and memory now work in Pane" |
| **Channel → Approval** | First gated action while away | Approve via channel | "Handled — you approved from your phone" |

---

## Onboarding content

- **In-app**: `/onboarding`, `/onboarding/features` (bento + videos). Existing; update to lead with the thesis ("your work lives here — now your agent does too").
- **In-app "first week" nudges** (State A, default-on after T2): day 1 (first win recap), day 3 (workspaces), day 5 (scheduled tasks), day 7 (channels + capture). These are the proactive engine ([07](./07-proactive-and-scheduled-work.md)) doing double duty as onboarding — no server needed.
- **External docs**: onboarding + feature pages with demo videos. *(Hosted docs/CDN are a docs-site concern, not a Pane-product server; fine to keep.)*
- **A "first week" email series is deferred** — outbound marketing email needs a sender service (State B); in-app nudges cover the same ground in State A.

---

## Migration (Hermes / OpenClaw)

A dedicated wizard (also reachable from Settings → Personalization):

1. **Detect** `~/.hermes` / `~/.openclaw` (or manual path entry).
2. **Import**:
   - Memory: `MEMORY.md`, `USER.md` → Pane's memory files.
   - Skills: `~/.hermes/memories/skills/*` → Pane skills (`provenance: migrated`).
   - Session DB: optional import into the session archive.
   - Channels: re-pair Telegram/Discord/Slack in Pane.
   - API keys: import into provider settings.
3. **Map toolsets**: Hermes `browser_*` → Pane browser tools; `terminal`/`file`/`web` → Pane equivalents.
4. **Verify**: run a single test task to confirm the migration landed.

---

## Success metrics

### Activation funnel
- Download → launch → T1 → T2 → T3 → T4 (each step's conversion and time-to-step).
- **Time-to-first-success** (target < 5 min).
- **T2 activation rate** (the thesis bar) within 7 days.
- **Model-step drop-off** (the no-default-model risk): conversion at the model picker, by path (OAuth vs BYOK vs local) and by ICP. If mass-ICP collapses here, fix OAuth onboarding before anything else ([00](./00-vision-and-thesis.md)).

### Engagement
- **North-star: weekly thesis actions per WAU** (see above).
- WAU of assistant (side panel + home + channels).
- Agent vs Chat session ratio; tool calls per agent session.
- Workspace grant rate; files/commands per workspace.
- Connect Apps per user; integration action rate.
- Scheduled tasks created and **still-enabled at D30**.
- Skills per user; **skill use-rate** (skills actually loaded into runs / skills owned — the anti-bloat metric, [04](./04-memory-and-learning-loop.md)).
- Context tool usage (`context.search`/`recall`) per agent session (moat health).
- **Capture→action rate**: % of passive-capture items (meeting action items, browsing learnings) that produce a user-acted-on task/nudge (the outcome for [14](./14-passive-capture-and-context-buckets.md), not "% captured").

### Retention
- D7 / D30 return with a thesis action (not just browser open).
- **Habit-loop health**: % of WAU who acted on ≥1 proactive ping in the week (the habit, not the install).
- Scheduled-task still-enabled rate (the always-on retention lever).
- Channel-connected users' retention vs. non-channel (hypothesis: channels lift retention).
- *(Cloud sync adoption is a State B metric — disabled in the Pane fork today.)*

### Developer
- `browseros-cli init` completions; Pane-as-MCP URL copies; active MCP sessions.
- Harness-agent (Claude Code/Codex via Pane) sessions.
- Custom MCP adoption.

### Quality
- Agent task completion rate (eval harness: WebVoyager, Mind2Web, AGI SDK + a new "Pane thesis" eval using workspace+files).
- Connection error rate (`/health`, troubleshooting traffic).
- Prompt-injection-caused bad actions (target near-zero; [10](./10-trust-privacy-security.md)).
- **First-bad-action rate**: consequential actions the user had to undo or regretted (the trust-killer; target near-zero, [10](./10-trust-privacy-security.md)).

### Business
- OAuth provider attach rate (ChatGPT Pro, Copilot, Qwen) — the durable State A on-ramp.
- BYOK key attach rate.
- *(Credit consumption and cloud-sync opt-in are State B metrics — disabled in the Pane fork today; re-enable the events when those surfaces return.)*

### Instrumentation
- PostHog in server and app; Sentry for errors; analytics event constants in `apps/app/lib/constants/analyticsEvents.ts`. Add new events for the thesis actions (workspace grant, first agent-with-files run, scheduled task created, channel paired, migration completed, **proactive ping acted-on**, **capture item acted-on**, **skill loaded into run**). *Drop/neutralize the `/credits` and cloud-sync events while those surfaces are disabled in the Pane fork.*

---

## A new eval: the "Pane thesis" eval

Existing evals (WebVoyager, Mind2Web) test browser-only agent quality. The thesis needs an eval that tests **browser + workspace + context** end-to-end:

- Tasks that require reading a page, writing to a file, and re-using that file in a later step.
- Tasks that require acting on a connected app (mock integrations in the harness).
- Tasks where the "right" answer depends on prior context in the graph (memory/session recall).

This eval is the internal proof that the moat pays off, and the public credibility artifact (publish to the eval viewer).

---

## Edge cases

- **No model picked**: there is no hosted-credits on-ramp in the Pane fork. If the user skips the picker, Chat is gated on a model — surface the OAuth-subscription option first ("one click if you already have ChatGPT Pro/Copilot"), then BYOK, then local. Never a dead end; never silently route to a paid cloud.
- **Local model chosen for Agent mode**: set expectations honestly ("Agent work wants a strong model; local is great for Chat"); offer "try this Agent run with an OAuth/BYOK model" if it fails twice.
- **No Chrome to import from**: skip import; seed the new tab with general suggestions instead of most-visited.
- **Migration partially fails**: import what succeeded, list what didn't, let the user retry per-item.
- **User skips workspace**: still activated via Chat + an app or a scheduled task (the T2 definition is an OR).
- **User skips passive capture**: fine — onboarding still activates via Chat/Agent; capture is an upsell in-week, not a gate.

---

## Kill criteria

- If T2 activation rate is materially below target, the thesis isn't landing in onboarding — revisit the "thesis moment" before adding features.
- If the "first week" email series shows low engagement, kill it (don't keep sending).
- If migration is rarely used despite Hermes/OpenClaw volume, the detection/wizard is the problem — fix before promoting.

---

## Open questions

1. ~~**Default model in onboarding**: default credits (easy) vs. pushing BYOK (durable)?~~ **Decision (v0.4): no hosted-credits on-ramp in the Pane fork.** Lead with OAuth subscriptions (often one click), then BYOK, then local. Default-credits return only as a later State B on-ramp if adoption justifies it (see the no-default-model tension in [00](./00-vision-and-thesis.md)).
2. ~~**Should workspace grant be required for T2 activation?**~~ **Decision (v0.2): ICP-specific.** Required for the dev and tinkerer/privacy bars; optional for the knowledge-worker bar (which can activate via app-connect or scheduled task).
3. **How prominent is the migration wizard** in onboarding vs. buried in settings? *Decision (v0.2): surface only if Hermes/OpenClaw is detected; otherwise a settings entry.*
4. ~~**Account creation timing**: before or after first success?~~ **Decision (v0.2): after** — let the value land first; cloud sync is the account prompt.

---

## Related specs

- All specs feed activation; in particular [02](./02-the-context-graph.md) (workspace grant), [03](./03-agent-modes-and-the-loop.md) (first run), [05](./05-workspace-files-terminal.md) (workspace setup), [07](./07-proactive-and-scheduled-work.md) (first scheduled task + the habit loop), [08](./08-reach-and-channels.md) (channel pairing), [10](./10-trust-privacy-security.md) (trust intro), [11](./11-personalization-skills-marketplace.md) (skill install), [13](./13-roadmap.md) (system model), [14](./14-passive-capture-and-context-buckets.md) (capture + research bucket onboarding).
