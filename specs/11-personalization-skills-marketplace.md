# 11 — Personalization & Skills Marketplace

## Summary

This spec rebuilds the personalization surfaces v0.46 pulled back (Soul, Memory) and adds skills sharing — but **conservatively**: own skills + agentskills.io import first, hosted marketplace later.

> **Review v0.2 note.** A hosted skills marketplace has a cold-start (no supply, no demand). **Decision: v1 leads with own-skills + agentskills.io import; the hosted marketplace is deferred** until there's a credible supply of verified/agent-written skills. Self-installing skills and external memory providers also move later. `soul.md` returns as a deliberately small, inspectable file (the OpenClaw "heavy backpack" lesson).
>
> **Review v0.3 note.** Reframed in system terms: **the skill *system* is an intrinsic, zero-Pane-server capability** — auto-create, edit, version, share-by-file, import-by-URL, agentskills.io peer import, self-install. The hosted *marketplace* is a **State B extension point** (a directory source that plugs in alongside local + peer import). The system becomes smarter and shares skills with zero servers.

---

## Goals

- Bring back personalization (Soul/identity) in a form that's open, editable, and grounded in the Context Graph.
- Make skills first-class: create, edit, version, share, install, and run.
- Build a marketplace that's open (agentskills.io-compatible), permissioned, and trustworthy.
- Let skills declare their dependencies (integrations, MCPs, workspaces) so installation is safe and explicit.

## Non-goals

- A closed proprietary skill format. Skills are plain markdown, portable.
- Becoming an app store with paid SKUs in v1. (Later, possible.)
- Centralizing skill execution. Skills run on the user's Pane, locally.

---

## Personalization: Soul → `USER.md` + identity

v0.46's "Soul" was Pane's persona/identity layer. We bring it back as a transparent, user-owned layer:

