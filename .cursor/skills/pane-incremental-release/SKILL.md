---
name: pane-incremental-release
description: >-
  Ship a Pane incremental (delta) release for macOS arm64 via Sparkle: bump
  versions, pack/publish CRX, run signed CI release (preferred) or local
  unsigned repackage/incremental for pre-release testing, publish DMG, update
  appcast. Use when the user asks for a Pane incremental release, Pane delta
  release, Pane repackage, incremental Pane build, Sparkle OTA ship for Pane,
  signed CI release, or to publish Pane extension/server/browser-patch changes
  without a full Chromium rebuild.
---

# Pane incremental release

Ship a **delta / incremental** Pane release (macOS). Repo: `/Users/abhishek/workspace/Pane`.
SOP for detail: `.cursor/docs/build-release-sop.md`. Prefer judgment over rigid checklists when something unexpected comes up — just don't do a full Chromium rebuild unless the user asks.

## Goal
Publish whatever changed: extension and/or server and/or browser patches, as a new browser version (`0.47.0.N`) that existing installs can pick up via Sparkle.

## Hard don'ts
- Do **not** run `git reset --hard`, `git clean`, or `gclient sync` in `/Users/abhishek/chromium/src` without asking.
- Do **not** use the full unsigned config (`release.macos.arm64.unsigned.local.yaml`) unless the user confirms a full rebuild.
- Do **not** bump `BROWSEROS_PATCH` until you're ready to build+ship a DMG in this session.

## Choose release path (do this first)

| What you want | Path | Notes |
| --- | --- | --- |
| **Ship to users** (signed + notarized DMG) | **Signed CI release** (preferred) | Bump → push `browser/v*` tag → GitHub Actions builds, signs, notarizes, uploads, appcasts |
| Local smoke / pre-release DMG only | **Unsigned repackage or incremental** | Testing only — Gatekeeper warns; not for production Sparkle |

### Local unsigned paths (testing only)

Classify the local ship, then pick **one**:

| What changed | Path | Config / command |
| --- | --- | --- |
| Extension and/or server (or static resources) **only** — no Chromium C++ / browser patches | **Repackage** (preferred; minutes) | `build/config/release.macos.arm64.unsigned.repackage.yaml` — **unsigned — testing only** |
| Browser patches / C++ / prefs / capture patches, Chromium base tag unchanged | **Incremental compile** | `bash packages/browseros-agent/scripts/release/run-unsigned-browser-build.sh` — **unsigned — testing only** |
| Chromium base tag change or unknown tree | **Full rebuild** | Ask user first — `...unsigned.local.yaml` — **unsigned — testing only** |

If the user says “repackage”, use the repackage path. If unsure whether browser code changed, check the diff: only touch `packages/browseros/chromium_patches/` or files under Chromium that need ninja → incremental compile; otherwise repackage.

Prerequisite for **both** non-full local paths: a prior build left
`/Users/abhishek/chromium/src/out/Default_arm64/Pane.app` intact.

## Signed CI release (production)

Identity: `Developer ID Application: Abhishek Verma (4Z2UAB6AWC)` (Team ID `4Z2UAB6AWC`).
Notarization: App Store Connect API key only (`NOTARY_KEY` / `NOTARY_KEY_ID` / `NOTARY_ISSUER`) — never apple-id/password in CI (2FA breaks it).

### Tag → release flow

1. Land feature work on `main`. Bump extension (if needed) and `BROWSEROS_PATCH`. Commit + push.
2. Tag and push:
   ```bash
   git tag -a browser/v0.47.0.N -m "browser v0.47.0.N"
   git push origin browser/v0.47.0.N
   ```
3. Workflow [`.github/workflows/release-browser.yml`](.github/workflows/release-browser.yml) runs on the tag:
   - Creates/updates the GitHub release
   - **macos-14 (arm64)** + **macos-13 (x64)**: import `DEVELOPER_ID_P12` → temp keychain → build (signed CI / incremental / repackage) → codesign (hardened runtime / `--options runtime`) → notarytool (API key) → staple → package DMG → Sparkle-sign → upload DMG + metadata
   - Lipo arm64+x64 → re-sign/notarize universal DMG → upload
   - Generate Sparkle appcasts → `commit-updates-via-pr.sh`
4. DMGs on the release are **signed and notarized** (Gatekeeper-clean). Users install without Right-click → Open workarounds.

Configs:
- Full: `release.macos.arm64.signed.ci.yaml` / `release.macos.x64.signed.ci.yaml`
- Incremental: `release.macos.arm64.signed.incremental.yaml`
- Repackage: `release.macos.arm64.signed.repackage.yaml`

Runner prerequisite: repository variable `CHROMIUM_SRC` (or `~/chromium/src`) pointing at a synced Chromium tree on the Mac runner. GitHub-hosted runners need a self-hosted/warm tree — full Chromium exceeds Actions cache limits.

Secrets (already on `abhishek-verma/Pane`): `DEVELOPER_ID_P12`, `P12_PASSWORD`, `NOTARY_KEY`, `NOTARY_KEY_ID`, `NOTARY_ISSUER`, `SPARKLE_PRIVATE_KEY`.

Manual re-run: Actions → Release Pane Browser → workflow_dispatch with tag + optional `build_mode` (`full` / `incremental` / `repackage`).

