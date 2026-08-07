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
- Never reuse an existing `v*` tag.
- **Nothing is "unrelated"** — typecheck errors, appcast mismatches, stale symlinks, profile routing bugs all affect the user. Fix everything before calling a release done.

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
- Build offset: `packages/browseros/build/config/BROWSEROS_BUILD_OFFSET` — **increment by 1 each repackage**
- Manifests: `updates/extensions/bundled-manifest.xml` (only — `update-manifest.xml` is deprecated)
- Appcast: `updates/browser/appcast.xml` AND `packages/browseros/updates/browser/appcast.xml` — **keep in sync**
- Sparkle feed URL baked into browser: `https://raw.githubusercontent.com/abhishek-verma/Pane/main/updates/browser/appcast.xml`

---

## Autonomous one-shot algorithm

### 1. Classify the ship
Diff `main` (or HEAD) against the latest `v*` tag:

| Diff touches | Path | Config |
| --- | --- | --- |
| Only extension UI / server / static resources / agent (no `chromium_patches/`, no C++ that needs ninja) | **Repackage** | `release.macos.arm64.signed.repackage.yaml` |
| `packages/browseros/chromium_patches/` or Chromium C++/prefs that need compile; base tag unchanged | **Incremental** | `release.macos.arm64.signed.incremental.yaml` |
| Chromium base tag change or unknown/broken tree | **Full** | **Ask user first** |

Server rebuild needed when diff touches `packages/browseros-agent/apps/server/**`, claw-server build inputs, or staged binary contents would otherwise be stale.

Extension bump needed only when `packages/browseros-agent/apps/app/**` (shipped extension) changed since the last extension tag.

### 2. Decide versions
- Always bump `BROWSEROS_PATCH` to the next unused `0.47.0.N` (check `git tag -l 'v*'` and GitHub releases — never reuse).
- Bump extension `package.json` version **only** if extension app code changed.
- **Bump `BROWSEROS_BUILD_OFFSET` by 1** for every repackage release (see §4 pitfall below).

### 3. Prep artifacts
If server rebuild needed:
```bash
cd packages/browseros-agent
PANE_BUILD=true bun scripts/build/server.ts --target=darwin-arm64 --no-upload --ci
PANE_BUILD=true bun scripts/build/claw-server.ts --target=darwin-arm64 --no-upload --ci
bash scripts/release/stage-pane-browser-resources.sh darwin-arm64
```

If extension changed:
```bash
cd apps/app && bun run build && bun run zip
cd ../..
AGENT_EXTENSION_PRIVATE_KEY="$(cat /Users/abhishek/workspace/Pane/secrets/pane-release/agent-extension.pem)" \
bun scripts/release/pack-extension-crx.ts \
  --zip apps/app/dist/browserosapp-0.0.Y-chrome.zip \
  --output /tmp/pane-agent-0.0.Y.crx
bun scripts/release/generate-extension-update-manifest.ts \
  --app-id biedncddmddkpapdplhcnkhhplnfgbif --version 0.0.Y \
  --codebase "https://github.com/abhishek-verma/Pane/releases/download/agent-extension%2Fv0.0.Y/pane-agent-0.0.Y.crx" \
  --output /Users/abhishek/workspace/Pane/updates/extensions/bundled-manifest.xml \
  --merge-from /Users/abhishek/workspace/Pane/updates/extensions/bundled-manifest.xml
```

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

One-shot config (preferred for repackage):
```bash
cd packages/browseros
uv run browseros build \
  --config build/config/release.macos.arm64.signed.repackage.yaml \
  --chromium-src /Users/abhishek/chromium/src
```

For **incremental**, use `release.macos.arm64.signed.incremental.yaml` (compile included).

Output: `packages/browseros/releases/<version>/Pane_v<version>_arm64.dmg` + `pane-browser-release-metadata.json`.

Note: the build writes to the directory named after the PREVIOUS version (from the existing tag). Rename the DMG/metadata to the new version after the build completes.

### 5. Verify build output
```bash
VERSION=0.47.0.N

# Check CFBundleVersion in the DMG
hdiutil attach "packages/browseros/releases/*/Pane_v*_arm64.dmg" \
  -mountpoint /tmp/pane-check -nobrowse -quiet
/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" /tmp/pane-check/Pane.app/Contents/Info.plist
# Should be: chromiumBuild + BROWSEROS_BUILD_OFFSET (e.g. 7778+172 = 7950.97)

# CRITICAL: Verify designated requirement matches v0.47.0.62 format
codesign -d --requirements - /tmp/pane-check/Pane.app 2>&1 | grep "field.1.2.840.113635.100.6.2.6"
# MUST match — if empty, OTA is broken for ALL existing users. Do not ship.

# Verify compiled version matches PANE_VERSION
strings "/tmp/pane-check/Pane.app/Contents/Frameworks/Pane Framework.framework/Versions/Current/Pane Framework" | grep "^0\.47\.0\."
# Should show the current patch level. If stale, need an incremental recompile.

hdiutil detach /tmp/pane-check -quiet

# Also verify Gatekeeper
spctl -a -vvv -t open --context context:primary-signature \
  packages/browseros/releases/*/Pane_v*_arm64.dmg
```

