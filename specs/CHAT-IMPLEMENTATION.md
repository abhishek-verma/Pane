# Chat implementation — September 9, 2026

Implements the core direction in `CHAT-PRODUCT-RESEARCH.md`. The longer roadmap in that proposal remains a roadmap.

## What changed

- Shared composer/editor across home, dedicated agent conversations, full-page chat, and side panel. Quiet rounded input; Plus discloses files, screenshots, tabs, workspace and apps. Main chat mode controls live in a settings popover. Promotional starter prompts were replaced with useful editable drafts.
- File picker, image paste and drag/drop; image/text previews and removal; TXT/Markdown/CSV/JSON/code files with missing MIME detection; native PDF input for compatible LLMs. Text files now reach both LLMs and harness agents. Images/documents remain in message parts, including on revisions. Unsupported PDFs in ACP produce an explicit error rather than silently losing the file.
- Screenshot source picker, viewport capture, drag-to-crop in the preview, retake and attach. Capture preserves the draft and never sends automatically.
- Atomic inline tab references with stable IDs, multiword title/URL search, Enter/Tab commit, Escape dismissal without deleting prose, and native Undo/Redo. Already attached tabs are excluded from mentions. Plus offers the separate multi-select picker. Page chips expose their URL and can open the source.
- Main chat drafts and attachment payloads persist per conversation and target. Local FIFO follow-ups have edit, reorder, pause/resume, removal, and restore-to-draft. A conversation-wide Web Lock prevents competing frontend dispatch owners; storage mutations are also locked. Successful LLM delivery requires the specific server turn's terminal receipt. Interrupted/uncertain delivery stays available for review. Restored queues pause. The UI must remain open for automatic dispatch.
- No backend queue was added. Dedicated harness conversations retain their existing server queue; they are not wrapped in a second queue. Their send/enqueue paths now wait for acceptance before clearing the composer, and a conflicting turn is not mistaken for acceptance.
- Sent-message editing for stateless LLM providers forks a new conversation from the full server-side prefix before the edited message. The original stays in history; superseded later turns are excluded. Persistent ACP providers offer draft reuse because replaying their native session history is a different capability.
- Reply to selected answer text, searchable history, local rename/pin/archive/restore, and full-transcript Markdown export. History search is explicitly limited to saved titles and recent prompts. Export lists attachment names; it is not a binary attachment archive.

## Validation

- 49 app tests passed: attachment staging/round-trip, source identity, queue settlement, request contracts, turn lifecycle, routing, and message memoization.
- 31 server route/attachment/revision tests passed, plus 28 chat-service regression tests (108 total).
- App TypeScript (`wxt prepare` + `tsgo --noEmit`) and server TypeScript (`tsc --noEmit`) passed.
- Targeted Biome check has no errors. Complexity warnings remain in larger functions.
- Browser smoke tests used the real `ChatInput`/`MentionEditor` components in an isolated fixture: narrow/wide layout, multiword mentions, Enter/Tab commit, Escape preservation, native Undo/Redo, busy Stop/Queue controls, and draft clearing after submission.
- The normal WXT development extension build now passes. The unrelated Layers entrypoint conflict was resolved in the working tree; no verification-only build exclusion is needed.
- Browser integration checks exercised the actual dispatcher with native Web Locks and synthetic local storage/replies: three-turn FIFO, ownership handoff without another storage event, cancellation of stale waiting effects, and preserving accepted sends during cleanup. All passed. Temporary fixtures were removed.

## Follow-up hardening

- Dispatchers wait for ownership with an abortable Web Lock. Previously, a nonblocking attempt could miss the final storage update and strand the next message.
- Interrupted `sending` items become reviewable immediately on recovery. Confirmed completion releases follow-ups without depending on a possibly stale SDK finish flag.
- Each send retains its own response receipt through asynchronous completion. A late response cannot overwrite a newer send's receipt or register the old turn against a newly selected conversation.
- The dedicated composer preserves edits made while awaiting acceptance and only removes context included in the accepted message.

## Remaining product work and verification

Native screenshot capture and live model delivery still need a final integrated smoke test. The development extension launches successfully, but the available native UI automation selects the existing production Pane instance rather than the isolated development window; production conversations were not used for these tests. PDFs use the model's native document support; local PDF extraction/OCR, page selection, DOCX/XLSX, full-page capture, annotation/redaction, cross-window/group context, full-body history search, and output-library expansion are not implemented here. History organization is local to the browser profile. This work does not publish a release.
