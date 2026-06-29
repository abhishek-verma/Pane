# Pane Rebrand — Step 0 Implementation Plan

> **For agentic workers:** Implement this plan stream-by-stream, task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each stream is independently implementable and testable. **Read the "Three classes of BrowserOS" section first** — it defines what changes and what must not.

**Goal:** Replace every **user-facing** instance of the BrowserOS brand (icons + display text) with Pane, using `assets/branding/pane-mark.svg` and `assets/branding/pane-wordmark.svg` as the canonical sources, so that no user ever sees "BrowserOS" anywhere in the shipped product — while leaving internal identifiers and infrastructure untouched (documented as tech debt).

**Architecture:** A rebrand sweep across four layers — (1) React extension UI (mostly done), (2) the docs site, (3) the Go CLI + contributor metadata, (4) native Chromium C++ strings + the raster icon set + build/CI display names. Canonical SVGs live in `assets/branding/`; everything else derives from them. A single source-of-truth rule eliminates the duplicate/orphan assets that exist today.

**Tech Stack:** SVG (`assets/branding/`), `resvg` (PNG export via `export-pngs.sh`), `verify-pngs.swift` (PNG QA), WXT (extension manifests/HTML), Mintlify (`docs/docs.json`), Go (CLI), Chromium C++ patches + Python build (`packages/browseros/`).

---

## The three classes of "BrowserOS" (read first)

The word "BrowserOS" appears in the repo in three different senses. **Only class 1 changes in this plan.**

| Class | Examples | Action in this plan |
|-------|----------|---------------------|
| **1. Product brand (user-facing)** | Icons, wordmark, UI copy, docs prose, CLI prose, native About/crash/keychain/installer strings, build artifact *display* names, docs logos | **→ Pane** (every stream below) |
| **2. Substrate identifiers (internal)** | `@browseros/*` package scopes, `chrome://browseros/*` URLs, `chrome.browserOS` API, `~/.browseros/` dir, `BROWSEROS_*` env vars, `browseros-cli` / `browseros-server` binary names, `com.browseros.BrowserOS` bundle ID, `packages/browseros*` dir names, C++ `browseros::` namespaces, `uv run browseros build` | **Keep** — documented tech debt. Renaming is high-churn and/or breaking (auto-update continuity, install paths, env contracts). Tracked in "Deep-native track" at the end, not executed here. |
| **3. Infrastructure (domains/org)** | `browseros.com`, `docs.browseros.com`, `cdn.browseros.com`, `files.browseros.com`, `api.browseros.com`, GitHub org `browseros-ai/BrowserOS` vs `browseros-ai/Pane` | **Separate migration track** — not prose, not this plan. Flagged at the end. |

**The rule for every edit:** if a user would *see or copy* the string, it becomes Pane. If a machine or a developer-typed path/env reads it, it stays (class 2) unless explicitly called out.

---

## Decision gates (resolve before starting)

These need a product call. Defaults are given; the plan assumes the defaults.

- [ ] **G1 — Rename the `browseros-cli` binary / npm package to `pane`?** *Default: keep the binary name `browseros-cli` for now (breaking for installed users); only fix user-facing prose to say "Pane".* If yes, it becomes a separate breaking-change release.
- [ ] **G2 — Change the MCP server slug `browseros` → `pane` in copied `claude mcp add` / `codex mcp add` snippets?** *Default: yes (users copy it), and keep a `browseros` alias on the server so existing setups don't break.* This is a coordinated cross-package change (S3 + S4).
- [ ] **G3 — Rebrand claw-app?** *Default: minimal only.* Per `IMPLEMENTATION-PLAN.md` §9.7, claw-app is **not bundled in Pane builds**, so a full claw-app rebrand is low-value now. Do only the manifest `name` + a favicon so it isn't embarrassing if seen; defer the rest.
- [ ] **G4 — Native install paths, bundle ID, `chrome://pane` alias?** *Default: no — these are class 2 / breaking. Leave to the "Deep-native track".* This plan only fixes native *display* strings.

---

## Canonical assets (source of truth)

