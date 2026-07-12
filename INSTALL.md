# Installing Pane

Pane is a local-first agentic browser. It runs entirely on your machine with no Pane-operated servers. This document covers installation, auto-update, and keep-alive setup for macOS, Windows, and Linux.

## macOS

### Install

1. Download the latest `.dmg` from [GitHub Releases](https://github.com/nicepane/pane/releases).
2. Open the DMG and drag Pane to Applications.
3. On first launch, macOS may block the app. Right-click the app icon and select **Open**, then confirm.

Signed and notarized builds pass Gatekeeper automatically. Unsigned builds (from source or CI without signing certificates) require the right-click workaround.

### Auto-Update

Pane uses Sparkle for automatic updates. When a new version is published to the GitHub Release appcast (`updates/browser/appcast.xml`), Pane will download and apply it on next launch.

You can disable auto-update from Settings > Customization.

### Keep-Alive

Keep-alive starts the agent server at login so scheduled tasks, triggers, and reach notifications work even when the browser UI is closed.

**Enable:** Settings > Reach & Keep-alive > toggle "Start at login"

This installs a `launchd` LaunchAgent at `~/Library/LaunchAgents/com.pane.agent-server.plist`. The server runs with `--server-only` (no browser UI). Jobs that need browser tools wait until you open Pane.

**Logs:** `~/Library/Logs/Pane/agent-server.log`

**Uninstall:** Toggle off in settings, or run:
```bash
launchctl unload -w ~/Library/LaunchAgents/com.pane.agent-server.plist
rm ~/Library/LaunchAgents/com.pane.agent-server.plist
```

### Limitations

- A closed laptop lid or powered-off machine does not run scheduled work.
- Browser-tool jobs require an open Pane window; they skip cleanly otherwise.

---

## Windows

### Install

1. Download the latest installer (`.exe`) from [GitHub Releases](https://github.com/nicepane/pane/releases).
2. Run the installer. If Windows SmartScreen warns about an unsigned binary, click "More info" then "Run anyway."

Authenticode-signed builds do not trigger SmartScreen warnings.

### Auto-Update

Pane checks for updates via a signed manifest on GitHub Releases (WinSparkle). Updates download and install on next launch.

### Keep-Alive

Keep-alive registers a Task Scheduler entry that starts the agent server at logon.

**Enable:** Settings > Reach & Keep-alive > toggle "Start at login"

This creates a scheduled task named `PaneAgentServer` via `schtasks`.

**Uninstall:** Toggle off in settings, or run:
```powershell
schtasks /delete /tn PaneAgentServer /f
```

---

## Linux

### Install

1. Download the latest `.AppImage` from [GitHub Releases](https://github.com/nicepane/pane/releases).
2. Make it executable: `chmod +x Pane_*.AppImage`
3. Run: `./Pane_*.AppImage`

No code signing is applied to Linux builds. Verify the SHA-256 checksum from the release page.

### Auto-Update

AppImage builds support zsync-based delta updates. Place the `.AppImage` in a stable location and Pane will update in-place when a new version is available.

### Keep-Alive

Keep-alive installs a systemd user unit that starts the agent server at login.

**Enable:** Settings > Reach & Keep-alive > toggle "Start at login"

This writes a unit file to `~/.config/systemd/user/pane-agent-server.service`.

**Uninstall:** Toggle off in settings, or run:
```bash
systemctl --user disable --now pane-agent-server.service
rm ~/.config/systemd/user/pane-agent-server.service
```

---

## Data Directory

All local data lives under `~/.browseros/` (production) or `~/.browseros-dev/` (development):

| Path | Contents |
|------|----------|
| `memories/` | SOUL.md, USER.md, MEMORY.md, skills |
| `capture/` | Meeting recordings and transcripts |
| `logs/` | Server logs (rotated daily, 7-day retention) |
| `browseros.sqlite` | Context graph, action log, tasks, scheduled runs |
| `server.json` | Server discovery (port, token) |

### Export Your Data

From Settings > Diagnostics > "Export my data" or manually archive `~/.browseros/`.

### Reset

- **Wipe context index:** Settings > Diagnostics > "Wipe Context Index" (memory files survive)
- **Reset onboarding:** Settings > Diagnostics > "Reset Onboarding"
- **Full reset:** Delete `~/.browseros/` and relaunch Pane

---

## Server-Only Mode

The agent server can run independently of the browser UI:

```bash
browseros-server --server-only --server-port 9100
```

In this mode, HTTP endpoints, scheduled tasks, reach notifications, and memory work normally. Browser tools are unavailable until a Pane window connects.

---

## Building from Source

See the [README](./README.md) for build instructions. The `pane` build profile disables all cloud features at compile time.

Required: Bun, Go 1.25+, Python 3.11+ (for Chromium build scripts and ASR sidecar).
