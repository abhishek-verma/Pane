# 18 — Agent Chat Visual Language

## Summary

The side-panel agent should feel like a **calm developer console**, not a stack of white rounded cards. Conversation prose stays primary. Tool work, reasoning, and status are quiet transcript metadata — inspectable, never decorative.

This standard applies to: side-panel chat, shared new-tab chat using the same components, tool-evidence rows, approvals, and the composer chrome. It does **not** redesign settings/home marketing cards.

Inspired by patterns from Hermes WebUI’s UI/UX guide (prose-first hierarchy, almost no transcript shadows, tool rows as disclosure not chat messages) and Cursor/Hermes-class agent UIs — adapted to Pane’s orange brand and Geist type.

> **Status:** implemented baseline on `feat/agent-chat-visual-language`.

---

## Goals

1. Remove the “soft white card stack” look from the agent transcript.
2. Make specialized tool evidence scannable as a **timeline rail**, not floating panels.
3. Keep progressive disclosure (peek → modal / expand) from [17](./17-agent-tool-call-visibility.md).
4. Stay on-brand: one orange accent, Geist / Geist Mono, light + dark.

## Non-goals

- Redesigning Settings, Adaptive Home widgets, or onboarding marketing cards.
- Pixel-cloning Hermes or Cursor.
- Introducing a new UI framework or large animation system.

---

## Hierarchy (most → least visual weight)

1. **Assistant prose** — plain left text, no bubble, no border.
2. **User message** — compact right-aligned tint (no shadow, soft radius only).
3. **Action-required** — approvals / errors (may use tint; must be noticed).
4. **Tool / activity traces** — left rail + quiet header; peeks are code strips.
5. **Chrome** — header/footer as hairlines + fade, not heavy bars.

---

## Shape & depth

| Surface | Shape | Fill | Border | Shadow |
|---------|-------|------|--------|--------|
| Assistant prose | none | none | none | none |
| User message | `rounded-md` (small) | muted tint only | none | none |
| Tool traces | **square** (`rounded-none`) | none / hairline tint | **left rail 2px** only | none |
| Diff peek / code | square | `muted/30` | none (inherits rail) | none |
| Composer field | `rounded-md` | `muted/40` | hairline | none |
| Modals / popovers | existing dialog radius | popover | yes | allowed |

**Rules**

- Transcript: **almost no shadows**. Shadows are for modals, menus, floating controls only.
- Prefer **either** a left rail **or** a subtle tint — never thick border + filled card + shadow together.
- Avoid nested rounded rectangles (card-in-card).
- Pills (`rounded-full`) only for true chips / primary circular actions (send, stop).

---

## Tool evidence (rail pattern)

Each specialized tool row:

```
│ status  title/path/caption          meta
│ peek / thumbnail / command output
│ secondary text actions
```

- Left rail color by kind (CSS tokens):
  - file → muted foreground / subtle
  - browser → accent orange at low alpha
  - terminal → muted
  - app-send → muted
  - error → destructive
- Status icon stays; title is mono for paths/commands, sans for captions.
- Diff peeks: mono strip, no rounded white well; fade at bottom optional.
- Screenshots: edge-to-edge under the caption, slight opacity; no padded photo frame.

Generics remain a quiet collapsible “N more steps” group — same rail family when expanded.

---

## Composer & chrome

- Composer sits on a **fade** from transcript (gradient), not a hard double border + card.
- Input: restrained `rounded-md`, muted fill, hairline focus ring using `--ring`.
- Header: thin bottom hairline; frosted ok if already present, keep light.

---

## Typography

- Prose: Geist sans, ~14px body.
- Paths, commands, diffs, tool names: Geist Mono, 11–12px.
- Meta (stats, “View in Action Log”): 10–11px muted.

---

## Motion

- Prefer opacity / color transitions ≤150ms.
- No bounce, scale-on-hover for routine rows, or glow pulses on tool cards.
- Streaming: existing typing indicator becomes a quiet three-dot row (no card).

---

## Tokens (CSS)

Defined in `apps/app/styles/global.css`:

| Token | Role |
|-------|------|
| `--agent-rail` | default left rail |
| `--agent-rail-browser` | browser / media traces |
| `--agent-rail-error` | error state |
| `--agent-user-bg` | user message tint |
| `--agent-trace-gap` | vertical gap between traces |

Utility classes: `.agent-trace`, `.agent-trace-browser`, `.agent-trace-error`, `.agent-user-bubble`, `.agent-composer-shell`.

---

## Do / don’t

**Do:** prose first; rail traces; one accent; progressive disclosure; tokenized colors.

**Don’t:** white `bg-card` stacks in the transcript; multi-layer shadows; pill clusters; purple glow; cream/terracotta editorial kitsch; nested rounded cards for every tool.

---

## Acceptance

- Side panel with a multi-tool turn reads as a timeline, not a card gallery.
- File peek + browser still + terminal row share one visual family.
- User can still open full diff modal and expand generics.
- Light and dark both remain legible.
- Spec 17 behavior unchanged; only chrome/visual weight changes.

---

## References

- Hermes WebUI [UIUX-GUIDE.md](https://github.com/nesquena/hermes-webui/blob/master/docs/UIUX-GUIDE.md) — calm console, tool rows as metadata, no transcript shadows.
- Pane [17 — Tool-call visibility](./17-agent-tool-call-visibility.md) — evidence content model.
- Pane [01 — Product principles](./01-product-principles.md) — “Show the work.”
