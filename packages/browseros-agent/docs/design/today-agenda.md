# Today: a calendar Pane maintains

## Product contract

Today answers “What matters on this date, and what can I do next?” It is a local, persistent agenda, maintained during agent conversations and by explicit background reviews. Opening Home only reads SQLite; it never starts a model, crawls the browser or synchronizes external apps.

The first view shows three prioritized items. A date picker and adjacent-day controls expose the same calendar on other dates. Users can add a task, complete/acknowledge an item, ask Pane to help, move it, hide it or undo completion/hiding. Supporting explanations and source links open from a small info icon on hover, click or keyboard activation. Empty days are valid. Live approval requests remain a separate Pending decisions section because they are actionable trust requests, not calendar commitments.

Use the existing Living Grid rail, typography, hairlines and field palette. Keep title, relevant time and the next action visible. Put reasons and provenance in the info popover; Move and Hide live in the item menu; completed/hidden work is collapsed. Do not add counters or generated advice to fill space.

## Item schema

| Field | Meaning |
| --- | --- |
| `id`, `sourceKey` | Stable item identity and unique identity of the underlying commitment/event. The key must survive date changes. |
| `day`, `timezone` | Calendar date (`YYYY-MM-DD`) and IANA zone in which that date was assigned. |
| `startsAt`, `endsAt` | Optional exact instants with timezone offsets. Start must fall on `day` in the item timezone; end must follow start. |
| `kind` | Task, event, update or prepared work. |
| `title`, `why`, `detail` | Concise action or outcome, reason it matters, and optional expanded detail. |
| `priority`, `certainty` | Normal/high priority and confirmed/suggested. Inference must not be presented as a confirmed obligation. |
| `sources` | Named conversation, file, app, site or manual input; real reference, short evidence and observation timestamp. |
| `agentQuery` | Optional scoped next step; executed only when the user chooses Ask Pane. |
| `status` | Open, done or dismissed; no hard delete. |
| `version`, `userFields` | Optimistic concurrency and fields protected by explicit user edits. |
| Timestamps | Creation/update time, distinct from source freshness and review time. |

An agenda item is not an automation. Recording “send proposal Friday” does not schedule a send or grant permission to send. Moving an event changes its Pane entry and clears its precise time; it does not edit the original invitation.

Today includes unfinished tasks from the previous seven days, clearly labelled with their original date. Older tasks remain available on their dates rather than forming an endless overdue wall. Events, updates and prepared outputs do not roll forward. Confirmed priority items lead, followed by carried tasks, events, tasks, updates/prepared work and suggestions. Events with a known end time in the past are demoted locally. The browser follows local midnight and timezone changes without a model call.

## Maintenance and refresh

Four tools are available in both the in-process agent and ACP/MCP: `agenda_list`, `agenda_upsert`, `agenda_update`, `agenda_review_finish`. Read-only chat receives only `agenda_list`. The normal agent prompt instructs agents to maintain real dated commitments as work evolves, reuse existing records, retain evidence, avoid generic advice and never infer completion from silence.

Refresh creates a durable `scheduled_runs` job and an `agenda_reviews` record. Requests coalesce by date and timezone while a review is active. The UI sends the run ID to the extension background; the regular queue alarm remains the fallback. Targeted drains retrieve the requested run even if it falls beyond the first page of pending jobs. Leaving Home does not own or cancel the review. Both the immediate drain and fallback alarm forward the selected workspace at execution time for explicit agenda reviews, alongside configured provider and connected MCP apps. Unrelated scheduled jobs do not inherit that folder. The conversation owner is persisted before starting the model; a failed handoff fails the run visibly. Waiting status reads actual pending approvals for the run or its ACP conversation, excluding expired requests.

The review prompt directs the agent to:

1. Read existing agenda items, including closed items, around the date.
2. Retrieve relevant discussions, current work, saved-site records, permitted files and available connected MCP apps. Follow existing source references and keep searches scoped.
3. Reconcile items with evidence. Preserve facts when a source is unavailable; mark completion/cancellation only when verified. Reuse IDs/keys and current versions. Avoid changing external apps or executing the listed work.
4. Save a required review report: summary, sources checked, unavailable sources, complete/partial outcome.

The report tool is bound to the assigned running agent. A completed model run without a report is shown as partially checked, never successfully verified. Failed/cancelled runs retain their saved agenda and expose retry. Progress distinguishes queued, running, waiting for input, partial, complete and failed. Users can open the review conversation. Snapshot polling only reads the local store.

## Persistence safeguards

The profile-local SQLite migration adds `agenda_items`, `agenda_reviews` and `agenda_changes`, including the packaged-build fallback schema. Date/status reads are indexed. Source-key uniqueness deduplicates retried creation; updates require the current version. User date/title/status edits cannot be overwritten by agent maintenance. Agents cannot automatically reopen closed items. Manual date moves protect the cleared exact times from subsequent agent writes. Every mutation records before/after state, actor and completion evidence where supplied.

These constraints protect mechanical identity and explicit choices. Determining whether two differently named commitments mean the same thing, or whether source evidence is sufficient, still depends on the agent following the tool contract. The design does not claim semantic deduplication or independent verification of arbitrary model-supplied evidence.

## Validation and rollout limits

Tests cover persistence across reopen, duplicate creates, stale versions, protected edits, completion and undo, timezone/date validation, event moves, bounded carryover, provenance requirements, coalesced reviews, report ownership, partial/failure handling, tool execution and local-read/queued-refresh separation. Database migration/bootstrap and existing Home/MCP regression tests also run. An integration test queues through the mounted scheduler API, drains with the app runner, calls the registered gated ACP agenda tools, and verifies the resulting Today response after reopening SQLite. Chat-request tests verify workspace, apps and ownership forwarding and interrupted-stream failures. The sample Home preview uses the actual agenda API and an isolated temporary database.

Native end-to-end evaluation with an actual configured provider and real connected sources remains a release smoke test. The preview does not contact user apps or run a live model. File and connector coverage is limited to the runner's existing access; unavailable sources must appear in a partial report. No external calendar writeback, recurrence expansion or automatic polling of connected apps is added. Automatic maintenance happens during agent turns; no additional always-running background model has been introduced.
