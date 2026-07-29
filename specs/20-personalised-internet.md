# 20 — Personalised Internet

**Status:** normative product + tech (v1 shipped in agent)
**Audience:** engineers and agents extending private sites / home doorways
**Companion:** [19 — Homescreen of the Personalised Internet](./19-homescreen-of-personal-internet.md) (front door); this doc owns **sites, pages, tools, refresh, storage**.
**Implementation plan:** `.llm/plans/2026-07-29-personalised-internet.md`

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
| Widgets | `GET /scheduler/home` keeps `widgets`; only **adds** optional `pi`. |
| No LLM on open | `loadHomeWidgets` / home fetch never call chat or models. |
| Authorship | Agent is primary author via `pi_*` tools; user manages via UI + chat. |
| Actions | Shared kinds: `open-internal`, `open-external`, `local`, `agent` (+ `query` + `metadata`). |

---

## 3. V1 surfaces

| Route | Purpose |
| --- | --- |
| `#/home` | Composer + `PiHomeRegions` (doorways / Today) + adaptive widgets |
| `#/pi/sites/:siteId` (+ `/pages/:pageId`) | Durable site / page |
| `#/pi/temp/:tempId` | Temp page with Keep / Discard |
| `#/pi/library` | List sites (“My sites”) |

Empty home starters prefill chat to create Job Search / Research Hub via tools.

---

## 4. Storage & write path

- **Files:** `<profile>/personal-internet/sites/<id>/pages/*.json`, temps, `home/HOME.json`, `home/prefs.json`
- **SQLite:** `pi_sites`, `pi_pages`, `pi_records`, `pi_pulses`, `pi_refresh_*`, `pi_temps`, FTS `pi_index`
- **Sole mutator:** `applyPiMutation` / `preserveTemp` in `apps/server/src/personal-internet/write-path.ts`
- **Templates (P0):** `job-search`, `research-hub`, `sales-leads`

Page documents are versioned DSL JSON (`PiPageDoc`): title, text, note, badge, stack, button, link, table, board. No model-authored HTML; reject script / `javascript:` / handler keys.

---

## 5. Agent tools & trust

**Read:** `pi_list`, `pi_read`, `pi_pulse_get`  
**Write-local:** `pi_site_upsert`, `pi_page_create`, `pi_page_patch`, `pi_page_delete`, `pi_site_archive`, `pi_preserve_temp`, `pi_home_regions_patch`

Registered in AI SDK tools, MCP, and `consequence-class` READ / WRITE_LOCAL sets. Chat mode keeps reads and drops writes.

Create tools return `{ siteId, pageId, route: '#/pi/...' }` so the agent can show the user the page.

---

## 6. Home projection

`buildPiHomeProjection()` (no LLM) → `{ doorways, continuity, libraryCount, generatedAt }` attached as `pi` on `/scheduler/home`. Doorways come from doorway-eligible active sites with pulse. Continuity is urgency/pulse-derived (empty OK; no fake blocks).

---

## 7. Refresh bus (kinds A–E)

| Kind | Role |
| --- | --- |
| A | Recompute pulse / home reproject (cheap, local) |
| B | Structured sync stub |
| C | Harvest — `scheduled_runs` source `pi-harvest` when `harvestEnabled`; default **off** |
| D | Region revise (deferred / skip) |
| E | Full scheduled task (owned elsewhere) |

Triggers include `site-updated`, `entity-mutated`, `manual-refresh`, `browser-started`, `host-opened` (extension → `POST /pi/hooks/host-opened`). Coalesce by target+kind; pre-event priority beats host-opened.

---

## 8. HTTP API

Mounted at `/pi` (profile-scoped): sites CRUD/archive/hard-delete, pages create/patch/delete, temps preserve/discard, library, actions invoke, refresh, host-opened hook.

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
