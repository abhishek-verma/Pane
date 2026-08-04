# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

Pane is a monorepo with two largely independent subsystems under `packages/`:

- **`packages/browseros-agent/`** — the agent platform (TypeScript/Bun + one Go CLI). This is where almost all product work happens: MCP server, AI agent loop, Chrome extension UI, CLI, eval harness. **This is a separate workspace root** — it has its own `package.json` with Bun workspaces (`apps/*`, `packages/*`). There is no root `package.json` at the Pane repo level; all `bun run` commands below run from `packages/browseros-agent/`.
- **`packages/browseros/`** — the Chromium fork and Python build system (~100GB checkout, patches, signing, packaging). Only touch this for browser-level/native changes.

Nested `CLAUDE.md` files hold the detailed, current rules — read the one for whatever you're touching before making changes:

- `packages/browseros-agent/CLAUDE.md` — monorepo-wide TS conventions (extensionless imports, Bun-only, kebab-case, `@browseros/shared` constants, comment policy)
- `packages/browseros-agent/apps/server/CLAUDE.md` — Hono/MCP/CDP server internals, profile isolation, release gate
- `packages/browseros-agent/apps/app/CLAUDE.md` — WXT extension UI (TanStack Query, GraphQL codegen, forms, routing, CDP-based UI self-testing)
- `packages/browseros-agent/apps/cli/CLAUDE.md` — Go CLI (Go idioms apply here, not the TS rules above)
- `packages/browseros-agent/apps/eval/CLAUDE.md` — eval harness (suites, graders, agent evaluators)

`ARCHITECTURE.md` (repo root) is a thorough, current architecture reference — system diagrams, data flows, port map, on-disk state, CI/CD, release tags. Prefer it over `README.md` for anything structural: the README's older architecture section references `apps/controller-ext/` and `packages/agent-sdk/`, which no longer exist (see `ARCHITECTURE.md`'s "Doc Drift Notes"). `CONTRIBUTING.md` at the repo root similarly points to a `packages/browseros-agent/CONTRIBUTING.md` that does not exist — for agent contribution standards, use the nested `CLAUDE.md` files instead.

## Commands

All agent-platform commands run from `packages/browseros-agent/`.

**First-time setup:**
```bash
cd packages/browseros-agent
cp apps/server/.env.example apps/server/.env.development
cp apps/app/.env.example apps/app/.env.development
bun run dev:setup
```

**Dev loop:**
```bash
bun run dev:watch              # fixed dev ports, existing profile — Pane binary + extension HMR + server
bun run dev:watch -- --new     # random ports, fresh profile
bun run start:server           # server only (two-terminal manual workflow)
bun run start:agent            # extension only — load apps/app/dist/ in chrome://extensions
```

**Before pushing (from `packages/browseros-agent/`):**
```bash
bun run check      # lint (Biome) + typecheck + fallow (unused exports/circular deps/type leaks)
bun run test        # full suite (bun run test:all)
```

**Scoped test/check runs** (faster feedback than the full suite):
```bash
bun run test:main                          # server tools + integration only
cd apps/server && bun run test:agent       # or test:api / test:browser / test:tools
cd apps/app && bun run typecheck && bun run test
bun run --filter @browseros/eval test      # eval has its own suite; test:main does NOT cover it
cd apps/cli && gofmt -l . && go vet ./... && go build ./... && go test ./...
```

**Builds:**
```bash
bun run build             # build:server + build:agent
bun run build:server      # server binary (all targets), R2 upload
bun run build:server:test # local darwin-arm64, no upload — for quick artifact checks
bun run build:agent       # WXT production extension build
```

**Browser subsystem** (`packages/browseros/`, only for Chromium-level work):
```bash
cd packages/browseros
pip install -e .
browseros setup    # fetch Chromium source (~100GB)
browseros apply    # apply patches
browseros build    # compile
browseros package  # package distributable
browseros sign     # code signing
```

