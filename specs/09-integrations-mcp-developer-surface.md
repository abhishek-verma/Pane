# 09 — Integrations, MCP & Developer Surface

## Summary

Pane is both a **consumer** of integrations (it connects to your apps) and a **provider** of integrations (the browser itself is an MCP server). That symmetry is the developer wedge: the same automation surface that powers the in-browser agent also powers Claude Code, Cursor, Gemini CLI, and the `browseros-cli`. This spec defines the integration layers, the MCP surfaces, the CLI, and how external coding agents plug into Pane + the Context Graph.

> **Review v0.2 note.** Elevated **Pane-as-MCP + harness agents + workspace** to the **wedge surface**, matching the ICP strategy in [00](./00-vision-and-thesis.md). The earlier draft buried this as a late afterthought. Connect Apps (consumer integrations) remains important but follows the wedge. Added the explicit "why this beats Chrome DevTools MCP" framing since that's the dev's actual comparison.
>
> **Review v0.3 note.** Restated as a system fact: **most of this spec is already shipped in BrowserOS** — Pane-as-MCP (`chrome://browseros/mcp`, one-line `claude mcp add`), `browseros-cli` (Go), harness agents (`AGENT_HARNESS_SUPPORT`), Connect Apps (40+ via Klavis), and custom-MCP support. The net-new work is small: expose the Context Graph over MCP and add CLI commands for context/task/schedule/memory. Klavis is a third-party server (not Pane's), so Connect Apps fits State A. Pane's own cloud sync/credits, if used, are State B extension points.

---

## Goals

- Let users connect the apps they use (Gmail, Slack, Linear, GitHub, Notion, …) with one-click OAuth.
- Expose Pane (browser + workspace + context graph) as an MCP server to any MCP client.
- Make external coding agents (Claude Code, Codex, Cursor) first-class citizens that work *with* Pane instead of around it.
- Keep the integration model **open (MCP), permissioned, and inspectable** (principles 4, 7, 8).

## Non-goals

- Hand-building every integration. Use managed MCP (Klavis) for breadth; let users add custom MCPs for the long tail.
- Lock-in. Any MCP client can connect; any custom MCP server can be added.
- Becoming an iPaaS. n8n/Zapier own heavy orchestration; Pane interoperates (webhooks + MCP).

---

## Integration layers

| Layer | What it connects | Surface | System layer |
|-------|------------------|---------|-------|
| **Pane-as-MCP** | Exposes Pane's browser + workspace + context graph to external clients | `chrome://browseros/mcp`; `claude mcp add …` | **Wedge (intrinsic; mostly shipped)** |
| **Custom MCP servers** | User-added MCP endpoints (self-hosted or third-party) | Settings → MCP | Intrinsic (expand) |
| **Connect Apps** (managed MCP) | 40+ SaaS apps via Klavis-backed OAuth/API | Settings → Connect Apps (`/connect-apps`) | Intrinsic (expand ICP) |
| **CLI** | Terminal control of Pane via MCP | `browseros-cli` | **Wedge (intrinsic; shipped)** |
| **Automation platforms** | n8n recipes calling Pane | Docs integration + webhooks | Later |
| **Cloud API** | Account, sync, credits, GraphQL | `api.browseros.com` | **Disabled in the Pane fork (State B, future)** |

---

## Connect Apps (consumer side)

- One-click OAuth for major services; API-key for others. Existing today (Klavis-backed).
- Connection = a Context Graph node with `grant_state`; app objects (emails, issues, events) are graph nodes fetched lazily with TTL.
- **Smart nudges** offer to connect an app at the moment it's useful ("you asked me to check your inbox — connect Gmail?"), dismissable (principle 6).
- **Per-connection scopes**: grant only what's needed (read inbox vs. send mail); escalate on demand.
- Apps the agent can act on are `write-external` and approval-gated (see [03](./03-agent-modes-and-the-loop.md)).

---

## Pane-as-MCP (provider side)

Pane exposes an MCP endpoint (`http://127.0.0.1:9100/mcp`, StreamableHTTP) with the full tool surface:

- **Browser tools** (53+): navigate, snapshot, click, type, read, screenshot, pdf, tabs, tab_groups, bookmarks, history, windows, evaluate, run, download, upload, etc.
- **Workspace tools**: file + terminal (within granted workspaces).
- **Context Graph tools**: `context.search`, `context.recall`, `context.related`, `context.current_work`, `context.attach` (see [02](./02-the-context-graph.md)).
- **Integration tools**: act on connected apps (Gmail, Slack, Linear, …) through the same MCP session.

Setup is one line (exists today):

```bash
claude mcp add --transport http browseros http://127.0.0.1:9100/mcp --scope user
```

The MCP URL is visible at `chrome://browseros/mcp` and in Settings → Pane as MCP.

### Why this is the wedge

An external coding agent connected to Pane gets, in one URL:

1. A real browser with the user's logins (not a WebDriver-flagged debug session).
2. The user's workspace (files + terminal).
3. The Context Graph (what the user is working on, past runs, memory, skills).

That's strictly more than Chrome DevTools MCP (browser only) or a bare filesystem MCP. It's the "Hermes but the agent is your coding agent, and the browser is Pane" story.

---

## External coding agents (harness agents)

Pane already supports Claude Code and Codex as harness agents (`AGENT_HARNESS_SUPPORT`). The model:

```mermaid
flowchart LR
    cc[Claude Code / Codex / Cursor] -->|MCP| pane[Pane MCP]
    pane --> browser[Browser<br/>real session]
    pane --> ws[Workspace<br/>files + terminal]
    pane --> graph[Context Graph]
    pane --> apps[Connected apps]
    pane -->|approvals| user[User]
```

- The **coding agent** owns the code work (edits, tests, commits) inside a workspace.
- **Pane** owns the browser, the context graph, and **all `write-external`/`spend` approvals**. The harness is sandboxed to the workspace and never gets to spend money or post externally without Pane asking the user.
- The harness can call Pane tools ("open the staging admin, reproduce the bug, return console errors") and Pane runs them in the user's real session.

This composes the strengths: coding agents are great at code; Pane is great at the live browser + context; the user keeps control.

---

## CLI (`browseros-cli`)

Existing today (Go). Commands map to MCP tools (`open`, `snapshot`, `click`, `batch`, `bookmark`, `history`, …) plus `launch`, `init`, `health`, `status`. Each command opens an MCP session, calls `tools/call`, closes.

We extend the CLI to expose the new surfaces:

- `pane context search "…"` — query the Context Graph.
- `pane context current` — what the user is working on right now.
- `pane task list` / `pane task run <name>` — task management from the terminal.
- `pane schedule list` / `pane schedule run <name>` — scheduled tasks.
- `pane memory` / `pane skills` — memory & skills management.
- `pane channel send <channel> "…"` — send via a reach channel (power-user).

Distributed via the npm shim that downloads platform binaries (exists today).

---

## Custom MCP servers

Users can add any MCP server (self-hosted or third-party) in Settings → MCP. Pane connects to it per-session via the existing `mcp-builder.ts` mechanism and exposes its tools to the agent loop. This is the long-tail answer: if Pane doesn't have an integration, the user (or a skill) can bring one.

---

## n8n / automation platforms

- Pane exposes **webhooks** per scheduled/triggered task (see [07](./07-proactive-and-scheduled-work.md)) so n8n can trigger Pane.
- Pane can call out to n8n workflows via webhook nodes in Graph mode.
- Docs recipe maintained (exists today).

---

## Surfacing

- **Connect Apps** (`/connect-apps`): catalog, connected status, scopes, disconnect.
- **Pane as MCP** (`/settings/mcp`): MCP URL, copy button, client setup instructions, active sessions, revoke.
- **Custom MCP** (`/settings/mcp`): add/remove servers, per-session enable.
- **CLI** install in onboarding and docs.

---

## User stories

- "I connect Gmail and Linear in two clicks. Now my morning digest summarizes overnight emails and files tickets into Linear."
- "In Claude Code I type `pane open localhost:3000; click Sign up; read console`. Pane runs it in my session and returns errors. Claude Code writes the fix."
- "I add a custom MCP for my internal API. The agent now can query our internal services alongside the browser."
- "From the terminal: `pane task run daily-standup-prep` — Pane executes the task and posts the summary to my Slack."
- "An n8n workflow fires a webhook into Pane to trigger the 'deploy smoke test' task."

---

## Interactions with other specs

- **02 — Context Graph**: app objects and custom-MCP objects are graph nodes; the graph is exposed as MCP tools.
- **03 — Agent Modes & The Loop**: integration tools are invoked by the loop with consequence classes; harness agents compose with Pane.
- **05 — Workspace, Files & Terminal**: harness agents are sandboxed to workspaces.
- **06 — Task & Work Management**: external task systems sync via Connect Apps; tasks exposed to CLI/MCP.
- **07 — Proactive & Scheduled Work**: triggers from integration events; webhooks for n8n; CLI for schedules.
- **08 — Reach & Channels**: Slack/Discord share OAuth between channel and integration roles.
- **10 — Trust**: per-connection scopes, approval gating, MCP session auth, custom-MCP sandboxing.
- **11 — Personalization & Skills**: skills can wrap MCP tool sequences; marketplace skills declare required MCPs.

---

## Edge cases

- **MCP server goes down**: tools fail gracefully; the agent reports the integration is unavailable and continues with other tools.
- **Custom MCP with dangerous tools**: custom MCPs are labeled untrusted; their `write-external`/`spend` calls still go through Pane's approval layer.
- **OAuth token expiry**: refresh silently; on failure, nudge to reconnect.
- **Rate limits** on integrations: respect them; back off; surface "rate-limited, will retry" in the transcript.
- **Conflicting scopes**: a connection granted `read` can't `send` — the agent requests an escalation, which the user approves.
- **External client left connected**: MCP sessions show in Settings with last-active and a revoke button.

---

## Kill criteria

- If custom MCP adoption is near-zero, keep the surface (it's cheap and high-signal for power users) but don't invest in discovery UI.
- If the CLI's new context/task/schedule commands see low use, keep the core (`open`/`snapshot`/`click`) and defer the rest.

---

## Open questions

1. **Do we expose the Context Graph as a versioned MCP *resource*** (not just tools) so clients can subscribe to changes? *Lean: yes, it's a strong differentiator and aligns with MCP.*
2. **Trust model for custom MCPs**: full approval passthrough, or a separate "untrusted MCP" sandbox? *Lean: untrusted by default; tools go through Pane's approval layer regardless.*
3. **Should harness agents be allowed to add custom MCPs themselves** (skill-installed MCPs)? *Lean: yes, but staged for user approval (like Hermes self-installing skills).*
4. **Pricing for Pane-as-MCP** for heavy external-agent use? *Lean: free for personal BYOK; metered credits for hosted/cloud-runner use.*

---

## Metrics

- **Connect Apps per user** and per-integration attach rate.
- **Pane-as-MCP URL copies** and **active MCP sessions** (developer adoption).
- **`browseros-cli init` completions** and CLI command usage by command.
- **Harness-agent sessions** (Claude Code/Codex via Pane) and tool-call mix.
- **Custom MCP adoption** (% of users with ≥1 custom server).
- **External agent task success rate** (eval harness via MCP).
- **Integration action rate** (sends/posts/creates) and approval grant rate.
