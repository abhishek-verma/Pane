# Pane chat: minimal interface, complete workflow

Research and product proposal · September 8, 2026 · Revised after rejection of the first design.

## Decision

Pane should feel as easy to start using as a familiar chat app, with the browser's context and actions available exactly where they help. The default surface is a conversation and one composer. Screenshots, documents, precise page references, editing, queuing, and useful outputs are core capabilities. They do not each deserve a permanent toolbar button or status panel.

The previous proposal overemphasized queue implementation, inherited the “developer console” aesthetic too literally, and treated multimodal input as a footnote. This document supersedes that product direction. Keep useful lifecycle protections from the earlier proposal, but change the interaction hierarchy and release order.

User constraint: queue orchestration remains entirely in the frontend. File ingestion and accurate history revisions may require separate runtime/API work; “frontend queue” does not make every chat feature frontend-only.

## Research performed and its limits

- Inspected the running Pane `/home/chat`, its composer controls, and the live @ picker. No messages were submitted. The picker was closed and the empty draft restored.
- Read the main composer, dedicated harness composer, tab selection/search, attachment staging, request builders, harness submission/parser, selected-text handling, transcript rendering, queue, history, and turn lifecycle paths.
- Read primary documentation from ChatGPT, Claude, Dia, Comet, Cursor, and Nielsen Norman Group. Inspected the screenshot-menu imagery in ChatGPT's official macOS guide.
- Agent Reach's Exa backend failed DNS resolution; research continued through the available web tool against primary sources. Search snippets were used for discovery, not as the sole support for the key comparisons.
- This is a source-backed product audit, not a claim to have run user interviews or tested competitors' authenticated apps. Marketing/docs establish documented interactions, not task-success rates. No competitor feature is assumed to work identically across models, plans, or platforms.

## What the references actually teach us

