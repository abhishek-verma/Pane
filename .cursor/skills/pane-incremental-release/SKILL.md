---
name: pane-incremental-release
description: >-
  One-shot Pane incremental release for macOS arm64: classify changes, bump
  versions, rebuild/stage server if needed, pack extension CRX if needed, run
  LOCAL signed+notarized build (default production path), tag, upload DMG,
  update Sparkle appcast. Use when the user asks for a Pane incremental /
  delta / signed release, Pane repackage, Sparkle OTA ship, or invokes this
  skill with no further instructions — run end-to-end autonomously.
---

# Pane incremental release (one-shot)

Ship a **delta** Pane browser release (`0.47.0.N`) that existing installs pick up via Sparkle.
Repo: `/Users/abhishek/workspace/Pane`. SOP detail: `.cursor/docs/build-release-sop.md`.

When the user invokes this skill **with no further instructions**, run the entire
**Local signed production** path end-to-end. Do not stop for confirmation unless a
hard don't would be violated or the tree needs a full Chromium rebuild.

## Hard don'ts
- Do **not** run `git reset --hard`, `git clean`, or `gclient sync` in `/Users/abhishek/chromium/src` without asking.
- Do **not** use full unsigned configs (`release.macos.arm64.unsigned.local.yaml`) for production.
- Do **not** bump `BROWSEROS_PATCH` until ready to build+ship a DMG in this session.
- Ask before anything destructive or if the Chromium tree is in an unknown state.
- Never reuse an existing `browser/v*` tag.

## Context
- Chromium src: `/Users/abhishek/chromium/src` (base `148.0.7778.97`)
- Warm app prerequisite for repackage/incremental: `out/Default_arm64/Pane.app`
- Extension PEM: `secrets/pane-release/agent-extension.pem`
- Extension app id: `biedncddmddkpapdplhcnkhhplnfgbif`
- Sparkle key: `secrets/pane-release/sparkle-private.b64` (or `packages/browseros/.env`)
- Notary API key: `secrets/pane-release/AuthKey_LG3BDKV6WC.p8`, `NOTARY_KEY_ID.txt`, `NOTARY_ISSUER.txt`
- Signing identity (already in login keychain locally): `Developer ID Application: Abhishek Verma (4Z2UAB6AWC)`
- GitHub: `abhishek-verma/Pane`
- Versions: `packages/browseros/resources/BROWSEROS_VERSION` → `0.47.0.N`; extension `packages/browseros-agent/apps/app/package.json` → `0.0.Y`
- Manifests: `updates/extensions/bundled-manifest.xml`, `updates/extensions/update-manifest.xml`
- Appcast: `updates/browser/appcast.xml`
- CRX URLs must use `%2F` in the tag path (`agent-extension%2Fv0.0.Y`)

---

## Autonomous one-shot algorithm

### 1. Classify the ship
Diff `main` (or HEAD) against the latest `browser/v*` tag:

| Diff touches | Path | Config |
| --- | --- | --- |
| Only extension UI / server / static resources / agent (no `chromium_patches/`, no C++ that needs ninja) | **Repackage** | `release.macos.arm64.signed.repackage.yaml` |
| `packages/browseros/chromium_patches/` or Chromium C++/prefs that need compile; base tag unchanged | **Incremental** | `release.macos.arm64.signed.incremental.yaml` |
| Chromium base tag change or unknown/broken tree | **Full** | **Ask user first** |

Server rebuild needed when diff touches `packages/browseros-agent/apps/server/**`, claw-server build inputs, or staged binary contents would otherwise be stale.

Extension bump needed only when `packages/browseros-agent/apps/app/**` (shipped extension) changed since the last extension tag.

### 2. Decide versions
- Always bump `BROWSEROS_PATCH` to the next unused `0.47.0.N` (check `git tag -l 'browser/v*'` and GitHub releases — never reuse).
- Bump extension `package.json` version **only** if extension app code changed.

### 3. Prep artifacts
If server rebuild needed:
```bash
cd packages/browseros-agent
PANE_BUILD=true bun scripts/build/server.ts --target=darwin-arm64 --no-upload --ci
PANE_BUILD=true bun scripts/build/claw-server.ts --target=darwin-arm64 --no-upload --ci
bash packages/browseros-agent/scripts/release/stage-pane-browser-resources.sh darwin-arm64
```

If extension changed: build zip → pack CRX with `AGENT_EXTENSION_PRIVATE_KEY` → publish `agent-extension/v0.0.Y` → update both manifests → keep `/tmp/pane-agent-0.0.Y.crx`.

Commit version bumps (+ manifests if any) on `main` and push before tagging the browser.

### 4. Local signed build (default production)
Identity is already in the login keychain — **do not** import the P12 locally.

