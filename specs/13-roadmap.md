# 13 — System Architecture & Build Order

## Summary

This doc is **not a timeline.** Implementation is AI-accelerated, so phasing-by-calendar is the wrong frame. Instead we think in **systems**: what the Pane system *is* as a pure open-source artifact with no Pane-operated servers, what it *can become* when optional servers plug in later via defined extension points, what already exists in BrowserOS that we build on, and what structurally depends on what.

> **Review v0.3 note.** Replaces the v0.2 phased roadmap. Two corrections from the user: (1) think in systems, not implementation timelines — the starting state is a pure-OSS project with **no Pane servers**, so anything requiring a server (marketplace, cloud sync, hosted credits, cloud-headless runner) is a *future extension point*, not a phase; the **auto-skill-creation engine is a day-one intrinsic capability** that needs zero servers. (2) We **build on BrowserOS**, not from scratch — most of the wedge is already shipped. This doc now leads with a capability map of what exists, the State A / State B system model, and dependency layers (not quarters).
>
> **Review v0.4 note (HoP pass).** Added a **Distribution, packaging & update** section (a State A cross-cutting concern the v0.2/v0.3 set ignored — builds/signing, auto-update-without-a-Pane-server via signed static-host manifests, the Chromium rebase treadmill, and mass-ICP discovery as a hard separate GTM problem). Expanded the risk register with the habit/retention, first-bad-action, skill-bloat, local-transcription, no-default-model, fork-maintenance, auto-update, and discovery risks — each with a mitigation pointing back to the spec that owns it.

---

## Build on BrowserOS — what already exists

We are not greenfield. BrowserOS already ships the substrate for most of this spec set. The net-new intrinsic work is smaller than it looks.

