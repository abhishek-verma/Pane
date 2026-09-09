import { expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerContextMcpTools } from '../../src/context/register-mcp'
import { LAYER_SKILLS } from '../../src/layers/skills'
import { buildLayerToolSet } from '../../src/layers/tools'
import { ensureRuntimeSkills } from '../../src/lib/agents/acpx/runtime-context'
import { closeDb, initializeDb } from '../../src/lib/db'
import { ensureBuiltinSkills } from '../../src/memory/builtin-skills'
import { loadSkill } from '../../src/memory/skills'

it('serializes and executes the same assessment through native tools and provider MCP', async () => {
  const server = new McpServer({ name: 'layer-contract', version: 'test' })
  registerContextMcpTools(server)
  const client = new Client({ name: 'provider', version: 'test' })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const args = {
    origin: 'https://example.com',
    execution: 'transform',
    trigger: 'document-load',
    content: 'all-content',
    languages: 'all',
  }
  try {
    await server.connect(st)
    await client.connect(ct)
    const inventory = await client.listTools()
    expect(inventory.tools.some((entry) => entry.name === 'layer_assess')).toBe(
      true,
    )
    expect(
      inventory.tools.some((entry) => entry.name === 'layer_data_sources'),
    ).toBe(true)
    expect(
      inventory.tools.some((entry) => entry.name === 'submit_layer_result'),
    ).toBe(false)
    expect(
      inventory.tools.some((entry) => entry.name === 'page_execute_script'),
    ).toBe(false)
    const result = await client.callTool({
      name: 'layer_assess',
      arguments: args,
    })
    expect(result.isError).not.toBe(true)
    const content = result.content as Array<{ type: string; text: string }>
    const mcp = JSON.parse(content[0].text)
    const tool = buildLayerToolSet().layer_assess
    if (!tool.execute) throw new Error('Missing assessment executor')
    const direct = (await tool.execute(args, {
      toolCallId: 'test',
      messages: [],
    })) as { text: string }
    expect(mcp).toEqual(JSON.parse(direct.text))
    expect(mcp.disposition).toBe('unsupported')
    const invalidScript = {
      definition: {
        protocol: 'pane.layers.v1',
        name: 'Invalid source',
        intent: 'Reject malformed source before saving',
        scope: { origin: 'https://example.com', paths: ['/*'] },
        mode: 'javascript',
        source: 'const = ;',
        operations: [],
        assertions: [{ id: 'body', selector: 'body', state: 'present' }],
      },
    }
    const validation = buildLayerToolSet().layer_validate
    if (!validation.execute) throw new Error('Missing validation executor')
    const localValidation = (await validation.execute(invalidScript, {
      toolCallId: 'validate-script',
      messages: [],
    })) as { text: string }
    const remoteValidation = await client.callTool({
      name: 'layer_validate',
      arguments: invalidScript,
    })
    expect(JSON.parse(localValidation.text)).toMatchObject({
      valid: false,
      issues: [{ path: ['source'] }],
    })
    expect(
      JSON.parse((remoteValidation.content as Array<{ text: string }>)[0].text),
    ).toEqual(JSON.parse(localValidation.text))
  } finally {
    await client.close()
    await server.close()
  }
})

it('materializes identical Layer skills for native memory and Claude/Codex managed runtimes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pane-layer-skills-'))
  const memoriesRoot = join(dir, 'memories')
  initializeDb({ dbPath: join(dir, 'test.sqlite') })
  try {
    await ensureBuiltinSkills({ memoriesRoot })
    const runtimeRoot = join(dir, 'runtime')
    const names = await ensureRuntimeSkills(runtimeRoot)
    for (const skill of LAYER_SKILLS) {
      const name = skill.id.replace(/^builtin-/, '')
      expect(names).toContain(name)
      const native = await loadSkill(name, { memoriesRoot })
      expect(native?.body).toBe(skill.body)
      expect(await readFile(join(runtimeRoot, name, 'SKILL.md'), 'utf8')).toBe(
        skill.body,
      )
    }
  } finally {
    closeDb()
    await rm(dir, { recursive: true, force: true })
  }
})
