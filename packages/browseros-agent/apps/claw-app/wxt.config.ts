import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

// `entrypoints/newtab/` is WXT's conventional new-tab entrypoint. WXT
// auto-wires manifest.chrome_url_overrides.newtab to point at the
// generated newtab.html, so no hand-rolled override needed.
//
// `browserOS` is BrowserOS Chromium's permission gate for the
// new-tab override and the cockpit-adjacent surfaces.
export default defineConfig({
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Pane Agents',
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAp9yMXtJyQ2p3TN+aY+tjFEYVPrNMduM9fSPa0ukmt0oAPU73UENUw2ePpZgJh1j6FS5Q6nJjiJWwTr3oz4cxiFtb3ZtCAzTtG/emHktUoNEeaX+ANjXSmSqe223I1Yr60tcIK1EcwJeBjoZFahQoMaANli5bFaokIEgCfFLvU+gEg4Qi/azDoAMe8gvQrvA40nsSxxI5Emw3A1uoSb2pwAtIF3sJ4cmpY/jYtjxkLR5KKMROBh3UDDMLRUxvuat1A4pjjJfMjYduW5NROP+xepQyZYOhmC+0+YxRCXukxDNKYx4A/OkxlvhGNrAn+tny7G8YZIde9FOAACkwD41UIQIDAQAB',
    permissions: [
      'browserOS',
      'storage',
      'tabs',
      'tabGroups',
      'sidePanel',
      'notifications',
      'webNavigation',
    ],
    host_permissions: ['http://127.0.0.1/*'],
    action: {
      default_title: 'Pane Agents',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
})
