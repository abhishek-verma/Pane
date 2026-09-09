/** Tool-boundary experiment for installed Codex, using only a fake local API. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startCodexActionTransport } from '../../apps/server/src/layers/codex-transport'

if (process.argv.includes('--actions')) {
  const { probeCodexActions } = await import('./layers-codex-action-probe')
  await probeCodexActions()
  process.exit(0)
}
if (process.argv.includes('--live-budget')) {
  const { checkCodexAccountBudget } = await import(
    './layers-codex-budget-check'
  )
  await checkCodexAccountBudget()
  process.exit(0)
}
const dir = await mkdtemp(join(tmpdir(), 'pane-layers-codex-'))
const home = join(dir, 'config')
await mkdir(home)
const nativeAuth = process.argv.includes('--native-auth')
const fixtureAccount = 'pane-layer-fixture-account'
const fixtureToken =
  [
    { alg: 'none', typ: 'JWT' },
    {
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': { chatgpt_account_id: fixtureAccount },
    },
  ]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
    .join('.') + '.fixture'
if (nativeAuth)
  await writeFile(
    join(home, 'auth.json'),
    JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: fixtureToken,
        access_token: fixtureToken,
        refresh_token: 'fixture',
        account_id: fixtureAccount,
      },
      last_refresh: new Date().toISOString(),
    }),
    { mode: 0o600 },
  )
const requests: unknown[] = []
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname !== '/v1/responses')
      return Response.json(
        { error: { message: 'Fixture route missing' } },
        { status: 404 },
      )
    const body = (await request.json()) as Record<string, unknown>
    requests.push({
      accountAuth:
        request.headers.get('authorization') === `Bearer ${fixtureToken}`,
      accountId: request.headers.get('chatgpt-account-id') === fixtureAccount,
      model: body.model,
      tools: Array.isArray(body.tools)
        ? body.tools.map((tool: { name?: string }) => tool.name)
        : body.tools,
      maxOutputTokens: body.max_output_tokens,
      text: body.text,
    })
    const output = {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        { type: 'output_text', text: '{"value":"Hello"}', annotations: [] },
      ],
    }
    const response = {
      id: 'resp',
      object: 'response',
      created_at: 1,
      status: 'completed',
      output: [output],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    }
    const events = [
      {
        type: 'response.created',
        response: { ...response, status: 'in_progress', output: [] },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...output, status: 'in_progress', content: [] },
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg',
        output_index: 0,
        content_index: 0,
        delta: '{"value":"Hello"}',
      },
      { type: 'response.output_item.done', output_index: 0, item: output },
      { type: 'response.completed', response },
    ]
      .map((data) => `data: ${JSON.stringify(data)}\n\n`)
      .join('')
    return new Response(events, {
      headers: { 'content-type': 'text/event-stream' },
    })
  },
})
const guarded = process.argv.includes('--guard')
const gate = guarded
  ? startCodexActionTransport(
      {
        model: 'gpt-5.5',
        tools: new Set(),
        maxRequests: 1,
        maxOutputTokens: 512,
        signal: new AbortController().signal,
        current: () => true,
        nativeAuth,
      },
      async (body, signal, accountHeaders) =>
        fetch(`http://127.0.0.1:${server.port}/v1/responses`, {
          method: 'POST',
          signal,
          headers: {
            ...Object.fromEntries(accountHeaders),
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
    )
  : undefined
try {
  const schemaPath = join(dir, 'schema.json')
  await writeFile(
    schemaPath,
    JSON.stringify({
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    }),
  )
  const args = [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--model',
    'gpt-5.5',
    '--json',
    '--output-schema',
    schemaPath,
    '-c',
    'model_provider="fixture"',
    '-c',
    `chatgpt_base_url="http://127.0.0.1:${server.port}"`,
    '-c',
    `model_providers.fixture={name="fixture",base_url="${gate?.url ?? `http://127.0.0.1:${server.port}/v1`}",${nativeAuth ? 'requires_openai_auth=true,env_http_headers={"x-pane-layer-transport"="PANE_FIXTURE_KEY"}' : 'env_key="PANE_FIXTURE_KEY"'},wire_api="responses",request_max_retries=0,stream_max_retries=0}`,
    '-c',
    'tools.view_image=false',
    '-c',
    'web_search="disabled"',
    '-c',
    'project_doc_max_bytes=0',
    '-c',
    'mcp_servers={}',
  ]
  for (const name of [
    'shell_tool',
    'unified_exec',
    'shell_snapshot',
    'code_mode_host',
    'apps',
    'plugins',
    'remote_plugin',
    'browser_use',
    'browser_use_external',
    'browser_use_full_cdp_access',
    'computer_use',
    'in_app_browser',
    'image_generation',
    'multi_agent',
    'hooks',
    'goals',
    'skill_search',
    'skill_mcp_dependency_install',
    'workspace_dependencies',
    'tool_suggest',
    'auth_elicitation',
  ])
    args.push('--disable', name)
  args.push('-')
  const child = Bun.spawn(['/Users/abhishek/.local/bin/codex', ...args], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CODEX_HOME: home,
      PANE_FIXTURE_KEY: gate?.token ?? 'fake',
    },
    stdin: new TextEncoder().encode(
      'Translate Bonjour. Return value Hello. Do not call tools.',
    ),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  clearTimeout(timer)
  if (
    guarded &&
    (code !== 0 ||
      requests.length !== 1 ||
      (requests[0] as any).maxOutputTokens !== 512 ||
      (requests[0] as any).tools.length !== 0)
  )
    throw new Error('Codex wire boundary did not hold')
  if (nativeAuth && !(requests[0] as any)?.accountAuth)
    throw new Error('Codex did not preserve account authentication')
  console.log(
    JSON.stringify(
      {
        code,
        requests,
        transportGuard: guarded,
        nativeAuth,
        supported: false,
        blockers: guarded
          ? [
              'Account/auth integration and private generated tools are not connected yet',
            ]
          : [
              'Built-in file tools remain exposed despite the tested restrictions',
              'No upstream max_output_tokens ceiling was sent',
            ],
        stdout,
        stderr,
      },
      null,
      2,
    ),
  )
} finally {
  gate?.close()
  server.stop(true)
  await rm(dir, { recursive: true, force: true })
}
