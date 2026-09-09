# Pane chat: product and interaction redesign

> Superseded as the product/design direction by [Chat product research and redesign](./CHAT-PRODUCT-RESEARCH.md). The first mockup was rejected for visual clutter and this proposal was too narrow. Its lifecycle notes remain engineering background; its visible queue layout and delivery priorities are not the recommended design.

Status: proposal, September 8, 2026. Based on the current working tree and inspection of the running `/home/chat` UI. Application behavior has not been changed. Existing unrelated work in the checkout is outside this proposal.

## Product decision

Make chat a dependable place to carry work forward: compose while Pane works, see what it is doing, revise instructions, and recover without losing work. Keep Pane's achromatic shell, Geist typography, citron action signal, and quiet tool evidence. The biggest problem is interaction completeness and consistency; a new visual skin alone will not resolve it.

Primary user: a developer or knowledge worker doing a multi-turn task alongside browser tabs and local files. Primary success journey: start with context → follow progress → add a follow-up → correct it → review an outcome → return later.

The user explicitly requested frontend-only message queuing. No new backend queue, scheduling service, or queue endpoints belong in this work.

## What exists, and what is actually missing

These are observations from source unless marked live observation. They are not measured usability-test results.

| Finding | Evidence | User consequence |
| --- | --- | --- |
| Side-panel and full-page chat reject submission while busy. Typing remains possible, but Send becomes Stop. | `ChatInput.tsx`: `isSubmitDisabled = isBusy || sendDisabled`; `chat-session.hooks.ts`: `canSend` includes active-turn and approval gates. | Users must remember to return and send their next thought. |
| Dedicated harness conversations already have a different queue. | `AgentCommandConversation.tsx` calls `useEnqueueHarnessMessage`; `QueuePanel.tsx` exposes removal only. | Queue behavior depends on the route, rather than the user's task. This is a partial existing feature, not universally absent. |
| Normal user messages lack an editing affordance. | `ChatMessages.tsx` renders actions only for assistant messages; `ChatMessageActions.tsx` offers Copy, Like, Dislike. | Correcting a prompt requires manual copying or another message. Feedback gets more visibility than user control. |
| Drafts are component-local state in inspected composers. | `Chat.tsx`, `chat-actions.hooks.ts`, `ConversationInput.tsx`. | Draft persistence/isolation needs an explicit contract across unmounts, history navigation, and surface changes. Do not infer exactly which navigation paths lose drafts without testing each path. |
| A submission can clear the composer before asynchronous acceptance is known. | `Chat.tsx` clears immediately after `sendMessage`; harness `onSend` invokes `.mutate()` / `void send()` without returning an acceptance promise. | Failure recovery cannot reliably retain the exact submitted text and context. |
| Provider occupies the header's strongest position; conversation identity is missing in that header. | `ChatHeader.tsx`; live `/home/chat` observation. | Hard to orient, return to work, or distinguish two conversations using the same model. |
| Full-page chat deliberately hides the history entry. | `NewTabChat.tsx` passes `hideHistory`; live observation. | Existing history storage does not translate into a discoverable return path. |
| Context and configuration controls differ across surfaces. | `ChatFooter.tsx` exposes mode/tabs/folder/apps; `ConversationInput.tsx` has tabs/attachments and an Options menu. | Users relearn the same action. Folder identity is a tooltip/dot in the panel rather than visible context. |
| Voice and keyboard behavior also differ. | Panel guards IME composition and appends dictation; `ConversationInput.tsx` Enter handler lacks the IME guard and replaces input with dictation. | Unexpected submission or replacement of a draft is possible. Verify supported voice builds separately. |
| A metadata diagnostic appeared as assistant prose. | Live `/home/chat`: model-metadata fallback warning, followed by Copy/Like/Dislike. | An infrastructure diagnostic masquerades as the answer. The observed symptom is confirmed; its producing adapter was not traced in this review. |
| Useful foundations are already present. | `ToolEvidenceList`, approvals, live watch, message paging, `ConversationScrollButton`, `ChatError`, `retryLastTurn`, `ChatTurnController`. | Extend these. Do not describe scrolling, retry, approvals, or history as wholly missing. |

Source roots: `packages/browseros-agent/apps/app/screens/sidepanel/index/`, `screens/agent-command/`, `screens/newtab/index/`, `modules/chat/`, and `components/`.

## Design direction

### Conversation identity and navigation

Header: conversation title, accessible History, New chat, and a small overflow menu. Rename via title/menu. Move repository promotion out of the working chat header. Put provider/model and mode together near the composer, because they determine the next submission. Show a locked provider with an explanation when the runtime cannot switch within a session.

