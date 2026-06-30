# Phase 2 Report — Trust & Workspaces

Status: **ready for human sign-off** — all modules implemented; automated verification green. Manual E2E in a running `pane` build still recommended before tagging v0.2.

## Module status

| Module | Status | Notes |
|--------|--------|-------|
| M2.1 Workspace object model | **done** | `Workspace`, terminal denylist, `buildFilesystemToolSet(workspace)` |
| M2.2 Trust gate | **done** | Single gate in `@browseros/shared/trust/consequence-class` + `apps/server/src/agent/trust/gate.ts`; applied at loop, filesystem MCP, browser MCP |
| M2.3 Action log | **done** | SQLite `action_log`, gate writes, `GET /action-log`, settings screen with **Replay** via `POST /trust/replay` |
| M2.4 Approval UI + pins | **done** | `ApprovalCard` with approve/deny/**edit args**/promote; promote + edited approve call `POST /trust/replay` with `__promoted: true` and patch tool output in the chat transcript |
| M2.5 Terminal sessions | **done** | `sessions.ts`, `sessionId` on `filesystem_bash`, `terminal_sessions` list tool, `onTerminalSession` hook |
| M2.6 Multi-workspace UI + file browser | **done** | `#/workspaces`, sidebar switcher, `GET /workspace/files` + `GET /workspace/file` |
| M2.7 Trust invariants | **done** | Core + fuzz path/payment escalation cases in `trust-invariants.test.ts` |

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
- **Promote / replay:** `POST /trust/replay` (`apps/server/src/api/routes/trust.ts`) executes tools with `__promoted: true` through `gateExecute`; app patches tool output via `patchToolInvocationOutput`
- UI parts: `approval-requested` / `approval-responded` on tool UI parts (see `getMessageSegments.ts`)

## Trust gate cross-package placement

- **Pure logic:** `packages/shared/src/trust/consequence-class.ts` — `deriveClass`, `decideGate`, `GateContext`, pins, blast radius
- **Loop gate:** `apps/server/src/agent/trust/gate.ts` — `wrapToolWithGate`, `gateExecute`, action log hooks
- **MCP gate:** `packages/browser-mcp/src/trust/mcp-gate.ts` — `gateMcpHandler` (preview/promote path)
- **Replay:** `apps/server/src/api/services/trust-replay.ts` — direct promoted execution for UI replay and action log

## Tests run (automated ship-gate evidence)

```text
bun run check                                              # green
cd apps/server && bun run test:agent                       # 327 pass
cd apps/server && bun run test:tools:filesystem            # 158 pass
cd apps/server && bun run test:api                         # 118 pass
cd apps/server && bun test tests/agent/trust-invariants.test.ts  # 24 pass
cd apps/server && bun test tests/api/services/trust-replay.test.ts
cd apps/app && bun run test                                # 285 pass
```

## Ship gate checklist

1. Workspace-scoped tools + path sandbox — **yes**
2. Single trust gate on loop + MCP — **yes**
3. Consequence classes + dry-run — **yes**
4. Blast-radius cap + pins — **yes** (server + Customize Pane UI)
5. Action log SQLite + settings + replay — **yes**
6. Approval UI (approve / edit / deny / promote) — **yes**
7. Multi-workspace switcher + file browser — **yes**
8. Full test green — **yes** (automated); manual E2E not run in CI agent session

## Deviations / follow-ups

1. **MCP trust pins:** Gate still uses empty pins per standalone MCP request; no `trustPins` header yet.
2. **Terminal sessions UI:** Server + `terminal_sessions` tool only; no dedicated app dropdown (allowed for v1).
3. **Manual E2E:** Boot `pane`, grant workspace, write file (approve/promote), bash dry-run → promote, path escape block, action log replay, workspace switch — recommended before release tag.

## BLOCKERS

None for human review. Phase 3 should not start until manual E2E sign-off.
