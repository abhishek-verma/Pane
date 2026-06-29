# 10 — Trust, Privacy & Security

## Summary

An agentic browser that sees your logins, files, terminal, and messages is powerful and also, by construction, dangerous. The security-research consensus (OpenAI, Dec 2025) is that prompt injection in agentic browsers is "unlikely to ever be fully solved." Pane's answer is not to shrink the agent's surface the way the closed browsers do — it is to make the surface **open, local-first, permissioned, inspectable, and approval-gated**, so the user is always in control and can always see what happened. This spec defines the trust model that every other spec depends on.

> **Review v0.2 note.** Added: **trust defaults tuned by ICP** (a developer trusts their own repo sooner than a knowledge worker trusts an email send), an explicit **approval-fatigue guardrail** (too many prompts = users disable them = we lose the trust story), and **cold-start approval calibration** (the first session has the most prompts; we must not lose the user there). Also restated that approval gating is *necessary, not sufficient* — we're honest it doesn't "solve" injection.
>
> **Review v0.3 note.** Trust is an **intrinsic State A concern** — it's about the local agent acting on local browser/files/terminal, and it needs no Pane server. The approval framework, Context panel, and action log all run on-device. Cloud-sync payloads (State B) get their own E2E-encryption + scan-before-sync handling, but the trust model doesn't depend on a server. Anchored on BrowserOS's existing CDP/browser-mcp tool surface (we add consequence classes + approvals to tools that already exist). **New in v0.3: passive-capture consent** — meeting + browsing capture is OFF by default, per-domain, with a visible indicator and bucket-scoped storage (see [14](./14-passive-capture-and-context-buckets.md)); captured content is treated as untrusted input for injection defense.
>
> **Review v0.4 note (HoP pass).** Added **"training wheels" (dry-run)** for the scary consequence classes — the structural answer to the first-bad-action trust risk: `write-external` drafts-and-shows by default, `system` previews the exact command, `spend` always dry-runs, and new users get a one-consequential-action-per-run blast-radius cap until they pin trust. Autonomy is earned by repeated user promotion, not granted up front.

---

## Goals

- Make **local-first** the default for browsing, files, memory, and credentials; cloud is opt-in per surface.
- Defend against prompt injection and data exfiltration without crippling the agent.
- Make every consequential action **approval-gated**, and every action **auditable**.
- Make trust **visible**: the user can always see what Pane knows and what it did.
- Keep Pane a credible, secure daily-driver Chromium (privacy patches, MV2 ad blocking, no vendor telemetry).

## Non-goals

- Claiming to "solve" prompt injection. We mitigate and give control; we don't pretend.
- Full VM isolation. We sandbox + gate; a heavier isolation mode is a later opt-in (see [05](./05-workspace-files-terminal.md)).
- Enterprise DLP / managed deployment features (later, sales-led).

---

## The threat model

| Threat | Source | Pane's defense |
|--------|--------|----------------|
| **Prompt injection** (page content smuggles hostile instructions) | Untrusted web pages | Context separation, tool-call allowlists, approval gating on consequential actions, signed/trusted instructions |
| **Credential exfiltration** | Pages, malicious MCPs, compromised skills | Credentials never in the Context Graph; memory injection scanning; denylist on outbound content for secrets |
| **Unauthorized consequential action** (send email, spend money, post) | Agent misuse or injection | Approval gating + trust pins + `spend` always-gated |
| **Filesystem overreach** | Agent or harness | Workspace sandbox; outside-root denied; symlink escape blocked |
| **Terminal misuse** | Agent or harness | Scoped shell, denylist, approval on side-effecting commands |
| **Silent data egress to cloud** | Default behavior elsewhere | Local-first defaults; cloud sync opt-in per surface; no silent telemetry |
| **Channel impersonation** | Someone messaging Pane | Sender allowlist + pairing codes; identity-bound channels |
| **Memory poisoning** | Injection via pages | Inferred (layer 4) memory writes stage for review; conversation writes scanned; user can always revert |
| **Skill poisoning** | Bad marketplace skill or bad auto-extracted skill | `provenance` + `success_rate` + source-run linking; marketplace skills untrusted by default; review before install |
| **MCP client left connected** | Stale external sessions | MCP sessions listed, revocable, session-scoped auth |

---

## Local-first by default

