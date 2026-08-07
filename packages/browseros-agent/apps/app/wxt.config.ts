import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'
import { LEGACY_AGENT_EXTENSION_ID } from './lib/constants/legacyAgentExtensionId'
import { PRODUCT_TAGLINE } from './lib/constants/product'
import { PRODUCT_WEB_HOST } from './lib/constants/productWebHost'

const appDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(appDir, '../../../..')

// biome-ignore lint/style/noProcessEnv: build config file needs env access
const env = process.env

// See https://wxt.dev/api/config.html
// Extension ID will be biedncddmddkpapdplhcnkhhplnfgbif
export default defineConfig({
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Pane',
    short_name: 'Pane',
    description: PRODUCT_TAGLINE,
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlY1Gvw+23owlqrSryUIiEChBhPpL4tZW8H4wYfu1PSQ8m8gR7ufXropxqGmR4EzSIlOI7ojivzeapdB2GoHyx5sfZgd23pecLdddPqKVMONGU2cx3ZgCu4jujcT43DNuGJRg026qIaPo4nbRpO8JAAyJKApCtrXUpr+1SzPFHQYdWhACSadWF/jc2JVjfgXY75izBwe/cJ6PRXS6IUOqwk99wQY9pJtXLp0yX7xU/Y03aByrnIJrz3T5BnQsA/1JMvWOYBtqJzVD6F3TBE8xEqGBGB+AGKHBrP65BpaM16A3wm3t8X76P1hkYiD2ZywuPD+n1ZfFvUVyTA3AjQjjMwIDAQAB',
    // No update_url: the extension only updates when the browser DMG is updated
    // (via Sparkle OTA). Independent extension OTA is intentionally disabled to
    // keep the extension and server versions in sync — they are always released
    // together as part of a browser release.
    web_accessible_resources: [
      {
        resources: ['app.html', 'pi.html'],
        matches: [
          `https://${PRODUCT_WEB_HOST}/*`,
          `https://*.${PRODUCT_WEB_HOST}/*`,
        ],
        extension_ids: [LEGACY_AGENT_EXTENSION_ID],
      },
    ],
    chrome_url_overrides: {
      newtab: 'app.html',
    },
    options_ui: {
      page: 'app.html#/settings',
      open_in_tab: true,
    },
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
      default_title: 'Ask Pane',
    },
    permissions: [
      'topSites',
      'storage',
      'unlimitedStorage',
      'scripting',
      'tabs',
      'tabGroups',
      'sidePanel',
      'bookmarks',
      'history',
      'browserOS',
      'alarms',
      'notifications',
      'webNavigation',
      'downloads',
      'tabCapture',
      'offscreen',
      'audioCapture',
    ],
    host_permissions: ['http://127.0.0.1/*', 'https://*/*', 'http://*/*'],
    // Sandbox page CSP for Mermaid isolation (mermaid-sandbox.html via
    // entrypoints/mermaid-sandbox.sandbox/). Scripts from extension only.
    content_security_policy: {
      sandbox:
        "sandbox allow-scripts; script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
  vite: () => ({
    build: {
      sourcemap: 'hidden',
    },
    resolve: {
      alias: {
        '@pane/logo': path.join(repoRoot, 'docs/logo'),
        '@browseros/shared': path.join(
          repoRoot,
          'packages/browseros-agent/packages/shared/src',
        ),
      },
    },
    server: {
      fs: {
        allow: [repoRoot],
      },
    },
    plugins: [
      tailwindcss(),
      ...(env.SENTRY_AUTH_TOKEN
        ? [
            sentryVitePlugin({
              org: env.SENTRY_ORG,
              project: env.SENTRY_PROJECT,
              authToken: env.SENTRY_AUTH_TOKEN,
              sourcemaps: {
                // Bug with sentry & WXT - refer: https://github.com/wxt-dev/wxt/issues/1735
                // filesToDeleteAfterUpload: ['./dist/**/*.map'],
              },
            }),
          ]
        : []),
    ],
  }),
})