| Asset | Path | Role |
|-------|------|------|
| Pane mark (mono, `currentColor`) | `assets/branding/pane-mark.svg` (viewBox `0 0 100 100`) | The mark, all contexts |
| Pane mark black / white | `assets/branding/pane-mark-black.svg`, `pane-mark-white.svg` | Raster PNG export inputs |
| Pane wordmark | `assets/branding/pane-wordmark.svg` (viewBox `0 0 78 36`, "Pane.") | Wordmark, all contexts |
| Pane extension icon | `assets/branding/pane-extension-icon.svg` (orange rounded rect + white mark) | Extension/toolbar/favicon |

**Rule:** every other copy of these (`apps/app/assets/pane-mark.svg`, `docs/logo/pane-mark.svg`, the inlined geometry in `PaneMark.tsx`) must either be deleted in favor of the canonical file or verified byte-identical. No divergent copies.

---

# Stream S0 — Asset preparation

**What:** Lock the canonical SVGs and generate the complete PNG set (all sizes, mark + wordmark + extension icon) from them, so every downstream stream can pull from one place.

- [ ] **S0.1 — Extend `assets/branding/export-pngs.sh`** to also export `pane-wordmark.svg` and `pane-extension-icon.svg`, and add the missing Chromium sizes (22, 24, 48, 192, 1024) alongside the existing 16/32/64/128/256/512. Output to `assets/branding/png/` with clear names (`pane-mark-black-<size>.png`, `pane-mark-white-<size>.png`, `pane-wordmark-<size>.png`, `pane-extension-icon-<size>.png`).
- [ ] **S0.2 — Run the export and verify with `assets/branding/verify-pngs.swift`.** Expected: every size renders the correct geometry; no blank/off-center PNGs. Commit the PNGs.
- [ ] **S0.3 — Remove orphan/duplicate SVGs** that are not the canonical source: `apps/app/assets/pane-mark.svg` (orphan, no imports), and decide on `apps/app/assets/product_logo.svg` (legacy name, Pane content, no imports → delete). Keep `docs/logo/pane-mark.svg` + `pane-wordmark.svg` only if S5 wires them; otherwise delete and reference canonical.
- **How to test:** `ls assets/branding/png/` shows the full matrix; `verify-pngs.swift` exits 0; `rg "pane-mark.svg|product_logo.svg" apps/app` returns no UI imports (only canonical refs remain).

---

# Stream S1 — Extension app icons + favicons (`apps/app`)

**What:** The extension's toolbar icon, manifest icons, and HTML favicons are Pane, generated from `pane-extension-icon.svg`, with no BrowserOS/WXT leftovers.

- [ ] **S1.1 — Regenerate `apps/app/icon/{16,32,48,128}.png`** from `pane-extension-icon.svg` (S0 outputs). These are already referenced by `wxt.config.ts:49-52` and `entrypoints/app/index.html:7-9,18`.
- [ ] **S1.2 — Regenerate `apps/app/public/favicon.png`** from the same source; already referenced at `entrypoints/app/index.html:10`.
- [ ] **S1.3 — Add the favicon to the sidepanel shell:** `apps/app/entrypoints/sidepanel/index.html` currently references `icon/32.png` + `icon/128.png` but not `/favicon.png` — add it for parity with the app shell.
- [ ] **S1.4 — Remove the unreferenced `apps/app/public/icon-32.png`** (orphan) and confirm `wxt.svg` is gone (git status says deleted).
- **How to test:** `bun run dev:watch`, load the extension → toolbar icon, new-tab favicon, sidepanel favicon all show the Pane mark. `rg "wxt.svg|product_logo.svg" apps/app` → none. Manifest icons resolve (Chrome extensions page shows the Pane icon at every size).

---

# Stream S2 — claw-app manifest + icons (minimal, per G3)

**What:** claw-app isn't bundled in Pane builds, but if seen it shouldn't say BrowserOS/claw-legacy.