Chromium version is pinned in `packages/browseros/CHROMIUM_VERSION`.

## High-level architecture

The two subsystems connect at runtime over CDP:

```
Pane Chromium (CDP :9000)  <---CDP client---  Pane Server (:9100, Hono)
  loaded extension (apps/app)                    /mcp   -> browser-mcp -> browser-core -> CDP
                                                  /chat  -> AI SDK ToolLoopAgent + tools
                                                  /agents -> harness / ACP agents
```

- **`apps/server`** (`@browseros/server`) is the runtime hub: connects to Chromium as a CDP client (required at startup — pass `--cdp-port` or set `BROWSEROS_CDP_PORT`), registers MCP browser tools, runs the AI SDK agent loop, persists sessions in SQLite, serves HTTP for the extension and external MCP clients (Claude Code, Cursor, etc.). Entry: `src/index.ts` -> `Application` in `src/main.ts`.
- **`apps/app`** (`@browseros/app`) is the WXT/React extension: side panel chat, new-tab app (Home/Settings/Scheduled Tasks/MCP), onboarding, background worker, content scripts. Talks to the local server for chat/agents and to a cloud GraphQL API for providers/sync/credits.
- **`apps/cli`** (`browseros-cli`, Go) drives Pane from the terminal purely over MCP (`/mcp`) — same endpoint the extension uses. No direct browser access.
- **`apps/eval`** runs browser-automation benchmarks (WebVoyager, Mind2Web, AGI SDK, WebBench, BrowseComp) by driving agents through the same MCP/CDP loop and grading trajectories.
- **BrowserClaw** (`apps/claw-server`, `apps/claw-app`, `apps/claw-onboard`) is a parallel agent UI stack on port 9200; start with `bun run dev:claw:watch`.
- **Shared packages** (`packages/browseros-agent/packages/`): `@browseros/shared` (ports/paths/timeouts/limits/urls constants + Zod schemas — the single source of truth, don't scatter magic values), `@browseros/cdp-protocol` (generated CDP types, `bun run gen:cdp`), `@browseros/browser-core` (CDP connection, tab/session management), `@browseros/browser-mcp` (MCP tool registry — 16 browser tools; server adds filesystem/cowork tools on top for 53+ total).

Port defaults (production / dev / test): CDP `9000`/`9010`/`9005`, server `9100`/`9110`/`9105`, extension `9300`/`9310`/`9305`. Defined in `@browseros/shared/constants/ports` and mirrored in Chromium prefs — keep both in sync when changing a default.

On-disk runtime state lives under `~/.browseros/` (prod) or `~/.browseros-dev/` (dev): `db/browseros.sqlite`, `sessions/`, `tool-output/`, `server.json` (discovery). Server routes that touch user data require an `X-BrowserOS-Profile-Id` header and resolve per-profile paths via `AsyncLocalStorage` (`runWithProfile`) — see `apps/server/CLAUDE.md` for the profile-isolation model.

For anything beyond this summary — data flow sequence diagrams, full MCP tool list, CI workflow matrix, release tag conventions, external systems (Klavis, Sentry, PostHog, R2/CDN) — read `ARCHITECTURE.md`.

## Repo-wide conventions

- **Conventional Commits** are enforced by a lefthook `commit-msg` hook: `<type>(<scope>): <description>` with types `feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert`. PR titles are validated the same way in CI (`pr-title.yml`).
- Branch names should match `<type>/<short-description>` (lefthook `pre-push` warns otherwise), e.g. `feat/add-auth`, `fix/login-crash`.
- Files over 400 lines in `packages/browseros-agent/**/*.{ts,tsx}` trigger a pre-commit warning (not a hard block) to reconsider splitting.
- New contributions need the CLA signed on first PR (bot-driven; see `CLA.md`).
- `.internal-docs` is a private git submodule (team-only) — it may not be initialized in your clone; don't assume its contents are available.
