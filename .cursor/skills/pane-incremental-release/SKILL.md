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

**Test first.** If the diff touches only server (`packages/browseros-agent/apps/server/**`)
or extension (`packages/browseros-agent/apps/app/**`) code, verify the changes in the
installed app with the **`pane-quick-test`** skill before building/shipping here. Only
proceed to the release when the user confirms the quick test passed. Chromium C++ /
`chromium_patches/` changes have no quick path — go straight to the incremental build.

## Hard don'ts
- Do **not** run `git reset --hard`, `git clean`, or `gclient sync` in `/Users/abhishek/chromium/src` without asking.
- Do **not** use full unsigned configs (`release.macos.arm64.unsigned.local.yaml`) for production.
- Do **not** bump `BROWSEROS_PATCH` until ready to build+ship a DMG in this session.
- Ask before anything destructive or if the Chromium tree is in an unknown state.
- Never reuse an existing `browser/v*` tag.
- **Nothing is "unrelated"** — typecheck errors, appcast mismatches, stale symlinks all affect the user. Fix everything before calling a release done.

## Context
- Chromium src: `/Users/abhishek/chromium/src` (base `148.0.7778.97`)
- Warm app prerequisite for repackage/incremental: `out/Default_arm64/Pane.app`
- **Bundle ID**: `com.panebrowser.app` (set via `chrome/app/theme/chromium/BRANDING`)
- **App version**: `CFBundleShortVersionString` tracks `PANE_VERSION` (e.g. `0.47.0.55`), not the Chromium upstream version
- Extension PEM: `secrets/pane-release/agent-extension.pem`
- Extension app id: `biedncddmddkpapdplhcnkhhplnfgbif`
- Sparkle key: `secrets/pane-release/sparkle-private.b64` (or `packages/browseros/.env`)
- Notary API key: `secrets/pane-release/AuthKey_LG3BDKV6WC.p8`, `NOTARY_KEY_ID.txt`, `NOTARY_ISSUER.txt`
- Signing identity (already in login keychain locally): `Developer ID Application: Abhishek Verma (4Z2UAB6AWC)`
- GitHub: `abhishek-verma/Pane`
- Versions: `packages/browseros/resources/PANE_VERSION` → `0.47.0.N`; extension `packages/browseros-agent/apps/app/package.json` → `0.0.Y`
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

For **incremental builds** (C++ recompile), depot_tools and build tools must be on PATH:
```bash
export PATH="$HOME/chromium/depot_tools:$HOME/chromium/src/buildtools/mac:$HOME/chromium/src/third_party/llvm-build/Release+Asserts/bin:$PATH"
```
For **repackage builds** only `gn` is needed (via `buildtools/mac`), but including the full PATH above is always safe.

```bash
export MACOS_CERTIFICATE_NAME="Developer ID Application: Abhishek Verma (4Z2UAB6AWC)"
export NOTARY_KEY="/Users/abhishek/workspace/Pane/secrets/pane-release/AuthKey_LG3BDKV6WC.p8"
export NOTARY_KEY_ID="$(tr -d '[:space:]' < secrets/pane-release/NOTARY_KEY_ID.txt)"
export NOTARY_ISSUER="$(tr -d '[:space:]' < secrets/pane-release/NOTARY_ISSUER.txt)"
export SPARKLE_PRIVATE_KEY="$(cat secrets/pane-release/sparkle-private.b64)"
export PANE_BUNDLED_MANIFEST_PATH="/Users/abhishek/workspace/Pane/updates/extensions/bundled-manifest.xml"
```

**`--config` and `--modules` are mutually exclusive.** Never pass both. Use `--modules` for partial/resume runs; use `--config` only for a full pipeline run from scratch. Use `--sign --package` phase flags to resume from signing without `--config`.

Practical split that always passes the sign guard (modules mode):
```bash
cd packages/browseros
uv run browseros build --modules resources,bundled_extensions \
  --arch arm64 --build-type release --chromium-src /Users/abhishek/chromium/src

APP="/Users/abhishek/chromium/src/out/Default_arm64/Pane.app"
FW_VER="$(ls "$APP/Contents/Frameworks/Pane Framework.framework/Versions/" | grep -vx Current | head -1)"
FW_RES="$APP/Contents/Frameworks/Pane Framework.framework/Versions/$FW_VER/Resources/browseros_extensions"
rsync -a /Users/abhishek/chromium/src/chrome/browser/browseros/server/resources/ \
  "$APP/Contents/Resources/BrowserOSServer/default/resources/"
rsync -a /Users/abhishek/chromium/src/chrome/browser/browseros/claw_server/resources/ \
  "$APP/Contents/Resources/BrowserOSClawServer/default/resources/"
rsync -a /Users/abhishek/chromium/src/chrome/browser/browseros/bundled_extensions/ "$FW_RES/"

uv run browseros build --modules sign_macos,package_macos,sparkle_sign \
  --arch arm64 --build-type release --chromium-src /Users/abhishek/chromium/src
```

One-shot config (only if app bundle is already injected to match staged resources):
```bash
uv run browseros build \
  --config build/config/release.macos.arm64.signed.repackage.yaml \
  --chromium-src /Users/abhishek/chromium/src
```