### 6. Tag → upload → appcast

**CRITICAL — `ota browser appcast` reads the version from GitHub and may cache stale data.**
Always write the appcast manually from the metadata file to guarantee correctness.

```bash
VERSION=0.47.0.N
TAG=v$VERSION
SIG=$(python3 -c "import json;m=json.load(open('packages/browseros/releases/$VERSION/pane-browser-release-metadata.json'));print(list(m['artifacts'].values())[0]['sparkle_signature'])")
LEN=$(python3 -c "import json;m=json.load(open('packages/browseros/releases/$VERSION/pane-browser-release-metadata.json'));print(list(m['artifacts'].values())[0]['sparkle_length'])")
SV=$(python3 -c "import json;m=json.load(open('packages/browseros/releases/$VERSION/pane-browser-release-metadata.json'));print(m['sparkle_version'])")

# Tag and create release
git tag -a "$TAG" -m "Pane v$VERSION" && git push origin "$TAG"
gh release create "$TAG" \
  packages/browseros/releases/$VERSION/Pane_v${VERSION}_arm64.dmg \
  packages/browseros/releases/$VERSION/pane-browser-release-metadata.json \
  --title "Pane v$VERSION" --notes "..."

# Write appcast manually (both copies must be identical)
cat > updates/browser/appcast.xml << EOF
<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
  <channel>
    <title>Pane (macOS arm64)</title>
    <link>https://raw.githubusercontent.com/abhishek-verma/Pane/main/updates/browser/appcast.xml</link>
    <description>Pane browser updates</description>
    <language>en</language>

<item>
  <title>Pane - $VERSION</title>
  <description sparkle:format="plain-text">
  </description>
  <sparkle:version>$SV</sparkle:version>
  <sparkle:shortVersionString>$VERSION</sparkle:shortVersionString>
  <pubDate>$(date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
  <link>https://github.com/abhishek-verma/Pane/releases</link>
  <enclosure
    url="https://github.com/abhishek-verma/Pane/releases/download/$TAG/Pane_v${VERSION}_arm64.dmg"
    sparkle:edSignature="$SIG"
    length="$LEN"
    type="application/octet-stream" />
  <sparkle:minimumSystemVersion>10.15</sparkle:minimumSystemVersion>
</item>
  </channel>
</rss>
EOF
cp updates/browser/appcast.xml packages/browseros/updates/browser/appcast.xml

git add updates/browser/appcast.xml packages/browseros/updates/browser/appcast.xml
git commit -m "chore: update browser appcast for v$VERSION" && git push origin main
```

### 7. Report
DMG path + size, CFBundleVersion, sparkle:version, notarization status, release URL.

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

## Known pitfalls — build & release

### 1. "About Pane is up to date" but a newer version was released — no OTA
**Root cause**: `sparkle:version` in the appcast must be **strictly greater than** the installed `CFBundleVersion`. For repackage builds both come from `chromiumBuild + BROWSEROS_BUILD_OFFSET`. If two releases share the same offset, they get the same `CFBundleVersion` and Sparkle can't distinguish them.

**Rule: increment `packages/browseros/build/config/BROWSEROS_BUILD_OFFSET` by 1 for every repackage release.**
- After a full Chromium recompile, the raw build number advances naturally — start reasoning fresh
- Each repackage that follows increments the offset by 1 (e.g. 171 → 172 → 173...)
- The "About Pane" version string (e.g. `0.47.0.64`) comes from `PANE_VERSION`; the Sparkle comparison uses `CFBundleVersion` which is `chromiumBuild + offset`
- Always verify: `CFBundleVersion in DMG` == `sparkle:version in appcast` == `installed CFBundleVersion + 1`

```bash
# Read from DMG after build:
hdiutil attach "releases/$VERSION/Pane_v${VERSION}_arm64.dmg" -mountpoint /tmp/pane-check -nobrowse -quiet
/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" /tmp/pane-check/Pane.app/Contents/Info.plist
hdiutil detach /tmp/pane-check -quiet
```

### 2. Detecting a "stuck" build vs a failed compile
**A build that looks stuck is usually a completed-but-failed compile.** `autoninja` exits silently on error and the Python build script may appear to hang.