| Spec area | Already in BrowserOS | Net-new intrinsic work |
|-----------|----------------------|------------------------|
| Browser | Chromium fork, native sidebar, MCP wiring, privacy patches, vertical tabs, ad blocking, glow, Chrome import, voice | — (extend only) |
| Agent loop + tools | `apps/server` (Hono, `/chat`, `/mcp`, `/agents`), `browser-mcp` (16 browser tools), Cowork filesystem tools → 53+ total; Chat + Agent modes GA | Loop reads Context Graph; grounding chips; glows per domain; interrupt/undo |
| **Dev wedge (Pane-as-MCP)** | `chrome://browseros/mcp`, one-line `claude mcp add`, `browseros-cli` (Go), harness agents (`AGENT_HARNESS_SUPPORT`) | **Mostly shipped.** Add workspace exposure over MCP + context-graph tools |
| Workspace / files / terminal | Cowork: filesystem tools (`ls`/`read`/`write`/`bash`/`search`) + folder picker | Workspaces (grant/switch/scope), sandboxed terminal w/ denylist, terminal-as-graph-node |
| Memory + skills | **Pulled back in v0.46** (Skills/Soul/Memory) — intentionally cleared to rebuild | The whole intrinsic memory + auto-skill-creation engine (this is the core rebuild) |
| Context Graph | browser-mcp/CDP extractors, page-markdown extraction, Cowork file ops, session persistence (SQLite) | The unified graph + index + **context buckets** + context tools + Context panel |
| **Passive capture & buckets** | tab/page capture via `browser-mcp`/CDP, the **glow indicator** (repurposed as the capture light), Cowork for local storage | Meeting capture + local transcription + notes; browsing learnings; bucket model (see [14](./14-passive-capture-and-context-buckets.md)) |
| Tasks | — | Tasks/inbox/executable-tasks + external sync |
| Proactive / scheduled | Scheduled tasks (sidebar + nudge), smart nudges | Triggers (graph events), keep-alive, daily digest |
| Reach | — | OS push + email + Telegram (all peer-to-peer, no Pane server) |
| Integrations | Connect Apps (40+ via Klavis — a third-party server, not Pane's), custom MCPs, `/klavis` routes | Expose Context Graph over MCP; skill-installed MCPs |
| Models | BYOK + OAuth (ChatGPT Pro/Copilot/Qwen) + local (Ollama/LM Studio) + default credits (Kimi, partnership) | Per-mode routing UI; weak-model nag |
| Trust | (implicit) | Consequence classes, approval framework, Context panel, action log, injection defense, **capture consent** |
| Cloud surfaces | Cloud sync (GraphQL `api.browseros.com`), credits (`CREDITS_SUPPORT`), Remote Hermes (`/remote-hermes`) — **exist in BrowserOS but DISABLED in the Pane fork** | None — Pane fork ships State A only; these are future State B extension points |
| Eval | `apps/eval` (WebVoyager, Mind2Web, AGI SDK) | Add the "Pane thesis" eval (browser + workspace + context + capture) |
| Parallel surface | BrowserClaw stack (`claw-server`/`claw-app`/`claw-onboard`) | May host some of these surfaces; out of scope for this spec set |

**The headline:** the developer wedge — the first proof of the thesis — is *mostly already shipped*. The net-new intrinsic work is the Context Graph (with **context buckets**), the memory + auto-skills engine, **passive capture (meetings + browsing learnings)**, Workspaces (evolved from Cowork), Tasks, Triggers, Reach, and the Trust framework. That's the system to build.

---

## System states: A (pure local) and B (optional servers)

The system is **complete and useful in State A** and **designed to accept State B** without redesign. Nothing in State A depends on a Pane-operated server.

> **v0.3 decision (from the user):** BrowserOS ships several Pane-operated server surfaces (cloud sync, credits, Remote Hermes, the cloud API). **These are disabled in the Pane fork.** Pane ships **State A only for now.** State B is a *future and conditional* possibility — "if Pane gets famous, we might add server-side integration and those features" — not a present reality. The interfaces are still defined so a future State B can plug in without redesign, but nothing assumes a Pane server exists.

### State A — Pure open-source, no Pane servers (what the Pane fork ships)

Everything runs on the user's machine. No Pane-operated server is required for any core capability.

| Capability | How it works in State A |
|-----------|--------------------------|
| Models | BYOK (user's keys to provider APIs), OAuth subscriptions (ChatGPT Pro/Copilot/Qwen — hit *provider* servers, not Pane's), local models (Ollama/LM Studio). Default credits (Kimi) are an *optional on-ramp*; the system is full-featured without them. |
| Context Graph | Local SQLite + FTS5 + optional on-device embeddings. |
| Memory + skills | Local files (`~/.browseros/memories/`); **auto-created by the learning loop on-device**; imported from agentskills.io by URL/file (peer). |
| Workspace / files / terminal | Local sandbox. |
| Tasks | Local store. |
| Scheduled / triggered work | In-app scheduler + OS keep-alive (login item / launchd / Task Scheduler). |
| Reach | OS native push (local), email (user's SMTP/IMAP), Telegram bot (hits Telegram's servers, not Pane's). All peer-to-peer. |
| Integrations | Klavis-managed apps (third-party server) + user's custom MCPs. Optional. |
| Personalization | `soul.md`, `USER.md`, own skills — all local. |
| Sync | None required; the system defines a sync *interface* but no server is needed to use Pane. |

**The "becomes smarter" promise is fully delivered in State A.** The learning loop watches browser + workspace + terminal activity, writes memory and `SKILL.md` files locally, and retrieves them on demand. No marketplace, no server, no account. This is the direct answer to "the system should automatically create skills like Hermes or OpenClaw to become smarter."

### State B — Optional Pane servers (future, conditional, designed-for extension points)

> Not shipped in the Pane fork. Defined only so a future server can plug in *without redesigning the core*. Each extension has a no-server fallback; the product is complete without any of them. Conditional on adoption — "if Pane gets famous."

| Extension point | Interface | What a Pane server would add |
|-----------------|-----------|------------------------------|
| **Cloud sync** | A sync adapter the local graph/memory/tasks write to | Cross-device follow-me; the local-only path stays full-featured |
| **Hosted credits / default model** | A provider adapter alongside BYOK/OAuth | A no-keys on-ramp for new users (the Kimi partnership is an early instance) |
| **Skills marketplace** | A directory source alongside local + agentskills.io-import | Hosted discovery/publishing; **the intrinsic skill system already works without it** |
| **Cloud-headless scheduled runner** | A runner adapter the scheduler can delegate to | True 24/7 without a machine on; isolated from live sessions |
| **Team / shared context** | A shared-graph adapter | Multi-user graphs, shared tasks/memory; sales-led |

The architecture rule: **every State B extension is behind an interface that has a no-server fallback.** If a Pane server never ships for a given extension, the product is still complete.

---

## Dependency layers (not a timeline)

These are *structural* dependencies — what must exist for what to work — independent of when they're built. AI-accelerated implementation means we can build many layers in parallel; the graph below says "X can't function without Y," not "X comes after Y in time."

```mermaid
flowchart TB
    subgraph existing [Already in BrowserOS]
        browser[Chromium + browser-mcp + 53 tools]
        server[Agent server: /chat /mcp /agents]
        cli[CLI + Pane-as-MCP + harness agents]
        cowork[Cowork filesystem tools]
        sched[Scheduled tasks + nudges]
        apps[Connect Apps + custom MCP]
        models[BYOK + OAuth + local]
    end

    subgraph intrinsic [Intrinsic net-new — State A]
        graph[Context Graph + index + buckets + context tools]
        trust[Trust framework: approvals + capture consent + Context panel + action log]
        ws[Workspaces + sandboxed terminal]
        memory[Memory + auto-skill learning loop]
        capture[Passive capture: meetings + browsing learnings + buckets]
        tasks[Tasks + executable tasks + triggers]
        reach[Reach: OS push + email + Telegram]
        soul[Personalization: soul.md + USER.md]
    end

    subgraph ext [State B extension points — optional servers]
        sync[Cloud sync adapter]
        credits[Hosted credits adapter]
        market[Skills marketplace source]
        headless[Cloud-headless runner adapter]
        team[Team / shared-graph adapter]
    end

    browser --> graph
    browser --> capture
    cowork --> ws
    server --> graph
    graph --> memory
    graph --> tasks
    capture --> graph
    capture --> memory
    trust --> ws
    trust --> memory
    trust --> capture
    ws --> memory
    memory --> tasks
    sched --> tasks
    tasks --> reach
    cli --> graph

    graph -.-> sync
    memory -.-> market
    sched -.-> headless
    models -.-> credits
    graph -.-> team
```

### Layer reading

- **Foundational (already shipped):** browser + agent server + tools + CLI/MCP + Cowork + scheduled tasks + apps + models. We build on these, we don't rebuild them.
- **Core intrinsic (State A, net-new):** Context Graph (with buckets), Trust framework (with capture consent), Workspaces, Memory+skills, **Passive capture (meetings + browsing learnings)**, Tasks, Reach, Personalization. These are the system. They depend on each other in the ways shown, and on nothing Pane-server-side.
- **Extension points (State B):** behind interfaces, no-server fallback each.

---

## The first proof (thinnest end-to-end expression of the system)

Not "Phase 1" — the *thinnest end-to-end slice that proves the system works*. Because the dev wedge is mostly already shipped, this slice is small:

> A developer copies the Pane-as-MCP URL, points Claude Code at it, and says "open localhost:3000, click Sign up, read the console errors." Pane runs the loop in the developer's real session, returns the console output. Claude Code edits the repo in a granted workspace, runs `make test` via Pane's terminal, Pane re-verifies in the browser.

What this slice exercises: existing Pane-as-MCP + harness agent (shipped) + a thin Context Graph (active tab + workspace + agent-run) + the Trust framework (consequence classes + action log) + Workspaces (evolved from Cowork). It needs **zero Pane servers**. It proves the thesis: *my coding agent drives my real browser, with my repo, in one loop.*

This slice is the calibration target for the whole system. If it's excellent, the rest compounds.

---

## Distribution, packaging & update (a State A concern, not a feature)

A pure-OSS, no-servers product still has to *reach users and stay current*, and that's harder without a Pane server. This is a real operational surface the v0.2 set ignored:

- **Builds & signing.** macOS (notarized), Windows (code-signing cert), Linux (AppImage/deb/rpm + repo). Code-signing certs cost money and rotate — an OSS project cost, not a server cost. *Lean: community-funded certs; unsigned builds available with a clear warning.*
- **Auto-update without a Pane server.** A Chromium fork is too heavy to ship full bundles every update. Options, all server-free from Pane's side: **(a) Chromium-style update via a static update manifest on any static host / GitHub Releases / a CDN we don't operate (Cloudflare Pages, jsDelivr-style)**; **(b) check-for-update against a signed manifest, download a delta/patch, verify signature, swap on next launch.** The update server is a *static file host*, not a Pane product server — consistent with "no Pane servers." We never run an update-control plane.
- **The Chromium rebase treadmill.** Pane tracks upstream Chromium; rebasing is a recurring engineering cost, not a one-time build. Budget it as ongoing, not a milestone. *Lean: lag stable Chromium by one or two minor versions; never chase canary.*
- **Discovery.** OSS browser forks have no app-store distribution. The dev wedge has a natural channel (MCP directories, dev Twitter/HN, "your coding agent drives your browser" demos). The mass ICP does not — discovery there is the hardest GTM problem and is *not solved by building features*. *Lean: win devs first (they distribute to devs + blog), let the open-source story carry the privacy ICP, and treat mass-ICP discovery as its own later problem.*

This belongs in the system doc, not a feature spec, because it's a cross-cutting constraint every feature inherits (you can't ship a feature the updater can't deliver).

---

## Risk register

| Risk | Mitigation |
|------|------------|
| **Treating State B as required** | Every spec declares its no-server fallback; a spec that breaks without a Pane server is rejected. |
| **Rebuilding what BrowserOS already has** | The capability map above is the gate; specs anchor on existing substrates and say "extend," not "build." |
| **Auto-skill-creation writes bad skills** | `provenance` + `success_rate` + source-run linking + easy delete + inferred-write staging (04/11). |
| **Context Graph too heavy / hurts browsing** | Thin edge first; disk + CPU budgets in CI; on-device embeddings opt-in (02). |
| **Approvals annoy users into disabling** | ICP-tunable defaults + approval-fatigue guardrail + cold-start calibration (10). |
| **Reach becomes a mobile-app company** | State A reach is peer-to-peer (OS push + email + Telegram); mobile companion is a State B-ish extension gated on engagement (08). |
| **Prompt injection causes a bad action** | Approval gating is the structural backstop; outbound scanning; honest docs (10). |
| **Local-first promise erodes if servers ship** | Business model scoped so the local-only path stays full-featured; review every quarter (00). |
| **Marketplace cold-start** | Not a State A concern — the intrinsic skill system + agentskills.io import works with zero supply; the hosted marketplace unlocks only with real supply (11). |
| **No daily habit → activation doesn't become retention** | The habit loop (proactive pings + capture-driven follow-ups) is specified as retention-critical in [12](./12-onboarding-activation-metrics.md); north-star = weekly thesis actions/WAU. |
| **First bad action kills trust forever** | Training-wheels/dry-run for `write-external`/`system`/`spend` + blast-radius cap for new users ([10](./10-trust-privacy-security.md)). |
| **Auto-skills bloat → "agent got dumber"** | Curation & pruning half of the loop: use-tracking demotes/archives, memory demotes when never recalled, monthly curation digest ([04](./04-memory-and-learning-loop.md)). |
| **Local transcription quality too low for meetings** | Ship local as default-with-consent, BYOK-to-provider as the fast path; benchmark before locking; if local is unusable, scope meetings to BYOK-only rather than drop the feature ([14](./14-passive-capture-and-context-buckets.md)). |
| **No-default-model blocks mass-ICP activation** | Lead onboarding with OAuth subscriptions; local as privacy path; default-credits return only as a later State B on-ramp. Measure model-step drop-off ([00](./00-vision-and-thesis.md), [12](./12-onboarding-activation-metrics.md)). |
| **Fork maintenance / Chromium rebase treadmill** | Lag stable Chromium by 1–2 minor versions; budget rebasing as ongoing, not a milestone (distribution section above). |
| **Auto-update without a Pane server** | Update via signed manifests on a static host / GitHub Releases / third-party CDN — a static file host is not a Pane product server. Never run an update control plane. |
| **Mass-ICP discovery (no app store, no server)** | Win devs first (they distribute to devs); let the open-source story carry the privacy ICP; treat mass-ICP discovery as a separate later GTM problem, not a feature problem. |

---

## What is explicitly not in the system (and why)

| Out | Why |
|-----|-----|
| A Pane-operated server as a **dependency** for core capability | The system is complete in State A. Servers are extension points. |
| Hosted skills marketplace as a **launch requirement** | Auto-skill-creation + peer import deliver "smarter over time" with no server. |
| Cloud sync as a **requirement** | Local-only is full-featured; sync is an opt-in adapter. |
| Cloud-headless runner as a **v1 dependency** | In-app + OS keep-alive covers the need; cloud-headless is a later opt-in for true 24/7. |
| Graph mode (visual workflows) | "Save as scheduled" covers the durable need; returns only with authoring data (03/07). |
| Mobile companion as a **launch dependency** | OS push + email + Telegram cover high-signal reach; companion is gated on engagement (08). |
| Native kanban / board views | Tasks differentiate on being *executable*, not on PM UI (06). |
| Team / shared context | Premature; single-user system first. |
| Office doc generation (Excel/PPT) | Partner or defer; Cowork wins that niche. |
| Full mobile browser | Reach companion is not a browser. |
| Containerized/VM workspaces | Sandbox + approval is the intrinsic answer; heavier isolation is a later opt-in. |

---

## Open questions

1. ~~**The existing cloud surfaces** (sync GraphQL, credits, Klavis): do we treat them as already-deployed State B instances, or wind them down to a pure-State-A starting posture?~~ **Decision (v0.3, from user): disable all Pane-operated server surfaces in the Pane fork** (cloud sync, credits, Remote Hermes, the cloud API). Pane ships State A only. Klavis/Connect Apps stay because they're a *third-party* server, not Pane's. State B is future and conditional on adoption.
2. **Where does the BrowserClaw stack fit** in this system model — is it a host for some intrinsic surfaces, or a separate product? *Decision needed; out of scope for this spec set.*
3. **Default-credits (Kimi) on-ramp**: keep as an optional State B provider adapter, or drop from the default experience to strengthen the "no servers" posture? *Lean: keep as an opt-in adapter; don't make it the default path.*
4. **Sync interface definition**: do we specify the sync adapter contract now (so State B plugs in cleanly) or defer until a server is actually built? *Lean: define the contract now as part of 02/04/06; it's cheap and prevents redesign.*

---

## Related specs

- [00 — Vision & Thesis](./00-vision-and-thesis.md) — the "why" + system states + business model.
- Each spec's `Review v0.3 note` flags how it anchors on BrowserOS and separates intrinsic (State A) from extension-point (State B).
