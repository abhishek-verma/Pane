import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createR2Client,
  joinObjectKey,
  uploadFileToObject,
} from '@browseros/build-server-tools'
import { log } from '../log'
import { type CliUploadConfig, loadCliUploadConfig } from './config'

// Canonical release repo. CLI artifacts are hosted on GitHub Releases; no
// Pane-operated CDN is required. Bump this one constant to move the
// distribution repo.
const GITHUB_REPO = 'abhishek-verma/Pane'
const GITHUB_RELEASES_BASE = `https://github.com/${GITHUB_REPO}/releases/download`
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8'
const CLI_ARCHIVE_PATTERN =
  /^browseros-cli_(?<version>[^_]+)_(?<os>darwin|linux|windows)_(?<arch>amd64|arm64)\.(?<ext>tar\.gz|zip)$/

const INSTALLERS = [
  {
    filePath: join('apps', 'cli', 'scripts', 'install.sh'),
    objectName: 'install.sh',
    contentType: 'text/x-shellscript; charset=utf-8',
  },
  {
    filePath: join('apps', 'cli', 'scripts', 'install.ps1'),
    objectName: 'install.ps1',
    contentType: 'text/plain; charset=utf-8',
  },
] as const

export interface CliReleaseOptions {
  version: string
  binariesDir: string
}

export interface CliReleaseAsset {
  filename: string
  url: string
  archive_format: 'tar.gz' | 'zip'
  sha256: string
}

export interface CliReleaseManifest {
  version: string
  published_at: string
  tag: string
  assets: Record<string, CliReleaseAsset>
}

export interface CliArchiveMetadata {
  filename: string
  version: string
  os: string
  arch: string
  archive_format: 'tar.gz' | 'zip'
}

function resolveRootDir(): string {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  process.chdir(rootDir)
  return rootDir
}

export async function runCliInstallerUpload(): Promise<void> {
  await uploadCliInstallers(resolveRootDir())
}

export async function runCliRelease(options: CliReleaseOptions): Promise<void> {
  await uploadCliRelease(resolveRootDir(), options)
}

/** Returns the R2 upload config, or null when no R2 credentials are present (e.g. a fork without a CDN). */
function tryLoadR2Config(rootDir: string): CliUploadConfig | null {
  try {
    return loadCliUploadConfig(rootDir)
  } catch {
    return null
  }
}

async function uploadCliInstallers(rootDir: string): Promise<void> {
  const config = tryLoadR2Config(rootDir)
  if (config === null) {
    log.info(
      'R2 credentials not configured — skipping installer CDN upload (installers are fetched via raw GitHub URLs)',
    )
    return
  }

  const client = createR2Client(config.r2)

  log.header('Uploading BrowserOS CLI installer scripts')

  try {
    for (const installer of INSTALLERS) {
      const absolutePath = join(rootDir, installer.filePath)
      if (!existsSync(absolutePath)) {
        throw new Error(`Installer script not found: ${installer.filePath}`)
      }

      const objectKey = joinObjectKey(
        config.r2.uploadPrefix,
        installer.objectName,
      )
      log.step(`Uploading ${installer.filePath}`)
      await uploadFileToObject(client, config.r2, objectKey, absolutePath, {
        contentType: installer.contentType,
      })
      log.success(`Uploaded ${objectKey}`)
    }

    log.done('CLI installer upload completed')
  } finally {
    client.destroy()
  }
}

export function parseCliChecksums(contents: string): Map<string, string> {
  const entries = new Map<string, string>()
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i)
    if (!match) {
      throw new Error(`Invalid checksum line: ${rawLine}`)
    }
    entries.set(match[2], match[1].toLowerCase())
  }
  return entries
}

export function parseCliArchiveFilename(
  filename: string,
): CliArchiveMetadata | null {
  const match = filename.match(CLI_ARCHIVE_PATTERN)
  if (!match?.groups) {
    return null
  }
  const archive_format = match.groups.ext as 'tar.gz' | 'zip'
  return {
    filename,
    version: match.groups.version,
    os: match.groups.os,
    arch: match.groups.arch,
    archive_format,
  }
}

export function buildCliReleaseManifest(options: {
  version: string
  filenames: string[]
  checksumsContent: string
  published_at?: string
  cdnBaseURL?: string
  uploadPrefix?: string
}): CliReleaseManifest {
  const checksumByFilename = parseCliChecksums(options.checksumsContent)
  const assets: Record<string, CliReleaseAsset> = {}
  const filenames = [...options.filenames].sort()
  const cdnBaseURL = options.cdnBaseURL ?? GITHUB_RELEASES_BASE
  const uploadPrefix = options.uploadPrefix ?? 'cli'

  for (const filename of filenames) {
    const archive = parseCliArchiveFilename(filename)
    if (archive === null) {
      throw new Error(`Unexpected CLI archive filename: ${filename}`)
    }
    if (archive.version !== options.version) {
      throw new Error(
        `Archive ${filename} does not match release version ${options.version}`,
      )
    }

    const checksum = checksumByFilename.get(filename)
    if (!checksum) {
      throw new Error(`Missing checksum for ${filename}`)
    }

    const assetKey = `${archive.os}/${archive.arch}`
    assets[assetKey] = {
      filename,
      url: `${cdnBaseURL}/${joinObjectKey(uploadPrefix, `v${options.version}`, filename)}`,
      archive_format: archive.archive_format,
      sha256: checksum,
    }
  }

  return {
    version: options.version,
    published_at: options.published_at ?? new Date().toISOString(),
    tag: `cli/v${options.version}`,
    assets,
  }
}

