import { z } from 'zod'
import { defineTool } from './framework'

export const screenshot = defineTool({
  name: 'screenshot',
  description:
    'Capture a PNG screenshot of the page, returned inline. Use when visual layout matters; prefer snapshot for structure/actions.',
  input: z.object({
    page: z.number().int(),
    fullPage: z.boolean().optional().describe('Capture beyond the viewport.'),
  }),
  annotations: { readOnlyHint: true },
  handler: async (args, ctx) => {
    const { session } = await ctx.session.pages.getSession(args.page)
    const result = await session.Page.captureScreenshot({
      format: 'png',
      captureBeyondViewport: args.fullPage ?? false,
    })
    return {
      content: [{ type: 'image', data: result.data, mimeType: 'image/png' }],
    }
  },
})