Use the same conversation identity when expanding from panel to full page and returning. Preserve draft, attached context, pending items, and reading position. Full page gets readable width and optional history navigation; the panel gets the same interactions in a narrower layout. Do not force the full agent rail into the side panel.

### Transcript hierarchy

Assistant prose stays left aligned, without a bubble. User messages use a compact neutral fill, clear alignment, and accessible actions. Keep a 14–15px text baseline, comfortable line spacing, and 12px secondary labels; stop shrinking important controls to metadata sizes. Use consistent turn spacing and smaller spacing within a turn.

One active status row describes the current phase: “Reading 3 tabs”, “Writing the comparison”, “Waiting for your approval”, “Reconnecting”, or “Stopped”. Show elapsed time if available, not an invented completion percentage. On completion, collapse routine activity into “Viewed 3 pages · 6 steps”; leave useful results and failures visible. Preserve expandable evidence, source links, full diffs, and live watch.

Do not render raw runtime warnings as answer text. Separate answer content, tool evidence, and system status at the adapter/event boundary. Non-blocking diagnostics belong in details; blocking errors get plain-language recovery next to the failed turn.

Existing scroll-to-bottom behavior needs consistent application, not replacement. Follow streaming only while the reader is at the bottom; otherwise show “New activity ↓”. Expanding tool evidence and loading older turns must preserve the reader's anchor. Editing a message must not cause auto-scroll to steal focus.

### Composer

A single console containing: attached context → multiline draft → compact controls. Keep the writing area clear of overlaid microphone/send clusters. Show `Agent ▾`, `Model ▾`, context attachment, and one secondary options entry. Use explicit mode labels and descriptions (“Chat: answer using context”; “Agent: use tools to do work”), replacing “Mode ON”. Scope any permission claims to actual runtime capabilities.

Selected context is readable: page title, selected-text excerpt, file name, workspace name. Each item can be inspected and removed. Selecting a tab fixes its identity; changing the active browser tab must not silently retarget a queued instruction. Explain when page content is read live at send time rather than captured earlier.

Preserve typed text during recording/transcription. Append dictation at the intended cursor/selection. Make long drafts scroll internally and optionally expand. Support paste and drop where supported; disclose unsupported attachments beside that action rather than accepting and discarding them.

## Frontend queue: interaction contract

“Queued” means Pane has saved this message locally and will submit it after the current turn succeeds. It does not mean the model has already received it.

| Current state | Primary composer action | Pending-message behavior |
| --- | --- | --- |
| Idle, connected | Send | Start a normal turn. |
| Running | Queue message | Save locally; clear the draft only after the save succeeds. Keep Stop separate. |
| Waiting for approval | Queue message | Accept more instructions locally; do not dispatch past the approval. |
| Reconnecting / unknown turn state | Save to queue | Preserve locally; never infer completion from a closed stream. |
| User stopped / previous turn failed | Add to queue | Keep queue paused, with a visible Resume queue action. |
| Saved after reload or reopening | Add to queue | Show “Saved queue · paused”; require Resume after reconciliation. |
| Queue item being edited | Save changes / Cancel | Hold dispatch while editing; preserve its place. |

Display an “Up next · N” region immediately above the composer, separate from the sent transcript. Each row shows a two-line preview, context summary, and Edit/Remove actions. Show the first two items by default and expand the rest. Provide Move up/Move down in the row menu; drag reordering is optional later. Removal offers Undo while the item is still unsent.

During a run, Enter queues and Shift+Enter inserts a line break. Label the button “Queue message”; tooltip-only semantics are insufficient. Keep a distinct neutral Stop control in the active status row. Stop pauses pending dispatch before cancelling the active turn. This prevents the next queued instruction from starting immediately after Stop.

Default dispatch is FIFO, one item per completed turn. Never concatenate messages silently or inject them into the current agent run. “Stop and send now” is an optional later action that cancels, confirms settlement, and sends the selected item ahead of others. Do not label it “Steer” unless the runtime genuinely supports mid-turn steering.

### Lifecycle and persistence

Use one frontend outbox for the new queue UX, scoped by browser profile, runtime target, and conversation/session ID. Allocate a stable conversation ID before the first message. Keep drafts and outbox items distinct.

Each item needs a stable local ID, revision, sequence, text, attachment references, selected-text snapshot/source, tab identities and recorded URLs, workspace identity, target/model/mode snapshot, created time, dispatch state, and any confirmed server turn ID. Never key queued items by message text: identical prompts are valid.