| Primary source | Documented behavior | Implication for Pane — design judgment |
| --- | --- | --- |
| [ChatGPT image input](https://help.openai.com/en/articles/8400551-chatgpt-image-inputs-faq/) | Images can enter through the plus menu, drag/drop, or clipboard paste. | One visible entry plus direct manipulation. Attaching an image should not require changing chat surface. |
| [ChatGPT macOS screenshot tool](https://help.openai.com/en/articles/9295245) | Screenshot capture is under Plus; a chosen window becomes an attachment before conversation submission. | Capture should produce a reviewable draft attachment, with no automatic send. Adapt this to current tab/region capture in Pane. |
| [Claude file uploads](https://support.claude.com/en/articles/8241126-upload-files-to-claude) | Plus, drop, and image paste; document formats include PDF/DOCX/CSV, with different processing rules for visual content. | “File support” means a reliable ingestion contract and clear read results, not a paperclip that accepts files the model cannot use. |
| [Dia 0.44](https://www.diabrowser.com/changelog/0-44-0) | Mention results hide tabs already mentioned; history references include prior chats. | Eliminate accidental duplicate/toggle behavior. Later, let relevant earlier work be attached through the same interaction. |
| [Dia 1.14](https://www.diabrowser.com/changelog/1-14-0) | A tab group can be mentioned to attach its tabs together. | Multi-page work deserves group selection, without cluttering the default composer. |
| [Comet Assistant panel](https://www.perplexity.ai/help-center/comet/en/articles/11734688-assistant-panel) | Uses the current page and @-mentioned tabs; extracts visible text and metadata on submission. | Make “this page” useful, while making page identity and read time understandable. Page context and a screenshot are different inputs. |
| [Cursor prompting](https://cursor.com/docs/agent/prompting) | @ references different context types; image paste/drop and context-usage inspection are available. | One context vocabulary can cover tabs, files, and prior chats. Advanced inspection belongs behind a small contextual entry. |
| [Cursor steerability changelog](https://cursor.com/changelog/1-4) | Distinguishes steering, queuing, and interruption. | These are different promises. Pane should ship queued follow-ups honestly, and only expose live steering when an adapter supports it. |
| [NN/g: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Separate common actions from secondary options with an obvious path between them. | Minimalism comes from deciding what is primary, not making everything tiny or icon-only. |
| [NN/g: recognition and recall](https://www.nngroup.com/articles/recognition-and-recall/) | Visible, recognizable choices reduce the need to remember commands. | @ and shortcuts are accelerators. Plus → Add tabs must remain a discoverable equivalent. |

Avoid copying undocumented gestures. For example, the older Cursor planning page contains contradictory queue shortcut wording; use it neither as a shortcut specification nor proof of current behavior. Pane's shortcuts should be internally consistent and visible in its own menus.

## Audit: actual gaps in Pane

### Input and files

| Finding | Evidence in current working tree | Severity |
| --- | --- | --- |
| Main chat has no file picker, image-paste handler, or drop handler. | `screens/sidepanel/index/ChatInput.tsx`, `ChatFooter.tsx`; `/home/chat` uses the same footer. Live UI exposes voice, mode, tabs, workspace, and apps, but no file/screenshot entry. | Core task blocked |
| Attachment support depends on route and target. | `screens/agent-command/ConversationInput.tsx` stages files and handles paste/drop; `AgentCommandHome.tsx` enables attachments for ACP targets. | Core inconsistency |
| Accepted client file types are narrow. | `lib/attachments.ts`: images, `text/*`, and JSON; PDF/DOCX/XLSX are not supported by this staging helper. | Core task blocked |
| Even text-like file support has an end-to-end contract mismatch. | Staging produces `kind: 'file'`; `agent-conversation.hooks.ts` passes payloads to `chatWithHarnessAgent`, which serializes them unchanged; server `routes/agents.ts` rejects any attachment whose kind is not `image`. | Source-confirmed mismatch; validate with an integration probe before implementation |
| No user-controlled screenshot-to-composer flow was found in the inspected chat surfaces. | Existing screenshot/tool evidence and capture infrastructure are separate from composer attachment entry points. | Core browser task blocked |
| Attachment validation cannot be treated as production-complete. | Unknown MIME falls back to octet-stream; text size uses string length; asynchronous staging can race; images can be downscaled/reencoded. | Reliability and visual fidelity need review |

Do not call the harness “file-complete” because an Attach button exists. An affordance, a staged preview, and a successfully usable model input are three separate checkpoints.

### Page and tab references

| Finding | Evidence | Why it feels bad |
| --- | --- | --- |
| @ behaves like a multi-select picker rather than a mention. | `tab-picker-popover.tsx`: Enter and row selection call `onToggleTab`, without committing/closing. | Enter selects, another Enter can deselect, and the user remains trapped in a selection interaction. |
| The mention disappears from the sentence. | `ChatInput.tsx::closeMention` removes the @ query; selected tabs render elsewhere. | “Compare @A with @B” becomes ambiguous text with detached attachments. |
| Multiword query handling is fragile. | `ChatInput.tsx` truncates the filter at the first whitespace. | A page title containing spaces cannot be searched naturally through this path. |
| Search is current-window-only substring filtering. | `available-tabs.hooks.ts`: `chrome.tabs.query({ currentWindow: true })`, title/URL `.includes`. | Relevant tabs in another window disappear; no group entry or useful ranking beyond recency. |
| Already selected tabs stay in results as toggle targets. | `tab-picker-popover.tsx` renders all matched tabs with `isSelected`. | Repeated selection can remove context rather than reinforce it. |
| The picker has heavy duplicated chrome. | Header, uppercase label, filtering hint, selected count, checkbox, framed favicon, title, tiny URL. | Too much scanning for “choose this page.” |
| Empty/error states are conflated. | Query failure returns empty tabs; live UI showed “No active tabs” although browser tabs were present, but ineligible. | User cannot distinguish no eligible pages, another-window pages, and an actual loading failure. |
| Attached chips expose little beyond truncated title and removal. | `ChatAttachedTabs.tsx`; sent tab chips in `UserActionMessage.tsx` are static. | Hard to verify which page was used, inspect the source, or recover missing content. |
| Source identity and source content are not a uniform contract. | Main request carries active/selected tab metadata; harness helper appends title/URL references to text. | The UI cannot honestly imply that every attached page has already been read. |

### Conversation and work continuity

The first audit already established missing sent-message editing, blocked busy submission in the main chat, local drafts, premature composer clearing, and header/history inconsistency. Additional gaps/opportunities:

- Current history UI groups conversations and offers deletion; the inspected list has no visible query field, pin, rename, or archive controls. Backend retrieval elsewhere does not make chat search discoverable.
- Page selection and conversation context should survive navigation intentionally. Current active-tab selection display and send-time context require explicit scoping, especially once queuing exists.
- Existing live watch, approval cards, tool evidence, and scroll-to-bottom are useful foundations. They need one consistent hierarchy, not replacement.
- Existing output cards cover some tool and page types. A coherent user-facing “what did I receive, where can I open it, can I use it?” flow still needs design across files, pages, and structured answers.

## Six journeys that should drive the work

| User intent | Complete journey | Success criterion |
| --- | --- | --- |
| “What is wrong with this UI?” | Capture a region → optionally mark the problem → attach → describe → get grounded advice. | Never leave the browser or save a screenshot manually just to attach it. |
| “Compare these things.” | Mention two pages → add PDF → specify comparison → inspect cited differences. | User and agent agree which source each statement refers to. |
| “Help with this exact passage.” | Select text on a page → Ask Pane → source-linked quote in draft → ask follow-up. | Selection, page identity, and location survive navigation and sending. |
| “Keep working; here's another thought.” | Queue a follow-up while busy → correct/reorder it → observe delivery. | No lost instructions, accidental interruption, or unexplained queue behavior. |
| “Use the result.” | Open generated file/page → preview → copy/download/open in split view → request a specific revision. | Output is usable without hunting for a path in tool logs. |
| “Continue yesterday's work.” | Search chat/body/source → open result at matching turn → recover draft/context → continue. | No manual reconstruction of tabs, files, and instructions. |

## The minimal interface

### Always visible

- A quiet top row: Pane/model entry, conversation navigation, New chat, overflow. A generated conversation title can live in the navigation entry; it does not need a breadcrumb plus subtitle plus version badge.
- Conversation prose, with compact user messages and readable assistant answers.
- One comfortable composer with **Plus**, writing area, dictation when available, and Send. While running, keep Stop accessible and change the submission semantics clearly to Queue.

### Visible only when relevant

- Attachment previews when there are attachments.
- A small “Using [page]” source indication when page context is actually enabled; the specific page title is inspectable. Do not display a permanent “Current conversation context” badge.
- One collapsed pending strip when something is queued. Expand only to manage items.
- One live activity line during a run. Detailed tools open on request. Approvals and blocking errors stay visible until resolved.
- A small output tile for an actual result, with Open/Download appropriate to its type.

### Available on demand

Plus opens a short menu: **Add files or photos**, **Take screenshot**, **Add tabs**, then a secondary **More** destination for workspace/app connections and other context types as they become available. Screenshot can disclose region/current viewport/full page. Do not put every capture variant in the root menu.

Model, reasoning effort, agent permissions, workspace, and enabled tools belong in one understandable configuration popover, with current exceptions summarized only when they matter. A user should not have to select a mode or configure a workspace to ask a simple question. Keep capability differences honest; avoid auto-switching providers, granting tool access, or changing spending behavior silently.

### Visual rules

Use a neutral surface, restrained border treatment, generous typing space, and normal sentence-case labels. Keep the brand accent small. A larger, softly rounded composer is justified even though prior specs preferred a 6px console: the user's requested direction supersedes that rule. Preserve Geist and the neutral palette; revise the composer geometry and metadata-heavy hierarchy.

Design the resting state first, then add one complexity at a time. Remove numbered queue rows, uppercase “PANE / CONVERSATION”, persistent workspace chips, redundant status subtitles, and multiple separated footer bands from the rejected mock. Small text and many hairlines do not create minimalism.

## Core interaction specifications

### 1. Screenshots are first-class input

Entry paths: Plus → Take screenshot; clipboard paste; drag an image into chat. The native capture flow starts with **Select area** and offers Current viewport; Full page is a secondary option where supported. Capture only the requested browser surface by default. Capturing another app/window is a later explicit capability.

For region capture: temporarily hide the assistant overlay from the captured page, show a crosshair with Escape to cancel, allow selection adjustment, then place the image in the draft. Restore the panel and original draft focus. Do not auto-submit or replace existing text. A screenshot appears as an actual thumbnail, not “image/png”.

Click thumbnail → larger preview with crop, simple arrow/rectangle annotation, optional redact, remove, and source/time information. Crop/redact produce the actual submitted image; annotations must not be a UI-only overlay. Keep the unmodified local original for undo, but send only the reviewed derivative. Retake keeps the draft.

Keep screenshot text legible; compression should be content-aware and explain material downscaling. Show unsupported image-model state at attachment time with an explicit compatible-model choice or a clearly labeled text-extraction option. No silent visual-information loss.

Screenshot and page-read actions remain distinct: images communicate appearance; page extraction communicates text/structure. A visual debugging prompt may benefit from both, with their provenance linked.

### 2. Files that work end to end

Initial target formats: PNG/JPEG/WebP, PDF, TXT/Markdown/CSV/JSON. Next: DOCX and XLSX; PPTX after real parsing/preview support. These are release priorities, not claims of support today. Handle code/text files with missing MIME through validated type/extension detection rather than unexplained rejection.

All surfaces use the same staging pipeline and support picker, paste, and drop. Permit attachment-only messages. Each item moves through preparing → ready or actionable failure; show progress only while needed. Mixed batches keep good files, label the failed file, and allow removal/retry. Do not erase a whole batch because one file fails.

Preview documents by name/type/page count when known. Let users inspect what was read and, for long files, choose page ranges/sheets or send a relevant selection. Distinguish text extracted, visual pages available, scanned PDF needing OCR, password protected, unsupported, and partly read. Keep these details out of the resting composer unless action is needed.

Retain immutable attachment references in the sent message and revised/queued payloads. Attachments can be re-used from conversation context without re-upload. Local ingestion, extraction, preview, model transport, and storage cleanup need a shared contract. A larger accepted MIME list alone is not implementation.

### 3. Mentions that behave like references

Typing @ opens a small anchored result list, ranked by current page, relevant matches, and recency. Each row has a favicon, readable title, domain, and a subtle window/group distinction only when needed. Support title words, domains, and URL fragments. Keep a clear “Other windows” scope; never cross browser profiles/private contexts silently.

Enter/Tab commits one result, replaces the @ query with a stable inline reference, closes the list, and returns the caret immediately after it. Arrow keys navigate; Escape dismisses without deleting ordinary prose. The committed reference is bound to a source ID, not just a title string. Same-title tabs remain distinguishable. Backspace and Undo treat a reference predictably as a unit.

Example: **Compare [Pricing · product A] with [Pricing · product B], using [requirements.pdf].** References stay at the positions that give the sentence meaning. They do not vanish into an unrelated chip strip. Avoid duplicating each inline tab reference in a second large attachment row; images/documents can retain richer previews.

Click a reference to inspect its full title/URL, open it, remove/replace it, and see read status. Already added references are excluded from ordinary results or visibly marked “Added” with no destructive toggle on Enter. Selection should never accidentally remove context.

Plus → Add tabs opens the deliberate multi-select variant with a search box, checkboxes, group selection, and an explicit Add tabs button. This is a different task from an inline mention. Add tab groups as one expandable reference; snapshot group membership at submission so future changes do not silently rewrite the request.

### 4. Clear context scope and freshness

Distinguish **attached for this message**, **available in this conversation**, and **workspace resources** in the context inspector, not through three permanent bars. “Attached” means selected; “Read” means extraction/ingestion succeeded. Never use a green check to imply the model read a URL when only its metadata was passed.

Current-page awareness can reduce friction on initial panel open, with a visible page indication and remove control. Once the user starts composing, stabilize the page reference. Navigating elsewhere may offer “Use this page” but must not silently change an unsent/queued instruction.

For queued messages, bind explicit page references at enqueue time and validate at dispatch. Preserve captured text/images as snapshots. Live pages should show their identity and retrieval timestamp; a closed/navigated tab requires reattachment, stored snapshot use, or explicit send without it. Do not endlessly block if a faithful local snapshot is already available.

After sending, expose a compact source inspector for the turn: requested sources, successfully read sources, unavailable/partial sources, and the content form sent. This is essential for diagnosing “it ignored my file.” Keep token budgets and tool details one level deeper, and show a budget indicator only if actionable or requested.

### 5. Queuing, corrections, and revisions

Frontend queue: while running, Enter adds the current draft and its context locally. The button's accessible name and on-hover/focus text must say Queue; show a one-time short state hint. Keep Stop independent. A collapsed “2 queued · next: …” line expands into editable previews with reorder, remove, and pause. No queue UI when empty.

Send next only on confirmed turn success and settled approval state. Stop, failure, uncertain delivery, and remount pause dispatch. UI-only persistence survives closing the panel, but pending work will not autonomously start with all relevant UI surfaces closed. Use one frontend dispatch owner across surfaces. Never stack this queue over the existing harness server queue or blindly retry ambiguous delivery.

Queued messages edit in place. Sent messages offer inline Edit and, when the run is settled, Save & rerun with the original recoverable. On an active run, corrections are new queued instructions unless the user explicitly stops. Historical revision creates correct prior context and excludes superseded later turns; it does not undo browser/file actions already executed. Full behavior must be verified per adapter.

Add **Quote selection** on assistant text: selecting a passage offers Reply to selection and Copy. Reply inserts a source-linked quote in the draft without overwriting other text. This handles “change just this part” without repeatedly pasting an entire answer.

### 6. Answers that lead somewhere

Source citations should open the actual attached page/file and, where anchors are supported, highlight the relevant paragraph/page/sheet. A URL alone is useful fallback; never invent a precise anchor. Keep source identifiers stable across renamed tabs.

Generated files/pages should have a compact preview tile with name/type and appropriate actions: Open, Download, Open in split view, Copy. A turn with several outputs can expose “3 files” rather than permanently opening a second sidebar. Later, a conversation-level Files panel collects inputs and outputs so users can find them again.

Offer Copy text/Markdown through a simple message menu, copy individual code blocks and tables where appropriate, and local transcript export. Local save is the initial sharing path; external publishing is a distinct explicit action. No vague “saved” state without an accessible destination.

### 7. Returning and personal efficiency

Add searchable conversation history (title and body), rename, pin, archive/restore, and source/file-aware results. Search should jump to the matching turn and retain query highlighting. Clarify whether global search and within-chat Find search only loaded messages or the full conversation.

Keep per-conversation drafts, attachment staging, scroll position, and pending queue across panel/full-page transitions. New chat starts clean while leaving the old draft recoverable. Route changes and model changes should not silently replace one conversation with another.

Add saved prompts and slash-command discovery after the fundamentals: useful for recurring workflows, reachable through Plus/More as well as `/`. Saved prompts should load an editable draft rather than automatically execute. Let users explicitly pin a source or instruction to a conversation; do not quietly turn every attachment into persistent memory.

## Expanded feature backlog and priorities

P0 = necessary for a complete basic chat release; P1 = next layer of daily-use power; P2 = evaluate after the core workflow works. Priority is qualitative because usage data is not yet available.

| Capability | Why it earns a place | Where it appears | Priority / dependency |
| --- | --- | --- | --- |
| Universal file/image picker | Bring real work into any chat | Plus | P0; shared transport |
| Clipboard image paste | Fast screenshot/debug workflow | Direct paste | P0 |
| File/image drag/drop | Familiar desktop interaction | Drop overlay only while dragging | P0 |
| Region + viewport screenshot | Point at the exact browser problem | Plus → Screenshot | P0; capture bridge |
| PDF/text/CSV ingestion | Core knowledge-work inputs | Attachment preview | P0; parsers/transport |
| Preparing/failed/partial attachment states | Prevent false confidence and lost work | Affected item | P0 |
| Image/document preview and remove | Verify before sending | Click attachment | P0 |
| True inline tab mentions | Precise multi-source prompting | @ | P0; structured composer |
| Better title/domain search | Find intended tab quickly | Mention results | P0 |
| Explicit multi-tab selection | Compare several sources | Plus → Tabs | P0 |
| Selected text with provenance | Ask about exact passage | Page selection action | P0; extend existing |
| Context identity/read status | Know what Pane actually received | Source chip inspector | P0 |
| Draft persistence and recovery | Preserve effort across navigation/failure | Automatic, recoverable | P0 |
| Frontend message queue + editing | Keep thinking during agent work | Conditional pending strip | P0; lifecycle gates |
| Sent-message edit/rerun | Correct instructions efficiently | Message action | P0; history semantics |
| Retry with preserved payload | Recover without reconstructing prompt | Failed turn | P0 |
| Clear Stop/approval/reconnect | Control actual agent work | Active state only | P0 |
| Panel/full-page continuity | Use more room without starting over | Expand/collapse action | P0 |
| Quote/reply to selected answer | Revise a specific part | Text selection menu | P1 |
| Screenshot crop/annotate/redact | Communicate precisely | Image preview | P1 |
| Full-page screenshot | Review layouts beyond viewport | Capture submenu | P1; limits/stitching |
| Point at element | Attach element text, region, and locator where available | Capture submenu | P1; browser instrumentation |
| Other-window tabs + tab groups | Handle real multi-window browsing | Context picker | P1 |
| DOCX/XLSX support | Common work documents | Same file flow | P1; reliable extraction |
| Page ranges / sheet selection | Avoid irrelevant large context | Document preview | P1 |
| Reuse attachments / pin source | Avoid repeatedly rebuilding context | Context inspector | P1 |
| Click-to-source citations | Verify claims in original context | Answer citations | P1; locator support |
| Output previews/open/download | Make completed work usable | Output tile | P0 for existing outputs, P1 expansion |
| Conversation files panel | Find prior inputs and outputs | Overflow → Files | P1 |
| Chat search / Find / rename / pin / archive | Return to ongoing work | History/overflow | P1 |
| Copy variants / local export | Take work elsewhere | Message/conversation menu | P1 |
| Saved prompts / slash actions | Accelerate repeat workflows | / and More | P1 |
| Attach an earlier conversation | Reuse relevant prior work deliberately | @ / context picker | P2; retrieval |
| Context-budget inspection | Diagnose large-context problems | Context inspector | P1; truthful measurements |
| Capability-aware model selection | Avoid rejected images/tools | Relevant picker/attachment error | P0 basic, P1 refinement |
| Temporary conversation controls | Intentional retention scope | New-chat menu | P2; storage semantics |
| Actual live steering | Correct a running agent immediately | Send menu | P2; adapter support |
| Audio/video file understanding | Richer inputs | File flow | P2; parsing/model support |

Do not ship the entire table at once. P0 defines the coherent release objective; vertical slices below make it implementable. No numeric RICE scores or impact percentages are invented.

## Build strategy and boundaries

### Slice A: one reliable attachment pipeline

Unify the composer model across main and harness chat. Normalize text parts, references, immutable attachment IDs, and draft state. Reuse existing image helpers where correct. Fix the `kind: file` transport mismatch, introduce actual generic-chat attachment support, and add PDF/text ingestion. Support paste/drop/picker and previews before decorating them.

Exit: the same image, text file, and PDF work from panel and full page on declared supported targets. Failed items are recoverable and unsent text remains intact. Reject unsupported capabilities before Send.

### Slice B: browser context that feels native

Replace @ multi-select behavior with mention completion. Keep deliberate multi-selection as a separate picker. Add source inspection, selected text, screenshot capture, and stable identity through navigation. Extend the context model and adapter mapping rather than appending ad hoc labels to prompt text.

Exit: “Compare @A with @B using this PDF” is readable, editable, correctly bound, and faithfully reflected in model input. Screenshot capture returns to the existing draft and works while a previous run is active.

### Slice C: compose through the entire task

Add frontend queue ownership/persistence, acceptance handling, queued editing, Stop/pause, and sent-message revisions. Preserve the earlier audit's lifecycle safeguards. The UI reduces to a conditional pending strip and existing message actions.

Exit: queue several mixed-input messages, revise one, navigate, stop, reopen, resume, and recover without wrong-context sends or duplicates.

### Slice D: use and rediscover results

Unify source links, output actions, quote-selection replies, conversation search, and context reuse. Measure whether users can find and use results rather than merely whether the agent emitted tokens.

Exit: a user can return to a prior conversation, locate its original file or generated output, verify a cited claim, and request a targeted revision.

## UX budgets and validation

Proposed design targets, to validate rather than treat as research findings:

- Resting composer has one attachment entry and no permanent row of workspace/apps/tabs/voice-mode controls.
- File dialog is at most two activations from the composer. Screenshot capture is at most three before selecting the region. @ selection commits with one Enter.
- Added context is inspectable in one activation; removing an unsent item is undoable.
- A queued state consumes one compact row until expanded. No empty queue scaffolding.
- Readable at 320/360/420px panel widths, larger full-page widths, 200% text zoom, and both themes. Keyboard and touch access cannot depend on hover.
- Typing stays responsive while preparing files and streaming tool output. Define measured budgets after profiling; offload parsing/compression where appropriate and avoid whole-transcript rerenders on keystrokes.

### Test scenarios

1. Paste a screenshot into a nonempty draft; add a PDF and CSV; remove one; submit. The model receives exactly the reviewed inputs.
2. Attach a scanned PDF, encrypted PDF, large spreadsheet, missing-MIME text file, and corrupted image. Each state is clear and recoverable.
3. Mention two same-title tabs, search a multiword title, select an already-added source, press Escape, Undo, and Backspace. References remain correct and prose is preserved.
4. Select tabs from another window and a group; close/navigate one before sending. Explain what is still available without silently changing identity.
5. Capture a region while the agent runs; annotate/redact; queue it. The transmitted pixels match the reviewed derivative.
6. Disconnect during submission and reopen in another surface. No duplicate send; accepted/uncertain/pending items remain distinguishable.
7. Edit a sent prompt with attachments and tool history. Revised context is correct; original conversation and completed side effects remain accessible.
8. Select part of an answer, reply to it, open its source, and find the resulting file later in history.
9. Keyboard-only, screen-reader, IME, long-page, large-file, and low-width passes across supported adapters.

### What to measure

Establish baseline before assigning improvement percentages. Measure successful attachment-to-model delivery, time/actions to attach the intended source, accidental source removal, draft recovery, queue delivery correctness, time to reopen a useful result, and task completion. Use content-free event metadata under existing privacy preferences; never log prompt or file contents for this work.

For qualitative validation, recruit a small first round of Pane users and observe the six journeys without coaching. Ask them to explain which sources will be sent, whether queued text has reached the agent, and what editing preserves. Repeated hesitation identifies where hidden power has become undiscoverable. This validation is proposed, not completed.

## What should deliberately wait

Do not add a dashboard, permanently visible task plan, universal command palette, multi-agent orchestration UI, every possible file type, or more notification surfaces to solve this problem. Ship the input/context/control/output loop well. Power belongs in the workflow and the data model; the default screen should remain quiet.
