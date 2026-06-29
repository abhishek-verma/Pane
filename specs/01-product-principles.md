# 01 — Product Principles

## Summary

These are the tenets every Pane spec is judged against. They are not features. They are the rules we use to say no, to resolve trade-offs, and to keep the product coherent as it grows. When a spec proposes something that contradicts a principle, the principle wins unless the principle is explicitly amended.

> **Review v0.2 note.** Added three tenets: **focus/wedge** (11), **performance is a hard budget** (12), and **earn the right to expand** (13). These address the earlier draft's tendency to spec everything at once.
>
> **Review v0.3 note.** Added two tenets that govern the system model: **local-complete; servers are optional extensions** (14) and **build on the substrate, don't rebuild** (15). These encode the "pure-OSS, no Pane servers at start" and "build on BrowserOS" inputs.

---

## The tenets

### 1. The agent is the browser. The browser is the agent.

We never build an agent feature that ignores the browser, and we never build a browser feature that ignores the agent. If a capability could exist identically in a non-browser agent, it is not a Pane differentiator — it is table stakes we ship because the ecosystem expects it, not something we lead with. The lead is always the context and control that only being-the-browser gives.

**Implication:** Every spec must answer "why does this need to be in the browser?" If the answer is "it doesn't," the spec is fine but it is not the frontier.

### 2. Local-first by default. Cloud is opt-in and earns its way in.

Browsing, files, memory, and credentials stay on the device unless the user explicitly chooses cloud sync for a specific surface. We never make local capability contingent on a cloud account. We never silently exfiltrate data for "personalization."

**Implication:** Specs that need cloud (sync, shared tasks, hosted skills marketplace) must define the local-only path and the opt-in path separately.

### 3. Bring your own brain. Never block on one model.

The user picks the model for each job: cloud, OAuth-subscription, or local. We recommend models for tasks (e.g. strong reasoning for agent mode) but we never hard-require a vendor. Default credits exist for trial, not for lock-in.

**Implication:** No spec may assume a specific model's capabilities. Anything model-dependent must degrade gracefully and be model-agnostic in its data model.

### 4. Context is permissioned, not harvested.

The agent can see a lot, but it sees only what the user has granted. Grants are specific (a workspace, a tab, a channel), revocable, and visible. The user can always see what the agent currently knows and retract it. This is the answer to "agentic browsers are structurally dangerous."

**Implication:** Every context source in [02 — The Context Graph](./02-the-context-graph.md) has a permission state. No silent global access.

### 5. Show the work. Always.

Agent actions are visible (tool batches, tab glow, snapshots), reversible where possible, and auditable after the fact. There is no "the agent did something and we won't tell you what." Proactive actions surface a notification even when the user is away.

**Implication:** Specs define a visibility/audit surface. Background work is not invisible work.

### 6. Suggest, don't nag.

Nudges (connect an app, schedule a task, save a memory) are offered at the moment they are useful, can be dismissed, and can be disabled permanently. The agent is helpful, not needy.

**Implication:** Every nudge has a "never suggest this again" control and a global rate limit.

### 7. Approvals scale with consequence.

Low-stakes actions (read a tab, summarize a page) run freely. High-stakes actions (send an email, post to Slack, modify a file outside the workspace, run a terminal command with side effects, spend money) require approval the first time and can be pinned as trusted or kept gated per the user's choice. The default errs toward asking.

**Implication:** Every tool/spec declares a consequence class. See [10 — Trust](./10-trust-privacy-security.md).

### 8. Open beats opaque.

AGPL source, MCP as the integration standard, agentskills.io-compatible skills, inspectable memory and skills as plain files. We compete on trust and inspectability, not on hiding the mechanism.

**Implication:** Proprietary lock-in features (e.g. a closed skills format) are out. Anything user-generated (memory, skills, tasks) is stored in an open, portable format.

### 9. Ship focused surfaces. Pull back to rebuild well.

We are willing to remove or hide a feature that isn't ready (as v0.46 did with Skills/Soul/Memory) rather than ship something half-baked that erodes trust. A smaller, coherent product beats a sprawling, incoherent one.