- **`USER.md`** (from [04](./04-memory-and-learning-loop.md)) is the user profile — name, role, timezone, communication style, preferences. The user edits it directly; the agent proposes additions (gated).
- **Agent identity ("Soul")**: a short, user-editable statement of *how Pane should behave* — voice, boundaries, defaults. Stored as a plain file (`~/.browseros/soul.md`), injected into the system prompt. This is the "personality" knob, kept simple and inspectable (the OpenClaw "heavy backpack" lesson: keep it short, don't pile settings in).
- **No hidden persona**: the file is readable and editable; the user can share/clone it.

This replaces the pulled-back Soul/Memory surfaces with something simpler and open.

---

## Skills (recap and extension)

From [04](./04-memory-and-learning-loop.md): skills are `SKILL.md` files (agentskills.io format) stored in `~/.browseros/memories/skills/`, with an index in the system prompt and bodies loaded on demand. Provenance: `agent-written`, `user-written`, `marketplace`, `migrated`.

This spec adds the **lifecycle** around skills:

| Stage | Action |
|-------|--------|
| **Create** | Agent (via learning loop) or user (hand-written) |
| **Edit / patch** | User or agent (gated by `skills.write_approval`) |
| **Version** | Each skill keeps a small version history; patches are diffable |
| **Test** | A `skills.test` command runs the skill against a saved example and reports success |
| **Publish** | Push to the marketplace (or to a private registry / gist) |
| **Install** | From the marketplace, with dependency check + trust prompt |
| **Run** | Loaded by the loop when relevant; tracked `uses` + `success_rate` |
| **Disable / delete** | One click; agent-written skills from a bad run are easy to kill |

### Skill dependencies

A `SKILL.md` frontmatter declares what it needs:

```yaml
---
name: acme-morning-export
description: Export the Acme analytics report to the workspace and post a summary to Slack.
triggers:
  - schedule: "weekday 09:00"
requires:
  integrations: [acme-analytics, slack]
  mcp_servers: []
  workspace: true
  approvals:
    - class: write-external
      target: slack:#analytics
trust: untrusted   # until the user pins it
---
```

On install, Pane checks the deps, prompts to connect missing integrations, and sets the approval expectations. Nothing runs blind.

---

## The marketplace (deferred; v1 is own-skills + import)

**Pane Skills** will be an open directory of agentskills.io-compatible skills. **It is deferred from v1** because a marketplace has a cold-start: no supply → no demand → no supply. v1 ships the parts that don't need a critical mass:

- **Your own skills** (agent-written + hand-written) — the learning loop produces these; they're the supply.
- **agentskills.io import** — install any skill published for Claude Code/Cursor/Hermes by URL or file; it "just works" because the format is shared.
- **Private registry / gist** support for teams to share internally without a public marketplace.

The hosted marketplace unlocks when there's a credible supply (see unlock condition below). When it ships:

| Source | Trust | Default |
|--------|-------|---------|
| **Your own** (agent/user-written) | Trusted | Run with normal approval rules |
| **Verified** (Pane team / signed) | Verified | Run with normal approval rules; badged |
| **Community** | Untrusted | Install prompts dependency + trust review; `write-external`/`spend` still gate |
| **Private registry / gist** | Configurable | Orgs can host their own |

### Marketplace UX

- **Browse** (`/skills`): categories (research, dev, ops, personal, writing…), search, "popular," "trending," "works with your connected apps."
- **Skill page**: description, author, trust badge, required deps, changelog, `uses` across the community, reviews, "Install" + "View source" (always — it's markdown).
- **Install flow**: dep check → connect missing integrations → trust prompt → install to `~/.browseros/memories/skills/`.
- **Publish flow**: from any skill you own → "Publish" → choose public/private → signed if verified author.
- **Update flow**: installed skills can auto-update (verified only) or prompt; user controls.

### Open by default

- Skills are markdown; "View source" is always one click. No opaque packaging.
- The marketplace indexes agentskills.io skills, so skills published for Claude Code/Cursor/Hermes are discoverable in Pane and vice versa. This is the interoperability bet.

---

## Self-installing skills (Hermes-style)

The agent can **write and install a skill on the fly** during a conversation when it lacks a capability. Following Hermes's pattern but with Pane's trust model:

- Auto-created skills are `provenance: agent-written`, `trust: untrusted`.
- If `skills.write_approval` is on, they stage for review.
- Skills that declare new MCP dependencies stage the MCP install separately (see [09](./09-integrations-mcp-developer-surface.md)).

---

## Surfacing

- **Skills view** (`/skills`): your skills (with `uses`/`success_rate`), marketplace browse, install/manage.
- **Skill chips** in the composer: when a skill is loaded for a turn, show it as a chip (removable).
- **Skill notifications**: `💾 Skill 'foo' created/patched` (controllable, [04](./04-memory-and-learning-loop.md)).
- **Personalization settings** (`/settings/personalization`): edit `USER.md` and `soul.md`, manage memory/skill write approvals.

---

## User stories

- "Pane wrote a skill for my weekly competitor scrape. I click Publish and my team can install it."
- "I browse the marketplace, install 'Linear triage' — it asks me to connect Linear and approves posting comments. Done."
- "I edit `soul.md` to say 'be terse, never use emojis.' Pane's voice changes everywhere, including channels."
- "A skill I installed has 3 uses and a 33% success rate — Pane flags it; I review and delete."
- "I install a Claude Code skill from agentskills.io and it just works in Pane too."

---

## Interactions with other specs

- **02 — Context Graph**: skills are graph nodes; skill runs link to source runs.
- **03 — Agent Modes & The Loop**: skills loaded by the loop; skill chips in composer.
- **04 — Memory & Learning Loop**: the learning loop creates/patches skills; `USER.md` is the personalization core.
- **07 — Proactive & Scheduled Work**: skills can declare schedules/triggers; "save as scheduled" from a skill run.
- **09 — Integrations & MCP**: skills declare integration/MCP deps; marketplace can recommend MCPs.
- **10 — Trust**: trust levels, dependency gating, `write-external`/`spend` still gate, marketplace skill review.

---

## Edge cases

- **Skill breaks after an upstream change** (site UI changes): `success_rate` drops; the agent offers to re-derive the skill from a fresh run.
- **Conflicting skills** (two with overlapping triggers): the loop picks the higher `success_rate`/more-specific one and tells the user; the loser is a candidate for archive (see curation in [04](./04-memory-and-learning-loop.md)).
- **Skill bloat** (auto-creation writes faster than the user prunes): handled by the curation & pruning loop in [04](./04-memory-and-learning-loop.md) — use-tracking archives unused skills, flags failing ones, and emits a monthly curation digest. The skill system gets *smarter*, not *heavier*.
- **Marketplace skill with hidden injection**: untrusted trust + approval gating + open source review limit the blast radius; community reporting flags it.
- **Private/org skills**: private registry support for teams; not in v1 public marketplace.
- **Skill needs a paid integration**: surfaced at install; never silently incurs cost.

---

## Kill criteria

- If marketplace install → active-use conversion is low, the marketplace is a content problem — invest in curation/verified skills before breadth.
- If auto-created skills are rarely reused (`uses` ≈ 1), tighten the extraction bar ([04](./04-memory-and-learning-loop.md)).
- If `soul.md` is edited by <2% of users, keep it but don't invest in more persona tooling.

---

## Open questions

1. **Marketplace hosting**: Pane-hosted directory vs. federated agentskills.io index? *Decision (v0.2): defer the marketplace; v1 is own-skills + agentskills.io import + private registry. When hosted ships, Pane-hosted index that also ingests agentskills.io.*
2. **Verified author program in v1?** *Decision (v0.2): no — ship own-skills + import first; add verified badges once marketplace volume justifies.*
3. **Paid skills**: allow paid skills in v1? *Decision (v0.2): no; keep free/open; monetize via credits/hosted inference.*
4. **Skill versioning semver**: full semver or simple patch history? *Lean: simple patch history in v1; semver when marketplace grows.*

### Marketplace unlock condition

The hosted marketplace ships only when **both** are true: (a) the median active user has ≥3 agent-written skills (real supply exists), and (b) agentskills.io import usage shows users actively seek outside skills (real demand). Until then, own-skills + import is the product.

---

## Metrics

- **Skills per user** (by provenance) and **skill retrieval rate**.
- **Marketplace install rate** and **install → active-use conversion**.
- **Skill success rate** distribution and auto-flagged bad skills.
- **Publish rate** (skills/user) and community install count.
- **`soul.md` / `USER.md` edit rate** (personalization adoption).
- **Self-installed skill adoption** (Hermes-style capability-on-demand).
