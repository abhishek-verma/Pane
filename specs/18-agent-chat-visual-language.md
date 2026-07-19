# 18 — Agent Chat Visual Language

## Summary

Pane’s product UI — side-panel agent, new-tab agent surfaces, settings, and shared chrome — should feel like one **calm developer console**. Conversation prose stays primary in chat. Settings and home use the same restrained radius, hairline borders, and muted fills — not a stack of soft white rounded marketing cards.

Inspired by Hermes WebUI / Cursor-class agent UIs, adapted to Pane’s orange brand and Geist type.

> **Status:** implemented baseline on `feat/agent-chat-visual-language`.

---

## Goals

1. One visual language across chat, settings, home, and extension chrome.
2. Reduce “old school” heavy rounding; prefer small radii and square tool traces.
3. Keep progressive disclosure for tool evidence (spec 17).
4. Stay on-brand: one orange accent, Geist / Geist Mono, light + dark.

## Non-goals

- Pixel-cloning Hermes or Cursor.
- Redesigning onboarding video/marketing storytelling layouts (only inherit radius/tokens).
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
| Tool traces | **square** | none / hairline tint | **left rail 2px** only | none |
| Settings / home panels | `rounded-md` | `bg-card` or transparent | hairline | none (static) |
| Shared `Card` | `rounded-md` | `bg-card` | hairline | none by default |
| Composer field | `rounded-md` | muted | hairline | none |
| Modals / menus | existing dialog radius | popover | yes | allowed |

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
- Settings AI provider list and side-panel chat feel like the same product (radius, borders, no soft card gallery).
- Expanding a wide tool output scrolls inside the peek; the chat column does not shift horizontally.

---

## References

- Hermes WebUI [UIUX-GUIDE.md](https://github.com/nesquena/hermes-webui/blob/master/docs/UIUX-GUIDE.md) — calm console, tool rows as metadata, no transcript shadows.
- Pane [17 — Tool-call visibility](./17-agent-tool-call-visibility.md) — evidence content model.
- Pane [01 — Product principles](./01-product-principles.md) — “Show the work.”
