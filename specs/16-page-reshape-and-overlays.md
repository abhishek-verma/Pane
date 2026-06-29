# 16 — Page Reshape & Overlays (the web, reshaped for you)

## Summary

Because Pane is the browser, it can read a page in the context of *your* goals and **layer what you need on top of it** — without changing the underlying web. A job listing shows a fit score against your resume and skills, not a generic "AI summary." A flight search highlights the routes that fit your calendar. A long policy doc gets margin notes tied to the project you're working on. A feed (LinkedIn, X, Hacker News) fades the engagement bait and recruiter spam and keeps the people you actually learn from. The web stays the web; Pane layers *yours* on top.

This is the README's "Pages reshaped for you" and "Feeds without the slop." It is intrinsic State A: reshapes are computed locally from your graph, memory, and `soul.md`, injected as **clearly marked, reversible, consented** overlays — never silent destructive edits to a page.

> **Build on BrowserOS, not from scratch.** The fork already ships page-level access (the glow indicator, content scripts, the 16 browser MCP tools, and native Chromium content-injection primitives an extension is progressively denied). Page reshape reuses that access; it does not add a new privileged path.

---

## Goals

- Make pages **about you**: surface your-fit, your-context, your-priorities on top of any page, derived from local state.
- **Feeds without the slop**: learn what you consider noise vs. signal per feed, and quietly hide the noise.
- **Never silently destructive**: every overlay is marked as Pane's, reversible, dismissible, and never rewrites what gets submitted to a site.
- **Consented per domain**: the user decides which sites Pane may reshape; defaults are conservative.
- **A learning feed**: what you dismiss/hide/pin flows back into memory and `soul.md` so reshaping improves over time.

## Non-goals

- Editing the page's actual submitted data (form values, posts). Overlays are presentation + annotation only — never silent writes to a third-party site. Any write goes through the normal agent + approvals path ([10](./10-trust-privacy-security.md)).
- A general-purpose "AI summary of every page." Generic summaries are the closed browsers' feature; Pane's edge is *your-context* overlays, not a re-skin of "summarize this tab."
- Rehosting or caching page content to a server. All reshape compute is local.

---

## User stories

- "I open a job listing. Pane shows a fit score: '82% match — your React + 4yrs exp hit it; you're missing their required Kubernetes.' Pulled from my resume in my workspace, not a generic summary."
- "I'm on a flight search. Pane highlights the two routes that don't clash with my calendar (read via integration) and dims the red-eyes I never book."
- "I'm reading a 40-page vendor security policy. Pane adds margin notes tied to *my* project: 'section 4.2 conflicts with the SOC2 scope you're working on.' I click the note; it jumps to the ticket."
- "On LinkedIn, the recruiter spam and engagement bait collapse; the posts from the three people I actually learn from stay on top. Pane learned that from what I expand vs. hide."
- "I dismissed a fit score on a site I didn't want it on. Pane never showed one there again, and remembered the preference."

---

## Spec

### Reshape primitives

| Primitive | What it does | Example |
|-----------|--------------|---------|
| **Annotation overlay** | Adds a Pane-authored layer beside/on top of page content | Fit score on a listing; margin notes on a doc |
| **Highlight/dim** | Visually emphasizes or de-emphasizes existing page elements | Calendar-fit flights highlighted; feed slop dimmed |
| **Hide (collapsible)** | Collapses an element with a "hidden by Pane — show" affordance | Recruiter spam collapsed in a feed |
| **Reorder (feed only)** | Reorders feed items by signal, with the original order one tap away | High-signal posts to top on HN/LinkedIn |
| **Sidebar note** | Opens a Pane side note tied to a page anchor | "this clause conflicts with ticket #481" |

### How reshapes are computed

- **Context inputs**: your `soul.md` persona + active bucket ([11](./11-personalization-skills-marketplace.md), [14](./14-passive-capture-and-context-buckets.md)), `USER.md` + `MEMORY.md` ([04](./04-memory-and-learning-loop.md)), granted workspace files (resume, project notes — [05](./05-workspace-files-terminal.md)), the Context Graph ([02](./02-the-context-graph.md)), and integrations (calendar — [09](./09-integrations-mcp-developer-surface.md)).
- **Page read**: Pane reads the page DOM (it already does for the glow/extraction). The reshape model gets a compact page digest + your-context digest and returns overlay intents (annotation/highlight/hide).
- **No page content leaves the machine.** Compute is on the local model or your BYOK model, called from the browser process with page content stripped to what's needed for the specific reshape.
- **Feed de-slop** is a learned classifier: per feed, your expand/hide/dwell signals ([14](./14-passive-capture-and-context-buckets.md) browsing learnings) train a local "signal vs. noise" preference stored in memory; the overlay applies it on load.

### Trust & consent (the load-bearing part)

Reshaping a page is sensitive — it changes what a user sees on a third-party site, which can mislead or hide information. So:

