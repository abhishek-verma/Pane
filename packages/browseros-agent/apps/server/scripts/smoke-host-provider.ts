/**
 * Opt-in live release check; uses the user's existing provider authentication.
 * Run: bun scripts/smoke-host-provider.ts codex /path/to/resources [model]
 * Also run with claude. A model-list/connection probe is not a substitute.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAcpxProvider } from 'acpx-ai-provider'
import { wrapAcpProviderExecutedTools } from '../src/lib/agents/acp/wrap-acp-provider-tools'
import { resolveAcpSpawnCommand } from '../src/lib/agents/host-acp/launcher'

const [agent, resourcesDir, model] = process.argv.slice(2)
if ((agent !== 'claude' && agent !== 'codex') || !resourcesDir) {
  throw new Error(
    'Usage: smoke-host-provider.ts <claude|codex> <resourcesDir> [model]',
  )
}
const root = await mkdtemp(join(tmpdir(), 'pane-provider-smoke-'))
const launcher = await resolveAcpSpawnCommand({
  agentType: agent,
  resourcesDir,
  browserosDir: root,
})
if (launcher?.source !== 'bundled-bun') {
  throw new Error('Release smoke requires the packaged Bun runtime')
}
const provider = createAcpxProvider({
  agent,
  cwd: root,
  stateDir: join(root, 'state'),
  sessionKey: crypto.randomUUID(),
  agentRegistryOverrides: { [agent]: launcher.command },
  permissionMode: 'deny-all',
})
const timeout = setTimeout(() => {
  console.error('Provider smoke timed out')
  process.exit(1)
}, 120_000)
try {
  await provider.prepare()
  if (model) await provider.setConfigOption('model', model)
  const wrapped = wrapAcpProviderExecutedTools(provider.languageModel())
  const result = await wrapped.doGenerate({
    prompt: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Reply with OK only. Do not use tools or read files.',
          },
        ],
      },
    ],
  })
  const reply = result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim()
  if (reply !== 'OK') {
    throw new Error(
      `Provider did not complete the live smoke: ${reply.slice(0, 1000)}`,
    )
  }
  console.log(
    `${agent}: PASS (packaged launcher, fresh cache, real model response)`,
  )
} finally {
  await provider.close()
  clearTimeout(timeout)
}