## Context
- Chromium src: `/Users/abhishek/chromium/src` — expect tag/base `148.0.7778.97` (or a `browseros` branch on it)
- Extension PEM: `secrets/pane-release/agent-extension.pem`
- Extension app id: `biedncddmddkpapdplhcnkhhplnfgbif`
- Sparkle: `packages/browseros/.env` / `secrets/pane-release/sparkle-private.b64`
- Apple signing material (local, git-ignored): `secrets/pane-release/DeveloperID_Pane.p12`, `AuthKey_LG3BDKV6WC.p8`, …
- GitHub repo: `abhishek-verma/Pane`

Versions:
- Browser: `packages/browseros/resources/BROWSEROS_VERSION` → `BROWSEROS_PATCH` → `0.47.0.N`
- Extension: `packages/browseros-agent/apps/app/package.json` → `0.0.Y`
- Manifests: `updates/extensions/bundled-manifest.xml` and `updates/extensions/update-manifest.xml`
- Appcast: `updates/browser/appcast.xml` (also under `packages/browseros/updates/browser/`)

CRX download URLs must use `%2F` in the tag path (`agent-extension%2Fv0.0.Y`).

## Typical flow (shared prep, then choose path)
1. Start from up-to-date `main`. Land feature work first if it isn't merged yet.
2. Rebuild server binaries if server/runtime changed:
   ```bash
   cd packages/browseros-agent
   PANE_BUILD=true bun scripts/build/server.ts --target=darwin-arm64 --no-upload --ci
   PANE_BUILD=true bun scripts/build/claw-server.ts --target=darwin-arm64 --no-upload --ci
   bash packages/browseros-agent/scripts/release/stage-pane-browser-resources.sh darwin-arm64
   ```
   Skip server rebuild if clearly extension-UI-only and binaries are already staged.
3. Bump extension version if shipping extension changes; build zip → pack CRX → publish `agent-extension/v0.0.Y` → update both manifests. Keep a local CRX at `/tmp/pane-agent-0.0.Y.crx` (bundled_extensions prefers it).
4. Bump `BROWSEROS_PATCH`, commit release bumps + manifests, push.
5. **Production:** push `browser/v0.47.0.N` and let Signed CI ship (above).  
   **Local testing only:** run unsigned repackage or incremental compile (below).
6. For local unsigned only: publish `browser/v…` yourself with DMG + metadata, then generate appcast.
7. Report extension URL, browser URL, appcast PR, DMG path, and **which path** ran.

## Repackage path (extension / server only) — unsigned, testing only

Config: `packages/browseros/build/config/release.macos.arm64.unsigned.repackage.yaml`  
Pipeline: `resources → bundled_extensions → package_macos → sparkle_sign` (no `gn gen`, no compile).

**Critical:** `resources` / `bundled_extensions` write into Chromium *source* trees. `package_macos` packs the existing `out/Default_arm64/Pane.app`. If you skip injecting into the app bundle, the DMG ships **stale** extension/server.

Before packaging, sync new artifacts into `Pane.app`:

```bash
APP="/Users/abhishek/chromium/src/out/Default_arm64/Pane.app"
FW_RES="$(echo "$APP"/Contents/Frameworks/Pane\ Framework.framework/Versions/*/Resources/browseros_extensions)"
# Server + claw (after stage-pane-browser-resources.sh)
rsync -a packages/browseros/resources/binaries/browseros_server/darwin-arm64/resources/ \
  "$APP/Contents/Resources/BrowserOSServer/default/resources/"
rsync -a packages/browseros/resources/binaries/browseros_claw_server/darwin-arm64/resources/ \
  "$APP/Contents/Resources/BrowserOSClawServer/default/resources/"
# Extension CRX + manifest (after bundled_extensions has written chromium src)
rsync -a /Users/abhishek/chromium/src/chrome/browser/browseros/bundled_extensions/ "$FW_RES/"
# Verify before DMG
python3 -c "import json; p='$FW_RES/bundled_extensions.json'; print(json.load(open(p)))"
```

Then run (detached / durable so `pkg-dmg` is not killed with the agent shell):

```bash
cd packages/browseros
export PANE_BUNDLED_MANIFEST_PATH="/Users/abhishek/workspace/Pane/updates/extensions/bundled-manifest.xml"
# Log: packages/browseros/logs/repackage-build.log
uv run browseros build \
  --config build/config/release.macos.arm64.unsigned.repackage.yaml \
  --chromium-src /Users/abhishek/chromium/src
```

Expect ~minutes. Confirm DMG size is in the same ballpark as the prior release (~200MB), not a truncated partial file. Verify appcast/signing steps still run (`sparkle_sign`).

For a **signed** local repackage (rare; prefer CI): use `release.macos.arm64.signed.repackage.yaml` with `NOTARY_*` + cert in keychain / `DEVELOPER_ID_P12`.

## Incremental compile path (browser / C++ changed) — unsigned, testing only

```bash
bash packages/browseros-agent/scripts/release/run-unsigned-browser-build.sh
```

Watch `packages/browseros/logs/unsigned-release-build.log`. Expect minutes (longer if C++ changed), not hours. Confirm the log says incremental (`...unsigned.incremental.yaml`, no reset / no gclient sync). If it wants a full build, stop and ask.

Signed sibling: `release.macos.arm64.signed.incremental.yaml` (prefer CI tag push).

## Notes
- Production ships go through **Signed CI** (tag → notarized DMG). Local unsigned paths are for pre-release testing only.
- Extension-only or server-only → **repackage**, not incremental compile.
- Browser/C++ patch changes are still delta if the Chromium base tag didn't change → incremental compile.
- Keep release commits focused; don't scoop unrelated dirty files.
- Adapt steps if versions are already bumped, a release partially exists, or something fails — fix forward, ask when unsure about destructive Chromium ops.

Optional fill-in: release notes / why: <one sentence>
