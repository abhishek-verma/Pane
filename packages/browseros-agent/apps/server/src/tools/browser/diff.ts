import { z } from 'zod'
import { defineTool, textResult } from './framework'
import { wrapUntrusted } from './trust-boundary'

export const diff = defineTool({
  name: 'diff',
  description:
    "Show what changed on the page since the last snapshot/diff - a cheap way to see an action's effect without re-dumping the whole tree.",
  input: z.object({ page: z.number().int() }),
  annotations: { readOnlyHint: true },
  handler: async (args, ctx) => {
    const d = await ctx.session.observe(args.page).diff()
    if (!d.changed) return textResult('no change since last snapshot')
    const origin = ctx.session.pages.getInfo(args.page)?.url ?? 'unknown'
    return textResult(wrapUntrusted(d.text, origin), {
      added: d.added,
      removed: d.removed,
    })
  },
})
