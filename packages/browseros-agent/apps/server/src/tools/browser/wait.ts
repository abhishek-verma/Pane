import { z } from 'zod'
import {
  abortableDelay,
  clampTimeout,
  defineTool,
  errorResult,
  textResult,
  throwIfAborted,
} from './framework'

const DEFAULT_WAIT_TIMEOUT_MS = 10_000
const MAX_WAIT_TIMEOUT_MS = 30_000

export const wait = defineTool({
  name: 'wait',
  description:
    'Wait for a condition before continuing. Prefer acting directly and reading the diff; use wait only when there is no reliable UI signal yet. for="text" (substring appears), "selector" (element appears), or "time" (value = ms).',
  input: z.object({
    page: z.number().int(),
    for: z.enum(['text', 'selector', 'time']),
    value: z
      .string()
      .optional()
      .describe('Text/selector, or ms for for="time".'),
    timeout: z.number().optional().describe('Max wait in ms (default 10000).'),
  }),
  annotations: { readOnlyHint: true },
  handler: async (args, ctx) => {
    const timeout = clampTimeout(
      args.timeout,
      DEFAULT_WAIT_TIMEOUT_MS,
      MAX_WAIT_TIMEOUT_MS,
    )

    if (args.for === 'time') {
      const waitMs = parseWaitMs(args.value, timeout)
      if (waitMs === null)
        return errorResult('wait: value must be milliseconds.')
      await abortableDelay(Math.min(waitMs, timeout), ctx.signal)
      return textResult('waited', { matched: true })
    }
    if (!args.value) {
      return errorResult(`wait: value is required for for="${args.for}".`)
    }

    const { session } = await ctx.session.pages.getSession(args.page)
    const expression =
      args.for === 'text'
        ? `(document.body?.innerText ?? '').includes(${JSON.stringify(args.value)})`
        : `!!document.querySelector(${JSON.stringify(args.value)})`

    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      throwIfAborted(ctx.signal)
      const result = await session.Runtime.evaluate({
        expression,
        returnByValue: true,
      })
      if (result.result?.value === true) {
        return textResult(`matched (${args.for})`, { matched: true })
      }
      await abortableDelay(
        Math.min(300, Math.max(0, deadline - Date.now())),
        ctx.signal,
      )
    }
    return textResult(`timed out after ${timeout}ms waiting for ${args.for}`, {
      matched: false,
    })
  },
})

function parseWaitMs(
  value: string | undefined,
  fallback: number,
): number | null {
  if (value === undefined) return fallback
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.round(ms)
}