- [ ] **S2.1 — `apps/claw-app/wxt.config.ts`:** set `manifest.name` from `'browserclaw'` → `'Pane Agents'` (line 14) and `manifest.action.default_title` → `'Pane Agents'` (line 27); add `manifest.icons` + `manifest.action.default_icon` pointing at a `claw-app/icon/` set generated from `pane-extension-icon.svg` (S0).
- [ ] **S2.2 — `apps/claw-app/entrypoints/newtab/index.html`:** add favicon links (`icon/32.png`, `icon/128.png`); `<title>` is already `Pane Agents`.
- [ ] **S2.3 — claw-app `PaneWordmark` hardcodes `"Pane"`** instead of importing `PRODUCT_NAME` — minor; leave unless claw-app gets a `product.ts` (not now).
- **How to test:** `bun run dev:claw:watch`, load claw-app → toolbar icon + new-tab favicon + title are Pane. (Do not spend more here — claw-app is deprioritized per G3.)

---

# Stream S3 — App UI display text + copy-paste MCP snippets (`apps/app`)

**What:** Every user-visible string and every string the user copies says Pane. This is the highest-risk stream because of the MCP slug (G2).

- [ ] **S3.1 — MCP CLI/config snippets (`apps/app/screens/mcp-settings/QuickSetupSection.tsx`):** lines 42, 55, 74, 89 — change the `browseros` JSON key and the `claude mcp add --transport http browseros <url>` / `codex mcp add browseros <url>` server slugs to `pane`. **Depends on S4.1** (server `BROWSEROS_MCP_SERVER_NAME`) so the copied command actually works.
- [ ] **S3.2 — Community + agent URLs:** `apps/app/lib/constants/productUrls.ts:70` (`https://discord.gg/browseros`) and `:75` (`https://dub.sh/browserOS-slack`) → Pane Discord/Slack invites (class 3 — get the real URLs from the infra track; if unavailable now, leave a `TODO(pane-infra)` and hide the links rather than ship BrowserOS ones). `apps/app/modules/chat/chat-types.ts:32,38` agent-suggestion URLs (`dub.sh/browseros-launch`, `git.new/browseros`) → Pane URLs.
- [ ] **S3.3 — Mock/demo strings:** `apps/claw-app/modules/api/run.hooks.ts:198` ("…the BrowserOS launch.") → "…the Pane launch." Sweep `apps/app` + `apps/claw-app` for any other mock fixture strings.
- [ ] **S3.4 — Rate-limit matcher:** `apps/app/screens/sidepanel/index/ChatError.tsx:67` matches `'BrowserOS LLM daily limit reached'`. Under the Pane build (hosted inference off, per `IMPLEMENTATION-PLAN.md` M1.2) this string won't occur, but update the matcher to `'Pane LLM daily limit reached'` in lockstep with S4.3.
- [ ] **S3.5 — JSDoc/comments + file headers:** `apps/app/lib/tool-labels.ts:3` ("Copyright 2025 BrowserOS") and claw-app file headers → "Pane". `apps/app/screens/ai-settings/BrowserOsAiPane.tsx:101` + `AISettingsPage.tsx:5` JSDoc "BrowserOS AI pane" → "Pane AI pane".
- [ ] **S3.6 — Rename the `BrowserOsAiPane` component** → `PaneAiPane` (file + import sites). Deprecate the `BrowserOSIcon` export alias in `apps/app/lib/llm-providers/providerIcons.tsx:78-93` (keep a re-export for one release, then remove).
- **How to test:** Manual — open `#/settings/mcp`, copy the `claude mcp add` command, run it → Claude Code lists the server as `pane` and connects. `rg -i "BrowserOS" apps/app --type ts --type tsx -g '!*.test.*'` returns only class-2 identifiers (`chrome.browserOS`, `BROWSEROS_*`, storage keys) and the deliberate `BrowserOSIcon` alias. The agent suggestion labels render with Pane URLs (or are hidden).

---

# Stream S4 — Server display strings (`apps/server`, `claw-server`)

**What:** Server-emitted user-facing strings say Pane; the MCP server slug change (G2) lands here so S3's copied commands work.

