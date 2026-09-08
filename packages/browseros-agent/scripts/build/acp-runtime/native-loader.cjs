// Release-owned preload. Never extract or sign code on the user's machine.
const { readFileSync, realpathSync } = require('node:fs')
const { basename, join, relative, isAbsolute } = require('node:path')
const root = realpathSync(join(__dirname, 'native', 'claude'))
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
if (manifest.schema !== 1 || !Array.isArray(manifest.modules))
  throw new Error('Invalid Pane native runtime manifest')
const modules = new Set(manifest.modules)
const original = process.dlopen
process.dlopen = function (module, filename, ...args) {
  if (
    typeof filename === 'string' &&
    (filename.includes('/$bunfs/') || filename.includes('\\~BUN\\'))
  ) {
    const name = basename(filename)
    if (!modules.has(name))
      throw new Error(
        `Pane runtime is missing embedded native module ${name}. Update Pane; no unsigned module was loaded.`,
      )
    const target = realpathSync(join(root, name))
    const rel = relative(root, target)
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new Error('Pane native module escapes its signed runtime')
    return original.call(this, module, target, ...args)
  }
  return original.call(this, module, filename, ...args)
}