**Implication:** Specs declare a "kill criteria" — the signal that says this feature should be pulled back.

### 10. The browser stays a browser.

Pane must remain a credible daily-driver Chromium: fast, compatible, with extensions, ad blocking, vertical tabs, and a familiar UX. The agent enhances browsing; it never makes the browser worse as a browser. We do not sacrifice core browsing quality for agent features.

**Implication:** Agent UI is additive (side panel, command center, glows), not displacing. Performance budgets protect browsing.

### 11. Win one ICP before serving four.

We pick a wedge ICP (developers, first), win it, and expand in a deliberate order. A spec that tries to please every ICP at once pleases none. When a surface serves an ICP outside the current phase, it waits — or it earns its way in by serving the wedge ICP too.

**Implication:** Every spec names the ICP it primarily serves and the phase that ICP is in. Features that only serve a later ICP are deferred, not half-built.

### 12. Performance is a hard budget, not an aspiration.

The Context Graph, indexing, embeddings, and background reviews all run on the user's machine alongside their browser. Browsing speed, memory, and disk are guarded by budgets we measure in CI. If an agent feature blows the budget, the feature is reworked or cut — the browser is never allowed to get slow.

**Implication:** Every spec that adds on-device work declares a budget and a measurement. "Nice to have" does not justify a regression.

### 13. Earn the right to expand.

Reach channels, the skills marketplace, Graph mode, team features, and the cloud-headless runner are not assumed — they are unlocked by hitting the prior phase's thesis checkpoint. Scope discipline is how a small team beats funded incumbents. We would rather ship a thin edge that's excellent than a broad surface that's mediocre.

**Implication:** Expansive specs (06 board views, 08 mobile companion, 11 hosted marketplace) define an unlock condition. Until it's met, the minimal version ships.

### 14. Local-complete; servers are optional extensions.

The product is fully functional as a pure open-source artifact with **no Pane-operated servers**. Memory, skills, the Context Graph, scheduled work, and reach all work locally. Anything requiring a Pane server (cloud sync, hosted credits, hosted skills marketplace, cloud-headless runner, team context) is an **extension point behind an interface with a no-server fallback** — added later, never a dependency.

**Implication:** Every spec declares its no-server path. A spec that breaks without a Pane server is rejected. The "becomes smarter every day" promise (auto-skill-creation) is delivered with zero servers.

### 15. Build on the substrate, don't rebuild.

Pane is built on BrowserOS, which already ships the browser, the agent server, 53+ MCP tools, Cowork, scheduled tasks, Connect Apps, Pane-as-MCP, the CLI, and harness agents. We extend these; we do not recreate them. New surfaces justify themselves against what's already there.

**Implication:** Every spec names the BrowserOS substrate it builds on and says "extend," not "build." A proposal to rebuild an existing capability needs an explicit reason (e.g. v0.46 pulled Skills/Soul/Memory back *to rebuild them well*).

---

## How we use these in spec review

A spec is **ready for build** when:

- It states which principles it advances and which it tensions.
- Every tension has an explicit resolution (e.g. "we accept the cloud dependency because X, gated by opt-in").
- It defines the permission, visibility, approval, and local-only surfaces the principles require.
- It has a kill criteria.

A spec is **not ready** when it relies on silent data access, an undeclared cloud dependency, a single vendor, or invisible background work.

---

## Open questions

1. **Is "show the work" a hard requirement for proactive/scheduled tasks too**, or do we allow "quiet" scheduled runs that only surface a digest? *Lean: quiet runs allowed, but a digest is always produced and the run is always auditable.*
2. **Where is the line on "the browser stays a browser"?** Could the agent ever take over the tab strip or omnibox in a way that changes core browsing? *Lean: only via explicit user mode (e.g. Agent Command), never by default.*

---

## Related specs

- Every spec references this one. In particular [02 — The Context Graph](./02-the-context-graph.md) (principle 4), [10 — Trust](./10-trust-privacy-security.md) (principles 4, 5, 7), and [07 — Proactive & Scheduled Work](./07-proactive-and-scheduled-work.md) (principles 5, 6, 7).
