/**
 * Primary public URL for Pane — used for docs, help, about, and community links in the UI.
 * @public
 */
export const PANE_GITHUB_URL = 'https://github.com/abhishek-verma/Pane'

/** GitHub repo slug (`owner/name`) for release asset URLs. */
export const PANE_GITHUB_REPO = 'abhishek-verma/Pane'

/** Raw content on the default branch — stable URLs for update manifests. */
export const PANE_GITHUB_RAW_BASE = `https://raw.githubusercontent.com/${PANE_GITHUB_REPO}/main`

/** GitHub Releases download base (per-tag assets). */
export const PANE_GITHUB_RELEASES_BASE = `${PANE_GITHUB_URL}/releases`

/** Latest-release asset prefix (`…/latest/download/<asset>`). */
export const PANE_GITHUB_RELEASES_LATEST = `${PANE_GITHUB_RELEASES_BASE}/latest/download`

/** Chrome extension auto-update manifest (repo-tracked, updated each extension release). */
export const PANE_EXTENSION_UPDATE_MANIFEST_URL = `${PANE_GITHUB_RAW_BASE}/updates/extensions/update-manifest.xml`

/** Bundled extension versions used when building the Chromium browser. */
export const PANE_EXTENSION_BUNDLED_MANIFEST_URL = `${PANE_GITHUB_RAW_BASE}/updates/extensions/bundled-manifest.xml`

/**
 * @public
 */
export const productRepositoryUrl = PANE_GITHUB_URL

/**
 * @public
 */
export const githubOrgUrl = PANE_GITHUB_URL

/**
 * @public
 */
export const docsUrl = PANE_GITHUB_URL

/**
 * @public
 */
export const productWebUrl = PANE_GITHUB_URL

/**
 * @public
 */
export const privacyPolicyUrl = PANE_GITHUB_URL

/**
 * @public
 */
export const contributorsUrl = `${PANE_GITHUB_URL}/graphs/contributors`

/**
 * @public
 */
export const productRepositoryShortUrl = PANE_GITHUB_URL

/**
 * @public
 */
export const scheduledTasksHelpUrl = PANE_GITHUB_URL

/**
 * @public
 */
export const mcpSetupGuideUrl = PANE_GITHUB_URL

/**
 * @public
 */
export const byokGuideUrl = PANE_GITHUB_URL

/**
 * @public
 */
export const connectionTroubleshootingUrl = PANE_GITHUB_URL

/**
 * @public
 */
export const changelogUrl = `${PANE_GITHUB_URL}/releases`

/**
 * @public
 * TODO(pane-infra): Pane Discord invite URL
 */
export const discordUrl: string | null = null

/**
 * @public
 * TODO(pane-infra): Pane Slack invite URL
 */
export const slackUrl: string | null = null

/**
 * @public
 */
export const productVideoUrl = 'https://youtu.be/J-lFhTP-7is'
