# 02 — The Context Graph

## Summary

The Context Graph is the unified, permissioned layer that knows what you are working on. It pulls together everything the agent is allowed to see — your active tab, your open tabs, your browsing history, your logins and sessions, your workspaces and files, your terminal sessions, your connected apps, your tasks, and your memory — into one queryable, auditable structure that lives on your device. This is the moat. Hermes and OpenClaw build a partial version of this by bolting onto a browser; Atlas/Comet/Dia build it in the cloud and won't let you see it. Pane builds it natively, locally, and with the user in control of every edge.

Everything else in the product — the agent loop, memory, skills, tasks, proactive work, reach — reads from and writes to the Context Graph. This spec defines what it contains, how it's built, how it's permissioned, and how it's surfaced.

> **Review v0.2 note.** The earlier draft spec'd the full graph up front. That's a multi-quarter build before any user value. This version defines a **thin edge** (the minimal graph that makes the developer wedge flow excellent) and an **expansion path**, plus an explicit **cold-start/bootstrap** strategy (an empty graph is useless) and a **value-before-completeness** rule. The app-object and semantic/embedding layers are deferred.
>
> **Review v0.3 note.** Anchored on **what BrowserOS already has**: `browser-mcp`/CDP extractors (snapshots, page-markdown via `read`/`snapshot`), Cowork file ops, and session persistence in SQLite. The Context Graph unifies and indexes these — it's an extension of existing extractors, not a new pipeline from scratch. **Cloud sync is a State B extension interface** (a sync adapter the local graph writes to); the graph is complete and useful locally with no server. The graph is **partitioned into context buckets** (work / personal / per-project / meeting-notes / research) — see [14 — Passive Capture & Context Buckets](./14-passive-capture-and-context-buckets.md) for the bucket model; this spec owns the graph + index + retrieval, 14 owns capture + bucket operations.

---

## Thin edge first

The full graph below is the destination. **The thin edge ships only what the developer wedge needs:**

| Domain | In the thin edge? | Why |
|--------|-------------------|-----|
| Browser — active tab + open tabs | ✅ | The wedge flow reproduces bugs on the current/active page |
| Workspace — files + terminal sessions | ✅ | The coding agent reads the repo and runs commands |
| Agent run | ✅ | "Show the work" + replay for the wedge |
| Browser — history, sessions, bookmarks, login presence | Expansion layer | Not needed to prove the wedge |
| App domain (Gmail/Slack/Linear objects) | Expansion layer | Not a dev-wedge need |
| Memory domain | Expansion layer | Memory rebuild is its own intrinsic surface |
| Embeddings / semantic index | Later (opt-in) | FTS5 is enough for the thin edge |

The thin edge is the smallest graph that lets the agent answer "what page am I on, what repo am I working in, and what did the last run do?" — which is exactly what the wedge flow needs.

## Goals

- Define a single substrate that represents "what the user is working on" across browser, files, terminal, apps, and memory.
- Make every context source **opt-in, revocable, and visible** (principle 4).
- Make the graph **queryable by the agent** at runtime and **inspectable by the user** at any time.
- Make the graph **local-first** and **portable**, never a cloud-only artifact.
- Give memory and skills ([04](./04-memory-and-learning-loop.md)) a grounded activity feed to learn from, instead of self-reported facts.

## Non-goals

- Building a knowledge graph with named-entity extraction and ontology. The Context Graph is a structured activity + reference store, not a semantic knowledge base. (Optional semantic index is a later layer.)
- Replacing the browser's own history/bookmark/tab stores. Pane's native stores remain the source of truth; the graph references and indexes them.
- Cross-user or team-shared context. That is a later, opt-in, cloud surface.

---

## What's in the graph

The graph is made of **nodes** (things) and **edges** (relationships and events). Five node domains:

### 1. Browser domain
- **Tab** — a live or past tab: URL, title, favicon, scroll position, focus state, opened-from edge.
- **Page** — a visited page, deduplicated by canonical URL: extracted markdown, links, screenshots, last-visited timestamps, visit count.
- **Session** — a logical browsing session (a window of related tabs/visits), with start/end and a generated topic.
- **Login** — a known authenticated session for an origin (presence only, never credentials). Used to know "the agent can act on this site as you."
- **Bookmark / History entry** — references to the browser's native stores, indexed for search.

