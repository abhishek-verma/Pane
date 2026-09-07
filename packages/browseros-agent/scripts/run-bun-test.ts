import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dir, '..')
const testCwd = process.env.BROWSEROS_TEST_CWD?.trim() || projectRoot
const junitPath = process.env.BROWSEROS_JUNIT_PATH?.trim()
const testTargets = process.argv.slice(2)
const testFilePattern = /\.(test|spec)\.[cm]?[jt]sx?$/
const ignoredDirectories = new Set([
  '.git',
  '.output',
  '.wxt',
  'dist',
  'node_modules',
  'test-results',
])

function collectTestFiles(target: string): string[] {
  const path = resolve(projectRoot, target)
  const stat = statSync(path)
  if (stat.isFile()) return testFilePattern.test(path) ? [path] : []
  if (!stat.isDirectory()) return []

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return []
    return collectTestFiles(resolve(path, entry.name))
  })
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

const files = [...new Set(testTargets.flatMap(collectTestFiles))].sort()
if (files.length === 0) {
  throw new Error(`No test files found for: ${testTargets.join(', ')}`)
}

const childEnv = { ...process.env }
delete childEnv.BROWSEROS_JUNIT_PATH

const results: Array<{ file: string; status: number; seconds: number }> = []
for (const file of files) {
  const cmd = [process.execPath]
  const envFile = process.env.BROWSEROS_TEST_ENV_FILE?.trim()
  if (envFile) cmd.push(`--env-file=${envFile}`)
  cmd.push('test', '--max-concurrency=1')
  const preload = process.env.BROWSEROS_TEST_PRELOAD?.trim()
  if (preload) cmd.push(`--preload=${preload}`)
  cmd.push(file)

  const started = performance.now()
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: testCwd,
    env: childEnv,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  const status = result.status ?? 1
  results.push({
    file: relative(projectRoot, file),
    status,
    seconds: (performance.now() - started) / 1000,
  })
}

if (junitPath) {
  const outputPath = resolve(projectRoot, junitPath)
  mkdirSync(dirname(outputPath), { recursive: true })
  const failures = results.filter((result) => result.status !== 0).length
  const cases = results
    .map((result) => {
      const name = escapeXml(result.file)
      const failure = result.status
        ? `\n      <failure message="Test file exited with code ${result.status}">See workflow logs for the failed assertions.</failure>`
        : ''
      return `    <testcase classname="isolated-file" name="${name}" time="${result.seconds.toFixed(3)}">${failure}\n    </testcase>`
    })
    .join('\n')
  const seconds = results.reduce((total, result) => total + result.seconds, 0)
  writeFileSync(
    outputPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${results.length}" failures="${failures}" time="${seconds.toFixed(3)}">\n  <testsuite name="isolated-files" tests="${results.length}" failures="${failures}" time="${seconds.toFixed(3)}">\n${cases}\n  </testsuite>\n</testsuites>\n`,
  )
}

const failedResults = results.filter((result) => result.status !== 0)
if (failedResults.length > 0) {
  console.error(
    `\n${failedResults.length} isolated test file(s) failed:\n${failedResults
      .map((result) => `- ${result.file} (exit ${result.status})`)
      .join('\n')}`,
  )
} else {
  console.log(`\nAll ${results.length} isolated test files passed.`)
}

process.exit(failedResults.length > 0 ? 1 : 0)
