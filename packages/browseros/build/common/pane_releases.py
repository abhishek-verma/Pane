"""Canonical Pane distribution URLs on GitHub Releases and raw.githubusercontent.com."""

PANE_GITHUB_REPO = "abhishek-verma/Pane"
PANE_GITHUB_RAW_BASE = f"https://raw.githubusercontent.com/{PANE_GITHUB_REPO}/main"
PANE_GITHUB_RELEASES_BASE = f"https://github.com/{PANE_GITHUB_REPO}/releases"
PANE_GITHUB_RELEASES_LATEST = f"{PANE_GITHUB_RELEASES_BASE}/latest/download"

PANE_EXTENSION_UPDATE_MANIFEST_URL = (
    f"{PANE_GITHUB_RAW_BASE}/updates/extensions/update-manifest.xml"
)
PANE_EXTENSION_BUNDLED_MANIFEST_URL = (
    f"{PANE_GITHUB_RAW_BASE}/updates/extensions/bundled-manifest.xml"
)

PANE_BROWSER_APPCAST_ARM64_URL = (
    f"{PANE_GITHUB_RAW_BASE}/updates/browser/appcast.xml"
)
PANE_BROWSER_APPCAST_X64_URL = (
    f"{PANE_GITHUB_RAW_BASE}/updates/browser/appcast-x86_64.xml"
)
PANE_BROWSER_APPCAST_WIN_URL = (
    f"{PANE_GITHUB_RAW_BASE}/updates/browser/appcast-win.xml"
)
PANE_BROWSER_APPCAST_WIN_ARM64_URL = (
    f"{PANE_GITHUB_RAW_BASE}/updates/browser/appcast-win-arm64.xml"
)

PANE_SERVER_APPCAST_URL = f"{PANE_GITHUB_RAW_BASE}/updates/server/appcast-server.xml"
PANE_SERVER_APPCAST_ALPHA_URL = (
    f"{PANE_GITHUB_RAW_BASE}/updates/server/appcast-server.alpha.xml"
)


def github_release_download_url(tag: str, asset_name: str) -> str:
    """Return a GitHub Releases asset download URL for a tagged release."""
    encoded_tag = tag.replace("/", "%2F")
    return f"{PANE_GITHUB_RELEASES_BASE}/download/{encoded_tag}/{asset_name}"
