import { execFileSync } from 'node:child_process'
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  BuildTarget,
  ResourceRule,
  StagedArtifact,
} from '@browseros/build-server-tools'

/** Resolve dependencies at build time using the committed integrity lockfile.
 * macOS closures must be prepared on macOS so Bun's embedded assets can be
 * enumerated before Developer ID signing. Cross-compilation alone is insufficient. */
export async function prepareAcpRuntime(
  target: BuildTarget,
  rootDir: string,
): Promise<{ rules: ResourceRule[]; dispose: () => Promise<void> }> {
  if (target.os === 'macos' && process.platform !== 'darwin') {
    throw new Error(
      'Build macOS server resources on macOS: embedded provider native modules must be staged before signing.',
    )
  }
  const source = resolve(rootDir, 'scripts/build/acp-runtime')
  const output = await mkdtemp(join(tmpdir(), `pane-acp-${target.id}-`))
  try {
    for (const file of ['package.json', 'package-lock.json'])
      await cp(join(source, file), join(output, file))
    const platform =
      target.os === 'macos'
        ? 'darwin'
        : target.os === 'windows'
          ? 'win32'
          : 'linux'
    execFileSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      [
        'ci',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        `--os=${platform}`,
        `--cpu=${target.arch}`,
      ],
      { cwd: output, stdio: 'inherit', timeout: 600_000 },
    )
    const claude = `node_modules/@anthropic-ai/claude-agent-sdk-${platform}-${target.arch}/claude${platform === 'win32' ? '.exe' : ''}`
    const codexPackage = join(
      output,
      `node_modules/@openai/codex-${platform}-${target.arch}`,
    )
    const nativeName = platform === 'win32' ? 'codex.exe' : 'codex'
    const codexFiles = (
      await readdir(codexPackage, { recursive: true, withFileTypes: true })
    ).filter((entry) => entry.isFile() && entry.name === nativeName)
    if (codexFiles.length !== 1)
      throw new Error('Expected exactly one packaged Codex executable')
    const codex = relative(
      output,
      join(codexFiles[0].parentPath, nativeName),
    ).replaceAll('\\', '/')
    if (target.os === 'macos') {
      const native = join(output, 'native', 'claude')
      await mkdir(native, { recursive: true })
      execFileSync(join(output, claude), ['--version'], {
        env: {
          ...process.env,
          BUN_OPTIONS: `--preload=${pathToFileURL(join(source, 'extract-native.cjs')).href}`,
          PANE_NATIVE_OUTPUT: native,
        },
        timeout: 60_000,
        stdio: 'inherit',
      })
      // Read this now so a CLI that stops honoring preloads fails the build.
      const extracted = JSON.parse(
        await readFile(join(native, 'manifest.json'), 'utf8'),
      )
      if (extracted.schema !== 1 || !Array.isArray(extracted.modules))
        throw new Error('Provider native extraction failed')
      await cp(
        join(source, 'native-loader.cjs'),
        join(output, 'native-loader.cjs'),
      )
    }
    await writeFile(
      join(output, 'runtime.json'),
      JSON.stringify(
        {
          schema: 1,
          platform,
          arch: target.arch,
          adapters: {
            claude: {
              entrypoint:
                'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js',
              executable: claude,
            },
            codex: {
              entrypoint:
                'node_modules/@agentclientprotocol/codex-acp/dist/index.js',
              executable: codex,
            },
          },
        },
        null,
        2,
      ),
    )
    return {
      rules: [
        {
          name: 'Locked ACP runtimes',
          source: { type: 'local', path: output },
          destination: 'resources/acp-runtime',
          recursive: true,
        },
      ],
      dispose: () => rm(output, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(output, { recursive: true, force: true })
    throw error
  }
}

/** Standalone server OTA must pass the same native-code trust requirements as
 * the app bundle. CI resources are signed later by the browser packaging job. */
export async function finalizeAcpArtifact(
  artifact: StagedArtifact,
  options: { ci: boolean },
) {
  if (options.ci || artifact.target.os !== 'macos') return
  const browserosRoot = resolve(import.meta.dir, '../../../../browseros')
  execFileSync(
    'uv',
    [
      'run',
      '--project',
      browserosRoot,
      'python',
      '-m',
      'build.scripts.sign_server_runtime',
      resolve(artifact.resourcesDir),
    ],
    {
      cwd: browserosRoot,
      stdio: 'inherit',
      timeout: 60 * 60 * 1000,
    },
  )
}