```bash
ps aux | grep -E "[s]iso|[a]utoninja"                        # empty = done
ls -lt /Users/abhishek/chromium/src/out/Default_arm64/siso_output  # timestamp = when compile ended
grep "FAILED" /Users/abhishek/chromium/src/out/Default_arm64/siso_output | tail -5
ls /Users/abhishek/chromium/src/out/Default_arm64/siso_failed_commands.sh  # exists = failed
```

### 3. GRD patch not applied — missing string IDs
**Symptom**: `error: use of undeclared identifier 'IDS_IMPORT_FROM_CHROME'` (or any `IDS_*` string).
**Cause**: incremental config does NOT run the `patches` module. GRD patches must already be in the working tree.
**Fix**: manually add the missing string at the correct location in the GRD, then re-run `autoninja`.
**Prevention**:
```bash
grep -c "IDS_IMPORT_FROM_CHROME" /Users/abhishek/chromium/src/chrome/app/generated_resources.grd
# must be > 0
```

### 4. Stale framework symlink — codesign fails
**Symptom**: `codesign` fails with `bundle format unrecognized, invalid, or unsuitable` on `Pane Framework.framework`.
**Cause**: `Versions/Current` symlink points to an old Chromium version string.
**Check**: `file "/Applications/Pane.app/Contents/Frameworks/Pane Framework.framework/Versions/Current"` must say `directory`, not `broken symbolic link`.
**Fix**: `autoninja -C /Users/abhishek/chromium/src/out/Default_arm64 -j 12 "Pane.app"` (~5 min, no recompile).

### 5. Build output lands in old version directory
The repackage build writes to the directory named after the currently-compiled version (e.g. `releases/0.47.0.62/`), NOT the new `PANE_VERSION`. After the build, **rename the DMG and update the metadata file** to the new version number, then update the Sparkle signature field to match the new filename.

### 6. `ota browser appcast` reads stale data from GitHub
The `uv run browseros ota browser appcast` command fetches asset metadata from the GitHub API, which may serve cached values. **Always write the appcast manually** from the local `pane-browser-release-metadata.json` file (see §6 template above) to guarantee the correct signature, length, and sparkle:version.

### 7. Two appcast files must stay in sync
Both `updates/browser/appcast.xml` (repo root) and `packages/browseros/updates/browser/appcast.xml` serve as the Sparkle feed. The build tools write to the `packages/browseros/` copy; the browser reads the root copy via GitHub raw URL. **Always `cp` one to the other and commit both together.**

### 8. `--start-from` does not exist / `--config` + `--modules` are mutually exclusive
Use `--modules sign_macos,package_macos,sparkle_sign` OR `--sign --package` flags — never with `--config`.

### 9. `chrome/VERSION` must not be overwritten
`compile` module's `_create_version_file` writes to `chrome/BROWSEROS_VERSION`. It must **never** overwrite `chrome/VERSION` — that file has `MAJOR=148` required by policy generation.

### 10. PATH requirements for incremental builds
Always set the full PATH or `gn`/`autoninja` won't be found (see §4 above).

### 11. Xcode must be full Xcode, not Command Line Tools
```bash
xcode-select -p   # must show /Applications/Xcode.app/...
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

### 12. Designated requirement must NEVER change format
**Symptom**: OTA update shows "com.panebrowser is damaged" on user machines.
**Cause**: Sparkle validates the downloaded update's code identity against the **installed** app's designated requirement. If the requirement format changes between releases, the identity check fails and macOS shows "damaged."

**Rule: the designated requirement in `sign_all_components()` must always be:**
```
=designated => identifier "com.panebrowser.app" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */
```
Never simplify this to `subject.OU` or any other format, even if it seems equivalent. The binary check is literal string matching against the installed app's seal.

**Verification after every build:**
```bash
codesign -d --requirements - /path/to/Pane.app 2>&1 | grep "field.1.2.840.113635.100.6.2.6"
# must match — if it doesn't, the build will break OTA for all existing users
```

### 13. Repackage builds freeze the About page version
**Symptom**: About page shows old version even after installing a newer repackage.
**Cause**: `BROWSEROS_VERSION` is a compile-time constant in the Chromium framework binary. Repackage builds don't recompile, so the version string stays at whatever patch level the binary was last compiled with.

**Rule: if more than 3-4 repackages accumulate since the last compile, do an incremental build** (just `autoninja -C out/Default_arm64 chrome` — takes ~8 min for a version-only change) to keep the displayed version current.

**Quick check before shipping:**
```bash
strings "out/Default_arm64/Pane.app/Contents/Frameworks/Pane Framework.framework/Versions/Current/Pane Framework" | grep "^0\.47\.0\."
# must show the CURRENT PANE_VERSION patch level
```

### 14. pkg-dmg adds FinderInfo xattrs — use hdiutil/ditto instead
**Symptom**: `codesign --verify --deep --strict` fails with "resource fork, Finder information, or similar detritus" on Sparkle's Autoupdate binary inside the DMG.
**Cause**: Chromium's `pkg-dmg` calls `rsync --archive` (preserves xattrs) and `SetFile -a C` which injects `com.apple.FinderInfo` into DMG contents. On macOS 16+, this blocks Sparkle's XPC helpers from launching.
**Fix**: `create_dmg()` now uses `ditto --noextattr --norsrc` + `hdiutil create -srcfolder` which never adds metadata.
**Prevention**: do not revert `create_dmg` to use `pkg-dmg`. If you see the detritus error in a build, verify that the ditto+hdiutil path is active.

---

## Extension release

### Extension and server always ship together
The extension and server are released in the same browser DMG. Independent extension OTA is disabled — both update atomically when the user installs a new browser version. Never ship an extension-only update that depends on a newer server API.

### Pack and update manifests
**Plain `bun run build`** — `PANE_BUILD` flag has been removed.

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
  --app-id biedncddmddkpapdplhcnkhhplnfgbif --version 0.0.Y \
  --codebase "https://github.com/abhishek-verma/Pane/releases/download/agent-extension%2Fv0.0.Y/pane-agent-0.0.Y.crx" \
  --output /Users/abhishek/workspace/Pane/updates/extensions/bundled-manifest.xml \
  --merge-from /Users/abhishek/workspace/Pane/updates/extensions/bundled-manifest.xml
```

