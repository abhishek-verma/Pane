---
name: pi-home
description: >-
  Pane home is the Personalised Internet front door (composer + doorways /
  continuity). Adaptive Home widgets were removed. Use when changing
  AgentCommandHome, PiHomeRegions, EmptyHomeState, /scheduler/home pi
  projection, home UI, or when someone mentions adaptive home widgets.
---

# PI Home (Personalised Internet front door)

## Product stance (lock)

Home is **not** a widget dashboard. It is the homepage of the user’s private web.

| Keep | Do not ship / restore |
| --- | --- |
| Composer on `#/home` (`ConversationInput`) | Adaptive Home widget grid / proposals / gallery |
| `PiHomeRegions` (doorways + Today continuity) | “Home widgets” settings / `+ Add widget` / `home_widget_*` |
| PI empty starters (create Job Search / Research hub via chat) | Ranking widgets as the product metaphor |
| Fast local open — **no LLM** inside `loadHome` / home fetch | Rebuilding Job Search / pipelines **on** the home page |

Specs: [20 — Personalised Internet](../../../specs/20-personalised-internet.md), [19 — Homescreen](../../../specs/19-homescreen-of-personal-internet.md).

## Current UI stack (`AgentCommandHome`)

1. Greeting + PI-aware subtitle  
2. `ConversationInput` (unchanged contract)  
3. If living work exists → `PiHomeRegions` from `home.pi`  
   Else → `EmptyHomeState` (PI site starters only)  
4. `RecentSites` + `ScheduleResults` (chrome around the front door)

Routes:

| Hash | Surface |
| --- | --- |
| `#/home` | Front door |
| `#/pi/library` | My sites |
| `#/pi/sites/:siteId` (+ `/pages/:pageId`) | Durable site/page |
| `#/pi/temp/:tempId` | Temp Keep/Discard |

`#/settings/home` redirects away — widget management UI was removed.

## Data

- Client fetch: `screens/newtab/home/home-data.ts` → `GET /scheduler/home`  
- Server: `loadHome()` returns `{ firstName, pi }` via `buildPiHomeProjection()`  
- Do not call `/chat` or models on home open (`home-loader-guard.ts`)

## Split of labor

- **Personal sites** (`pi_*` tools, `/pi/*`) = operable depth (boards, stages, records)  
- **Home** = arrival: pulse doorways + continuity callouts into those sites  
- Home must **not** become a second pipeline board

## When editing home

1. Prefer extending `PiHomeRegions` / home projection / PI templates — not resurrecting widgets.  
2. System callouts that aren’t campaign sites (e.g. pending approvals) should become homepage regions or native chrome later — not a return of the widget gallery.  
3. Empty home = calm + PI starters that **create sites**.  
4. Keep composer behavior and routing helpers (`routeHomeSend`, pending initial message) stable unless the user asks otherwise.

## Related code

- App: `screens/agent-command/AgentCommandHome.tsx`, `screens/newtab/home/PiHomeRegions.tsx`, `EmptyHomeState.tsx`, `home-data.ts`  
- Server: `personal-internet/home-projection.ts`, `scheduler/home.ts`  
- Removed (do not revive without product ask): `apps/server/src/home/*`, `home_widgets` tables, `home_widget_*` tools, AdaptiveHome UI
