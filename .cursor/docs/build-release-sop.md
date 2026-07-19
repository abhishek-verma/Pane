# Pane Build & Release SOP

## Key rules

- **Never run** `git reset --hard` **in the Chromium source without explicit user confirmation.** It resets all patched files and forces a near-full recompile (4+ hours). Ask first.
- **Never run** `git clean -fdq` **in the Chromium source without explicit user confirmation.** Same reason.
- A full build (with `clean` + `gclient sync`) is only needed when the Chromium base tag changes or the tree is at an unknown state.
- An incremental build (no reset, no gclient sync) reuses compiled objects and only recompiles files whose content actually changed. It takes minutes, not hours.
- **Never bump BROWSEROS_PATCH unless you intend to ship a new browser release.** Even a version-only change cascades through `chrome/VERSION` → `version_info.h` and forces recompilation of ~7,000+ files. Only bump the version when you're ready to build a new release DMG.
- **`-j` is not a valid siso flag.** Siso uses `-local_jobs N` (not `-j N`) to cap parallel jobs.

---

## Build parallelism guide (16–18GB RAM MacBook)

Siso runs the actual Chromium compilation. Too many parallel jobs = swap, slowness, and 30GB RAM pressure.

| `-local_jobs` | RAM estimate | Speed | When to use |
|---|---|---|---|
| 4 | ~4–6 GB | slowest (~90 min) | background, machine still usable |
| 8 | ~8–10 GB | fast (~45 min) | recommended default |
| 16 | ~16–20 GB | fastest but risky | only if nothing else is running |

**Recommended compile command:**
```bash
cd /Users/abhishek/chromium/src
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export PATH="$HOME/chromium/depot_tools:$PATH"
/Users/abhishek/chromium/src/third_party/siso/cipd/siso ninja \
  --offline -local_jobs 8 -C out/Default_arm64 chrome chromedriver
```

**What `-j` does in autoninja:** autoninja passes `-j` to ninja (not siso). When siso is the backend, `-j` is silently ignored or rejected — always use `-local_jobs` directly with the siso binary.

---



## Components and their versioning


| Component | Version file                                             | Current                      |
| --------- | -------------------------------------------------------- | ---------------------------- |
| Browser   | `packages/browseros/resources/BROWSEROS_VERSION`         | `0.47.0.x` (BROWSEROS_PATCH) |
| Extension | `packages/browseros-agent/apps/app/package.json`         | `0.0.x`                      |
| Server    | `packages/browseros-agent/package.json` (server version) | auto                         |


The browser's Chromium base tag is fixed at `148.0.7778.97`. The displayed Chromium version is `148.0.7949.97` (from `chrome/VERSION`).

---



## Incremental release (most common — new extension or browser patch changes)

Use this when: changing extension UI, server logic, browser C++ patches, or just bumping versions. No Chromium base tag change.

### 1. Make and commit your changes to `main`

```bash
git add ... && git commit && git push origin main
```



### 2. Bump versions

**Extension** — edit `packages/browseros-agent/apps/app/package.json`:

```json
"version": "0.0.103"
```

**Browser** — edit `packages/browseros/resources/BROWSEROS_VERSION`:

```
BROWSEROS_PATCH=6
```



### 3. Build the extension

```bash
cd packages/browseros-agent/apps/app
bun run build   # builds dist/chrome-mv3/
bun run zip     # produces dist/browserosapp-0.0.103-chrome.zip
```

Verify: `cat dist/chrome-mv3/manifest.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['version'])"`

### 4. Pack the extension as CRX

```bash
cd packages/browseros-agent
AGENT_EXTENSION_PRIVATE_KEY="$(cat /path/to/secrets/pane-release/agent-extension.pem)" \
  bun scripts/release/pack-extension-crx.ts \
    --zip apps/app/dist/browserosapp-0.0.103-chrome.zip \
    --output /tmp/pane-agent-0.0.103.crx \
    --expected-app-id biedncddmddkpapdplhcnkhhplnfgbif
```



### 5. Publish the extension CRX to GitHub