For **incremental**, use `release.macos.arm64.signed.incremental.yaml` (compile included).

Output: `packages/browseros/releases/<version>/Pane_v<version>_arm64.dmg` + `pane-browser-release-metadata.json`.

### 5. Verify Gatekeeper cleanliness
```bash
APP="/Users/abhishek/chromium/src/out/Default_arm64/Pane.app"
DMG="packages/browseros/releases/<version>/Pane_v<version>_arm64.dmg"
codesign --verify --deep --strict "$APP"
spctl -a -vv "$APP"
xcrun stapler validate "$APP"
xcrun stapler validate "$DMG"
```

### 6. Tag → upload → appcast
```bash
VERSION=0.47.0.N
TAG=v$VERSION      # plain v-tag (as of v0.47.0.62+)
git tag -a "$TAG" -m "Pane v$VERSION"
git push origin "$TAG"

gh release create "$TAG" \
  packages/browseros/releases/$VERSION/Pane_v${VERSION}_arm64.dmg \
  packages/browseros/releases/$VERSION/pane-browser-release-metadata.json \
  --title "Pane v$VERSION" --notes "..."

# Generate appcast and commit directly on main:
cd packages/browseros
export SPARKLE_PRIVATE_KEY="$(cat /Users/abhishek/workspace/Pane/secrets/pane-release/sparkle-private.b64)"
uv run browseros ota browser appcast --version "$VERSION" --tag "$TAG"
cd /Users/abhishek/workspace/Pane
git add updates/browser/appcast.xml
git commit -m "chore: update browser appcast for v${VERSION}"
git push origin main
```

**CRITICAL — verify sparkle:version matches CFBundleVersion after every build:**
```bash
# Read CFBundleVersion from the freshly built DMG:
hdiutil attach "packages/browseros/releases/$VERSION/Pane_v${VERSION}_arm64.dmg" \
  -mountpoint /tmp/pane-check -nobrowse -quiet
/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" /tmp/pane-check/Pane.app/Contents/Info.plist
hdiutil detach /tmp/pane-check -quiet

# Compare with appcast:
grep "sparkle:version" updates/browser/appcast.xml
```
They **must match exactly**. If they differ, edit `sparkle:version` in the appcast to match `CFBundleVersion` before pushing. A mismatch causes an infinite update-download loop in installed Pane.

### 7. Report
DMG path + size, notarization acceptance / stapler result, `spctl` output, release URL, appcast URL, path used.

---

## Resume after an interrupted release

If the build terminal dies mid-release (app already signed, DMG/tag/upload never happened):
```bash
bash packages/browseros-agent/scripts/release/resume-signed-browser-release.sh <version>
```

**Resuming after a failed compile** — fix the error, then:
```bash
export PATH="$HOME/chromium/depot_tools:$HOME/chromium/src/buildtools/mac:$HOME/chromium/src/third_party/llvm-build/Release+Asserts/bin:$PATH"
autoninja -C /Users/abhishek/chromium/src/out/Default_arm64 -j 12 chrome chromedriver

# Resume sign+package:
cd packages/browseros
uv run browseros build --sign --package \
  --arch arm64 --build-type release --chromium-src /Users/abhishek/chromium/src

# Then Sparkle sign:
uv run browseros build --modules sparkle_sign \
  --arch arm64 --build-type release --chromium-src /Users/abhishek/chromium/src
```

---

## Known pitfalls — incremental builds

### 1. Detecting a "stuck" build vs a failed compile
**A build that looks stuck is usually a completed-but-failed compile.** `autoninja` exits silently on error and the Python build script may appear to hang.

How to diagnose:
```bash
# Is siso/autoninja still running?
ps aux | grep -E "[s]iso|[a]utoninja"

# When did compile finish?
ls -lt /Users/abhishek/chromium/src/out/Default_arm64/siso_output

# What was the error?
grep "FAILED" /Users/abhishek/chromium/src/out/Default_arm64/siso_output | tail -5

# Did it create a failed-commands script?
ls /Users/abhishek/chromium/src/out/Default_arm64/siso_failed_commands.sh
```
If `siso_failed_commands.sh` exists, open `siso_output` to find the actual compiler error. If it doesn't exist (and grep finds 0 FAILED lines), compile succeeded.

### 2. GRD patch not applied — missing string IDs
**Symptom**: `error: use of undeclared identifier 'IDS_IMPORT_FROM_CHROME'` (or any `IDS_*` string).

**Cause**: The incremental config does NOT run the `patches` module. `chromium_patches/*.grd` diffs must already be applied in the working tree. A partial prior patch run may have applied the `.cc` file but failed on the `.grd` file.

**Fix**: manually add the missing string to the working tree GRD at the location indicated in the patch diff, then re-run `autoninja`.

**Prevention**: before every incremental build, spot-check that key patch additions exist in the working tree:
```bash
grep -c "IDS_IMPORT_FROM_CHROME" /Users/abhishek/chromium/src/chrome/app/generated_resources.grd
# must be > 0
```

