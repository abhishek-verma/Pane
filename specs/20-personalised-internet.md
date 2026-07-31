# 20 — Personalised Internet

**Status:** operable ship — chassis + hero Job Search loops wired; dogfood gated on live harvest/materialize agent turns. Spec claims below match code, not aspirational storyboard from [19](./19-homescreen-of-personal-internet.md).  
**Audience:** engineers and agents extending private sites / home doorways  
**Companion:** [19 — Homescreen of the Personalised Internet](./19-homescreen-of-personal-internet.md) (north-star home narrative); this doc owns **sites, pages, tools, refresh, storage**.  
**Implementation plan (chassis):** `.llm/plans/2026-07-29-personalised-internet.md`  
**Operable ship plan (no half-bake):** `.llm/plans/2026-07-29-pi-operable-complete-ship.md`

---

## 1. What it is

Personalised Internet is a **private web per browser profile**: durable sites and pages the agent authors as structured JSON (not freeform HTML), plus short-lived temp pages that can be Kept into the private web. Home is the front door (doorways + continuity around the existing chat composer). Sites are operable depth for living work (Job Search pipeline is the hero).

Chat and markdown are not enough for multi-day operable state. Pages are.

---

## 2. Product locks

| Lock | Rule |
| --- | --- |
| Isolation | One private web **per browser profile** (not per context-bucket “side”). |
| Split | **Sites** = operable depth; **Home** = front door + continuity. Do not rebuild pipelines on the homepage. |
| Composer | Home `ConversationInput` on `AgentCommandHome` stays as-is. |
| Widgets | Removed. No `home_widgets` table, `home_widget_*` tools, or widgets on `/scheduler/home`. Front door is `pi` + composer. |
| No LLM on open | `loadHome` / home fetch never call chat or models. |
| Authorship | Agent is primary author via `pi_*` tools; user manages via UI + chat. |
| Actions | Shared kinds: `open-internal`, `open-external`, `local`, `agent` (+ `query` + `metadata`). |

---

## 3. V1 surfaces

| Address | SPA route | Purpose |
| --- | --- | --- |
| (home) | `#/home` | Composer + PI doorways/continuity (or empty-site starters) |
| `pi://sites/:siteId` (+ `/pages/:pageId`) | `#/pi/sites/…` | Durable site / page |
| `pi://sites/:siteId/entities/:entityKey` | `#/pi/sites/…/entities/…` | Lazy per-entity page (stub → materialize) |
| `pi://temp/:tempId` | `#/pi/temp/…` | Temp page with Keep / Discard |
| `pi://library` | `#/pi/library` | List sites (“My sites”) |

Canonical user-facing addresses are `pi://…` (Pane Chromium rewrites to the agent extension HashRouter). Empty home starters prefill chat to create Job Search / Research Hub via tools.

---

## 4. Storage & write path

- **Files:** `<profile>/personal-internet/sites/<id>/pages/*.json`, temps, `home/HOME.json`, `home/prefs.json`
- **SQLite:** `pi_sites`, `pi_pages`, `pi_records`, `pi_pulses`, `pi_refresh_*`, `pi_temps`, FTS `pi_index`
- **Sole mutator:** `applyPiMutation` / `preserveTemp` in `apps/server/src/personal-internet/write-path.ts`
- **Templates (P0):** `job-search`, `research-hub`, `sales-leads`

Page documents are versioned DSL JSON (`PiPageDoc`): title, text, note, badge, stack, button, link, table, board, **chart**, **mermaid**, **svg** (sanitized). Prefer `chart` data over freeform SVG. No model-authored HTML; reject script / `javascript:` / handler keys.

---

## 5. Agent tools & trust

**Read:** `pi_list`, `pi_read`, `pi_pulse_get`, `pi_record_list`, `pi_open`  
**Write-local:** `pi_site_upsert`, `pi_page_create`, `pi_page_patch`, `pi_page_delete`, `pi_site_archive`, `pi_preserve_temp`, `pi_home_regions_patch`, `pi_record_upsert`, `pi_entity_ensure`

Registered in AI SDK tools, MCP, and `consequence-class` READ / WRITE_LOCAL sets. Chat mode keeps reads and drops writes.

Job Search **source of truth** is `pi_records` (`job-application`); board/chart sync from records. Company details use entity routes — not one mega page.

Create tools return `{ siteId, pageId, route: '#/pi/...', href: 'pi://...', preview }` so the agent can share the page. `pi_open` navigates the user to a `pi://` address when contextually appropriate.

---

## 6. Home projection

`buildPiHomeProjection()` (no LLM) → `{ doorways, continuity, libraryCount, generatedAt }` attached as `pi` on `/scheduler/home`. Doorways come from doorway-eligible **active** sites with pulse (dormant demoted unless pinned). Continuity merges HOME.json, pulse urgencies, and pending approvals (empty OK; no fake blocks). Doorway may include `secondary` urgency action.

---

## 7. Refresh bus (kinds A–E)

| Kind | Role |
| --- | --- |
| A | Recompute pulse / home continuity reproject (cheap, local) |
| B | Structured sync stub (no Gmail/Calendar product yet — do not claim in UI) |
| C | Harvest — `scheduled_runs` source `pi-harvest` when `harvestEnabled`; guards: battery, quiet hours, host-tab affinity; skip → `staleAt` |
| D | **Home:** continuity revise (local merge of approvals + doorway urgencies — not agent page authorship). **Site:** board/chart sync from records + pulse (template `new-day` is kind D). |
| E | Full scheduled task (owned elsewhere) |

Triggers include `site-updated`, `entity-mutated`, `manual-refresh`, `browser-started`, `host-opened` (extension → `POST /pi/hooks/host-opened`; drain nudged), `new-day` (once/local day), `home-focused`, `run-completed`, `meeting-ended`, `meeting-started` (active Pane capture — **not** calendar lead-time), `return-from-sleep`. Calendar `pre-event` (N min before) is reserved in home policy but **not emitted** without Calendar. Coalesce by target+kind; meeting-started / pre-event priority beats host-opened. Entity ensure enqueues `pi-materialize` and the UI nudges drain. Unshipped: `url-matched` / `host-closed`, Calendar lead-time warm-up.

---

## 8. HTTP API

Mounted at `/pi` (profile-scoped): sites CRUD/archive/hard-delete, pages create/patch/delete, records list, entity ensure, temps preserve/discard, library, actions invoke, refresh, host-opened hook.

---

## 9. Retrieval

Durable pages/records index into `pi_index` + embed queue (`sourceKind: pi_page | pi_record`). Hybrid lexical search includes the PI arm. Archive/delete removes index rows.

---

## 10. Out of scope (v1)

Hosted sync, element marketplace, freeform HTML iframes, replacing the widget store, full Gmail/Calendar sync (B stub only), self-learning research companion docs.

---

## 11. Related

- Homescreen narrative: [19](./19-homescreen-of-personal-internet.md)
- Adaptive home foundation: [15](./15-adaptive-home.md)
- Architecture: [ARCHITECTURE-DESIGN.md](./ARCHITECTURE-DESIGN.md) §4.13
- Tests: `packages/browseros-agent/apps/server/tests/personal-internet/`
