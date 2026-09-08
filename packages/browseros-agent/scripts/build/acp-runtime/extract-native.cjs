// Build-time only. Preload into the pinned Bun-compiled CLI before its entrypoint.
// Enumerate the complete embedded native closure, not a list of today's filenames.
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { join, basename } = require('node:path')
const output = process.env.PANE_NATIVE_OUTPUT
if (!output) throw new Error('PANE_NATIVE_OUTPUT is required')
mkdirSync(output, { recursive: true })
const names = new Set()
for (const file of Bun.embeddedFiles) {
  if (!file.name.endsWith('.node')) continue
  if (basename(file.name) !== file.name || names.has(file.name)) {
    throw new Error(`Ambiguous embedded native module: ${file.name}`)
  }
  names.add(file.name)
  // Preloads must finish synchronously; --version may exit before an async
  // Blob.arrayBuffer continuation. Bun exposes embedded files through node:fs.
  writeFileSync(
    join(output, file.name),
    readFileSync(`/$bunfs/root/${file.name}`),
  )
}
writeFileSync(
  join(output, 'manifest.json'),
  JSON.stringify({ schema: 1, modules: [...names].sort() }),
)
process.exit(0)