### 3. Stale framework symlink — codesign fails
**Symptom**: `codesign` fails on `Pane Framework.framework` with `bundle format unrecognized, invalid, or unsuitable`.

**Cause**: `Pane.app/Contents/Frameworks/Pane Framework.framework/Versions/Current` is a broken symlink pointing to an old Chromium build version. This happens when `out/Default_arm64/Pane.app` is left over from a prior build on a different Chromium base version.

**Check before signing**:
```bash
file "/Users/abhishek/chromium/src/out/Default_arm64/Pane.app/Contents/Frameworks/Pane Framework.framework/Versions/Current"
# Must say "directory" — not "broken symbolic link"
```

**Fix**: rebuild the app bundle with ninja (takes ~5 min, no full recompile):
```bash
export PATH="$HOME/chromium/depot_tools:..."
autoninja -C /Users/abhishek/chromium/src/out/Default_arm64 -j 12 "Pane.app"
```

### 4. sparkle:version mismatch → infinite update loop
**Symptom**: installed Pane continuously downloads the latest version even after installing it (About page shows "Updating Pane (14%)" in a loop).

**Cause**: `sparkle_sign` computes `sparkle_version = chromiumBuild + 171` (the build offset). But `autoninja` bakes `CFBundleVersion` from the raw `chrome/VERSION` BUILD field — without the offset. An incremental build on Chromium `148.0.7778.97` produces `CFBundleVersion = 7778.97`, but `sparkle_version = 7778 + 171 = 7949.97`. Since `7949 > 7778`, Sparkle permanently thinks an update is available.

**Fix**: after `sparkle_sign` generates the metadata/appcast, always verify and correct if needed:
```bash
# Actual CFBundleVersion in the DMG:
hdiutil attach "releases/$VERSION/Pane_v${VERSION}_arm64.dmg" -mountpoint /tmp/pane-check -nobrowse -quiet
/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" /tmp/pane-check/Pane.app/Contents/Info.plist
hdiutil detach /tmp/pane-check -quiet
# Then compare with appcast and fix if different (see §6 above).
```

### 5. `--start-from` does not exist
The `browseros build` CLI has no `--start-from` flag. To resume from a specific step:
- `--modules sign_macos,package_macos,sparkle_sign` — but NOT with `--config`
- `--sign --package` phase flags — without `--config`
- `--config` and `--modules`/phase flags are **mutually exclusive**

### 6. `chrome/VERSION` must not be overwritten
The `compile` module's `_create_version_file` writes the Pane version to `chrome/BROWSEROS_VERSION`. It must **never** overwrite `chrome/VERSION` — that file contains `MAJOR=148` (the real Chromium major) required by policy generation. Overwriting it causes `Missing --chrome-version-major`.

### 7. PATH requirements for incremental builds
`gn` and `autoninja` must be on PATH or the build fails with `[Errno 2] No such file or directory: 'gn'`. Always set the full PATH before any incremental build command (see §4 above).

### 8. Xcode must be full Xcode, not Command Line Tools
```bash
xcode-select -p   # must show /Applications/Xcode.app/...
# If it shows /Library/Developer/CommandLineTools, fix it:
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

---

## Extension release

### Pack and update manifests
**Always build without any special flags** — `PANE_BUILD` has been removed; a plain `bun run build` is all that's needed.

```bash
cd packages/browseros-agent/apps/app
bun run build
bun run zip   # creates dist/browserosapp-0.0.Y-chrome.zip

cd ../..
AGENT_EXTENSION_PRIVATE_KEY="$(cat /Users/abhishek/workspace/Pane/secrets/pane-release/agent-extension.pem)" \
bun scripts/release/pack-extension-crx.ts \
  --zip apps/app/dist/browserosapp-0.0.Y-chrome.zip \
  --output /tmp/pane-agent-0.0.Y.crx

bun scripts/release/generate-extension-update-manifest.ts \
  --app-id biedncddmddkpapdplhcnkhhplnfgbif \
  --version 0.0.Y \
  --codebase "https://cdn.browseros.com/extensions/pane-agent-0.0.Y.crx" \
  --output /Users/abhishek/workspace/Pane/updates/extensions/bundled-manifest.xml \
  --merge-from /Users/abhishek/workspace/Pane/updates/extensions/bundled-manifest.xml
```

After packing, update **only `bundled-manifest.xml`** — `update-manifest.xml` is deprecated (independent extension OTA is disabled; extension only updates with the browser). Verify the `codebase` URL ends in `.crx`:

### Trigger CI release workflow
The `release-agent-extension.yml` workflow triggers on `agent-extension/v*` tag push AND `workflow_dispatch`. If a tag push doesn't appear in `gh run list` within 30 seconds, manually dispatch:
```bash
gh workflow run release-agent-extension.yml --field tag="agent-extension/v0.0.Y"
```
The workflow waits for approval in the `release-core` GitHub environment — approve at the Actions run URL in the GitHub UI.

### Typecheck before shipping
Run `bun run typecheck` from `packages/browseros-agent` before publishing. Errors in **any** package are release blockers — nothing is "unrelated" when shipping to users.

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