Use extension-local persistence for metadata and appropriate local blob storage for attachments; do not copy large base64 blobs into every storage update. Persist first, then clear the composer. On storage failure, keep the draft and explain the failure. Subsequent provider, mode, or folder changes apply to new drafts, not previously queued payloads.

For live browser context, preserve the selected tab and recorded URL. At dispatch, validate the selection. If the tab closed or navigated away, pause that item and offer reattachment or an explicit send without it. A selected-text snapshot can remain valid independently of the open tab. Never claim a tab attachment is an immutable page snapshot unless actual page content was captured.

One frontend coordinator owns dispatch per conversation. A frontend origin-scoped lock (for example Web Locks) plus a durable `dispatching` state must prevent two extension surfaces from sending the same item. Read current item revision and lifecycle state inside that ownership boundary; React effects alone are not a queue protocol.

This is an open-UI queue: closing all chat surfaces stops dispatch, but locally saved items survive. On remount, inspect the active turn and show the saved queue paused. The current server run can continue independently. Background dispatch while all chat UIs are closed is outside the first release; it must not be implied by the UI.

Do not convert the existing harness backend queue into a second layer under the local queue. New submissions for this UX should wait locally and use the ordinary send endpoint when eligible. Existing server-queued harness items, if present, remain explicitly identified as already scheduled and are reconciled before local dispatch. Do not silently migrate/delete them. Sharing the queue presentation is safe; mixing two dispatch authorities is not.

### Delivery and recovery

Model outbox states explicitly: `pending`, `editing`, `dispatching`, `accepted`, `needs-review`, and `failed`. Keep queue pause state separate from active-turn status. A transport callback reporting `ready` is insufficient to drain; use confirmed server turn completion plus settled approval state.

Return a structured acceptance result from frontend send adapters. On confirmed acceptance, associate the server turn with the local item and transition it into the transcript exactly once. If a request might have succeeded but the reply was lost, mark “Delivery uncertain”; reconcile using the existing turn/history APIs. Do not automatically resend an ambiguous request. Frontend-only coordination cannot promise exactly-once delivery across a network failure without server idempotency support.

Cancellation in the current generic API is conversation-scoped. Hold local dispatch, reconcile the observed turn, issue cancellation, and verify the result before allowing another local send. A concurrent externally started turn remains a limitation; turn-specific atomic cancellation would require a separate API capability, not a new backend queue.

## Editing: three explicit meanings

| Message | Action and result |
| --- | --- |
| Draft or queued item | Edit in place. Save keeps its position and context; Cancel restores its previous content. No network request. |
| Sent instruction, current run active | Offer “Send correction” as a queued follow-up. Offer Stop separately. Never imply the earlier instruction has been removed from an already running agent. |
| Sent instruction, completed turn | Inline editor with “Save & rerun” and Cancel. Preserve the original conversation as a recoverable version; run from the edited instruction using only the applicable earlier context. |

For sent-message editing, place the editor at the message rather than stealing an unrelated composer draft. Show “Starts a revised conversation from here. Original preserved.” before submission. The revised branch must exclude the original answer and all later turns from model context. Preserve the original branch's queue; start the revised branch with an empty queue, optionally offering explicit copy later.

Browser actions, sent communications, and file changes from the original run are historical facts. Editing conversation text does not undo them. When relevant, the edit UI should state “Previous actions remain applied.” Preserve execution evidence and require fresh approvals for newly proposed gated actions.

The current LLM service retains server-side history, so mutating the client `messages` array is not sufficient. Its `previousConversation` seed path is text-only; it is not a faithful branch mechanism for attachments and tool state. Validate structured branch/history support per adapter before exposing full Save & rerun. A new conversation with an explicit text context seed can be a deliberately limited interim capability, labeled accordingly. Harness session branching needs its own verified adapter support.

Ship queued-item editing with the queue. Treat sent-message editing as core follow-on work with real history semantics, not a cosmetic frontend shortcut. This may need conversation/history API work, while the queue still needs no backend implementation.

Message actions: user → Copy, Edit, overflow; assistant → Copy, Retry/Regenerate where supported, overflow. Move feedback into overflow. Keep actions available on keyboard focus and touch as well as hover. Up arrow in an empty composer can open the latest eligible user-message editor; never intercept it during IME composition or when navigating a mention menu.

## Recovery and outcomes

Errors belong to the affected turn and identify the remedy: reconnect, choose a model, retry a failed submission, reattach missing context, or inspect details. Distinguish retrying transmission from rerunning a task that may already have changed external state. Preserve partial output and the user's text.