### 2. Workspace domain
- **Workspace** — a named working context (e.g. "Q3 launch", "personal") grouping files, tabs, tasks, and a folder. See [05](./05-workspace-files-terminal.md).
- **File** — a file in a granted workspace folder: path, type, size, mtime, and a content index (local full-text + optional embeddings).
- **Terminal session** — a recorded shell session: commands, outputs, exit codes, cwd. See [05](./05-workspace-files-terminal.md).

### 3. App domain (integrations)
- **Connection** — an OAuth/API connection to an external app (Gmail, Slack, Linear…). See [09](./09-integrations-mcp-developer-surface.md).
- **App object** — a referenced external object: an email thread, a Slack channel/message, a Linear issue, a Notion page, a calendar event. Stored as a reference + a fetched snapshot (with TTL), not a full mirror.

### 4. Work domain
- **Task** — a unit of work the user or agent created. See [06](./06-task-and-work-management.md).
- **Project** — a grouping of tasks, workspaces, tabs, files.
- **Follow-up / Reminder** — a time- or condition-bound item.
- **Agent run** — a recorded agent execution: prompt, tool calls, results, outcome, linked tabs/files.

### 5. Memory domain
- **Memory entry** — a curated persistent fact (user profile + agent notes). See [04](./04-memory-and-learning-loop.md).
- **Skill** — a procedural `SKILL.md`. See [11](./11-personalization-skills-marketplace.md).
- **Past conversation** — a searchable session archive (FTS).

### Edges
- **opened-from / linked-to / references / attached-to / worked-on / created / derived-from / part-of / due-before / mentions**
- Edges carry timestamps and provenance (user vs. agent) so the graph is also an **activity log**.
- Edges can cross buckets (a meeting note → a project task → a skill); cross-bucket edges are first-class but require the target bucket's retrieval permission.

### Context buckets

The graph is partitioned into **buckets** — scoped namespaces with their own captured items, memory, skills, permissions, retention, and embeddings. Default buckets: **Personal**, **Work**, plus **per-project** buckets created from Workspaces ([05](./05-workspace-files-terminal.md)); special-purpose buckets: **Meeting notes**, **Research**. Bucket-aware retrieval means working in a Work workspace does not surface Personal-bucket memory unless cross-bucket access is granted. The full bucket model (creation, merge, retention, capture assignment) lives in [14 — Passive Capture & Context Buckets](./14-passive-capture-and-context-buckets.md); this spec treats a bucket as a partitioning dimension on every node and edge.

---

## How the graph is built

```mermaid
flowchart LR
    subgraph sources [Sources — each permissioned]
        tabs[Browser tabs/pages/sessions]
        files[Workspace files]
        term[Terminal sessions]
        apps[Connected apps]
        user[User actions]
        agent[Agent runs]
    end

    subgraph ingest [Ingest — local, on-device]
        extract[Extractors]
        dedupe[Dedupe + canonicalize]
        index[Local index: FTS + optional embeddings]
    end

    graph[(Context Graph<br/>SQLite + files on device)]
    memory[Memory & Skills]

    tabs --> extract
    files --> extract
    term --> extract
    apps --> extract
    user --> extract
    agent --> extract
    extract --> dedupe --> index --> graph
    graph --> memory
```

- **Extractors** run on-device. Browser extractor hooks into the existing CDP/browser-mcp layer ( Pane already snapshots tabs and extracts markdown via `read`/`snapshot`). File and terminal extractors run in the workspace sandbox.
- **Dedup + canonicalize** so the same page or file visited many times becomes one node with many visit events.
- **Local index** is SQLite (FTS5) for text, plus an optional local embeddings store for semantic retrieval. No embeddings leave the device unless the user opts into a cloud embedding model for that purpose.
- **App objects** are fetched lazily with a TTL snapshot; the graph stores references, not full mirrors, to keep it lightweight and respect API limits.

---

## Permissioning (the heart of this spec)

Every node and every domain has a **grant state**:

| State | Meaning |
|-------|---------|
| `granted` | Agent may read and (if the tool allows) act on it |
| `granted:read-only` | Agent may see it but not mutate |
| `denied` | Agent cannot see it (excluded from query results) |
| `ephemeral` | Available only for the current turn/session, not persisted to the graph |

Grant lifecycle:

- **Grant** is requested by the agent or offered by a nudge, and confirmed by the user. Grants are specific: "this workspace folder," "this tab," "this Slack channel."
- **Revoke** is one click in the Context inspector. Revoking deletes derived graph data for that node within a bounded retention window (configurable).
- **Visibility**: the user can always open **Context → What Pane knows right now** and see, per domain, what is granted. This panel is the trust surface (links to [10](./10-trust-privacy-security.md)).