- [ ] **S4.1 — MCP server slug:** find `BROWSEROS_MCP_SERVER_NAME = 'browseros'` (claw-server `src/shared/mcp-url.ts:24` and the server MCP manager) → set to `'pane'`, and **register `browseros` as a compat alias** so existing `claude mcp add browseros …` setups still resolve. This unblocks S3.1.
- [ ] **S4.2 — `packages/browseros-agent/server.json:3`** `"BrowserOS MCP Server"` → `"Pane MCP Server"`.
- [ ] **S4.3 — OAuth success HTML:** `apps/server/.../callback-server.ts:69,181` ("BrowserOS instances", "return to BrowserOS") → "Pane".
- [ ] **S4.4 — Rate-limit error string:** the server string that `ChatError.tsx` matches (S3.4) → emit `'Pane LLM daily limit reached'`.
- **How to test:** `curl /mcp` handshake shows "Pane MCP Server". Trigger the OAuth success page → says Pane. `claude mcp add pane <url>` and `claude mcp add browseros <url>` both connect (alias works). Unit test asserting the alias resolves.

---

# Stream S5 — Docs site (Mintlify)

**What:** The docs site shows Pane logos and Pane repo links; legacy BrowserOS logos are gone.

- [ ] **S5.1 — `docs/docs.json`:** replace `docs/logo/favicon.png` (line 10) and `docs/logo/logo44.png` (lines 70-71 navbar light/dark) with Pane exports from S0 (use `pane-mark` for favicon; for the 44px navbar use the wordmark or a padded mark — wordmark is 78×36, so export a dedicated `pane-nav-44.png` or use `pane-mark` at 44). Point at `docs/logo/pane-mark.svg` / `pane-wordmark.svg` where Mintlify accepts SVG.
- [ ] **S5.2 — Remove/archive legacy docs logos:** `docs/logo/browseros.svg`, `docs/logo/light.svg`, `docs/logo/dark.svg` → delete (after confirming nothing references them post-S5.1).
- [ ] **S5.3 — Footer/socials + repo links:** `docs/docs.json` footer `socials.github` is `BrowserOS-ai/BrowserOS` (stale — `browseros-ai/Pane` is used elsewhere) → unify to the Pane repo; `navbar.primary.href` `https://browseros.com` → Pane download URL (class 3 — use real URL when available, else `TODO(pane-infra)`).
- [ ] **S5.4 — `docs/contributing.mdx`:** unify repo links to `browseros-ai/Pane` (issues/discussions) — currently mixed. Keep `cd packages/browseros` + `uv run browseros build` (class 2).
- [ ] **S5.5 — `docs/troubleshooting/connection-issues.mdx`:** change the Windows search hint "search **browseros agent**" → "search **Pane agent**". Keep image filenames (`…browseros-agent.png`) unless S5.6.
- [ ] **S5.6 — (Optional, cosmetic) rename docs images** with `browseros` in the filename (`about-browseros.png`, `features--browseros-mcp-settings.png`, `adblock-browseros.png`) → Pane names; update the mdx references. Low priority.
- **How to test:** `mintlify dev` (or build) → navbar logo, favicon, footer social links all Pane; no `browseros.svg`/`light.svg`/`dark.svg` referenced. `rg -i "browseros" docs/docs.json` → only the kept `chrome://browseros` URL refs in feature mdx (class 2), none in config/logo fields.

---

# Stream S6 — Go CLI user-facing prose

**What:** The CLI's help, errors, setup wizards, and embedded agent guide say "Pane"; the binary name `browseros-cli` and bundle ID stay (G1, G4).

