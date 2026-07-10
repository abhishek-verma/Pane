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
