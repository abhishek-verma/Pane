# 21 — Living Grid Design System

## Summary

Pane has two kinds of surface and they should not look alike.

The **shell** — home, the agent side panel, settings, library — is strictly achromatic. Pure white in light mode, pure black in dark mode, structured only by hairlines and one signal accent. It is the frame around your work, not a destination.

A **place** — every Personalised Internet site and entity page — carries a chromatic *field*: a full-bleed background colour drawn from a family of ten. Walking from home into a place is a visible event. Two places never feel like the same page.

This spec defines the field family, how a place is assigned one, the typographic and structural grammar shared by both surface kinds, and the composer.

Supersedes the colour and surface rules in [18 — Agent Chat Visual Language](./18-agent-chat-visual-language.md). The hierarchy, tool-rail, and progressive-disclosure rules in spec 18 still stand.

> **Status:** tokens + composer + field assignment shipped. Brand rollout: citron replaces orange across extension icons, favicon, glow, Chromium welcome/toolbar paints, prefs chrome, README feature art/GIFs, poster, and solid-CTA contrast (`text-primary-foreground` on signal fills).

---

## Goals

1. One grammar across shell and places, so nothing looks like a different app.
2. Real character per place, achieved through hue and composition — never through a bespoke design.
3. Light and dark are equal citizens, not a filter applied to one another.
4. Chroma is load-bearing: seeing colour means "I am inside something."
5. Every existing composer control survives the redesign.

## Non-goals

- Per-page custom layouts or one-off page designs.
- A new UI framework, icon set, or animation system.
- Adding a typeface. Geist and Geist Mono are the system.

---

## 1. Surface kinds

| Surface kind | Routes | Background | Chroma |
|---|---|---|---|
| **Shell** | `/home`, `/home/chat`, `/settings/*`, `/pi/library`, side panel | `#FFF` light / soft charcoal dark (`oklch(0.16 …)`) | None. Achromatic greys only. |
| **Place** | `/pi/sites/:siteId`, `/pi/sites/:siteId/pages/:pageId`, `/pi/sites/:siteId/entities/:entityKey`, `/pi/temp/:tempId` | A field from the family below | Full-bleed, edge to edge |

The shell is the default: it lives in `:root` and `.dark`. A place opts in by rendering inside a `data-field` wrapper, which locally overrides the semantic tokens. Nothing downstream needs to know — `bg-card`, `bg-muted`, `border-border`, and `text-muted-foreground` all resolve against the field automatically.

**Places are full-bleed.** They escape the shell's `max-w-4xl` content wrapper, because a field that stops short of the viewport edge reads as a card and defeats the point.

---

## 2. The field family

Ten fields. Each is a single seed colour; every surface tint in the page derives from it, which is what makes a place feel cut from one material rather than assembled from cards.

| Field | Light (paper) | Dark (pigment) | Reads as |
|---|---|---|---|
| `rust` | `#F4E7E2` | `#241514` | red |
| `ember` | `#F6EADF` | `#26190F` | orange |
| `amber` | `#F5EEDC` | `#241E0E` | yellow |
| `clay` | `#EFE9DD` | `#211B12` | warm neutral |
| `moss` | `#E8EDDF` | `#182014` | green |
| `petrol` | `#E1EBE7` | `#0F2320` | teal |
| `dust` | `#E4E9F2` | `#131A2B` | blue |
| `iris` | `#E9E6F3` | `#1B1729` | violet |
| `plum` | `#F1E5EE` | `#231621` | magenta |
| `slate` | `#E7E8EC` | `#16171B` | cool neutral |

**Light mode is paper, not pastel.** Every light field sits at roughly `L 0.93` with chroma between `0.012` and `0.022`. That is the range where a colour reads as pigmented uncoated stock. Push chroma higher and it becomes a washed-out 2010s pastel; drop it lower and the ten fields stop being distinguishable.

**Dark mode is pigment, not grey.** Every dark field sits at roughly `L 0.19` with chroma between `0.022` and `0.030`. Clearly hued, never muddy, never pure black — pure black is reserved for the shell so the shell/place distinction survives in dark mode.

Because both modes hold a fixed lightness, the ten fields are tonally interchangeable. Swapping a place's field changes its character without changing its legibility or layout.

### Derived tints

Each field derives its own surfaces via CSS relative colour, so adding a field means writing one value:

```
background        = field
card / popover    = field, lightness +0.025
muted / secondary = field, lightness -0.030   (light)  /  +0.045 (dark)
border / input    = field, lightness -0.10, chroma ×2   (light)
                    field, lightness +0.11, chroma ×1.6 (dark)
foreground        = field hue at L 0.16 (light) / L 0.94 (dark)
muted-foreground  = field hue at L 0.47 (light) / L 0.66 (dark)
```

Ink is tinted by the field hue rather than neutral. It is a small thing that does most of the work: neutral grey text on a coloured field is what makes a tinted page look like a stylesheet accident.