- [ ] **S6.1 — `apps/cli/cmd/root.go`:** `Short: "Browser control CLI for BrowserOS"` → "…for Pane"; `Long` "browseros-cli — … controlling BrowserOS via MCP" → "controlling Pane via MCP"; flag help "BrowserOS server URL" → "Pane server URL"; the error block "Open BrowserOS Settings > BrowserOS MCP" / "If BrowserOS is closed" / "download from https://browseros.com" → Pane labels (keep `chrome://browseros/mcp` URL — class 2; download URL is class 3 → `TODO(pane-infra)` or keep).
- [ ] **S6.2 — `cmd/init.go`, `cmd/launch.go`, `cmd/health.go`, `cmd/info.go`:** replace all "BrowserOS" product prose with "Pane" (setup wizard titles, "Launch the BrowserOS application", "BrowserOS is already running", health/info headings). **Keep** `browserOSBundleID = "com.browseros.BrowserOS"`, `/Applications/BrowserOS.app`, `%LOCALAPPDATA%\BrowserOS\…` paths (class 2, G4).
- [ ] **S6.3 — `cmd/llm_txt.md`** (embedded agent guide): "drives BrowserOS" / "start BrowserOS" / "BrowserOS > Settings > BrowserOS MCP" → Pane prose; keep `chrome://browseros/mcp`.
- [ ] **S6.4 — `update/manager.go`, `mcp/client.go`, `config/config.go`:** product prose → Pane; keep "browseros-cli is up to date" / `npm update -g browseros-cli` / `~/.config/browseros-cli/` (binary name + paths, G1).
- [ ] **S6.5 — Install scripts + READMEs:** `apps/cli/scripts/install.sh` + `install.ps1` prose ("Installing browseros-cli", "Add browseros-cli to your PATH") → "Pane CLI (browseros-cli)" wording; keep the binary name + `cdn.browseros.com` (class 3). `apps/cli/npm/README.md` + `apps/cli/README.md` → full Pane doc pass.
- [ ] **S6.6 — `apps/cli/npm/package.json`:** `description` "…controlling BrowserOS…" → "…controlling Pane…"; add `pane` to `keywords`; keep `name: browseros-cli`, `bin: browseros-cli/bos` (G1). `repository`/`homepage`/`bugs` → Pane repo (class 3).
- **How to test:** `go build && ./browseros-cli --help`, `./browseros-cli info`, `./browseros-cli launch --help` → all prose says Pane, no "BrowserOS" except kept identifiers. `rg -i "BrowserOS" apps/cli --type go` returns only class-2 identifiers (bundle ID, paths, binary name, CDN URL).

---

# Stream S7 — Native Chromium user-facing strings (C++)

**What:** Native strings a user sees (crash reporter, Keychain, Windows installer/updater, macOS product dir, disclosure strings, bundled-extension labels) say Pane. Class-2 native identifiers (URLs, API, namespaces, install paths, bundle ID) stay (G4).

- [ ] **S7.1 — Crash reporter:** `packages/browseros/chromium_patches/chrome/app/chrome_crash_reporter_client.cc:18-35` (`BrowserOS_Android`/`BrowserOS_Linux`/`BrowserOS_Mac`/`BrowserOS`) and `chrome_crash_reporter_client_win.cc:23` (`"BrowserOS"`) → `Pane_*` / `"Pane"`.
- [ ] **S7.2 — Windows updater:** `chrome/browser/win/winsparkle_glue.cc:281` (`L"BrowserOS", L"BrowserOS"`) → `L"Pane", L"Pane"`.
- [ ] **S7.3 — Windows install ProgID descriptions:** `chrome/install_static/chromium_install_modes.h:10,23-35` (`L"BrowserOS"`, `L"BrowserOS HTML Document"`, `L"BrowserOS PDF Document"`) → `L"Pane"`, `L"Pane HTML Document"`, `L"Pane PDF Document"`. **Keep** `kProductPathName[] = L"BrowserOS"` (install path — class 2, G4).
- [ ] **S7.4 — macOS product dir + Keychain:** `chrome/app/app-Info.plist:20` `CrProductDirName` `BrowserOS` → `Pane` (this is the `~/Library/Application Support/<name>` folder — **decide**: changing it moves user data; if keeping the old dir for continuity, leave it and mark G4). `components/os_crypt/common/keychain_password_mac.mm:12-13` ("BrowserOS Safe Storage", "BrowserOS") → "Pane Safe Storage", "Pane" (visible in Keychain Access).
- [ ] **S7.5 — Extension maintainer disclosure strings:** `chromium_patches/.../browseros_extension_maintainer.cc:50,56,61` ("BrowserOS Extension Maintainer", …) → "Pane Extension Maintainer".
- [ ] **S7.6 — Bundled extension labels:** `packages/browseros/build/modules/extensions/bundled_extensions.py:25-28` ("BrowserOS bug reporter", "BrowserOS agent", "BrowserOS Claw app") → "Pane bug reporter", "Pane agent", "Pane Claw app".
- [ ] **S7.7 — Welcome/about page URL-in-copy (cosmetic):** `browseros_welcome.h` page copy is already Pane, but references `chrome://browseros-*` URLs in instructive copy. Keep the URL scheme (class 2); only fix any prose that literally says "BrowserOS" as a product name (audit the welcome HTML).
- **How to test:** Build a dev Chromium (`uv run browseros build` then run) → open About → says Pane; trigger a crash → crash reporter product name is Pane; on macOS, Keychain shows "Pane Safe Storage"; on Windows, the updater UI + ProgID descriptions say Pane. `rg -i "BrowserOS" packages/browseros/chromium_patches --type cpp` returns only class-2 identifiers (namespaces, `kBrowserOS*` constants, `chrome://browseros`).

