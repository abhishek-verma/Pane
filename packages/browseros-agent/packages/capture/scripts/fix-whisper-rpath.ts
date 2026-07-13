#!/usr/bin/env bun
/**
 * Post-install: fix the @rpath in whisper.node binaries so they can find
 * their bundled dylibs at runtime using @loader_path instead of the
 * hardcoded CI builder path.
 *
 * This is a known packaging bug in @kutalia/whisper-node-addon on macOS.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  'node_modules/@kutalia/whisper-node-addon/dist',
)

if (process.platform !== 'darwin') {
  process.exit(0)
}

if (!existsSync(PKG_DIST)) {
  // Package not installed yet — silent exit, bun install will call us again
  process.exit(0)
}

const CI_RPATH =
  '/Users/runner/work/whisper-node-addon/whisper-node-addon/deps/whisper.cpp/build/Release'

for (const dir of readdirSync(PKG_DIST)) {
  const nodePath = join(PKG_DIST, dir, 'whisper.node')
  if (!existsSync(nodePath)) continue

  try {
    // Check if the bad rpath is still present
    const rpaths = execSync(`otool -l "${nodePath}" 2>/dev/null`).toString()
    if (!rpaths.includes(CI_RPATH)) continue

    execSync(
      `install_name_tool -rpath "${CI_RPATH}" "@loader_path" "${nodePath}"`,
      { stdio: 'pipe' },
    )
    console.log(`[capture postinstall] Fixed rpath in ${dir}/whisper.node`)
  } catch {
    // Non-fatal — may already be fixed or on a different platform
  }
}