```bash
# Upload to existing release if tag already exists, otherwise create it
gh release upload agent-extension/v0.0.103 \
  --repo abhishek-verma/Pane --clobber \
  /tmp/pane-agent-0.0.103.crx#pane-agent-0.0.103.crx

# Or create new release:
gh release create agent-extension/v0.0.103 \
  --repo abhishek-verma/Pane \
  --title "Pane Agent Extension v0.0.103" \
  --notes "..." \
  /tmp/pane-agent-0.0.103.crx#pane-agent-0.0.103.crx
```

Verify the CRX URL returns HTTP 302: `curl -sI "https://github.com/abhishek-verma/Pane/releases/download/agent-extension%2Fv0.0.103/pane-agent-0.0.103.crx" | head -2`

### 6. Update the bundled extension manifest

Edit `updates/extensions/bundled-manifest.xml`:

```xml
<updatecheck codebase="https://github.com/abhishek-verma/Pane/releases/download/agent-extension%2Fv0.0.103/pane-agent-0.0.103.crx" version="0.0.103"/>
```

Note: The `/` in the tag name must be URL-encoded as `%2F` in the codebase URL.

### 7. Build the server resources (if server code changed)

```bash
cd packages/browseros-agent
PANE_BUILD=true bun scripts/build/server.ts --target=darwin-arm64 --no-upload --ci
PANE_BUILD=true bun scripts/build/claw-server.ts --target=darwin-arm64 --no-upload --ci
```

Skip if only extension UI changed and server binaries are already staged.

### 8. Commit version bumps and manifest

```bash
git add packages/browseros/resources/BROWSEROS_VERSION \
        packages/browseros-agent/apps/app/package.json \
        updates/extensions/bundled-manifest.xml
git commit -m "chore: bump browser to v0.47.0.6 and extension to v0.0.103"
git push origin main
```



### 9. Start the incremental browser build

```bash
bash packages/browseros-agent/scripts/release/run-unsigned-browser-build.sh
```

The script auto-detects that the Chromium tree is at `148.0.7778.97` and uses the incremental config (no `git reset`, no `gclient sync`). Only changed files recompile. **Expected time: 5–30 minutes.**

Monitor: `tail -f packages/browseros/logs/unsigned-release-build.log`

### 10. Create GitHub release and upload DMG

```bash
VERSION=0.47.0.6
DMG="packages/browseros/releases/$VERSION/Pane_v${VERSION}_arm64.dmg"
METADATA="packages/browseros/releases/$VERSION/pane-browser-release-metadata.json"

gh release create "browser/v$VERSION" \
  --repo abhishek-verma/Pane \
  --title "Pane Browser v$VERSION" \
  --notes "..." \
  "$DMG#Pane_v${VERSION}_arm64.dmg" \
  "$METADATA#pane-browser-release-metadata.json"
```



### 11. Update the appcast

```bash
cd packages/browseros
uv run browseros ota browser appcast --version "$VERSION" --dmg "$DMG"
```

Then copy the generated appcast to the canonical location and verify it:

```bash
cp packages/browseros/updates/browser/appcast.xml updates/browser/appcast.xml
cat updates/browser/appcast.xml | grep -A5 "$VERSION"
```



### 12. Commit and push appcast, then merge via PR

```bash
git add updates/browser/appcast.xml
git commit -m "chore: update browser appcast for v$VERSION"
git push origin main
```

---



## Full build (Chromium base tag change or clean slate)

Use this when: the Chromium base tag changes (e.g. `148.0.7778.97` → new tag), the tree is corrupted, or dependencies need a resync.

**Confirm with user before running** — this takes 3–5 hours.

```bash
# Manually reset the tree first (with user confirmation):
git -C /Users/abhishek/chromium/src reset --hard tags/<new-tag>
git -C /Users/abhishek/chromium/src clean -fdq

# Then use the full config which includes gclient sync:
cd packages/browseros
uv run browseros build \
  --config build/config/release.macos.arm64.unsigned.local.yaml \
  --chromium-src /Users/abhishek/chromium/src
```

The full config (`release.macos.arm64.unsigned.local.yaml`) runs: `clean → git_setup (gclient sync) → sparkle_setup → resources → bundled_extensions → chromium_replace → string_replaces → series_patches → patches → configure → compile → package_macos → sparkle_sign`.