---

# Stream S8 — Chromium raster icon set

**What:** The browser's own dock/taskbar/About icons are Pane at every size, generated from the canonical mark. (The vector toolbar icon `kPaneMarkIcon` is already done.)

- [ ] **S8.1 — Run icon generation** from `packages/browseros/build/scripts/icon_generation/source/app_icon.svg` (Pane) per `build/scripts/icon_generation/README.md` → produces the full `product_logo_*` PNG tree (16/22/24/32/48/64/128/192/256/512/1024) into `packages/browseros/resources/icons/`.
- [ ] **S8.2 — Regenerate platform icon bundles:** macOS `.icns` + `Assets.xcassets` (`resources/icons/mac/`), Windows `.ico` + tiles `Logo.png`/`SmallLogo.png` (`resources/icons/win/`), Linux `.xpm` (`resources/icons/linux/`) — all from the S8.1 output.
- [ ] **S8.3 — Sync the `chromium_files/` mirror:** `packages/browseros/chromium_files/chrome/app/theme/chromium/product_logo_*` must match `resources/icons/` (both are checked in). Also confirm `packages/browseros/resources/icons/product_logo.svg` + `build/scripts/icon_generation/static/product_logo.svg` are the Pane SVG.
- [ ] **S8.4 — Verify `build/config/copy_resources.yaml:43-89`** picks up the regenerated set (it copies `product_logo_*` into Chromium theme) and `build/modules/package/linux.py:274,325-327` references resolve.
- **How to test:** Build + launch the dev browser → dock/taskbar icon, About page logo, installer icon all show the Pane mark at every size (no blurry/wrong logos). `verify-pngs.swift` on the regenerated set. Visual check at 16px (hardest size) — the mark must still read.

---

# Stream S9 — Build artifact *display* names + CI

**What:** Human-readable release/CI labels say Pane; artifact *filenames* (`BrowserOS_v*.dmg` etc.) stay until the binary-rename track (class 2, G1/G4).

- [ ] **S9.1 — DMG volume + signing labels:** `build/modules/package/macos.py:59,75,341` and `merge.py:211` (DMG volume "BrowserOS") → "Pane"; `build/modules/sign/macos.py:717,1041` ("BrowserOS", "BrowserOS Dev") → "Pane", "Pane Dev".
- [ ] **S9.2 — `build/common/context.py:157,205`** `BROWSEROS_APP_BASE_NAME = "BrowserOS"` — this drives the `.app` name and DMG. **Decide (G4):** changing it renames the .app (breaking for launch paths, bundle ID). *Default: leave the internal base name, but set a separate `PANE_DISPLAY_NAME = "Pane"` for user-facing labels* so artifacts still say Pane to humans without breaking paths.
- [ ] **S9.3 — CI workflow titles + release notes:** `release-server.yml`, `release-agent-extension.yml`, `release-cli.yml`, `nightly-macos-build.yml`, `nightly-release.yml`, `eval-weekly.yml` — workflow *names* and GitHub release *titles/bodies* ("Release BrowserOS Server", "BrowserOS Server - v…", "point CLI at your BrowserOS MCP server") → Pane. Keep artifact filenames and `cdn.browseros.com` (class 2/3).
- **How to test:** Trigger a nightly build → the GitHub release title and DMG volume name say Pane; the `.app` still launches from the unchanged path. `rg -i "BrowserOS" .github/workflows` returns only artifact filenames / CDN URLs.