/**
 * Writes manifest.json + version.txt into the binaries dir so they ship as
 * GitHub Release assets (the CLI self-update fetches them via the
 * /releases/latest/download/<asset> redirect). When R2 credentials are
 * present, also mirrors them to the CDN.
 */
async function writeReleaseMetadata(
  absoluteBinariesDir: string,
  version: string,
  releaseArchives: string[],
  config: CliUploadConfig | null,
): Promise<void> {
  const checksumsPath = join(absoluteBinariesDir, 'checksums.txt')
  if (!existsSync(checksumsPath)) {
    throw new Error('checksums.txt is required to build CLI manifest')
  }

  const manifest = buildCliReleaseManifest({
    version,
    filenames: releaseArchives,
    checksumsContent: readFileSync(checksumsPath, 'utf-8'),
  })

  const manifestPath = join(absoluteBinariesDir, 'manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
  log.success(`Wrote ${manifestPath}`)
  log.info(
    `manifest asset URL: ${GITHUB_RELEASES_BASE}/cli/v${version}/manifest.json`,
  )

  const versionPath = join(absoluteBinariesDir, 'version.txt')
  writeFileSync(versionPath, version, 'utf-8')
  log.success(`Wrote ${versionPath}`)

  if (config === null) {
    return
  }

  const client = createR2Client(config.r2)
  try {
    const versionedManifestKey = joinObjectKey(
      config.r2.uploadPrefix,
      `v${version}`,
      'manifest.json',
    )
    const latestManifestKey = joinObjectKey(
      config.r2.uploadPrefix,
      'latest',
      'manifest.json',
    )
    const latestVersionKey = joinObjectKey(
      config.r2.uploadPrefix,
      'latest',
      'version.txt',
    )

    log.step('Mirroring manifest.json + version.txt to R2')
    await uploadFileToObject(
      client,
      config.r2,
      versionedManifestKey,
      manifestPath,
      {
        contentType: JSON_CONTENT_TYPE,
      },
    )
    await uploadFileToObject(
      client,
      config.r2,
      latestManifestKey,
      manifestPath,
      {
        contentType: JSON_CONTENT_TYPE,
      },
    )
    await uploadFileToObject(client, config.r2, latestVersionKey, versionPath, {
      contentType: TEXT_CONTENT_TYPE,
    })
    log.success('Mirrored manifest + version to R2')
  } finally {
    client.destroy()
  }
}

async function uploadCliRelease(
  rootDir: string,
  options: CliReleaseOptions,
): Promise<void> {
  const { version, binariesDir } = options
  const absoluteBinariesDir = resolve(rootDir, binariesDir)

  if (!existsSync(absoluteBinariesDir)) {
    throw new Error(`Binaries directory not found: ${binariesDir}`)
  }

  const archives = readdirSync(absoluteBinariesDir).filter(
    (f) => f.endsWith('.tar.gz') || f.endsWith('.zip') || f === 'checksums.txt',
  )
  if (archives.length === 0) {
    throw new Error(`No archives found in ${binariesDir}`)
  }
  const releaseArchives = archives.filter((f) => f !== 'checksums.txt')

  const config = tryLoadR2Config(rootDir)

  log.header(`Publishing BrowserOS CLI v${version} release`)

  if (config === null) {
    log.info(
      'R2 credentials not configured — GitHub Release will host all artifacts (manifest.json, version.txt, archives, checksums.txt)',
    )
  }

  if (config !== null) {
    const client = createR2Client(config.r2)
    try {
      for (const filename of archives) {
        const filePath = join(absoluteBinariesDir, filename)
        const versionedKey = joinObjectKey(
          config.r2.uploadPrefix,
          `v${version}`,
          filename,
        )
        const latestKey = joinObjectKey(
          config.r2.uploadPrefix,
          'latest',
          filename,
        )

        log.step(`Uploading ${filename} to R2`)
        await uploadFileToObject(client, config.r2, versionedKey, filePath)
        await uploadFileToObject(client, config.r2, latestKey, filePath)
        log.success(`Uploaded ${filename}`)
      }
    } finally {
      client.destroy()
    }
  }

  await writeReleaseMetadata(
    absoluteBinariesDir,
    version,
    releaseArchives,
    config,
  )

  log.done('CLI release artifacts ready (GitHub Release hosts distribution)')
}

// Re-exported for callers that historically imported it alongside the runner.
export { GITHUB_RELEASES_BASE, GITHUB_REPO }