| Surface | Default | Opt-in |
|---------|---------|--------|
| Browsing (tabs, history, cookies) | Local only | Cloud sync of history/bookmarks (existing) |
| Files & terminal | Local only, workspace-sandboxed | Cloud sync of file *metadata* (not content) — separate opt-in for content |
| Memory & skills | Local files | Cloud sync of memory/skills (so they follow the user) |
| Context Graph | Local SQLite + index | Cloud sync of node *index* (not page/file content) — separate opt-in for content |
| Credentials | Never stored in the graph; browser's native stores only | n/a |
| Telemetry | None by default; Sentry/PostHog opt-in for crash/anon usage | Existing |

Principle: cloud makes things *follow the user*, not *visible to the vendor*. Sync payloads are scoped and the user chooses each surface.

---

## Prompt-injection defense (the core problem)

We accept that pages are untrusted. The defense is layered:

### 1. Context separation
- **Trusted context**: user prompts, `MEMORY.md`, `USER.md`, skills the user approved, and explicit attachments the user chose.
- **Untrusted context**: page content, screenshots, fetched app objects, custom-MCP outputs.
- The system prompt **labels** untrusted content and instructs the model to treat page content as data, not instructions. This is mitigation, not a guarantee (matches the research consensus).

### 2. Tool-call allowlists per mode
- **Chat mode**: no mutating tools; only `read` + read-only context tools. Injection can't act.
- **Agent mode**: full toolset but every `write-external` / `system` / `spend` action gates on approval. Injection can *propose*; it cannot *execute* without the user.

