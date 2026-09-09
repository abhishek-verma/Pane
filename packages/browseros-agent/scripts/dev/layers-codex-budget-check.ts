/** Explicit live-account compatibility probe. Reads the existing CLI credential
 * in memory, sends one tiny fixed request to its vendor, and prints no secrets,
 * account identifiers, response content or raw provider errors. */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export async function checkCodexAccountBudget() {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
  const auth = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8'))
  const accessToken = auth.tokens?.access_token
  const accountId = auth.tokens?.account_id
  if (typeof accessToken !== 'string' || typeof accountId !== 'string')
    throw new Error('The configured Codex account credential is unavailable')
  const response = await fetch(
    'https://chatgpt.com/backend-api/codex/responses',
    {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'ChatGPT-Account-Id': accountId,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'responses=experimental',
        originator: 'codex_cli_rs',
      },
      body: JSON.stringify({
        model: 'gpt-5.5',
        instructions: 'Reply with OK only.',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Reply OK.' }],
          },
        ],
        tools: [],
        tool_choice: 'none',
        stream: true,
        store: false,
        max_output_tokens: 32,
      }),
    },
  )
  if (!response.ok) {
    const error = await response.text()
    console.log(
      JSON.stringify({
        status: response.status,
        outputLimitRejected:
          /(?:unsupported|unknown|not supported|unrecognized)[\s\S]{0,100}max_output_tokens|max_output_tokens[\s\S]{0,100}(?:unsupported|not supported)/i.test(
            error,
          ),
        authenticated: response.status !== 401 && response.status !== 403,
        supported: false,
      }),
    )
    return
  }
  if (!response.body) throw new Error('Missing compatibility response')
  const reader = response.body.getReader()
  let bytes = 0,
    text = ''
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > 65536)
        throw new Error('Unexpected compatibility response size')
      text += decoder.decode(next.value, { stream: true })
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  const terminal = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => {
      try {
        return JSON.parse(line.slice(5))
      } catch {
        return null
      }
    })
    .find(
      (event) =>
        event?.type === 'response.completed' ||
        event?.type === 'response.incomplete',
    )
  console.log(
    JSON.stringify({
      status: response.status,
      outputLimitRejected: false,
      completed: terminal?.type === 'response.completed',
      boundedUsage:
        typeof terminal?.response?.usage?.output_tokens === 'number' &&
        terminal.response.usage.output_tokens <= 32,
    }),
  )
}
