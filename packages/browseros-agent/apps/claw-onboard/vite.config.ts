import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function readPaneVersion(): string {
  try {
    const versionPath = fileURLToPath(
      new URL(
        '../../../browseros/resources/BROWSEROS_VERSION',
        import.meta.url,
      ),
    )
    const text = readFileSync(versionPath, 'utf8')
    const values = Object.fromEntries(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [key, value] = line.split('=')
          return [key, value]
        }),
    )
    const major = values.BROWSEROS_MAJOR ?? '0'
    const minor = values.BROWSEROS_MINOR ?? '0'
    const build = values.BROWSEROS_BUILD ?? '0'
    const patch = values.BROWSEROS_PATCH ?? '0'
    return `${major}.${minor}.${build}.${patch}`
  } catch {
    return '0.47.0'
  }
}

export default defineConfig(({ mode }) => {
  const isChromiumBuild = mode === 'chromium'
  const paneVersion = readPaneVersion()

  return {
    base: isChromiumBuild ? './' : undefined,
    plugins: [react(), tailwindcss()],
    define: {
      __PANE_ONBOARDING_VERSION__: JSON.stringify(paneVersion),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: isChromiumBuild
      ? {
          outDir: 'dist/chromium',
          emptyOutDir: true,
          assetsDir: '.',
          cssCodeSplit: false,
          modulePreload: { polyfill: false },
          assetsInlineLimit: 0,
          rollupOptions: {
            output: {
              entryFileNames: 'app.js',
              chunkFileNames: 'app.js',
              inlineDynamicImports: true,
              assetFileNames: (assetInfo) => {
                const name = assetInfo.names[0] ?? ''
                if (name.endsWith('.css')) return 'app.css'
                throw new Error(
                  `Unexpected Chromium resource asset emitted: ${name}`,
                )
              },
            },
          },
        }
      : undefined,
  }
})
