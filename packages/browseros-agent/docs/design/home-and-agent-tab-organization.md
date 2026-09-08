# Home and agent tab organization

Home should answer three questions: what can I ask Pane to do, where is my saved work, and what needs my attention?

## Home

- Living Grid typography, full-width Home rail, hairline dividers, compact controls and square corners throughout, including the shared composer and floating controls. Starter and saved-work tiles use soft tints from the existing place palette, with stable site colors and dark-theme variants.
- One task composer under a single greeting. No starter buttons or repeated introductory copy. Shortcuts sit directly below it without another heading or boxed tiles.
- Open-tab context remains visible. Attach appears only for named-agent routes that accept file payloads; text-only provider routes do not offer a file control that would discard uploads. Assistant selection, local files and connected apps move into Options. Attachment-only submissions receive a usable prompt, selected tabs reach named agents as source references, and failed Home dispatch retains the draft.
- Familiar website shortcuts and a responsive grid of saved work replace numbered text sections. Pin and Hide live in a keyboard-accessible overflow menu on each card.
- Today is now a persistent dated agenda maintained by agents, with local reads, source-backed items and explicit background review. See [Today agenda](today-agenda.md). Live approvals appear separately under Pending decisions.
- Approval details stay visible. Expired requests disappear locally even if the next refresh fails. Pending approvals cannot be dismissed as ordinary reminders.
- Today shows compact rows with pastel kind icons, titles, relevant times and a next action. Supporting context opens from an info icon on hover or click; Move and Hide live in a separate overflow menu. Date selection is a popover next to the Today heading. Refresh feedback distinguishes skipped sources, queued work and local information. Errors expose retry actions. A failed Home projection is explicitly unavailable rather than an empty successful response.
- Growth counters, milestone interruptions and the jargon-heavy onboarding list no longer appear on Home.

## Agent folders

The shared browser tool framework carries task ownership through async-local context. Both normal tab tools and JavaScript `browser.pages.newPage()` calls inherit it. The internal agent and MCP paths supply their conversation scope; clients without one use a Pane fallback scope. Scheduled preparation tabs pass ownership explicitly.

Immediately after tab creation, before waiting for page load, the page manager puts it in a named Pane group. All automatic opens reuse “Tabs opened by Pane” in their browser window, across websites and conversations, including after a server restart. The fallback uses Chromium’s green folder color (the supported palette match for Pane’s lime signal) on creation and reuse. Explicit model titles retain a Pane prefix and remain scoped to their task; their chosen colors are preserved. Grouping is serialized to avoid races on simultaneous opens; browser windows each need their own group. Deleted groups are recreated; model-regrouped tabs are followed into their replacement group. Personal folders are not adopted as automatic defaults.

If mandatory grouping fails, close only the just-created tab and return an error. If cleanup also fails, report the affected tab ID. Raw CDP tab creation inside agent tools directs the model to the managed page API. This is an organization guarantee for the supported tools, not a security boundary around arbitrary server JavaScript.

## Validation

- 73 focused browser and refresh-feedback tests, including concurrency, missing labels, deleted groups, model regrouping, raw-CDP bypass prevention and cleanup failure handling.
- 28 chat-service regression tests, including scheduled hidden-page ownership.
- 30 Home projection, growth and approval regression tests.
- 5 MCP route tests and 5 MCP registration tests (141 passing tests in total).
- App, server, browser-core and browser-mcp TypeScript checks.
- Actual React components previewed with mocked data: desktop and narrow layouts, editable starter drafts, Options, empty Home, unavailable data and failed refresh.

Updated the MCP registration test catalogue to include the existing trigger_list and trigger_delete tools; its registration and tab-default forwarding checks pass.

## Wiring audit

The follow-up audit passes 151 focused tests across agenda persistence, mounted scheduler/background/MCP integration, chat request forwarding, Home handoffs, existing Home/approval behavior and browser folder enforcement. App and server type checks pass. See the Today design for the exact refresh pipeline and live-provider limits.

## Release limits

No signed browser release was built or published. Native Chromium behavior still needs a smoke test in a newly built Pane: open multiple tabs through the internal agent and ACP, rename/delete a folder, and repeat in a hidden scheduled-task window. Page-created popups, tabs opened outside the supported Pane tools, and manual user tab moves are not covered by these unit tests. The preview uses sample data and is not connected to a user's browser profile.

## Design revision verification

Reviewed the actual React preview at desktop width and 390px, in light and dark themes. DOM inspection found no visible Home elements with nonzero corner radii and no horizontal overflow at 390px. Verified info disclosure, keyboard dismissal, Move controls, completion/undo, and Options including voice conversation. The preview retains its existing sample data and real local agenda API; external providers remain mocked.

## Long content and work navigation

Composer text uses the same 40px first-line frame as its action buttons, with the 32px icon inset by 4px. Today actions have a fixed-width primary action slot. Titles wrap to at most two lines and break unspaced strings; full Today titles and descriptions remain in the info panel, bounded by the available viewport height with internal scrolling. Site names and summaries also clamp to two lines without forcing wider cards.

Home labels its saved-site section Sites. View all opens Your work, with Sites and Temporary pages categories. The latter consumes the existing `temps` collection from `/pi/library`, shows expiry, and links to the existing temporary page route with Keep. The API regression test verifies that Keep removes an item from the temporary list and adds a saved site.