Defaults:

- **Tabs/pages**: the active tab is `ephemeral` context by default; the agent can ask to remember a page (→ `granted`).
- **Open tabs (all)**: `denied` by default; user enables "let the agent see all open tabs" globally or per-session.
- **History**: `denied` by default; opt-in for "search my history."
- **Logins**: presence-only metadata, never credentials; always `granted:read-only` when the origin is granted.
- **Files/terminal**: `denied` until a workspace folder is granted.
- **Apps**: `denied` per-app until connected.
- **Memory**: `granted` (it is the agent's own notes), but visible and editable by the user.

---

## Querying the graph

The agent queries the graph through a small set of **context tools** (registered in the MCP registry alongside the existing 53 browser tools):

| Tool | Purpose |
|------|---------|
| `context.search` | FTS + optional semantic search across granted nodes |
| `context.recall` | "What was I working on around X?" — temporal recall over the activity log |
| `context.related` | Given a node, return linked nodes (e.g. "files attached to this task") |
| `context.current_work` | Snapshot of what the user is doing right now (active tab, active workspace, recent agent run) |
| `context.attach` | Attach a node to the current task/conversation (manual grounding) |
| `context.grant_request` | Agent asks the user to grant a new context source |

These tools are how the agent gets situation awareness without the user having to paste context. They are also exposed to external MCP clients (Claude Code, Cursor) so the developer surface benefits from the same graph (see [09](./09-integrations-mcp-developer-surface.md)).

---

## Surfacing the graph to the user

1. **The Context panel** (`/context` or a side-panel tab): the "what Pane knows" inspector. Per-domain grant list, search, revoke, inspect a node's edges and events.
2. **Inline grounding chips**: in the composer, show what's attached (active tab, selected files, a task) as removable chips — same affordance as attaching tabs today, generalized to all node types.
3. **"Recent work" on the new tab page**: a feed derived from the activity log ("You were working on Q3 launch — 3 tabs, 2 files, 1 open task").
4. **Memory & skills view**: the user-facing window into the memory domain (links to [04](./04-memory-and-learning-loop.md)).

---

## Data model (sketch)

```
Node { id, domain, type, canonical_ref, title, summary, grant_state,
       provenance, created_at, updated_at, ttl? }
Edge { id, from, to, type, provenance, at, meta }
Event { id, node_id, kind, at, payload }   // activity log (visited, opened, edited, ran, sent...)
Index { node_id, text, embedding? }        // FTS + optional vector
Grant { node_id|domain, state, granted_by, granted_at, revoked_at? }
```

Storage: SQLite (production: `~/.browseros/db/`) plus a content-addressed blob store for page snapshots/screenshots under `~/.browseros/sessions/`. Sync (opt-in) replicates a user-chosen subset to the cloud GraphQL API.

---

## Cold start: the empty-graph problem

A brand-new Pane has an empty graph — and an empty graph is useless to the agent and invisible to the user. This is the highest-churn-risk moment for the Context Graph. Bootstrap strategy:

1. **Import-on-first-run**: Chrome import (already exists) seeds bookmarks/history; the graph indexes them immediately so `context.search` returns results on day one.
2. **Active-tab-first value**: even with an empty graph, the agent always has `context.current_work` (the active tab + active workspace). The wedge flow works with *zero* graph history. The graph must never be a precondition for the first useful action.
3. **Progressive indexing**: history and workspace files index in the background with a visible "Pane is getting to know your work" indicator and a disk/CPU budget. The user sees it filling up, not a void.
4. **No "come back later" UX**: every surface that reads the graph degrades gracefully to the active-tab + active-workspace baseline. A sparse graph returns fewer results, never an error.
5. **Seed memory from onboarding**: the trust intro and model-pick step write a few `USER.md` entries (timezone, model preference, chosen ICP path) so memory isn't empty either.

The rule: **the product is useful at minute one and gets more useful as the graph fills; it is never gated on the graph being full.**

## Value before completeness

A graph that's 20% built but makes the wedge flow excellent beats a 100%-built graph that ships six months later. Every domain ships only when it has a consuming feature in the same phase:

- Browser history → ships with `context.search` (expansion layer).
- App objects → ship with the integrations that produce them (expansion layer).
- Memory → ships with the memory loop (its own intrinsic surface).
- Embeddings → ship only when FTS5 proves insufficient, and opt-in.

No "build the graph and they will come." Each layer earns its place by powering a shipped feature.

## Index privacy

The local index (FTS5 + optional embeddings) contains page content and file text. Privacy rules:

- The index lives only on disk (`~/.browseros/db/`), never sent to a model; the agent queries it via tools and only the matching snippets enter the prompt.
- Embeddings, if on, run on-device by default; cloud embeddings are opt-in per-workspace and the content sent is labeled.
- Indexing skips incognito/private windows and `denied`/`ephemeral` context.
- The user can wipe the index (and only the index) without deleting the graph structure, and can exclude paths/origins from indexing.

### Performance budget (principle 12)

The graph must not make browsing worse. Hard rules:

- **FTS5 first; embeddings opt-in.** The default index is FTS5 (cheap, ~ms). On-device embeddings are an opt-in upgrade for semantic recall, run idle-priority on GPU/NPU when available, and pause on battery/under-load.
- **Indexing is cadenced, not per-event.** Page/file indexing is batched on a short cadence, not synchronous with every navigation, so the browser stays snappy.
- **Disk + CPU budgets enforced in CI** (a browsing-quality regression test): opening/closing tabs and navigating with the graph on must be within X% of the bare-browser baseline. A regression that breaches the budget fails the build.

---

## Interactions with other specs

- **03 — Agent Modes & The Loop**: the loop reads `context.current_work` and `context.search` to ground every turn.
- **04 — Memory & Learning Loop**: memory writes are grounded in graph events ("you did X five mornings in a row"); skills are extracted from agent runs stored as graph nodes.
- **05 — Workspace, Files & Terminal**: workspaces, files, and terminal sessions are graph domains with their own grant flow.
- **06 — Task & Work Management**: tasks/projects are graph nodes; a task auto-collects related nodes via edges.
- **07 — Proactive & Scheduled Work**: proactive triggers fire on graph events ("page X updated", "no progress on task Y in 3 days").
- **08 — Reach & Channels**: outbound messages reference graph nodes so the user can tap through back to the in-browser context.
- **09 — Integrations & MCP**: app objects are graph nodes; the whole graph is exposed to external MCP clients.
- **10 — Trust, Privacy & Security**: the grant model and Context panel are the primary trust surface; prompt-injection defense relies on separating untrusted (page) content from trusted (memory) content in the graph.

---

## Edge cases

- **Incognito / private windows**: never ingested. Explicit `denied` at the browser domain level.
- **Revoking a workspace mid-task**: agent runs depending on that grant fail gracefully with a clear message; the task is not silently corrupted.
- **Very large workspaces**: indexing is incremental and lazy; the agent never blocks on a full reindex. Respects a disk budget.
- **Conflicting grants** (e.g. a file is in two workspaces with different grants): most-permissive-wins is rejected; instead the stricter grant applies and the user is told.
- **Page content that changes** (SPAs): page nodes store versioned snapshots with a TTL; the agent can request a fresh snapshot.
- **App disconnections**: app-object nodes are marked stale; references remain but actions are blocked until reconnected.

---

## Kill criteria

Pull this feature back if:
- The Context panel becomes a maintenance burden users don't open (engagement < 5% of WAU) — we'd be over-building trust UI nobody uses.
- Local indexing disk/CPU cost measurably degrades browsing (violates principle 10).
- Users report feeling surveilled despite the permission model — a signal the defaults are too permissive.

---

## Open questions

1. **Embeddings on-device vs. opt-in cloud?** Local embeddings (e.g. small model in the server) preserve privacy but cost RAM/CPU. Cloud embeddings are cheap but leak content. *Lean: on-device by default, cloud embeddings opt-in per-workspace.*
2. **How much of the graph syncs to the cloud** when the user opts into sync? *Lean: tasks, memory, skills, and a node-index (not page/file content) by default; full content sync is a second explicit opt-in.*
3. **Do we expose the graph as a public MCP resource** so any MCP client can query it, or only via Pane's own tools? *Lean: yes, as a versioned MCP resource, since it advances the developer-surface wedge.*
4. **Retention defaults** for the activity log. Hermes uses unbounded SQLite; Pane should have a sane default (e.g. 90 days raw, indefinite summarized) with a control.

---

## Metrics

- **Grant adoption**: % of users who grant at least one workspace, one "all open tabs", and one app within 7 days.
- **Context tool usage**: `context.search` / `context.recall` calls per agent session (proxy for the moat paying off).
- **Context panel opens** per WAU (trust surface health).
- **Revoke events** per user (if high, our defaults are too permissive; if zero, users may not know they can).
- **Grounding lift**: agent task success rate with vs. without graph context (eval harness A/B).