---



## Patch file rules

Patch files live in `packages/browseros/chromium_patches/`. Each file is a `git diff` patch applied to the Chromium source via `git apply`.

**Critical: hunk count correctness.** `git apply` truncates new files if the `+new_count` in the `@@` header is less than the actual number of lines. Always verify:

```bash
# Test a patch before committing:
git -C /Users/abhishek/chromium/src apply --check packages/browseros/chromium_patches/path/to/file.cc

# Count lines in a new-file patch to verify the hunk header:
grep -c "^+" packages/browseros/chromium_patches/path/to/file.cc
# Should match the count in @@ -0,0 +1,N @@
```

When editing patch files:

- Context lines start with a single space ( ``)
- Removed lines start with `-`
- Added lines start with `+`
- The hunk header `@@ -old_start,old_count +new_start,new_count @@` must account for ALL lines in the hunk including trailing context
- Net change = new_count − old_count = added_lines − removed_lines

---



## Secrets location


| Secret              | Path                                       |
| ------------------- | ------------------------------------------ |
| Sparkle private key | `secrets/pane-release/sparkle-private.b64` |
| Agent extension PEM | `secrets/pane-release/agent-extension.pem` |
| Claw extension PEM  | `secrets/pane-release/claw-extension.pem`  |


`packages/browseros/.env` contains `SPARKLE_PRIVATE_KEY` and `CHROMIUM_SRC` for the build scripts.

---



## Build configs


| Config                                          | Use                                                   | Modules                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release.macos.arm64.unsigned.incremental.yaml` | Incremental release (tree already set up)             | sparkle_setup → resources → bundled_extensions → chromium_replace → string_replaces → series_patches → patches → configure → compile → package_macos → sparkle_sign |
| `release.macos.arm64.unsigned.local.yaml`       | Full build without R2 (local machine, no cloud creds) | clean → git_setup → (all above)                                                                                                                                     |


---



## Common mistakes and how to avoid them


| Mistake                                                   | Consequence                                                                  | Fix                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running `git reset --hard` in Chromium src without asking | Invalidates all compiled objects, forces 4+ hour recompile                   | Always ask user first                                                                                                                                                                                                         |
| Incorrect `+N` count in new-file patch hunk               | File truncated silently, leads to `unterminated #ifdef` or missing functions | Run `--check` before building                                                                                                                                                                                                 |
| Patch context lines that don't match actual source        | `git apply` fails with "patch does not apply"                                | Check the actual source lines, regenerate context                                                                                                                                                                             |
| Using tag URL without `%2F` encoding in codebase XML      | CRX download returns 404                                                     | Always encode `/` as `%2F` in release asset URLs                                                                                                                                                                              |
| Bundled manifest pointing to old extension version        | Browser bundles stale extension                                              | Update `updates/extensions/bundled-manifest.xml` before browser build                                                                                                                                                         |
| Appcast written to wrong path                             | Auto-update doesn't see new release                                          | Copy from `packages/browseros/updates/browser/appcast.xml` to `updates/browser/appcast.xml`                                                                                                                                   |
| Inline `<script>` block in an extension HTML entrypoint   | CSP blocks it (`script-src 'self'`); all pages that HTML serves go blank     | Extract to `apps/app/public/<name>.js` and reference as `<script src="/<name>.js">`. Only raw IIFEs survive the Vite build; `type="module"` inline scripts are fine — WXT bundles them. Never add `unsafe-inline` to the CSP. |


---



## Extension not working in a freshly built browser

If the new-tab page shows "Could not load home widgets" and the side panel doesn't load:

**1. Agent server not running (most common)**

All extension UI calls `http://127.0.0.1:9200`. `ERR_CONNECTION_REFUSED` means the server isn't up.

**2. CSP inline script violation**

Symptom: console shows `Executing inline script violates the following Content Security Policy directive 'script-src 'self''`.

Cause: an inline `<script>` block (not `type="module"`) survived in a built HTML entrypoint. MV3 extensions cannot execute inline scripts.