---

# Stream S10 — Contributor + repo metadata

**What:** Contributor-facing docs and package metadata say Pane; `@browseros/*` scopes and `browseros-cli` npm name stay (class 2, G1).

- [ ] **S10.1 — `CONTRIBUTING.md` (root):** title "Contributing to BrowserOS" + body → "Contributing to Pane".
- [ ] **S10.2 — `.github/`:** `ISSUE_TEMPLATE/feature_request.md`, `ISSUE_TEMPLATE/01-bug.yml` ("bug report for BrowserOS", "BrowserOS Version"), `ISSUE_TEMPLATE/config.yml`, `SECURITY.md` → Pane.
- [ ] **S10.3 — `CLAUDE.md` files:** `packages/browseros-agent/CLAUDE.md` + `apps/*/CLAUDE.md` → Pane (contributor ground rules).
- [ ] **S10.4 — `.cursor/skills/*`:** `test-ui/SKILL.md`, `write-docs/SKILL.md`, `ask-internal/SKILL.md` → Pane ("Test the Pane app…", "Pane documentation", "Pane fork internals"). Note UI nav labels referenced may already be Pane.
- [ ] **S10.5 — `package.json` descriptions/author/homepage** (keep `name` scopes): `packages/browseros-agent/package.json` (`description`, `author`, `repository`, `homepage`, `bugs`), `apps/server/package.json` (`description`), `apps/app/package.json` (`description`), `apps/cli/npm/package.json` (`description`, `keywords`), `packages/build-server-tools/package.json` (`description`) → Pane prose; keep all `@browseros/*` `name` fields and `browseros-cli`/`browseros-server` `bin` fields.
- **How to test:** `rg -i "BrowserOS" CONTRIBUTING.md .github CLAUDE.md .cursor/skills` → none (or only class-2 substrate refs like `packages/browseros`). `npm ls` still resolves `@browseros/*`.

---

# Stream S11 — Verification sweep (the "don't miss any" gate)

**What:** A final audit proving no user-facing BrowserOS string remains, with an explicit allowlist for class 2/3.

- [ ] **S11.1 — Ripgrep audit for product-brand remnants.** Run:

```bash
rg -in "BrowserOS|Browser OS|Browseros" \
  -g '*.{tsx,ts,html,md,mdx,go,cc,cpp,h,mm,plist,grd,gn,gni,py,json,yaml,yml,sh,ps1,toml,idl}' \
  -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/.build/**' \
  -g '!docs/comparisons/**' \
  <repo>
```

  Manually classify every hit against the class-2 allowlist below. **Every class-1 hit is a bug — fix it.**

- [ ] **S11.2 — Class-2 allowlist (expected to remain — NOT bugs):** `@browseros/*`, `chrome://browseros`, `chrome.browserOS`, `browser_os.idl`, `~/.browseros`, `BROWSEROS_*` env vars, `browseros-cli`/`browseros-server` binary names, `com.browseros.BrowserOS` bundle ID, `packages/browseros*` paths, C++ `browseros::` namespaces / `kBrowserOS*` / `BrowserOS*` classes, `uv run browseros build`, `product_logo_*` filenames, MCP `browseros` compat alias, provider id `'browseros'` (display label already Pane).
- [ ] **S11.3 — Class-3 TODO audit:** collect every `TODO(pane-infra)` added in S3.2/S5.3/S6.1 into one list for the infra track (domains, GitHub org, download URLs).
- [ ] **S11.4 — Visual QA:** screenshot every app screen (newtab home, personalize, sidepanel, chat history, settings AI/MCP/customization/usage, onboarding welcome/steps/features/demo, connect-mcp, scheduled-tasks, agent-command) + every native surface (About, Welcome, Preferences, dock/taskbar, installer, crash dialog if reproducible). No screenshot contains "BrowserOS" as a product name or a non-Pane logo.
- [ ] **S11.5 — Build smoke test:** `bun run dev:watch` (app) + a dev Chromium build → no BrowserOS user-visible string; MCP wedge (`chrome://browseros/mcp` → Pane MCP settings) works end-to-end with the `pane` slug.
- **How to test:** This stream *is* the test. Pass = S11.1 returns zero class-1 hits and S11.4 screenshots are all Pane.

