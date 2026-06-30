# Phase 2 Report — Trust & Workspaces

Status: **partial** — M2.1–M2.5 and M2.6 landed; M2.4 Promote polish and full ship-gate verification remain.

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| M2.1 Workspace object model | **done** | `Workspace`, terminal denylist, `buildFilesystemToolSet(workspace)` |
| M2.2 Trust gate | **done** | Single gate in `@browseros/shared/trust/consequence-class` + `apps/server/src/agent/trust/gate.ts`; applied at loop, filesystem MCP, browser MCP |
| M2.3 Action log | **done** | SQLite `action_log`, gate writes, `GET /action-log`, settings screen `#/settings/action-log` |
| M2.4 Approval UI + pins | **partial** | `ApprovalCard`, `addToolApprovalResponse` for write-local; dry-run preview + Promote sends follow-up message (not `__promoted` re-call yet); trust pins in Settings → Customize |
| M2.5 Terminal sessions | **done** | `sessions.ts`, `sessionId` on `filesystem_bash`, `terminal_sessions` list tool, `onTerminalSession` hook |
| M2.6 Multi-workspace UI + file browser | **done** | `#/workspaces`, sidebar switcher, `GET /workspace/files` + `GET /workspace/file`, TanStack Query file browser |
| M2.7 Trust invariants | **partial** | `tests/agent/trust-invariants.test.ts` covers deriveClass, decideGate, pins, blast radius — not full fuzz suite |

## `deriveClass` table (shipped)

| Class | Tools / conditions |
|-------|-------------------|
| `read` | `filesystem_read/ls/grep/find`; browser `tabs` list/active, `snapshot`, `screenshot`, `read`, `grep`, `diff`, `pdf`, `wait`, `windows`, `tab_groups`, `navigate`, `download`, `upload`, `run`, `evaluate`; nudge tools |
| `write-local` | `filesystem_write`, `filesystem_edit` (inside workspace) |
| `system` | `filesystem_bash`; `filesystem_write/edit` with path outside workspace (`..`, absolute) |
| `write-external` | `act` with mutating kinds (`fill`, `type`, `click`, etc.) |
| `spend` | `act` on payment-sensitive host (`pay`, `checkout`, `bank`, `stripe`, `paypal`) |

Escalation uses `ctx.browserContext.activeTab.url` and path heuristics only — never model output.

## AI SDK approval API

- Package: `ai` + `@ai-sdk/react@3.x`
- Symbol: `addToolApprovalResponse` on `useChat` / `AbstractChat` (`UseChatHelpers`)
- Server: `needsApproval` async on wrapped tools in `wrapToolWithGate` (`apps/server/src/agent/trust/gate.ts`) for `write-local` in loop surface
- UI parts: `approval-requested` / `approval-responded` on tool UI parts (see `getMessageSegments.ts`)

## Trust gate cross-package placement

- **Pure logic:** `packages/shared/src/trust/consequence-class.ts` — `deriveClass`, `decideGate`, `GateContext`, pins, blast radius
- **Loop gate:** `apps/server/src/agent/trust/gate.ts` — `wrapToolWithGate`, `gateExecute`, action log hooks
- **MCP gate:** `packages/browser-mcp/src/trust/mcp-gate.ts` — `gateMcpHandler` (preview/promote path)

## Tests run

```text
bun run check                          # green
cd apps/server && bun run test:tools:filesystem  # includes sessions.test.ts
cd apps/server && bun test tests/agent/trust-invariants.test.ts  # 13 pass
cd apps/server && bun test tests/tools/filesystem/sessions.test.ts  # 5 pass
```

Pre-existing failures: `tests/api/routes/index.test.ts` (`ChatService is not defined` in test helper) — unrelated to Phase 2.

## Ship gate checklist

1. Workspace-scoped tools + path sandbox — **yes** (M2.1)
2. Single trust gate on loop + MCP — **yes** (M2.2)
3. Consequence classes + dry-run — **yes** (M2.2)
4. Blast-radius cap + pins — **yes** server; pins UI in app
5. Action log SQLite + settings — **yes** (M2.3)
6. Approval UI — **partial** (M2.4 Promote)
7. Multi-workspace switcher + file browser — **yes** (M2.6)
8. Full test green — **no** (API test helper broken; M2.7 incomplete; no manual E2E)

## Deviations / follow-ups

1. **Promote path:** Dry-run Promote in UI sends a user message instead of re-invoking the tool with `__promoted: true`. MCP clients use `__promoted` in args as specified.
2. **MCP gate context:** Default empty pins per MCP request; no `trustPins` header yet.
3. **M2.4 Promote:** Dry-run Promote in UI sends a user message instead of re-invoking the tool with `__promoted: true`.
4. **Commits:** M2.1–M2.4 on `main`; M2.5/M2.6 in follow-up commits.

## BLOCKERS

None for human review / ship-gate sign-off — remaining:

- M2.4 polish: wire Promote to `__promoted` via tool replay or request side-channel
- Manual E2E: boot `pane`, approval → promote, workspace switch, action log
- Fix pre-existing `tests/api/routes/index.test.ts` helper
