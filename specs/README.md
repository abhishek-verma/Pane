# Pane Product Specs

This folder holds the product specification for Pane's next phase: **Pane as a Hermes-class personal agent that happens to be your browser**.

These specs are written from a product-manager lens: who the product serves, what it does, how the pieces fit together, and how we measure success. They are design intent, not implementation contracts. For current implementation reality, see [ARCHITECTURE.md](../ARCHITECTURE.md) and [PRODUCT.md](../PRODUCT.md). For the **engineering design** that realizes these specs (grounded in the current fork, extensible to State B via interfaces only), see [ARCHITECTURE-DESIGN.md](./ARCHITECTURE-DESIGN.md).

> **Status: draft v0.5 — vision-alignment pass (against README.md).** Two corrections from the user shape v0.3: (1) **think in systems, not implementation timelines** — the Pane fork starts as a pure open-source project with **no Pane-operated servers** (BrowserOS's sync/credits/Remote-Hermes/cloud-API surfaces are **disabled**); server-dependent things are *future, conditional extension points*; **auto-skill-creation is a day-one intrinsic local capability** that needs zero servers; (2) we **build on BrowserOS**, not from scratch — most of the wedge is already shipped. v0.3 added a flagship intrinsic capability: **passive capture & context buckets** ([14](./14-passive-capture-and-context-buckets.md)).
>
> **v0.4 (holistic HoP review)** tightened the set across strategy, ICPs, retention, trust, distribution, and feasibility: added the **daily-habit/retention loop + a north-star metric** ([12](./12-onboarding-activation-metrics.md)); a **researcher/student flow** under the knowledge-worker ICP + a concrete research bucket ([00](./00-vision-and-thesis.md), [14](./14-passive-capture-and-context-buckets.md)); a **"why a fork, not an extension" defense** and the **no-default-model tension** ([00](./00-vision-and-thesis.md)); **training-wheels/dry-run** for the scary consequence classes ([10](./10-trust-privacy-security.md), [03](./03-agent-modes-and-the-loop.md)); the **curation/pruning half** of the learning loop so the system gets smarter, not heavier ([04](./04-memory-and-learning-loop.md)); a **distribution/packaging/auto-update** section and an expanded risk register ([13](./13-roadmap.md)); and **performance-budget** enforcement in the resource-heavy specs ([02](./02-the-context-graph.md), [04](./04-memory-and-learning-loop.md), [14](./14-passive-capture-and-context-buckets.md)). Also fixed stale v0.2 content in [12](./12-onboarding-activation-metrics.md) that contradicted the "no servers / credits disabled" decision.
>
> **v0.5 (vision-alignment pass against README.md).** The README's headline is **"a browser with a soul"** that **"becomes whatever you need it be."** This pass brings the specs into alignment: **elevated `soul.md` to a first-class persona/identity layer**; added **[15 — Adaptive Home](./15-adaptive-home.md)** and **[16 — Page Reshape & Overlays](./16-page-reshape-and-overlays.md)**; and added the shape-shifting thesis to [00](./00-vision-and-thesis.md). The engine (memory, graph, capture, soul) is built first; expression surfaces ship on top.
>
> **v0.6 (phase reorder, 2026-07).** **v1.0 = Phase 7** (packaging). **Phase 8** = evolving home (user/agent widgets). **Phase 9** = page reshape, incremental post-launch. See [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md).

---

## The thesis in one paragraph

Most of your work already lives in your browser — your tabs, your logins, your docs, your dashboards, your tickets, your inboxes. So the agent that is supposed to help you with that work should live there too, not in a separate daemon you bolt a browser onto via CDP, and not in a closed cloud sidebar that ships your browsing to a vendor. Pane is that agent. Because Pane **is** the browser, it gets native, permissioned context on everything you do, plus your workspace, files, and terminal. It does everything an always-on self-improving agent like Hermes does — persistent memory, self-written skills, scheduled work, multi-channel reach — but with richer context and direct automation, instead of reaching for your work through plugins and a debug port.

---

## Build on BrowserOS, not from scratch

We are not greenfield. BrowserOS already ships the Chromium fork, the agent server with 53+ MCP tools, Chat/Agent modes, Cowork (files), scheduled tasks, smart nudges, Connect Apps (Klavis), **Pane-as-MCP + `browseros-cli` + harness agents** (the dev wedge, mostly shipped), BYOK/OAuth/local models, vertical tabs, ad blocking, and the eval harness. v0.46 pulled Skills/Soul/Memory back to rebuild.

The **net-new intrinsic work** is: the Context Graph (with **context buckets**), the Memory + **auto-skill-creation engine** (+ **`soul.md` persona layer**), **passive capture**, Workspaces, Tasks, Triggers, Reach, and the Trust framework — **Phases 1–6**. **v1.0 (Phase 7)** is signing, cross-platform packaging, diagnostics, and eval. Post-launch: **Phase 8** evolving home (user/agent widgets on the new tab) and **Phase 9** page reshape (one site/feed at a time). See [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md).

---

## System states: A (pure local) and B (optional servers)

The system is **complete and useful with no Pane-operated servers** (State A), and **designed to accept optional servers later** (State B) via defined extension points. Nothing in State A depends on a Pane server.

```mermaid
flowchart LR
    subgraph A [State A — pure OSS, no Pane servers]
        dir[Browser + agent server + 53 tools]
        graph[Context Graph + buckets: local SQLite/FTS5]
        mem[Memory + auto-skills: local files]
        capture[Passive capture: meetings + browsing learnings]
        ws[Workspaces + sandboxed terminal]
        tasks[Tasks + executable + triggers]
        sched[Scheduled work: in-app + OS keep-alive]
        reach[Reach: OS push + email + Telegram bot]
        trust[Trust framework: approvals + capture consent + audit]
        models[BYOK + OAuth + local models]
    end
    subgraph B [State B — optional Pane servers, future/conditional]
        sync[Cloud sync adapter]
        credits[Hosted credits adapter]
        market[Skills marketplace source]
        headless[Cloud-headless runner adapter]
        team[Team / shared-graph adapter]
    end
    A -. optional plugs in via no-server-fallback interfaces .- B
```

**The "becomes smarter every day" promise is fully delivered in State A.** The learning loop watches browser + workspace + terminal activity — including **passive capture** of meetings and browsing ([14](./14-passive-capture-and-context-buckets.md)) — and writes memory + `SKILL.md` files locally. No marketplace, no server, no account.

**State B — optional Pane servers, future and conditional.** Cloud sync, hosted credits, the hosted skills marketplace, the cloud-headless runner, and team features are **not shipped in the Pane fork today** — BrowserOS's Pane-operated server surfaces (sync, credits, Remote Hermes, the cloud API) are **disabled**. State B is a future possibility ("if Pane gets famous, we might add server-side integration"), not a present reality. The interfaces are defined only so a future server can plug in without redesigning the core, each behind a no-server fallback.

---

## The wedge, then expand

We pick a wedge ICP, win it, and expand in order. The first proof of the thesis is the **developer flow** — and it's mostly already shipped: point Claude Code at Pane via one MCP URL, reproduce a bug in your real session, fix it from the repo, re-verify. That slice must be excellent before we optimize the knowledge-worker flows.

```mermaid
flowchart LR
    wedge["Wedge<br/>Developer / IC engineer<br/>(Pane-as-MCP + workspace + harness agent — mostly shipped)"]
    expand["Expand<br/>Browser-native knowledge worker<br/>(side-panel Chat + Agent + scheduled)"]
    grow["Grow<br/>Power user · Privacy pro<br/>(local models + open skills)"]
    migrate["Migrate<br/>Hermes / OpenClaw users<br/>(import memory, skills, channels)"]
    wedge --> expand --> grow
    grow --> migrate
```

See [00 — Vision](./00-vision-and-thesis.md) for the per-ICP problem statements and primary flows, and [13 — System Architecture](./13-roadmap.md) for the system model and dependency layers (not a timeline).

---

## How these specs fit together

```mermaid
flowchart TB
    thesis["00 · Vision & Thesis<br/>(ICP strategy + system states + build-on-BrowserOS)"]
    principles["01 · Product Principles"]
    sys["13 · System Architecture<br/>(capability map + State A/B + dependency layers)"]

    context["02 · The Context Graph<br/>(local + buckets; sync = State B extension)"]
    loop["03 · Agent Modes & The Loop<br/>(Graph mode deferred)"]
    memory["04 · Memory & Learning Loop<br/>(auto-skills = intrinsic, zero-server)"]
    capture["14 · Passive Capture & Context Buckets<br/>(meetings + browsing learnings; intrinsic)"]
    work["05 · Workspace, Files & Terminal<br/>(evolved from Cowork)"]
    tasks["06 · Task & Work Management<br/>(executable tasks)"]
    proactive["07 · Proactive & Scheduled Work<br/>(local + keep-alive; cloud-headless = State B)"]
    reach["08 · Reach & Channels<br/>(peer-to-peer; mobile = State B)"]
    integrations["09 · Integrations, MCP & Dev Surface<br/>(wedge; mostly shipped)"]
    trust["10 · Trust, Privacy & Security"]
    skills["11 · Personalization & Skills<br/>(soul.md persona + intrinsic skill system; marketplace = State B)"]
    activation["12 · Onboarding, Activation & Metrics"]
    home["15 · Adaptive Home<br/>(evolving new-tab widgets; intrinsic)"]
    reshape["16 · Page Reshape & Overlays<br/>(your-context overlays + feed de-slop; intrinsic)"]

    thesis --> principles
    thesis --> sys
    principles --> context
    context --> loop
    context --> memory
    capture --> context
    capture --> memory
    integrations --> loop
    loop --> work
    loop --> tasks
    loop --> proactive
    proactive --> reach
    context --> integrations
    trust --> loop
    trust --> work
    trust --> reshape
    skills --> memory
    memory --> home
    skills --> home
    proactive --> home
    context --> reshape
    memory --> reshape
    skills --> reshape
    work --> reshape
    activation --> sys
```

The **Context Graph** (02) is the center of gravity, **partitioned into context buckets** (14). The **developer MCP + workspace surface** (09, 05) is the wedge that proves the thesis first — and it's mostly already shipped. **Passive capture** (14) is the purest "we are the browser" capability for the knowledge-worker ICP. The **adaptive home** (15) and **page reshape** (16) are the expression surfaces where the soul + memory + graph + capture system becomes something the user *feels* every time they open a tab or a page. Read 00, then 13 (system model), then 09 and 05 (the wedge), then 02 and 14 (the context system), then 11, 15 and 16 (the "becomes yours" surfaces).

---

## Spec index

| # | Spec | What it defines |
|---|------|-----------------|
| 00 | [Vision & Thesis](./00-vision-and-thesis.md) | ICP strategy, per-ICP flows, **build on BrowserOS**, **system states A/B**, competitive defense, business model |
| 01 | [Product Principles](./01-product-principles.md) | Tenets every spec is judged against (incl. focus, performance, local-complete, build-on-substrate) |
| 02 | [The Context Graph](./02-the-context-graph.md) | Local graph + index + context tools; sync is a State B extension interface |
| 03 | [Agent Modes & The Loop](./03-agent-modes-and-the-loop.md) | Chat / Agent modes (Graph deferred), the tool loop, visibility, approvals, model routing |
| 04 | [Memory & Learning Loop](./04-memory-and-learning-loop.md) | **Auto-skill-creation as an intrinsic zero-server capability**; memory layers (incl. `soul.md`); browser-grounded learning |
| 05 | [Workspace, Files & Terminal](./05-workspace-files-terminal.md) | Evolved from Cowork: workspaces, sandboxed terminal, trust bar |
| 06 | [Task & Work Management](./06-task-and-work-management.md) | Executable tasks + inbox + triage (native kanban cut) |
| 07 | [Proactive & Scheduled Work](./07-proactive-and-scheduled-work.md) | Local + OS keep-alive; cloud-headless = State B extension point |
| 08 | [Reach & Channels](./08-reach-and-channels.md) | Peer-to-peer reach (OS push + email + Telegram); mobile companion = State B |
| 09 | [Integrations, MCP & Developer Surface](./09-integrations-mcp-developer-surface.md) | The wedge — mostly shipped: Connect Apps, Pane-as-MCP, harness agents, CLI |
| 10 | [Trust, Privacy & Security](./10-trust-privacy-security.md) | Local-first, prompt-injection defense, ICP-tunable approvals, fatigue guardrail |
| 11 | [Personalization & Skills](./11-personalization-skills-marketplace.md) | **`soul.md` persona layer** + intrinsic skill system + agentskills.io peer import; hosted marketplace = State B |
| 12 | [Onboarding, Activation & Metrics](./12-onboarding-activation-metrics.md) | ICP-specific paths, calibrated activation bars, success metrics |
| 13 | [System Architecture & Build Order](./13-roadmap.md) | **Not a timeline** — capability map, State A/B, dependency layers |
| 14 | [Passive Capture & Context Buckets](./14-passive-capture-and-context-buckets.md) | Meeting recordings + notes, browsing learnings, bucketed context — all intrinsic State A |
| 15 | [Adaptive Home](./15-adaptive-home.md) | New tab foundation (Phases 5–6) + evolving home (Phase 8): curated then user/agent widgets |
| 16 | [Page Reshape & Overlays](./16-page-reshape-and-overlays.md) | On-page overlays + feed de-slop — **Phase 9**, incremental post-v1.0 |
| — | [Architecture Design](./ARCHITECTURE-DESIGN.md) | **Engineering design** that realizes the specs, grounded in the current fork; intrinsic-only with State B extension-point interfaces. v0.4: expert-architecture review (process model & supervision, CDP-as-security-boundary, state-ownership boundary, loop discipline, platform matrix, degradation/observability/testing) + a full **disable & cleanup register** of BrowserOS defaults Pane doesn't need (product + tech). |
| — | [Implementation Plan](./IMPLEMENTATION-PLAN.md) | **End-to-end OSS build plan (State A).** Phases 0–9: engine through Phase 6, **v1.0 at Phase 7**, post-launch Phase 8 + Phase 9. |
| — | [Rebrand Plan (Step 0)](./REBRAND-PLAN.md) | **BrowserOS → Pane rebrand sweep.** Replaces every user-facing BrowserOS brand (icons from `assets/branding/pane-mark.svg` / `pane-wordmark.svg` + display text) across app, docs, CLI, native C++, Chromium icons, build/CI, and metadata. Splits product-brand (→ Pane) from substrate identifiers (tech debt) and infra (separate track), with a final ripgrep + visual QA gate. |
| — | [Phase 1 Prompt](./PHASE-1-PROMPT.md) | Self-contained execution prompt for Phase 1 (Bedrock). |
| — | [Phase 2 Prompt](./PHASE-2-PROMPT.md) | Self-contained execution prompt for Phase 2 (Trust & Workspaces). Small-model detailed. |
| — | [Phase 3 Prompt](./PHASE-3-PROMPT.md) | Self-contained execution prompt for Phase 3 (Context Graph & Tasks). Grounded in Phase 2 as-shipped. |
| — | [Phase 4 Prompt](./PHASE-4-PROMPT.md) | Self-contained execution prompt for Phase 4 (Memory & Skills). Grounded in Phase 3 as-shipped: replace `context_recall` stub, memories files + index, prompt budget, auto-skill staging, curation, `soul.md` personas, UI + CLI. Stops at Pane v0.4. |
| — | [Phase 4 Report](./PHASE-4-REPORT.md) | As-shipped Phase 4 (Memory & Skills). Ship gate met; stop before Phase 5. |
| — | [Phase 5 Prompt](./PHASE-5-PROMPT.md) | Self-contained execution prompt for Phase 5 (Proactive & Reach). Stops at Pane v0.5. |
| — | [Phase 5 Report](./PHASE-5-REPORT.md) | As-shipped Phase 5. Ship gate met. |
| — | [Phase 6 Prompt](./PHASE-6-PROMPT.md) | Self-contained execution prompt for Phase 6 (Passive Capture & Buckets). Stops at Pane v0.6. |
| — | [Phase 6 Report](./PHASE-6-REPORT.md) | As-shipped Phase 6. Ship gate met; next is Phase 7 (v1.0 packaging). |
| — | [Phase 7 Prompt](./PHASE-7-PROMPT.md) | Self-contained execution prompt for Phase 7 (v1.0 polish, packaging, diagnostics, eval). |

---

## How to read a spec

Each spec follows the same shape so they can be read in any order after 00, 01, and 13:

1. **Summary** — one paragraph, the elevator pitch.
2. **Goals / Non-goals** — what is and isn't in scope.
3. **User stories** — the jobs to be done.
4. **Spec** — the design: behavior, data model, UX, edge cases.
5. **Interactions** — how this spec depends on and feeds the others.
6. **Open questions** — unresolved decisions.
7. **Metrics** — how we know this worked.

Each spec anchors on **what BrowserOS already has** and separates **intrinsic (State A)** capability from **State B extension points**. When a spec conflicts with current shipped behavior (in `PRODUCT.md`), it states the intended future state and flags the delta.

---

## Status and ownership

These specs are **draft for review (v0.6)**. They are meant to be challenged. Each one ends with open questions that need a product decision before implementation begins. Nothing here is committed until it appears in [13 — System Architecture](./13-roadmap.md) with an owner.