---

# Deep-native track (NOT in this plan — class 2, breaking)

Documented for later, explicitly excluded from Step 0:
- Rename `@browseros/*` package scopes → `@pane/*` (cross-package import churn).
- `chrome://browseros/*` → `chrome://pane/*` (with redirects for old URLs).
- `chrome.browserOS` API → `chrome.pane` (extension API rename).
- `~/.browseros/` → `~/.pane/` (with migration of existing user data).
- `BROWSEROS_*` env vars → `PANE_*`.
- `browseros-cli` / `browseros-server` binaries → `pane-cli` / `pane-server` (breaking release).
- `com.browseros.BrowserOS` bundle ID → `com.pane.Pane` (breaks auto-update continuity — needs a migration).
- Install paths (`/Applications/BrowserOS.app`, `%LOCALAPPDATA%\BrowserOS`, `/opt/browseros`).
- `BROWSEROS_APP_BASE_NAME` / artifact filenames (`BrowserOS_v*.dmg`).

These belong in a dedicated, coordinated, migration-tested release — not a branding sweep.

# Infra migration track (NOT in this plan — class 3)

- Domains: `browseros.com`, `docs.browseros.com`, `cdn.browseros.com`, `files.browseros.com`, `api.browseros.com`, `llm.browseros.com` → Pane domains.
- GitHub org/repo: unify `browseros-ai/BrowserOS` vs `browseros-ai/Pane` → the chosen Pane repo.
- Community: Discord/Slack invite URLs (S3.2), Twitter handle.
- Docs download badges + citation BibTeX (`browseros2025`).

Each `TODO(pane-infra)` planted in S3/S5/S6 feeds this track.

---

## Self-review

**1. Coverage (against the three explore inventories):**
- App UI display text + components → S1, S3 (components already Pane per inventory; S3 fixes the remaining strings/slugs). ✔
- App icons/favicons/manifest/HTML → S1. ✔
- claw-app → S2 (minimal, G3). ✔
- Server display strings + MCP slug → S4. ✔
- Docs site + logos → S5. ✔
- CLI prose → S6. ✔
- Native C++ user-facing strings → S7. ✔
- Chromium raster icons → S8. ✔
- Build/CI display names → S9. ✔
- Contributor + package metadata → S10. ✔
- Final audit → S11. ✔
- Class 2 (substrate) → explicitly excluded + allowlisted in S11.2 + Deep-native track. ✔
- Class 3 (infra) → TODO markers + Infra track. ✔

**2. Dependency order:** S0 (assets) → S1/S2/S5/S8 (consume PNGs); S4.1 (server slug) → S3.1 (copied snippets); S4.3 → S3.4 (rate-limit matcher). No cycles. S6/S7/S9/S10 are independent of the asset streams.

**3. Placeholder scan:** no "TBD"; infra URLs that aren't known yet are marked `TODO(pane-infra)` explicitly (class 3, not blockers for the branding sweep) rather than invented.

**4. Decision-gate safety:** G1/G2/G3/G4 defaults keep every breaking change out of Step 0; the MCP slug change (G2) is non-breaking because of the kept alias.

---

## Execution handoff

Plan complete and saved to `specs/REBRAND-PLAN.md`. Two execution options:

1. **Parallel Execution** — independent streams (S1, S5, S6, S7, S9, S10) across workers after S0 lands; S3 after S4; S8 after S0; S11 last.
2. **Inline Execution** — streams in this session with checkpoints.

Which approach?
