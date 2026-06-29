# 14 — Passive Capture & Context Buckets

## Summary

Because Pane **is** the browser, it can do something no external agent or bolted-on daemon can: **passively capture and learn from what happens in the browser, in one place, with native consent.** Today users assemble this from separate products — Otter/Granola/Fathom for meeting notes, tab-history and research tools for browsing memory, separate "work" and "personal" silos for scoping. Pane folds all of it into the browser itself.

Three things, all intrinsic and local (State A): **automatic meeting recording + notes** (web meetings run in a tab; capture audio + content natively, transcribe locally, summarize, file in a meeting bucket), **browsing learnings** (passive observation → facts, workflows, and skill candidates fed to the memory loop), and **context buckets** (scoped namespaces in the Context Graph so work doesn't leak into personal life).

> **Review v0.3 note.** New spec, added in v0.3 per the user. This is the purest "we are the browser" capability: capture that normally needs a separate bot/app/extension is native to Pane. **All intrinsic State A** — capture happens in the browser, transcription defaults to a local model (optional BYOK to a *provider* transcription API, never a Pane server), storage + indexing in the local Context Graph. Builds on existing BrowserOS substrates: tab/page capture via `browser-mcp`/CDP, the glow indicator (already shipped) as the capture light, and Cowork for local file storage. Cross-refs [02](./02-the-context-graph.md) (buckets), [04](./04-memory-and-learning-loop.md) (learnings → memory/skills), [10](./10-trust-privacy-security.md) (consent), [06](./06-task-and-work-management.md) (meeting action items → tasks).
>
> **Review v0.4 note (HoP pass).** Made the **research bucket** concrete (auto-threading of the page chain, verbatim-quote capture for citable retrieval, synthesis-with-citations, exportable) so the researcher/student ICP signal in [00](./00-vision-and-thesis.md) has a real flow, not just a name. Flagged **local-transcription quality as a load-bearing feasibility risk** to de-risk early. Added a **performance-budget** stance (pause capture on battery, cadenced extraction) so "always learning" doesn't mean "always draining." Tightened the headline metric to an outcome (capture→action rate, not "% captured").

---

## Why being the browser is the unfair advantage

- **Meeting capture without a bot.** Web meetings (Meet, Zoom web, Teams web) run *in a tab*. Pane captures that tab's audio + content natively — no "Otter bot joins your call," no separate app, no vendor cloud recording. Transcription runs on your machine. Notes land in your context graph, scoped to a work bucket, callable by the agent.
- **Browsing learnings without an extension graveyard.** Pane sees every page you open (with consent + per-domain controls). It extracts facts, patterns, and skill fragments passively — "you always read PR checks before merging," "you research via arXiv → Notion → Slack" — and feeds the memory loop ([04](./04-memory-and-learning-loop.md)). No second product.
- **Buckets without a new product.** Context isn't one soup. Pane scopes capture, memory, and skills into **buckets** with separate permissions, retention, and retrieval — so your work agent doesn't surface your personal browsing.

---

## A. Meeting capture & notes

**Trigger.** The user clicks "Capture meeting" on a meeting tab, or Pane auto-detects a meeting URL (Meet/Zoom/Teams patterns) and prompts once per domain. **One-time per-domain consent** + a persistent, visible recording indicator (the existing glow, repurposed as the capture light).

**Capture.**
- Tab audio via the browser's media capture APIs (tab capture / `getDisplayMedia`), system + mic mix per the user's consent choice.
- Page content (participants, in-call chat, shared docs, agenda) via `browser-mcp`/CDP extractors that already exist.
- Stored locally (Cowork-managed folder under the meeting bucket).

**Transcribe.**
- **Default: a local speech model** (whisper.cpp-class) — keeps the pure-OSS, no-server promise.
- **Optional: BYOK to a provider transcription API** (OpenAI/Deepgram/etc. — a *provider* server, never Pane's) for speed/accuracy. Disclosed at opt-in; the local path is the default and always available.

**Process.** Diarize → summarize → extract **action items → tasks** ([06](./06-task-and-work-management.md)) → extract **decisions/facts → memory** ([04](./04-memory-and-learning-loop.md)) → link the note to its meeting bucket and to any related project/task.

**Surface.** A "Meeting notes" view; the agent answers "what did we decide about X in last week's standup?" via `context.recall` scoped to the meeting bucket.

**Privacy.** Never auto-share with other attendees (manual export only). Per-domain opt-in. The recording indicator is always visible while active. One click to stop; one click to delete the recording (transcript retention is configurable).

---

## B. Browsing learnings

**Passive observation**, opt-in with per-domain granularity, produces lightweight extractions:

- **Facts** the user repeatedly engages — "our staging URL is …", "the on-call rota lives in …".
- **Workflows** — "open PR → read checks → comment → merge"; "triage inbox → label → reply-template."
- **Research threads** — a chain of pages opened toward a question, saved as a research bucket entry.

**Feeds.**
- Facts → memory layer 4 (activity-derived) in [04](./04-memory-and-learning-loop.md), staged for review per the inferred-write default.
- Repeated workflows → candidate `SKILL.md` files in the auto-skill-creation loop ([04](./04-memory-and-learning-loop.md), [11](./11-personalization-skills-marketplace.md)) — this is the "becomes smarter from real activity" engine made *continuous*, not only from explicit agent runs.
- Research threads → research bucket, retrievable later.

**Controls.** Per-domain on/off; a "paused" state that suspends all extraction; a learnings log the user can browse, edit, and delete. Nothing is extracted silently from a domain the user hasn't allowed.

---

## C. Context buckets

A **bucket** is a scoped namespace in the Context Graph ([02](./02-the-context-graph.md)) with its own: captured items, memory, skills, permissions, retention, and (optional) embeddings.

- **Default buckets:** Personal, Work. **Per-project buckets** are created automatically from Workspaces ([05](./05-workspace-files-terminal.md)). **Special-purpose buckets:** Meeting notes, Research.
- **Bucket-aware retrieval.** When the agent works in a Work workspace, it does not surface Personal-bucket memory unless cross-bucket access is explicitly granted. The agent states which bucket it read from.
- **Bucket operations:** create, rename, merge, archive, export, delete. **Cross-bucket links** (a meeting note → a project task → a skill) are first-class graph edges.
- **Retention per bucket** — e.g. meeting *recordings* auto-delete after N days while *transcripts* persist longer; browsing-learnings expire unless promoted to memory. All configurable.

This is the structural answer to "I don't want my work agent to know my personal browsing."

### The research bucket (the researcher/student flow)

Research is a wandering, multi-tab, multi-day activity. The research bucket turns it into structured, citable notes without the user manually bookmarking:

- **Auto-threading.** While the user researches (on a consented domain set), Pane records the **chain of pages opened toward a question** — not just a flat history, but a thread (page A → "cited by" → page B → "opened from search for X"). The thread is the bucket entry.
- **Key extractions.** Per page: a one-line gist + any quotes the user highlighted/copied + the source URL + timestamp. Quotes are stored verbatim so retrieval can surface the *exact* source text (the anti-hallucination discipline — claims are traceable to a captured quote, not a paraphrase).
- **Synthesis on demand.** "Draft a lit review / outline / summary from what I've read this week" pulls from the bucket with **citations back to the source tabs**; every claim in the draft links to the captured quote it came from. The user can click through to verify.
- **Editable + exportable.** The bucket is a first-class object: rename ("Q3 competitor research"), merge, export to Markdown/Notion, archive. The user can drop pages out of a thread if they were tangential.
- **Privacy.** Research capture is its own consent class (separate from meeting capture and general browsing learnings); a "researching" toggle (with an optional topic label) makes the start/end explicit rather than implicit.

This is the flow that owns the researcher/student ICP signal in [00](./00-vision-and-thesis.md) — the thing students/researchers currently stitch together from Zotero + Notion + tab groups + screenshot tools, native to Pane because it's the browser.

---

## Goals / Non-goals

**Goals.** Passive meeting capture + notes; passive browsing learnings; bucketed, permissioned, locally-stored context — all local, all consented, all in one place.

**Non-goals (intrinsic v1).**
- Video recording of meetings (audio + content first).
- Cross-device bucket sync (State B extension point).
- A Pane-hosted transcription service (BYOK to providers only; local is the default).
- Automatic sharing of notes with other attendees (manual export only).
- Capture without consent, ever.

---

## Consent & trust

Cross-ref [10](./10-trust-privacy-security.md). The headline rules:

- Passive capture is **OFF by default.** Each capture class (meetings, browsing) and each domain has its own opt-in.
- A **persistent, visible indicator** (the glow) shows when capture is active; there is no hidden capture.
- **Bucket assignment is user-visible and editable**; inferred assignments (e.g. `github.com` → Work) are shown and can be reassigned, never applied silently.
- **Captured content is treated as untrusted input** for injection purposes — meeting transcripts and scraped pages can contain prompt-injection attempts; the agent's grounding + approval framework (10) applies.
- **Everything is deletable**, per bucket, with retention defaults that bias to short retention for raw recordings.

---

## Interactions

- [02](./02-the-context-graph.md) — buckets are the partitioning dimension of the graph.
- [04](./04-memory-and-learning-loop.md) — browsing + meeting learnings feed memory; workflows → skill candidates.
- [05](./05-workspace-files-terminal.md) — per-project buckets created from Workspaces.
- [06](./06-task-and-work-management.md) — meeting action items → tasks.
- [07](./07-proactive-and-scheduled-work.md) — a scheduled "daily digest" can summarize the day's meetings + browsing learnings.
- [10](./10-trust-privacy-security.md) — consent, indicators, injection defense on captured content.
- [11](./11-personalization-skills-marketplace.md) — workflows → auto-created skills.
- [12](./12-onboarding-activation-metrics.md) — onboarding offers meeting-capture opt-in + bucket setup.

---

## Open questions

1. **Local transcription quality/speed.** Is whisper.cpp-class good enough on a laptop for near-real-time meeting transcription, or is BYOK-to-cloud the practical default while local stays the privacy option? *Lean: ship local as the default-with-consent path; BYOK as the fast path. Benchmark before locking.* **(HoP v0.4: this is a load-bearing feasibility risk for a flagship feature — de-risk it early with a benchmark; if local is unusable on common laptops, scope meeting capture to BYOK-only rather than ship a bad local experience or drop the feature.)**
2. **Bucket auto-assignment.** Should the agent infer the bucket from domain (`github.com` → Work) with user override, or always ask? *Lean: infer + show, user can reassign; never silent.*
3. **Video capture.** Audio + content now, video later? *Lean: later; audio + content covers most meeting-note value at a fraction of the storage/cost.*
4. **Retention defaults.** Recordings auto-delete after N days, transcripts kept longer? *Lean: recordings short-retention, transcripts longer, all configurable per bucket.*
5. **Capture cost on battery/laptop.** Passive extraction + transcription are the heaviest intrinsic consumers. *Lean: obey the performance budget ([04](./04-memory-and-learning-loop.md)) — pause capture on battery/under-load with a visible "capture paused" state; extraction is cadenced, not per-page-load.*

---

## Metrics

- % of meeting-tab sessions captured (opt-in rate).
- Time-to-note after a meeting (target: a usable note ready **<30s** after the call ends).
- Browsing-learnings written per active day; % surfaced usefully in a later session.
- Bucket hygiene: % of captured items in a non-default bucket; **cross-bucket-leak incidents = 0.**
- Capture-trust NPS: do users leave capture on after the first week?
