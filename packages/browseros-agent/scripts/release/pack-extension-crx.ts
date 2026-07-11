#!/usr/bin/env bun
/**
 * Pack a WXT chrome zip into a CRX3 file for Chromium external extension updates.
 *
 * Requires the extension private key that matches the manifest `key` field.
 * Set AGENT_EXTENSION_PRIVATE_KEY or CLAW_EXTENSION_PRIVATE_KEY in CI secrets.
 *
 * Usage:
 *   AGENT_EXTENSION_PRIVATE_KEY="$(cat key.pem)" \
 *     bun scripts/release/pack-extension-crx.ts \
 *       --zip apps/app/pane-agent-0.0.100-chrome.zip \
 *       --output pane-agent-0.0.100.crx
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { $ } from 'bun'
import crx3 from 'crx3'

async function packDirectory(
  directory: string,
  privateKey: string,
  outputPath: string,
  expectedAppId?: string,
): Promise<string> {
  // crx3 signs with `keyPath` (file path), not a `privateKey` string.
  const keyDir = mkdtempSync(join(tmpdir(), 'pane-crx-key-'))
  const keyPath = join(keyDir, 'extension.pem')
  writeFileSync(keyPath, privateKey, 'utf8')

  try {
    const info = (await crx3([directory], {
      keyPath,
      crxPath: outputPath,
    })) as { appId?: string }

    const appId = info.appId
    if (!appId) {
      throw new Error('crx3 did not return an app id')
    }
    if (expectedAppId && appId !== expectedAppId) {
      throw new Error(
        `CRX app id ${appId} does not match expected ${expectedAppId}`,
      )
    }

    return appId
  } finally {
    rmSync(keyDir, { recursive: true, force: true })
  }
}

function parseArgs(argv: string[]): {
  zipPath: string
  outputPath: string
  privateKeyEnv: string
  expectedAppId?: string
} {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }
    values.set(key, next)
    i++
  }

  const zipPath = values.get('zip')
  const outputPath = values.get('output')
  const privateKeyEnv =
    values.get('private-key-env') ?? 'AGENT_EXTENSION_PRIVATE_KEY'
  if (!zipPath || !outputPath) {
    throw new Error('Required: --zip, --output (optional: --private-key-env)')
  }

  return {
    zipPath,
    outputPath,
    privateKeyEnv,
    expectedAppId: values.get('expected-app-id'),
  }
}

function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.includes('BEGIN')) {
    return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`
  }

  // Sparkle-style base64 seed (32 or 64 bytes) is not a CRX key — require PEM.
  throw new Error(
    'Extension private key must be PEM (-----BEGIN PRIVATE KEY-----). ' +
      'Store the matching key for the manifest `key` field in GitHub secrets.',
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const zipPath = resolve(args.zipPath)
  const outputPath = resolve(args.outputPath)
  const keyMaterial = process.env[args.privateKeyEnv]

  if (!keyMaterial) {
    throw new Error(`${args.privateKeyEnv} is not set`)
  }

  const privateKey = normalizePrivateKey(keyMaterial)
  const workDir = mkdtempSync(join(tmpdir(), 'pane-crx-'))

  try {
    await $`unzip -q -o ${zipPath} -d ${workDir}`.quiet()
    const appId = await packDirectory(
      workDir,
      privateKey,
      outputPath,
      args.expectedAppId,
    )
    process.stderr.write(
      `Packed ${basename(outputPath)} from ${basename(zipPath)} (app id ${appId})\n`,
    )
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

await main()
