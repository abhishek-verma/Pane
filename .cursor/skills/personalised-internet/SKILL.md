---
name: personalised-internet
description: >-
  Personalised Internet private sites/pages: DSL, write-path, pi_* tools,
  /pi API, refresh bus, templates, indexing. Use when working under
  personal-internet/, pi_* tools, #/pi routes, temp preserve, or PI specs.
---

# Personalised Internet

Private web **per browser profile**: durable sites + temp pages (structured DSL JSON, not freeform HTML). Agent authors via `pi_*`; home is only the front door (see **pi-home** skill).

Normative: [specs/20-personalised-internet.md](../../../specs/20-personalised-internet.md). Plan: `.llm/plans/2026-07-29-personalised-internet.md`.

## Compatibility locks

- One write path: `applyPiMutation` / `preserveTemp`  
- Register every `pi_*` in AI SDK tools, MCP, and `consequence-class` READ / WRITE_LOCAL  
- No LLM in `loadHome`  
- Home UI is PI doorways + composer — Adaptive Home widgets removed (see **pi-home**)

## Layout

| Area | Path |
| --- | --- |
| Domain | `apps/server/src/personal-internet/` |
| HTTP | `apps/server/src/api/routes/personal-internet.ts` → `/pi` |
| App screens | `apps/app/screens/personal-internet/` |
| Actions | `apps/app/lib/pi-actions.ts` |
| Host-opened | `apps/app/entrypoints/background/piHostOpened.ts` |
| Tests | `apps/server/tests/personal-internet/` |

## Tools

**Read:** `pi_list`, `pi_read`, `pi_pulse_get`  
**Write-local:** `pi_site_upsert`, `pi_page_create`, `pi_page_patch`, `pi_page_delete`, `pi_site_archive`, `pi_preserve_temp`, `pi_home_regions_patch`

Templates: `job-search`, `research-hub`, `sales-leads`. Create responses should include `route: '#/pi/...'`.

## Refresh

Kinds A–E in `personal-internet/refresh/`. Harvest (C) defaults **off** (`harvestEnabled`). Host filter must not use naive substring matching when changing policy.

## Verify

```bash
cd packages/browseros-agent/apps/server && bun test tests/personal-internet/ tests/home/
cd packages/browseros-agent/apps/app && bun run typecheck
```
