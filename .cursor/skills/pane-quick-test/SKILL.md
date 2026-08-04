---
name: pane-quick-test
description: >-
  Build an unsigned repackage DMG with the latest server and extension changes
  from the working tree. Reveals it in Finder. That's it.
---

# Pane quick test

Builds an unsigned DMG with the latest server + extension from the working tree.
Opens it in Finder. You install it.

Not for Chromium C++ changes — server and extension only.

**Prerequisite:** `out/Default_arm64/Pane.app` must already have the correct
Info.plist values (`CFBundleIdentifier: com.panebrowser.app`,
`CFBundleShortVersionString: 0.47.0.x`). Verify with:
```bash
/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" \
  /Users/abhishek/chromium/src/out/Default_arm64/Pane.app/Contents/Info.plist
```
If it still shows `com.browseros.BrowserOS`, patch it first — see the
"Fix Bundle ID" task in the repo docs.

---

```bash
# 1. Build server + claw
cd /Users/abhishek/workspace/Pane/packages/browseros-agent
PANE_BUILD=true bun scripts/build/server.ts --target=darwin-arm64 --no-upload --ci
PANE_BUILD=true bun scripts/build/claw-server.ts --target=darwin-arm64 --no-upload --ci

# 2. Build extension
cd /Users/abhishek/workspace/Pane/packages/browseros-agent/apps/app
bun run zip

# 3. Stage server + pack extension CRX
cd /Users/abhishek/workspace/Pane
bash packages/browseros-agent/scripts/release/stage-pane-browser-resources.sh darwin-arm64

EXT_VER=$(python3 -c "import json; print(json.load(open('packages/browseros-agent/apps/app/package.json'))['version'])")
AGENT_EXTENSION_PRIVATE_KEY="$(cat secrets/pane-release/agent-extension.pem)" \
  bun packages/browseros-agent/scripts/release/pack-extension-crx.ts \
  --zip "packages/browseros-agent/apps/app/dist/browserosapp-${EXT_VER}-chrome.zip" \
  --output "/tmp/pane-agent-${EXT_VER}.crx" \
  --expected-app-id biedncddmddkpapdplhcnkhhplnfgbif

# 4. Inject into out/ bundle
OUT=/Users/abhishek/chromium/src/out/Default_arm64/Pane.app/Contents/Resources
STAGED=/Users/abhishek/workspace/Pane/packages/browseros/resources/binaries

rm -rf "$OUT/BrowserOSServer/default/resources"
cp -R "$STAGED/browseros_server/darwin-arm64/resources"      "$OUT/BrowserOSServer/default/resources"
rm -rf "$OUT/BrowserOSClawServer/default/resources"
cp -R "$STAGED/browseros_claw_server/darwin-arm64/resources" "$OUT/BrowserOSClawServer/default/resources"

APP=/Users/abhishek/chromium/src/out/Default_arm64/Pane.app
FW_VER="$(ls "$APP/Contents/Frameworks/Pane Framework.framework/Versions/" | grep -vx Current | head -1)"
cp "/tmp/pane-agent-${EXT_VER}.crx" \
  "$APP/Contents/Frameworks/Pane Framework.framework/Versions/$FW_VER/Resources/browseros_extensions/biedncddmddkpapdplhcnkhhplnfgbif.crx"

# 5. Build DMG and reveal in Finder
cd /Users/abhishek/workspace/Pane/packages/browseros
uv run browseros build \
  --config build/config/release.macos.arm64.unsigned.repackage.yaml \
  --chromium-src /Users/abhishek/chromium/src

VERSION=$(python3 -c "
import re, pathlib
t = pathlib.Path('resources/BROWSEROS_VERSION').read_text()
v = {k:v for k,v in re.findall(r'(\w+)=(\d+)', t)}
print(f\"{v['BROWSEROS_MAJOR']}.{v['BROWSEROS_MINOR']}.{v['BROWSEROS_BUILD']}.{v['BROWSEROS_PATCH']}\")
")
open -R "releases/$VERSION/Pane_v${VERSION}_arm64.dmg"
```