```bash
export MACOS_CERTIFICATE_NAME="Developer ID Application: Abhishek Verma (4Z2UAB6AWC)"
export NOTARY_KEY="$(cat secrets/pane-release/AuthKey_LG3BDKV6WC.p8)"
export NOTARY_KEY_ID="$(tr -d '[:space:]' < secrets/pane-release/NOTARY_KEY_ID.txt)"
export NOTARY_ISSUER="$(tr -d '[:space:]' < secrets/pane-release/NOTARY_ISSUER.txt)"
export SPARKLE_PRIVATE_KEY="$(cat secrets/pane-release/sparkle-private.b64)"
export PANE_BUNDLED_MANIFEST_PATH="/Users/abhishek/workspace/Pane/updates/extensions/bundled-manifest.xml"
```

Practical split that always passes the sign guard (`--config` and `--modules` are mutually exclusive — use modules mode for the split):
```bash
cd packages/browseros
uv run browseros build --modules resources,bundled_extensions \
  --arch arm64 --build-type release --chromium-src /Users/abhishek/chromium/src

APP="/Users/abhishek/chromium/src/out/Default_arm64/Pane.app"
FW_RES="$(echo "$APP"/Contents/Frameworks/Pane\ Framework.framework/Versions/*/Resources/browseros_extensions)"
rsync -a /Users/abhishek/chromium/src/chrome/browser/browseros/server/resources/ \
  "$APP/Contents/Resources/BrowserOSServer/default/resources/"
rsync -a /Users/abhishek/chromium/src/chrome/browser/browseros/claw_server/resources/ \
  "$APP/Contents/Resources/BrowserOSClawServer/default/resources/"
rsync -a /Users/abhishek/chromium/src/chrome/browser/browseros/bundled_extensions/ "$FW_RES/"

uv run browseros build --modules sign_macos,package_macos,sparkle_sign \
  --arch arm64 --build-type release --chromium-src /Users/abhishek/chromium/src
```

One-shot config (only if the app bundle is already injected to match staged resources):
```bash
uv run browseros build \
  --config build/config/release.macos.arm64.signed.repackage.yaml \
  --chromium-src /Users/abhishek/chromium/src
```

For **incremental**, use `release.macos.arm64.signed.incremental.yaml` (compile included; still set the same env).

Output: `packages/browseros/releases/<version>/Pane_v<version>_arm64.dmg` + `pane-browser-release-metadata.json`.

### 5. Verify Gatekeeper cleanliness
```bash
APP="/Users/abhishek/chromium/src/out/Default_arm64/Pane.app"
DMG="packages/browseros/releases/<version>/Pane_v<version>_arm64.dmg"
codesign --verify --deep --strict "$APP"
spctl -a -vv "$APP"
xcrun stapler validate "$DMG"
```

### 6. Tag → upload → appcast
```bash
VERSION=0.47.0.N
TAG=browser/v$VERSION
git tag -a "$TAG" -m "browser v$VERSION"
git push origin "$TAG"   # also push the bump commit on main

# Create release if the tag-push workflow did not (no self-hosted runner yet):
gh release create "$TAG" --title "Pane Browser - v$VERSION" --notes "Signed release." || true
gh release upload "$TAG" \
  packages/browseros/releases/$VERSION/Pane_v${VERSION}_arm64.dmg \
  packages/browseros/releases/$VERSION/pane-browser-release-metadata.json \
  --clobber

cd packages/browseros
uv run browseros ota browser appcast --version "$VERSION" --tag "$TAG" \
  --output-dir /Users/abhishek/workspace/Pane/updates/browser

# From repo root — lands appcast via PR:
packages/browseros-agent/scripts/release/commit-updates-via-pr.sh \
  main "chore/browser-appcast-v${VERSION}" \
  "chore: update browser appcasts for v${VERSION}" \
  updates/browser/appcast.xml \
  updates/browser/appcast-x86_64.xml \
  updates/browser/appcast-win.xml \
  updates/browser/appcast-win-arm64.xml
```

### 7. Report
DMG path + size, notarization acceptance / stapler result, `spctl` output, release URL, appcast PR URL, path used (signed.repackage vs signed.incremental).

---

## Signed CI path (when a self-hosted runner exists)

Tag-push `browser/v*` runs `.github/workflows/release-browser.yml` (arm64 + x64 + universal by default). Requires repository variable `CHROMIUM_SRC` on the runner and secrets `DEVELOPER_ID_P12`, `P12_PASSWORD`, `NOTARY_*`, `SPARKLE_PRIVATE_KEY`.

`workflow_dispatch` inputs: `tag`, `build_mode` (`full`/`incremental`/`repackage`), `skip_universal` (arm64-only when true).

Until a self-hosted Mac runner is registered, **use Local signed** above — CI cannot build Chromium on stock GitHub-hosted runners.

---

## Unsigned local paths (testing only — not for production Sparkle)

| Path | Config |
| --- | --- |
| Repackage | `release.macos.arm64.unsigned.repackage.yaml` |
| Incremental | `run-unsigned-browser-build.sh` → `...unsigned.incremental.yaml` |

Gatekeeper will warn. Do not ship these as production.

---

## Notes
- Prefer judgment when a release is partially done — fix forward.
- Keep release commits focused; don't scoop unrelated dirty files.
- Optional fill-in: release notes / why: <one sentence>