Update only `bundled-manifest.xml` — `update-manifest.xml` is deprecated. Verify the `codebase` URL ends in `.crx` not `.zip`.

### Typecheck before shipping
```bash
cd packages/browseros-agent && bun run typecheck
```
Errors in any package are release blockers.

---

## Key architectural facts for debugging

### Extension profile routing
The extension resolves its server profile ID via `chrome.browserOS.getPref('browseros.metrics_client_id')`. This API is only available in `privileged_extension` contexts (background, sidepanel, popup) — **NOT in offscreen documents**.

- **Offscreen recorder** (`capture-offscreen/recorder.ts`): receives `profileKey` pre-resolved from the background script via the `captureAudioStart` message. Uses plain `fetch` with `X-BrowserOS-Profile-Id: profileKey`. Never calls `agentFetch` or `chrome.browserOS`.
- **Background / sidepanel**: use `agentFetch` which auto-resolves the profile key.
- **Any new code in the offscreen document** that needs to call the server must receive the profile key via message from the background — it cannot resolve it independently.

### Debugging meeting transcription issues
If the halo appears but no transcript is produced:
1. Check `~/.browseros/profiles/<profileId>/capture/default/meetings/<sessionId>/audio-chunks/` — should have `.webm` files
2. If empty: chunk uploads are failing. The profile ID used by the offscreen is probably wrong
3. Find the active profile: run in extension service worker devtools: `chrome.browserOS.getPref('browseros.metrics_client_id', p => console.log(p.value))`
4. Check server logs: `~/.browseros/logs/pane-server-$(date +%Y-%m-%d).log`
5. Check ASR model: `curl -s http://127.0.0.1:9200/capture/asr/model-status -H "X-BrowserOS-Profile-Id: <profileId>"`

### Zoom meeting capture consent
Capture consent is stored per profile in the server's SQLite DB. If the halo appears but recording stops immediately, check consents:
```bash
curl -s http://127.0.0.1:9200/capture/consents -H "X-BrowserOS-Profile-Id: <profileId>"
# zoom.us must be allowed:true
# app.zoom.us consent (if present) must also be allowed:true
```

The Zoom PWA (`app.zoom.us`) uses a multi-frame architecture. Meeting controls (mute/leave) are in a child iframe, not the main frame. The DOM probe uses `allFrames: true` to detect them.

---

## Signed CI path (when a self-hosted runner exists)

Tag-push `browser/v*` runs `.github/workflows/release-browser.yml`. Requires repository variable `CHROMIUM_SRC` and secrets `DEVELOPER_ID_P12`, `P12_PASSWORD`, `NOTARY_*`, `SPARKLE_PRIVATE_KEY`.

Until a self-hosted Mac runner is registered, **use Local signed** above.

---

## Unsigned local paths (testing only)

| Path | Config |
| --- | --- |
| Repackage | `release.macos.arm64.unsigned.repackage.yaml` |
| Incremental | `run-unsigned-browser-build.sh` → `...unsigned.incremental.yaml` |

Gatekeeper will warn. Do not ship these as production.

---

## Notes
- Prefer judgment when a release is partially done — fix forward.
- Keep release commits focused; don't scoop unrelated dirty files.