- **Per-domain consent.** Pane only reshapes a domain the user has opted in for. Defaults: off for banking/payments/health/government domains; the user enables elsewhere. A first-encounter prompt: "Pane can show your fit score / notes on this site — enable?"
- **Always marked, always reversible.** Every Pane-authored overlay is visually branded (Pane mark + "added by Pane") and has a one-tap dismiss. Hidden elements are *collapsed*, not deleted — a "show what Pane hid" control is always one tap away. The user can never lose information to a reshape.
- **Never silent writes.** Overlays are presentation/annotation only. Anything that would submit, post, or change account state goes through the normal agent + approvals flow ([10](./10-trust-privacy-security.md)). Reshape never edits form values or posts on your behalf.
- **Injection defense.** Pane's overlays are isolated (content-script world + a Pane-owned overlay root) so a hostile page can't read your context digest or trick the overlay. Untrusted page text never becomes a memory entry without review (the rule from [04](./04-memory-and-learning-loop.md) and [10](./10-trust-privacy-security.md) — prompt-injection defense applies double when reading a page *and* layering on it).
- **No deception.** Overlays must not impersonate the site's own UI. A fit score is a Pane card, not a fake "you match" badge styled like the site.

### Learning loop

Dismissals, hides, expands, and pin/keep signals feed back as memory writes (gated per [04](./04-memory-and-learning-loop.md)): "user hides recruiter messages on LinkedIn" → `USER.md`/feed preference. Over time, the feed de-slop classifier and the reshape ranking both improve — another expression of "gets smarter from your real activity."

### Performance budget

Reshapes are **lazy and rate-limited** (principle 12). A reshape runs on page load only if (a) the domain is opted in and (b) the active persona/bucket makes a relevant reshape available. Feed de-slop uses a cached local classifier (no per-load LLM call); annotation overlays use a cheap model and cache per-URL results. On battery/low-resource, reshapes suspend (the glow shows "reshape paused").

---

## Interactions with other specs

- **02 — Context Graph**: reshapes read your threads/buckets; the active thread can drive margin-note context.
- **04 — Memory & Learning Loop**: dismiss/hide/expand signals become memory; the reshape ranking improves over time.
- **05 — Workspace, Files & Terminal**: fit-score-style reshapes read granted workspace files (resume, project notes).
- **09 — Integrations**: calendar-fit reshapes read calendar via Connect Apps.
- **10 — Trust, Privacy & Security**: per-domain consent, injection defense, never-silent-writes, reversibility — this spec's hard constraints.
- **11 — Personalization**: `soul.md` persona + active bucket decide which reshapes are eligible.
- **14 — Passive Capture**: feed de-slop trains on browsing-learnings signals.
- **15 — Adaptive Home**: the home surfaces a "this page can be reshaped" hint and a one-tap enable.

---

## Edge cases

- **A site breaks because of an overlay:** overlays are isolated and additive; if a site still breaks, the reshape auto-disables for that URL and reports to the action log; the user is notified, the page reloads clean.
- **Misleading reshape (wrong fit score, bad highlight):** every overlay has "wrong? report" → kills that reshape for the URL and logs it; repeated wrong reshapes demote the model's confidence for that domain.
- **Site ToS forbids automation/overlay:** Pane respects the user's choice but is honest in docs that some sites' ToS may restrict overlays; the feature is opt-in per domain and the user owns the decision.
- **Heavy pages (infinite feeds):** feed de-slop runs on visible items first, then lazily on scroll — never blocks first paint.
- **Local model too weak for good annotations:** annotation overlays require a capable model; if the user is on a weak local model, annotation overlays are hidden (not shown broken) while highlight/dim still work.

---

## Kill criteria

- If per-domain consent is rejected >60% of the time on first encounter, the prompt/value framing is wrong — rework before expanding domains.
- If "show what Pane hid" is used often and users re-expand, the de-slop classifier is hiding signal — retrain / raise the noise threshold.
- If overlays are reported misleading above a low threshold, annotation overlays default-off until the model improves.

---

## Open questions

1. **Feed de-slop scope in v1:** LinkedIn/X/HN only, or a general "learn any feed" mechanism? *Lean: ship 2–3 named feeds first (where the slop pain is acute and DOM is stable), generalize later.*
2. **Annotation model:** local-only, or allow BYOK for quality? *Lean: BYOK allowed; local-only users get highlight/dim + a degraded annotation experience (honest).*
3. **Are reshapes shareable?** (e.g. "share my job-fit overlay config.") *Lean: later; `soul.md` + preferences are shareable, reshape configs ride on that.*

---

## Metrics

- **Per-domain opt-in rate** at first encounter, and **retained opt-in** at D14 (kill-criterion input).
- **Reshape action rate**: % of reshaped pages where the user acts on a Pane overlay (clicks a note, expands a kept item, runs a suggested action).
- **Hide/reshape reversal rate** (signal that reshapes are hiding signal — must stay low).
- **Feed de-slop precision**: of items hidden, % the user would agree were noise (sampled via "show what Pane hid" re-expansion rate).
- **Misleading-reshape report rate** (kill-criterion input for annotation overlays).