---

## 3. Signal

One accent, named `--signal`. It marks agent liveness and progress and nothing else: live dots, progress rails, the send button, focus rings, shimmer placeholders for sections still being written.

| Context | Signal | Why |
|---|---|---|
| Shell + cool/dark fields | citron `#C8E832` | maximum separation from achromatic and from cool hues |
| Paper fields (light) | deep citron `#94B316` | bright citron has no contrast on light paper |
| `amber` + `moss`, light | olive ink `#5F6B18` | citron dies on warm yellow-green |
| `amber` + `moss`, dark | ivory `#F2EFE4` | citron on dark olive is invisible |

Three token values resolved per field, not a per-page judgement call.

> **Brand note:** citron replaces the legacy BrowserOS orange as the product accent. `--accent-orange` is aliased to `--signal` so the ~150 existing call sites move in one step. The original orange is preserved as `--accent-orange-legacy`; reverting is a one-line change in `global.css`.

---

## 4. Field assignment

A place's field is a **stable hash of its identifier**. Deterministic, so a place looks the same on every visit and on every device, and no migration or stored preference is needed.

| Page | Hash input |
|---|---|
| Site page | `siteId` |
| Entity page | `siteId + ':' + entityKey` |
| Temp page | `tempId` |

**Entity pages get their own field, not the parent's.** A company page should feel like that company's own site rather than a sub-page of a board. Including `siteId` in the entity hash keeps two entities with the same key under different sites visually distinct.

The hash is FNV-1a over the identifier, modulo the field count. Field order in the family array is therefore load-bearing: reordering it reassigns every existing place. Append new fields, never insert.

---

## 5. Structural grammar

Shared by shell and places, which is what makes them one product.

**Top rail.** Full width, 1px bottom hairline. Left: breadcrumb in mono, uppercase, `PANE / JOB SEARCH / GREYORANGE`. Right: live state in mono with a signal dot, plus any page-level action as a small bordered mono button.

**Type.** Geist for names, headings, and prose. Geist Mono for all metadata: breadcrumbs, section numbers, counts, timestamps, statuses, table column headers, tool names. The split is absolute — mono means "this is machine truth", sans means "this is content". Section headers are numbered mono (`01 OVERVIEW`), which gives a page an implicit table of contents and makes progressive loading legible.

**Structure by division, not by elevation.** Regions are separated by 1px hairlines, not by shadows, gaps, or nested rounded cards. No card-in-card. Radius stays at `--radius` (6px); `rounded-full` is reserved for the send button and true status dots.

**Progress rail.** Directly under a place's masthead: N equal segments split by hairlines, filled in signal as sections complete, with tiny mono labels beneath. This is how above-the-fold-first loading is expressed. A section still being written shows a signal shimmer bar in place of its content; a section not yet started shows an empty bordered region with muted mono `04 PEOPLE — QUEUED`. No spinners anywhere.

**Asymmetric two-column body.** Wide left for content, narrow right for sources, actions, and queued sections. Divided by a hairline that runs the full height.

---

## 6. Composer

One component in spirit, two implementations in fact: `ConversationInput` (home + agent conversations) and `ChatInput`/`ChatFooter` (side panel + `/home/chat`). They must stay visually identical, at slightly different scale.

**Shape.** A single bordered console. Not a stack of boxes. No one-sided accent borders on rounded corners — they read as unfinished.

**Density.** Compact. Input at 14px on a 32px minimum line. One control row directly beneath, no dead space between them, no dead space below. Total resting height around 100px on home, 90px in the panel.

**Controls are unboxed.** The provider selector is the only bordered control, because it is the one that names your model. Everything else — workspace, tabs, attach, apps, mic, voice — is a bare icon-and-label with a hover region, grouped tightly at the left and separated by short hairline dividers where the grouping changes meaning. They should not be evenly distributed across the width; even distribution is what made the previous version read as a spreadsheet toolbar.

**Send** is a circular signal button at the far right, the only round element on the surface.

**No keyboard hints.** The `↵ to run · ⇧↵ new line` row is removed. It occupied a full row to teach something learned once.

**Nothing is removed.** Provider selector, workspace selector, tabs picker, attach, apps/MCP link, dictation mic, voice mode, stop-while-streaming, attachment chips, drag-and-drop, and the side panel's `@`-mention and chat/agent toggle all remain.

---

## 7. Rules

1. Chroma means "inside a place." Never tint the shell. The shell is white or soft charcoal, not pure black.
2. A place gets exactly one field. Never two hues on one page.
3. Derive surfaces from the field seed. Never hand-pick a tint.
4. One signal per field, resolved by token. Never a second accent.
5. Divide with hairlines. Never elevate with shadows in the transcript or on a page.
6. Mono is metadata, sans is content. No exceptions.
7. Fields are full-bleed. A field inside a content wrapper is a card, and a card is not a place.
