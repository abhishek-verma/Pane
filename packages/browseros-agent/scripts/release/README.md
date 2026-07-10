# Pane release secrets

Pane uses **its own** signing keys, independent of BrowserOS. Public keys live in
`pane-release-keys.public.json` (committed). Private keys live in
`secrets/pane-release/` (gitignored).

## One-time key generation

```bash
pip install cryptography   # or use packages/browseros venv

python3 packages/browseros-agent/scripts/release/generate-pane-release-keys.py
```

This creates:

| Path | Committed? | Contents |
|------|------------|----------|
| `secrets/pane-release/sparkle-private.b64` | **No** | Sparkle Ed25519 private key |
| `secrets/pane-release/agent-extension.pem` | **No** | Agent extension RSA private key |
| `secrets/pane-release/claw-extension.pem` | **No** | Claw extension RSA private key |
| `scripts/release/pane-release-keys.public.json` | **Yes** | Public keys + extension IDs |

The script also updates `wxt.config.ts`, Chromium patches, CORS allowlist, workflows, etc.

**Back up `secrets/pane-release/`** somewhere safe (password manager, encrypted drive). If you lose it, you must rotate keys and ship a new browser build.

## Upload to GitHub

```bash
export SPARKLE_PRIVATE_KEY="$(cat secrets/pane-release/sparkle-private.b64)"
export AGENT_EXTENSION_PRIVATE_KEY="$(cat secrets/pane-release/agent-extension.pem)"
export CLAW_EXTENSION_PRIVATE_KEY="$(cat secrets/pane-release/claw-extension.pem)"

python3 packages/browseros-agent/scripts/release/verify_release_secrets.py

packages/browseros-agent/scripts/release/setup-github-release-secrets.sh \
  --sparkle secrets/pane-release/sparkle-private.b64 \
  --agent secrets/pane-release/agent-extension.pem \
  --claw secrets/pane-release/claw-extension.pem
```

Secrets are stored as **repository secrets** on `abhishek-verma/Pane` so tag-triggered releases work without manual approval.

## What each key does

| Secret | Purpose |
|--------|---------|
| `SPARKLE_PRIVATE_KEY` | Signs browser DMG/installer + server OTA zips for auto-update |
| `AGENT_EXTENSION_PRIVATE_KEY` | Packs agent `.crx` for GitHub Releases and Chromium bundling |
| `CLAW_EXTENSION_PRIVATE_KEY` | Packs claw `.crx` (optional; claw is not bundled in Pane browser) |

Public counterparts are in `pane-release-keys.public.json` and embedded in the browser via `apply-pane-release-keys.py`.

## Local browser builds

Put the same Sparkle key in `packages/browseros/.env`:

```bash
SPARKLE_PRIVATE_KEY=<contents of secrets/pane-release/sparkle-private.b64>
```

Extension PEMs are only needed in GitHub for release workflows.

## Rotating keys

1. Delete `secrets/pane-release/`
2. Re-run `generate-pane-release-keys.py`
3. Commit updated `pane-release-keys.public.json` and applied file changes
4. Re-upload GitHub secrets
5. Ship new browser + extension releases (old installs will not trust new Sparkle signatures)

## Verify

```bash
python3 packages/browseros-agent/scripts/release/verify_release_secrets.py
```

## Extension IDs

See `apps/app/lib/constants/paneExtensionIds.ts` (generated). Agent ID changes whenever you rotate the agent `manifest.key`.

## Unsigned browser releases (no Apple Developer account)

Until Apple code signing is set up, ship the browser as an **unsigned DMG** on GitHub Releases.
Users see a one-time Gatekeeper warning on first launch. Install steps: `docs/install/macos.mdx`.

### Build (maintainer)

```bash
# 1. Fetch Chromium once (see docs/contributing.mdx)
# 2. Set CHROMIUM_SRC in packages/browseros/.env

packages/browseros-agent/scripts/release/build-unsigned-browser.sh
# or: packages/browseros-agent/scripts/release/build-unsigned-browser.sh --platform linux
```

Output: `packages/browseros/releases/<version>/Pane_v<version>_arm64.dmg`

### Publish

```bash
git tag -a browser/v0.47.0.1 -m "browser v0.47.0.1"
git push origin browser/v0.47.0.1

packages/browseros-agent/scripts/release/upload-browser-release.sh \
  browser/v0.47.0.1 \
  packages/browseros/releases/0.47.0.1/Pane_v0.47.0.1_arm64.dmg \
  packages/browseros/releases/0.47.0.1/pane-browser-release-metadata.json

# Re-run Release Pane Browser workflow (workflow_dispatch) to refresh appcasts
```

Config: `packages/browseros/build/config/release.macos.arm64.unsigned.yaml`

Signed releases later: use `release.macos.arm64.yaml` once Apple certs are in `.env`.
