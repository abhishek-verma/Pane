# 08 — Reach & Channels

## Summary

Pane is a desktop browser, but your work and your life aren't only at the desktop. This spec defines how Pane **reaches you beyond the browser**: delivering digests, approval requests, proactive nudges, and answers to the places you already are — Telegram, Discord, Slack, WhatsApp, Signal, email, SMS, and a mobile companion. It is Pane's answer to the Hermes/OpenClaw messaging-gateway strength, and the thing that makes Pane a credible "always-on personal agent" rather than only an in-browser assistant.

The inversion worth stating up front: Hermes and OpenClaw are *messaged by you* through chat apps. Pane is *primarily used in the browser* and *reaches out to you* through chat apps. The browser is the cockpit; the channels are the pager.

> **Review v0.2 note.** The earlier draft spec'd 8 channels + a full mobile companion + inbound command surface all at once. That's a mobile-app company's scope. **This version cuts to the high-signal thin edge: OS native push + email + one messaging channel (Telegram), outbound-first.** The mobile companion, Discord/WhatsApp/Signal/SMS, and full inbound commands are **deferred** and unlock only on engagement data.
>
> **Review v0.3 note.** Reframed in system terms: **State A reach is peer-to-peer and needs no Pane server** — OS push (local), email (the user's SMTP/IMAP), and a Telegram bot (hits Telegram's servers, not Pane's) all run from the local app. The **mobile companion and any cloud-mediated push are State B extension points.** The system has full reach with zero Pane servers.

---

## Goals

- Let Pane push digests, nudges, approval requests, and task updates to channels the user already uses.
- Let the user have lightweight chat interactions with Pane from a channel ("yes, approve", "what's my day look like?").
- Keep channel access **permissioned, per-channel, revocable** (principles 4, 7).
- Make outbound messages **context-linked**: every message can deep-link back into the in-browser context.
- Offer a first-class **mobile companion** for on-the-go interaction.

## Non-goals

- Making Pane primarily a chat-app agent. The cockpit is the browser.
- Replicating OpenClaw's 20+ channel breadth on day one. Ship the high-signal channels first.
- Building our own messaging infrastructure. Use platform APIs and existing libraries.

---

## Channel model (thin edge first)

A **channel** is an outbound + inbound connection to a messaging platform. **v1 ships the high-signal subset; the rest unlock on engagement.**

| Channel | Outbound | Inbound | Auth | v1? |
|---------|----------|---------|------|-----|
| **OS native push** (macOS/Win/Linux) | Notifications, approval prompts | (n/a) | Pane account | ✅ v1 |
| **Email** | Digests, approval requests, replies | Replies (IMAP) | SMTP/IMAP | ✅ v1 |
| **Telegram** | Messages, inline buttons, deep links | Replies, `/approve`, `/tasks` | Bot token | ✅ v1 |
| **Discord** | DM/channel messages, buttons | Replies, slash commands | Bot | Later |
| **Slack** | DM/channel messages, buttons | Replies, slash commands | OAuth (shares Connect Apps) | Later |
| **WhatsApp / Signal / SMS** | Messages | Replies | Cloud API / Twilio | Later |
| **Mobile companion** | Notifications, cards, approvals, chat, voice, camera | Replies | Pane account | **State B extension** (unlock on engagement) |

### Channel vs. integration

A channel is for **reaching the user**. An integration (Connect Apps) is for **acting on an external service**. Slack is both: an integration (post to #eng on the user's behalf) and a channel (Pane DMs you a digest). The settings UI keeps these clearly separated but shares the OAuth where applicable.

---

## What Pane sends

| Message type | When | Example |
|--------------|------|---------|
| **Digest** | Scheduled (e.g. daily morning) | "Good morning. 3 tasks due, 1 blocked, I handled 2 overnight. 1 approval needed." |
| **Approval request** | A run hit a gated action | "Pane wants to post to #releases: 'deploy green'. Approve? [Yes] [No]" |
| **Proactive nudge** | Inferred opportunity | "You do the analytics export every Monday — schedule it? [Yes] [Not now]" |
| **Task update** | Agent-owned task finished/failed | "Expense report filed. Summary attached." |
| **Trigger fired** | A trigger condition met | "Staging deploy is green. Run smoke tests? [Yes] [Later]" |
| **Answer** | Reply to a user's channel question | "Your day: 9am standup, 11am review ENG-421…" |
| **Memory/skill notification** | Background review wrote something | "💾 Skill 'acme-export' created. Review?" |

All outbound messages are **rate-limited** (per-channel and globally) and respect **quiet hours**.

---

## Inbound: lightweight chat from channels (v1: minimal)

The user can talk to Pane from a channel for lightweight things, without opening the browser. **v1 inbound is deliberately small** — approvals + a few commands — not a full Hermes-style command surface:

- **Approvals**: inline buttons (`[Yes] [No] [Always allow]`). The highest-signal inbound action.
- **A few commands**: `/tasks`, `/approve <id>`, `/run <task name>`.
- **Free-text chat** (Telegram only in v1): "what's on my plate today?" — staged; expand based on usage.

Inbound channel sessions are **real conversations** stored in the session archive (layer 3, [04](./04-memory-and-learning-loop.md)). They share the same memory and skills. The nudge counter is derived from persisted history so it is not starved in gateway mode (the Hermes bug).

### Security model for inbound

- **Trusted sender allowlist**: only the user's own accounts can command Pane. Pairing via a one-time code during channel setup (like OpenClaw's pairing codes).
- **Consequence gating still applies**: a channel-initiated request that needs `write-external`/`spend` still asks for approval — even from the owner — the first time, and on `spend` always.
- **Identity-bound**: each channel is linked to the Pane account; a channel compromise can't impersonate a different user.

---

## Deep linking back to the browser

Every outbound message can carry a **Pane deep link** that opens the exact in-browser context: a task, an agent run, a tab + file combo, a memory entry. Tapping the link (desktop) or opening it (mobile companion → handoff to desktop) restores the full situation. This is the part Hermes can't do well, because Hermes doesn't own the browser.

---

## Mobile companion (State B extension point, deferred)

A **mobile app** (iOS + Android) is the *reach* surface, not a full browser. **It is deferred** — OS push + email + Telegram cover the high-signal need first, and a companion implies cloud-mediated delivery (a Pane server or a shared account layer), which is a State B concern. If engagement data shows users need richer mobile interaction (camera, voice, triage on the go), the companion ships with:

- Notifications and cards (digests, approvals, nudges).
- Lightweight chat with Pane; approval prompts with biometric confirm.
- Task list (read + triage); voice input; camera (photo a receipt → "file this as an expense").
- Handoff: open a deep link → wakes/streams the desktop Pane (or, with the State B cloud runner, runs headless).

The companion pairs with the user's Pane account, not a specific machine. It is explicitly **not** a mobile browser replacement. **Unlock condition:** OS push + email approval-latency and digest engagement data show users want more on mobile than notifications afford.

---

## Surfacing and setup

- **Channels settings** (`/settings/channels`): per-channel connect, pairing, what-to-send toggles (digests, approvals, nudges, task updates), quiet hours, rate limits.
- **Per-task delivery rules**: each scheduled/agent-owned task can pick which channel(s) to notify.
- **Onboarding nudge**: after a user creates their first scheduled task, offer "want this delivered to Telegram?" (principle 6: at the moment it's useful).

---

## User stories

- "My morning digest arrives on Telegram at 7:30am with inline approve/deny buttons for the overnight runs."
- "A scheduled task wants to post to a new Slack channel; Pane DMs me on Telegram, I tap Approve, it finishes."
- "From my phone I text Pane: 'summarize #eng since yesterday' — it replies with a digest pulled from the Context Graph."
- "I photograph a receipt in the mobile companion; Pane files it as an expense task and starts the expense form run on my desktop."
- "I tap a deep link in an email digest; my desktop Pane opens to the exact task with its tabs and files restored."

---

## Interactions with other specs

- **02 — Context Graph**: outbound messages reference graph nodes; deep links restore context.
- **03 — Agent Modes & The Loop**: channel-initiated requests run the same loop with the same approvals.
- **04 — Memory & Learning Loop**: channel sessions are archived; `/memory` `/skills` commands work over channels; nudge counter survives gateway resets.
- **06 — Task & Work Management**: digests and triage prompts; task updates.
- **07 — Proactive & Scheduled Work**: digests, triggered-task notifications, approval-when-away.
- **09 — Integrations & MCP**: Slack/Discord share OAuth between channel and integration roles.
- **10 — Trust**: sender allowlist, pairing codes, consequence gating for inbound, channel-isolated credentials.

---

## Edge cases

- **Channel outage**: outbound messages queue and retry; if a channel is down at digest time, fall back to the next preferred channel or email.
- **Conflicting approvals** (user approves on two channels simultaneously): first-wins; the other gets "already handled."
- **Message size limits** (e.g. Telegram 4096 chars): digests summarize and link to a full in-browser view.
- **Spam / abuse inbound**: rate-limit inbound per sender; ignore non-allowlisted senders.
- **Channel credential rotation**: detect and notify the user to re-pair.
- **Privacy of channel content**: channel messages are stored locally in the session archive; the user can set a shorter retention for channel sessions.

---

## Kill criteria

- If inbound chat usage is negligible and channels are used only for outbound notifications, drop the inbound command surface for low-signal channels (keep Telegram + mobile).
- If the mobile companion's camera/voice features are unused, pare back to notifications + approvals + chat.
- If a channel's maintenance cost exceeds its engagement, drop it.

---

## Open questions

1. ~~**Which channels ship first?**~~ **Decision (v0.2): OS native push + email + Telegram.** Discord/Slack/WhatsApp/Signal/SMS later, unlocked on engagement.
2. ~~**Build the mobile companion native or web?**~~ **Deferred.** Build only if push+email+Telegram prove insufficient; then native shell wrapping a shared React core.
3. **Does the mobile companion require the cloud account**, or can it talk LAN-direct to a desktop Pane? *Lean (when built): cloud-account by default; LAN-direct as a power-user option.*
4. ~~**Inbound command surface scope**: full Hermes-style command set, or approval + a few commands?~~ **Decision (v0.2): approvals + `/tasks` + `/approve` + free-text chat on Telegram only; expand based on usage.**

---

## Metrics

- **Channels connected per user** and which channels.
- **Outbound messages per week per user** (engagement) and **open/act rate** by type (digest vs. approval vs. nudge).
- **Approval latency** via channel (how fast users respond) — the key "always-on" metric.
- **Inbound message rate** and **command success rate**.
- **Deep-link click-through** back to desktop (the browser-cockpit handoff).
- **Mobile companion DAU** and retention.
- **Channel disconnect rate** (credential/cred issues).
