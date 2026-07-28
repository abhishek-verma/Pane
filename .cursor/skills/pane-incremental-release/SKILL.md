---
name: pane-incremental-release
description: >-
  Ship a Pane incremental (delta) release for macOS arm64 via Sparkle: bump
  versions, pack/publish CRX, run unsigned incremental browser build, publish
  DMG, update appcast. Use when the user asks for a Pane incremental release,
  Pane delta release, incremental Pane build, Sparkle OTA ship for Pane, or to
  publish Pane extension/server/browser-patch changes without a full Chromium
  rebuild.
---

# Pane incremental release

Ship a **delta / incremental** Pane release (macOS arm64). Repo: `/Users/abhishek/workspace/Pane`.
SOP for detail: `.cursor/docs/build-release-sop.md`. Prefer judgment over rigid checklists when something unexpected comes up — just don't do a full Chromium rebuild unless the user asks.

## Goal
Publish whatever changed: extension and/or server and/or browser patches, as a new browser version (`0.47.0.N`) that existing installs can pick up via Sparkle.

## Hard don'ts
- Do **not** run `git reset --hard`, `git clean`, or `gclient sync` in `/Users/abhishek/chromium/src` without asking.
- Do **not** use the full unsigned config (`release.macos.arm64.unsigned.local.yaml`) unless the user confirms a full rebuild.
- Do **not** bump `BROWSEROS_PATCH` until you're ready to build+ship a DMG in this session.

Use the incremental path:
`bash packages/browseros-agent/scripts/release/run-unsigned-browser-build.sh`
Confirm the log says incremental (`...unsigned.incremental.yaml`, no reset / no gclient sync). If it wants a full build, stop and ask.

## Context
- Chromium src: `/Users/abhishek/chromium/src` — expect tag/base `148.0.7778.97` (or a `browseros` branch on it)
- Extension PEM: `secrets/pane-release/agent-extension.pem`
- Extension app id: `biedncddmddkpapdplhcnkhhplnfgbif`
- Sparkle: `packages/browseros/.env` / `secrets/pane-release/sparkle-private.b64`
- GitHub repo: `abhishek-verma/Pane`

Versions:
- Browser: `packages/browseros/resources/BROWSEROS_VERSION` → `BROWSEROS_PATCH` → `0.47.0.N`
- Extension: `packages/browseros-agent/apps/app/package.json` → `0.0.Y`
- Manifests: `updates/extensions/bundled-manifest.xml` and `updates/extensions/update-manifest.xml`
- Appcast: `updates/browser/appcast.xml` (also under `packages/browseros/updates/browser/`)

CRX download URLs must use `%2F` in the tag path (`agent-extension%2Fv0.0.Y`).

## Typical flow
1. Start from up-to-date `main`. Land feature work first if it isn't merged yet.
2. Classify roughly: extension-only, server involved, and/or browser patches. Rebuild server binaries if server/runtime changed; skip if clearly UI-only and binaries are already staged.
3. Bump extension version if shipping extension changes; build zip → pack CRX → publish `agent-extension/v0.0.Y` → update both manifests.
4. Bump `BROWSEROS_PATCH`, commit release bumps + manifests, push.
5. Run the incremental browser build script. Watch `packages/browseros/logs/unsigned-release-build.log`. Expect minutes (longer if C++ changed), not hours.
6. Publish `browser/v0.47.0.N` with DMG + metadata from `packages/browseros/releases/<version>/`.
7. Generate appcast after the GitHub release exists:
   `cd packages/browseros && uv run browseros ota browser appcast --version "$VERSION"`
   Copy into `updates/browser/appcast.xml` and land via a small PR (preferred).
8. Report extension URL, browser URL, appcast PR, DMG path, and that the build was incremental.

## Notes
- Extension-only or server-only can still be a quick delta: new CRX + new DMG so the browser bundles/updates correctly.
- Browser/C++ patch changes are still delta if the Chromium base tag didn't change.
- Keep release commits focused; don't scoop unrelated dirty files.
- Adapt steps if versions are already bumped, a release partially exists, or something fails — fix forward, ask when unsure about destructive Chromium ops.

Optional fill-in: release notes / why: <one sentence>
