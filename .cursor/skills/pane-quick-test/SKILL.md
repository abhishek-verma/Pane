---
name: pane-quick-test
description: >-
  Install the latest server and/or extension build into the installed Pane app
  (/Applications/Pane.app) as a proper install via unsigned repackage DMG — no
  special launch flags, persists across restarts, ready for all-day testing.
  Use before running pane-incremental-release, or whenever the user wants to
  test new server/extension code in the real installed browser with their real
  profile.
---

# Pane quick test (unsigned repackage DMG)

Install the latest **server** (`packages/browseros-agent/apps/server/**`) and/or
**extension** (`packages/browseros-agent/apps/app/**`) into `/Applications/Pane.app`
as a real install — the app launches normally, with no CLI switches, and the
changes persist across browser and OS restarts.

This is the **pre-release test loop** for catching hidden issues / side-effects
throughout the day. Once verified, ship with `pane-incremental-release`.

## When to use

- "Install / test the latest server or extension changes in Pane"
- Any server-only, extension-only, or combined change to test in the installed
  browser with the real profile.
- Do **not** use for Chromium C++ / `chromium_patches/` changes — those need a
  full build (see `pane-incremental-release`).

## Why not rsync into /Applications directly?

macOS enforces quarantine xattrs on signed app bundles. Even as the owner,
`chmod` and `xattr -d` are silently ignored, so rsync cannot overwrite existing
files in the bundle. The DMG approach sidesteps this entirely.

## Steps

### 1. Build server + claw from the working tree

```bash
cd /Users/abhishek/workspace/Pane/packages/browseros-agent
PANE_BUILD=true bun scripts/build/server.ts --target=darwin-arm64 --no-upload --ci
PANE_BUILD=true bun scripts/build/claw-server.ts --target=darwin-arm64 --no-upload --ci
```

Skip whichever component has no changes.

### 2. Stage artifacts into the chromium tree

```bash
cd /Users/abhishek/workspace/Pane
bash packages/browseros-agent/scripts/release/stage-pane-browser-resources.sh darwin-arm64
```

### 3. (Extension changes only) Build zip → CRX, place in /tmp

```bash
cd /Users/abhishek/workspace/Pane/packages/browseros-agent/apps/app
# Bump patch in package.json if version matches what's already in the profile
bun run zip   # → .output/pane-agent-0.0.Y-chrome.zip
cd /Users/abhishek/workspace/Pane
AGENT_EXTENSION_PRIVATE_KEY="$(cat secrets/pane-release/agent-extension.pem)" \
  bun packages/browseros-agent/scripts/release/pack-extension-crx.ts \
  --zip packages/browseros-agent/apps/app/.output/pane-agent-0.0.Y-chrome.zip \
  --output /tmp/pane-agent-0.0.Y.crx \
  --expected-app-id biedncddmddkpapdplhcnkhhplnfgbif
# The bundled_extensions module in the repackage build will pick up the local CRX
# from /tmp automatically if it matches the version in bundled-manifest.xml.
# If not, place it where the build expects and update the manifest, or let the
# build fetch from CDN (for testing server-only changes this step is not needed).
```

### 4. Build the unsigned repackage DMG (~10 s)

`package_macos` packages from `out/Default_arm64/Pane.app` — **not** from the
chromium source tree. The `resources` module only updates
`chromium/src/chrome/browser/browseros/server/resources/` (the Ninja source),
so you must **also copy staged resources directly into the out/ bundle** before
packaging.

```bash
# Copy staged resources into the built out/ bundle
OUT=/Users/abhishek/chromium/src/out/Default_arm64/Pane.app/Contents/Resources
STAGED=/Users/abhishek/workspace/Pane/packages/browseros/resources/binaries

rm -rf "$OUT/BrowserOSServer/default/resources"
cp -R "$STAGED/browseros_server/darwin-arm64/resources" "$OUT/BrowserOSServer/default/resources"

rm -rf "$OUT/BrowserOSClawServer/default/resources"
cp -R "$STAGED/browseros_claw_server/darwin-arm64/resources" "$OUT/BrowserOSClawServer/default/resources"

# Package + sparkle-sign
cd /Users/abhishek/workspace/Pane/packages/browseros
uv run browseros build --modules bundled_extensions,package_macos,sparkle_sign \
  --arch arm64 --build-type release \
  --chromium-src /Users/abhishek/chromium/src
```

Output: `packages/browseros/releases/<version>/Pane_v<version>_arm64.dmg`

### 5. Install and launch

Use `ditto` from the terminal — Finder drag-to-replace merges rather than
replaces, leaving old binaries behind.

```bash
VERSION=<version>  # e.g. 0.47.0.54
osascript -e 'quit app "Pane"' 2>/dev/null; sleep 2

hdiutil attach packages/browseros/releases/$VERSION/Pane_v${VERSION}_arm64.dmg -nobrowse
rm -rf /Applications/Pane.app
ditto "/Volumes/Pane/Pane.app" /Applications/Pane.app

# Clear quarantine (errors on signed Chromium binary/lproj files are expected and harmless)
xattr -dr com.apple.quarantine /Applications/Pane.app 2>/dev/null; true

# Ad-hoc sign the whisper .node file so Gatekeeper doesn't block it
find "/Applications/Pane.app/Contents/Resources/BrowserOSServer/default/resources/asr" \
  -type f \( -name "*.node" -o -name "*.dylib" \) \
  -exec codesign --force --sign - {} \; 2>/dev/null; true

open -a Pane
```

## Verify

- **Server binary timestamp** — this is the fastest check. The installed binary
  mtime should match the build artifact:
  ```bash
  ls -la "/Applications/Pane.app/Contents/Resources/BrowserOSServer/default/resources/bin/browseros_server"
  ls -la /Users/abhishek/workspace/Pane/packages/browseros-agent/dist/prod/server/.tmp/binaries/browseros-server-darwin-arm64
  # Both should show the same timestamp (today's build time)
  ```
- **Server behavior:** exercise the changed functionality (chat, agent, capture,
  scheduled tasks, …) over the day — restarts included (Cmd-Q + relaunch, full
  OS restart).
- **Extension:** Settings/about or `chrome://extensions` shows the new `0.0.Y`
  for `biedncddmddkpapdplhcnkhhplnfgbif`. If it still shows the old version, the
  profile copy is pinned — delete it and relaunch:
  `rm -rf "$HOME/Library/Application Support/Pane/Default/Extensions/biedncddmddkpapdplhcnkhhplnfgbif"`

## Caveats

- The unsigned DMG is **not notarized** — Gatekeeper blocks it unless quarantine
  is cleared (step 5). Never distribute it. The next signed release restores
  notarization.
- Only server/extension changes. Chromium C++ / `chromium_patches/` changes
  require `pane-incremental-release` (incremental build).
- The unsigned repackage uses the version already in
  `packages/browseros/resources/BROWSEROS_VERSION` — don't bump it here; save
  the bump for the real signed release.

## Revert

Reinstall the last release DMG over `/Applications/Pane.app`, or wait for the
next Sparkle OTA update which restores a notarized copy.

## Production path

Once quick-test passes, ship with `pane-incremental-release` which builds the
signed + notarized DMG, tags, uploads, and updates the Sparkle appcast.