Completion should lead with the result, link artifacts/pages, and report a blocker if the intended outcome was not reached. A concise expandable activity summary provides evidence. Do not generate an extra model call merely to decorate every answer with a summary.

Empty state: show relevant context and two or three examples that load an editable draft. Current suggestions submit immediately; draft-first examples let users review the instruction and context. Keep history nearby. Avoid another onboarding dashboard inside chat.

## Delivery sequence

| Order | Scope | Exit criterion |
| --- | --- | --- |
| 1 — Core control | Shared draft/outbox state; frontend FIFO queue; queued editing/removal/reorder; acceptance handling; Stop pauses queue. Start with panel and `/home/chat`. | User can type three follow-ups during a run, edit the second, stop safely, reopen, and resume without loss or duplication. |
| 2 — Coherent surface | Shared composer and message-action primitives; title/history; visible context; state row; error separation; IME/dictation fixes. | Same workflow and labels across panel/full page; narrow panel remains usable. |
| 3 — Revision and runtime parity | Sent-message revisions with correct history; capability adapters; dedicated harness queue presentation and dispatch reconciliation. | Edited content is actually used by the model; original history and actions remain accessible; no double dispatch authorities. |
| 4 — Reading and outcome polish | Scroll anchors, evidence density, artifact navigation, draft-first suggestions, search/rename/history improvements. | Long tool-heavy conversations remain readable and easy to resume. |

These are dependency-ordered slices, not calendar estimates. Do not start with theme replacement, animations, a backend queue, model-routing redesign, or an entire transcript framework rewrite.

## Implementation map

- Extend `modules/chat/chat-turn-controller.ts` and `chat-session.hooks.ts` with reusable lifecycle/acceptance signals; preserve existing restore, approval, and stop protections.
- Add frontend draft/outbox storage and coordinator modules near `modules/chat/`; use adapters for generic chat and harness sends.
- Converge `ChatInput`, `ChatFooter`, and `ConversationInput` on shared composer and context controls. Share interaction state first; avoid rewriting all runtime hooks at once.
- Extend `QueuePanel` into a presentation component taking a normalized queue view model. Keep queue ownership out of the component.
- Extend `ChatMessages`, its row-prop equality logic, and user-message rendering with edit actions and a separate inline editor.
- Update `ChatHeader` and `NewTabChat` for conversation identity and accessible history. Reuse existing history APIs/UI.
- Preserve tool evidence, approvals, live watch, message windows, and current design tokens. Specs 18 and 21 remain the visual foundation; consolidate their composer rules against the new shared implementation.

## Acceptance and validation

1. Queue A/B/C while a turn runs; edit B, move C ahead of B, remove/undo A. Verify exact order and payloads.
2. Double Enter, rapid clicks, duplicate completion events, and two open surfaces never create two local dispatches for one item.
3. Stop with queued messages never starts the next item. Cancellation failures remain visible; pending drafts stay saved.
4. SSE disconnect and SDK `ready` while the server runs never drain the queue. Approval resumes do not race with pending submissions.
5. Reload during pending, editing, dispatching, accepted, and uncertain states. Reconcile before enabling Resume; never blindly resend.
6. Change model, folder, active tab, and conversation after queueing. Original item context stays attached to its own conversation and is validated at send time.
7. Failed local save retains the draft. Failed network acceptance retains the payload. An ambiguous timeout shows review rather than an automatic retry.
8. Sent-message revision excludes superseded turns from model context, preserves original history/evidence, and does not replay tools from imported history. Test each supported runtime.
9. At 320/360/420px panel widths and full-page widths, controls remain reachable. Test long drafts, URLs, tables, code, context chips, light/dark themes, keyboard, IME, and screen-reader labels.
10. Scroll up while streaming; expand evidence and load old messages. Position stays anchored and new activity remains discoverable.

Proposed instrumentation, respecting existing privacy settings: queue-added/sent/edited/removed, pause reason, recovery outcome, draft restored, acceptance latency, and edit-rerun completion. Record IDs/categories and timings, never prompt text or attached content. Establish a baseline before setting adoption targets. Hard correctness targets: no lost locally acknowledged messages and no duplicate dispatches in the acceptance scenarios.

Run short usability sessions around the primary journey. Observe whether users can explain when a queued item will send, which page it uses, what Stop does, and what editing a sent message preserves. This review identifies hypotheses and implementation risks; it does not substitute for observing users.

Release gate: keep the queue behind a frontend feature flag until the lifecycle/recovery scenarios pass. Disable automatic draining if duplicate sends or acknowledged-message loss appear; leave saved drafts and manual sending available. Local persistence must remain responsive and avoid rerendering the full transcript on each keystroke.