### 3. Approval is the backstop
- Because injection can trick the model into proposing a bad action, **approval on consequential actions is the structural defense**. The user sees the proposed action (post to #releases? send this email?) and decides.
- `spend` is **never** auto-approved. `write-external` is approval-gated first time, pinnable per (target, action) with expiry. `system` is approval-gated unless explicitly pinned for a time box.

### 4. Outbound content scanning
- Before sending/posting/writing externally, scan for: secrets (API keys, tokens), PII patterns the user flagged, and known-exfil patterns. Block + warn on hits.

### 5. Memory & skill hygiene
- Inferred (layer 4) memory writes **always stage for review** even when `write_approval` is off — injection can't quietly become permanent knowledge.
- Skills record `provenance` and `source_run`; bad skills are detectable and deletable.

### 6. Sandboxing
- File and terminal sandboxing (see [05](./05-workspace-files-terminal.md)) prevents injection from touching anything outside granted workspaces.

We are honest in docs: this **reduces** risk and **preserves control**; it does not make injection impossible. That honesty is itself a trust asset vs. closed competitors who downplay it.

---

## Approvals (operational detail)

Recap from [03](./03-agent-modes-and-the-loop.md), with the trust lens:

| Class | Default | Pinnable? | Expiry |
|-------|---------|-----------|--------|
| `read` | Free | n/a | n/a |
| `write-local` | First-time confirm | Yes (per workspace) | 30 days |
| `write-external` | Approve first time | Yes (per connection+target+action) | 30 days |
| `system` | Approve every time | Yes, time-boxed explicit | 7 days |
| `spend` | Approve **always** | **Never** | n/a |

- Pins are visible and revocable from the Context panel / Trust settings.
- Approvals are required **even for inbound channel-initiated requests** the first time, and always for `spend`.
- Unattended runs that hit a gated action **pause and ask via a channel** ([08](./08-reach-and-channels.md)); never auto-approve.

### Trust defaults by ICP

A developer granting a workspace on their own repo and a knowledge worker sending an email on their behalf carry different risk and different tolerance for prompts. Defaults tune to the ICP (set during onboarding's ICP path, adjustable in Trust settings):

| ICP | `write-local` | `write-external` | `system` | Notes |
|-----|---------------|------------------|----------|-------|
| Developer | First-time confirm, pin suggested | Approve first time, pinnable | Approve first time in a granted workspace, pinnable | Devs trust their own repo; over-prompting here is the biggest churn risk |
| Knowledge worker | First-time confirm | Approve first time, pinnable | Approve every time | External actions (email/post) are the risk surface |
| Privacy-conscious pro | First-time confirm | Approve every time | Approve every time | Most conservative; pins opt-in only |
| Strict preset | Approve first time | Approve every time | Approve every time | No pins; `spend` always; for regulated users |

### Approval-fatigue guardrail (the thing that saves the trust story)

If approvals are annoying, users pin "always allow" blindly or disable the agent — and we lose both safety and trust. Hard guardrails:

1. **Measure approval grant/deny/pin/disable rates per consequence class, per ICP, per session.** If deny+disable > 40% for a class, the class is miscalibrated — re-tune before any UX change.
2. **Batch related approvals**: a multi-step run that does N writes *to the same granted workspace* asks once (first-time), not N times.
3. **Smart pin suggestions**: after a user approves the same (action, target) twice, proactively offer the pin with a clear scope and expiry — don't wait for them to discover it.
4. **No approval on `read`, ever** — the highest-volume tool class stays invisible.
5. **Cold-start calibration**: the first session has the most first-time prompts by definition. Onboarding pre-pins the workspace's `write-local` so the first Agent run doesn't prompt-spam. We accept a slightly lower safety bar in minute one to earn the right to a second session.

The principle: approvals exist to catch the *rare* consequential action, not to gate every step. If they're gating every step, the design is wrong.

### Training wheels (dry-run) — the trust on-ramp

The biggest trust risk is the **first bad action**: one wrong automated email to a customer, one wrong `git push`, and the user never trusts the agent again. So the first consequential actions get a **dry-run** path, not just an approval:

- **`write-external` first-of-kind**: by default the agent **drafts and shows**, doesn't send. "Here's the email I'd send to your boss — review and send." The user explicitly promotes draft → send. After the user promotes the same (action, target) twice, offer the pin (the existing smart-pin suggestion).
- **`system` / terminal**: a **preview-and-confirm** that shows the exact command + cwd + affected workspace before running, with a one-click "run exactly this." No vague "may I run a command?" prompts.
- **`spend`**: always dry-run-then-confirm; never auto.
- **Blast-radius cap for new users**: until T2, a single Agent run is capped at **one** `write-external`/`system` action before re-prompting — a runaway loop can't fire 12 emails before the user notices. The cap lifts as the user pins trust.

This is the structural answer to "I'm scared to let it act." Dry-run is the default for the scary classes; autonomy is *earned* by repeated user promotion, not granted up front.

---

## Visibility & audit

- **Context panel — "What Pane knows right now"** (per-domain grants; revoke). Primary trust surface (see [02](./02-the-context-graph.md)).
- **Action log**: every consequential action (and every tool call) recorded with input, output, time, and approval decision; replayable.
- **Proactive log**: nudges shown and outcomes (see [07](./07-proactive-and-scheduled-work.md)).
- **Run replay**: any agent run can be replayed step-by-step (see [03](./03-agent-modes-and-the-loop.md)).
- **Trust settings** (`/settings/trust`): approval defaults, pin management, quiet hours, outbound scanning rules, data retention.

---

## Data handling & retention

- **Retention defaults**: activity log 90 days raw, indefinite summarized; channel sessions shorter by default; full controls in Trust settings.
- **Deletion**: `pane forget` commands and UI to delete a node, a session, a memory entry, a skill, or "everything about X." Deletions propagate to derived data within the retention window.
- **Incognito / private windows**: never ingested into the graph.
- **Revoking a grant** deletes derived graph data for that node within a bounded window.
- **Cloud sync payloads** are scoped; the user can request/export and delete their cloud data. *(State B — disabled in the Pane fork today.)*

## Passive-capture consent (cross-ref [14](./14-passive-capture-and-context-buckets.md))

Passive capture (meetings + browsing) is the most sensitive surface in Pane, so it gets the strictest defaults:

- **OFF by default.** Each capture class and each domain has its own opt-in; there is no global "capture everything" toggle.
- **Always-visible indicator.** The glow (already shipped) doubles as the capture light; there is no hidden capture state.
- **Bucket-scoped storage.** Captured items land in a chosen bucket (inferred from domain, shown, reassignable — never silent). Work capture never leaks into Personal retrieval unless explicitly granted.
- **Captured content is untrusted input.** Meeting transcripts and scraped pages can contain prompt-injection attempts; they're grounded + approval-gated like any other external content.
- **Short retention for raw recordings** (meeting audio), longer for transcripts; everything deletable per bucket.
- **Local transcription by default**; BYOK to a provider transcription API is disclosed at opt-in (provider server, not Pane's).

---

## Credential handling

- Credentials live in the browser's native credential stores and password manager — never in the Context Graph, never in memory, never sent to a model.
- The graph stores **login presence** (origin: "has a session") so the agent knows it *can* act on a site as the user, without storing *how*.
- OAuth tokens for integrations are stored in the existing secure store; rotated/refreshed per provider; never exposed to model context.

---

## Browser-level privacy (the "stays a browser" tenet)

- ungoogled-chromium lineage privacy patches (existing).
- MV2 + uBlock Origin (existing, ~10x vs Chrome).
- No vendor telemetry by default.
- Privacy browser extensions import from Chrome.
- The agent does not make the browser worse as a browser (principle 10); agent telemetry is opt-in and anonymized.

---

## Interactions with other specs

This spec is the trust spine. It is referenced by every other spec's permission/approval/visibility sections. In particular:

- **02**: grant model, Context panel, revocation.
- **03**: consequence classes, approvals, visibility.
- **04**: memory injection scanning, inferred-write staging, skill provenance.
- **05**: workspace sandbox, terminal denylist, dangerous-command blocking.
- **07**: approval-when-away, cloud-headless isolation.
- **08**: sender allowlist, pairing codes, channel credential isolation.
- **09**: per-connection scopes, custom-MCP untrusted labeling, MCP session revoke.
- **11**: marketplace skill trust levels; `soul.md` persona shifts are proposed (gated), never silent.
- **14**: capture consent as untrusted input, bucket-scoped storage.
- **15**: home widgets read only local, consented state; capture-dependent widgets respect capture consent.
- **16**: page-reshape trust constraints — per-domain consent, always-marked/reversible overlays, never-silent-writes, injection-isolated overlays; untrusted page text is never trusted as context without the [04] injection-defense rules (applies double when reading a page *and* layering on it).

---

## Edge cases

- **User pins "always allow Slack posts to #releases" and an injection later abuses it**: pins expire (30 days); outbound scanning catches secrets; the action log lets the user see and revoke. We can't prevent a pinned action from firing, but we limit blast radius and time.
- **A skill from the marketplace contains a hidden bad instruction**: marketplace skills are `untrusted` provenance; their `write-external`/`spend` calls still gate; `source_run`/`success_rate` surface anomalies.
- **A custom MCP returns prompt-injection text**: outputs are labeled untrusted; consequential tool calls still gate.
- **The user wants a fully quiet, no-approval session**: a "trust this session" mode exists but is time-boxed and excludes `spend`; clearly warned.
- **Cloud sync of memory leaks something sensitive**: memory is user-editable; a "scan before sync" pass flags entries matching secret/PII patterns.

---

## Kill criteria

- If approval prompts are ignored/bypassed >40% of the time, the consequence classes are miscalibrated — fix calibration before any UX change.
- If users report feeling surveilled despite the model, defaults are too permissive — tighten (especially layer 4 inferred writes and "all open tabs" grant).
- If outbound scanning blocks legitimate work too often, tune patterns; do not disable.

---

## Open questions

1. **Heavier isolation mode** (containerized workspace / separate profile for agent actions) — ship as opt-in v1 or later? *Lean: later; sandbox + approval is the v1 answer.*
2. **Should we offer a "strict" preset** (all inferred writes staged, all external actions always-approve, no pins) for high-security users? *Lean: yes, a Trust preset selector (Standard / Strict / Custom).*
3. **Cloud sync encryption**: end-to-end encrypted (server can't read) or server-side encrypted? *Lean: E2E for memory/skills/task content; server-side for the node index.*
4. **How do we communicate the injection reality** in-product without scaring users away? *Lean: a one-time, honest "How Pane keeps you in control" onboarding card + a living Trust doc.*

---

## Metrics

- **Approval grant vs. deny rate** per class (calibration).
- **Pin adoption** and **pin expiry/revoke rate**.
- **Outbound scanning blocks** (and false-positive reports).
- **Context panel opens** and **grant revoke events** (trust surface health).
- **Inferred-write staging queue** size and approval rate (layer 4 hygiene).
- **Security incidents** reported (injection-caused bad actions) — target near-zero, investigate every one.
- **"Trust this session" mode usage** (should be low).
