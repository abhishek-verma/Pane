import { randomUUID } from 'node:crypto'
import { runClaudeLayerAction } from '../../apps/server/src/layers/claude-action-runner'
import { runCodexLayerAction } from '../../apps/server/src/layers/codex-action-runner'

/** Installed CLI/production adapter. Local model by default; explicit live flag
 * sends only a fixed public sample. Generated protocol checks use a synthetic
 * page host; actual DOM effects are verified in layers-integration-probe.ts. */
export async function probeCodexActions() {
  const live = process.argv.includes('--live-action')
  const generated = process.argv.includes('--scripts')
  const claude = process.argv.includes('--claude')
  if (claude && !live)
    throw new Error('Use the separate Claude fixture for local tests')
  const runner: typeof runCodexLayerAction = claude
    ? (run) => runClaudeLayerAction(run)
    : runCodexLayerAction
  const requests: Array<{
    model: unknown
    tools: string[]
    maxOutputTokens: unknown
  }> = []
  let inspected = 0,
    executed = 0
  const output = {
    schema: 'pane.translation.v1',
    targetLanguage: 'en',
    blocks: [{ blockId: 'first', translatedText: 'Hello' }],
  }
  const result = await runner(
    {
      binding: {
        invocationId: randomUUID(),
        profileId: randomUUID(),
        layerId: randomUUID(),
        layerVersion: 'a'.repeat(64),
        actionId: 'action',
        tabId: 1,
        frameId: 0,
        documentId: 'fixture',
        instanceId: randomUUID(),
        routeEpoch: 0,
        snapshotId: randomUUID(),
        revocationGeneration: 1,
      },
      input: generated
        ? { schema: 'pane.script-task-input.v1' }
        : {
            targetLanguage: 'en',
            blocks: [{ blockId: 'first', text: 'Bonjour' }],
          },
      action: {
        id: 'action',
        kind: generated ? 'page-task' : 'transform',
        ...(generated ? { execution: 'javascript' as const } : {}),
        trigger: 'click',
        instruction: generated ? 'Add a heading.' : 'Translate to English.',
        outputSchema: generated
          ? 'pane.script-task-receipt.v1'
          : 'pane.translation.v1',
        targetLanguage: 'en',
        limits: {
          maxSteps: generated ? (claude ? 4 : 3) : claude ? 2 : 1,
          maxOutputTokens: live ? 4096 : generated ? 1536 : 512,
          deadlineMs: 25000,
        },
      },
      config: {
        provider: claude ? 'claude-code' : 'codex',
        model: claude ? 'claude-sonnet-4-6' : 'gpt-5.5',
      },
      signal: new AbortController().signal,
      current: () => true,
      pageHost: {
        inspect: async () => {
          inspected++
          return { candidates: [{ selector: 'body' }] }
        },
        execute: async () => {
          executed++
          return {
            checks: [
              { operationId: 'result', affectedElements: 1, intact: true },
            ],
          }
        },
      },
    },
    live
      ? {
          observeTools: (tools) =>
            console.log('CLI inventory:', JSON.stringify(tools)),
          observeFailure: (failure) =>
            console.log('Boundary:', JSON.stringify(failure)),
        }
      : {
          nativeAuth: false,
          env: { PATH: process.env.PATH },
          binary: '/Users/abhishek/.local/bin/codex',
          observeTools: (tools) =>
            console.log('CLI inventory:', JSON.stringify(tools)),
          upstream: async (body) => {
            const stage = requests.length
            const tools = (
              body.tools as Array<{
                name: string
                tools?: Array<{ name: string }>
              }>
            ).flatMap((tool) =>
              tool.tools
                ? tool.tools.map((entry) => `${tool.name}.${entry.name}`)
                : [tool.name],
            )
            requests.push({
              model: body.model,
              tools,
              maxOutputTokens: body.max_output_tokens,
            })
            const name = generated
              ? ['page_inspect', 'page_execute_script', 'complete_page_task'][
                  stage
                ]
              : stage === 0
                ? 'submit_layer_result'
                : undefined
            const toolName =
              name && tools.find((item) => item.endsWith(`.${name}`))
            if (name && !toolName)
              throw new Error(
                `Missing private tool ${name}; actual tools: ${tools.join(',')}`,
              )
            const args = generated
              ? stage === 1
                ? {
                    source: '(() => {document.body.dataset.test="yes"})();',
                    assertions: [
                      { id: 'result', selector: 'body', state: 'present' },
                    ],
                  }
                : {}
              : output
            const item = toolName
              ? {
                  id: `fc_${stage}`,
                  call_id: `call_${stage}`,
                  type: 'function_call',
                  namespace: 'mcp__pane_layer',
                  name,
                  arguments: JSON.stringify(args),
                  status: 'completed',
                }
              : {
                  id: `msg_${stage}`,
                  type: 'message',
                  role: 'assistant',
                  status: 'completed',
                  content: [
                    { type: 'output_text', text: 'Done.', annotations: [] },
                  ],
                }
            const response = {
              id: `resp_${stage}`,
              object: 'response',
              created_at: 1,
              model: body.model,
              status: 'completed',
              output: [item],
              usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
            }
            return new Response(
              [
                {
                  type: 'response.created',
                  response: { ...response, status: 'in_progress', output: [] },
                },
                {
                  type: 'response.output_item.added',
                  output_index: 0,
                  item: {
                    ...item,
                    status: 'in_progress',
                    ...(toolName ? { arguments: '' } : { content: [] }),
                  },
                },
                ...(toolName
                  ? [
                      {
                        type: 'response.function_call_arguments.delta',
                        item_id: item.id,
                        output_index: 0,
                        delta: JSON.stringify(args),
                      },
                    ]
                  : [
                      {
                        type: 'response.output_text.delta',
                        item_id: item.id,
                        output_index: 0,
                        content_index: 0,
                        delta: 'Done.',
                      },
                    ]),
                { type: 'response.output_item.done', output_index: 0, item },
                { type: 'response.completed', response },
              ]
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(''),
              { headers: { 'content-type': 'text/event-stream' } },
            )
          },
        },
  ).catch((error) => {
    console.error('Request metadata:', JSON.stringify(requests))
    throw error
  })
  if (live) {
    if (
      generated
        ? result.schema !== 'pane.script-task-receipt.v1' ||
          !result.executions.length ||
          inspected === 0 ||
          executed === 0
        : result.schema !== 'pane.translation.v1' ||
          result.blocks[0]?.blockId !== 'first'
    )
      throw new Error('The live account did not return the bound translation')
    console.log(
      JSON.stringify({
        passed: [
          `configured ${claude ? 'Claude' : 'Codex'} account`,
          generated
            ? 'live private page-tool protocol with synthetic host'
            : 'private typed translation result',
          'no alternate API key',
        ],
        providerTokenCeiling: claude,
        acceptedOutputLimit: 4096,
      }),
    )
    return
  }
  const expected = (
    generated
      ? ['page_inspect', 'page_execute_script', 'complete_page_task']
      : ['submit_layer_result']
  )
    .map((name) => `mcp__pane_layer.${name}`)
    .sort()
  if (
    requests.length !== (generated ? 3 : 1) ||
    requests.some(
      (request) =>
        request.model !== 'gpt-5.5' ||
        request.maxOutputTokens !== 512 ||
        JSON.stringify([...request.tools].sort()) !== JSON.stringify(expected),
    )
  )
    throw new Error(
      'The model, private tool inventory or request budget changed',
    )
  if (
    generated
      ? result.schema !== 'pane.script-task-receipt.v1' ||
        inspected !== 1 ||
        executed !== 1
      : JSON.stringify(result) !== JSON.stringify(output)
  )
    throw new Error('The private result did not match browser/input evidence')
  console.log(
    JSON.stringify(
      {
        passed: [
          'installed CLI private tool flow',
          'canonical result validation',
          'no built-in tools forwarded',
          'saved model and output limits',
        ],
        generated,
        requests,
      },
      null,
      2,
    ),
  )
}
