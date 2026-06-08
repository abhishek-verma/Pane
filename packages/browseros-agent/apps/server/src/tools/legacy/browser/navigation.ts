import { z } from 'zod'
import { logger } from '../../../lib/logger'
import { defineTool, type ToolContext } from '../framework'

// Best-effort: attach a page to a tab group. Failure is logged but
// never propagated — the caller already created/moved the page and
// the agent should see its tool succeed. Stale groupIds from the
// agent-company side reconcile at boot, so a one-off miss is
// recoverable.
async function joinTabGroup(
  ctx: ToolContext,
  pageId: number,
  tabGroupId: string | undefined,
): Promise<void> {
  if (!tabGroupId) return
  try {
    await ctx.browser.groupTabs([pageId], { groupId: tabGroupId })
  } catch (err) {
    logger.warn('Failed to attach tab to default tab group', {
      pageId,
      tabGroupId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

const pageParam = z.number().describe('Page ID (from list_pages)')
const pageInfoSchema = z.object({
  pageId: z.number(),
  targetId: z.string(),
  tabId: z.number(),
  url: z.string(),
  title: z.string(),
  isActive: z.boolean(),
  isLoading: z.boolean(),
  loadProgress: z.number(),
  isPinned: z.boolean(),
  isHidden: z.boolean(),
  windowId: z.number().optional(),
  index: z.number().optional(),
  groupId: z.string().optional(),
})

export const get_active_page = defineTool({
  name: 'get_active_page',
  description: 'Get the currently active (focused) page in the browser',
  input: z.object({}),
  output: z.object({ page: pageInfoSchema }),
  handler: async (_args, ctx, response) => {
    const page = await ctx.browser.getActivePage()
    if (!page) {
      response.error('No active page found.')
      return
    }
    response.text(
      `Active page: ${page.pageId} (tab ${page.tabId})\n${page.title}\n${page.url}`,
    )
    response.data({ page })
  },
})

export const list_pages = defineTool({
  name: 'list_pages',
  description: 'List all pages (tabs) currently open in the browser',
  input: z.object({}),
  output: z.object({
    pages: z.array(pageInfoSchema),
    count: z.number(),
  }),
  handler: async (_args, ctx, response) => {
    const pages = await ctx.browser.listPages()

    if (pages.length === 0) {
      response.text('No pages open.')
      response.data({ pages: [], count: 0 })
      return
    }

    const lines = pages.map(
      (p) => `${p.pageId}. ${p.title} (tab ${p.tabId})\n   ${p.url}`,
    )
    response.text(lines.join('\n\n'))
    response.data({ pages, count: pages.length })
  },
})

export const navigate_page = defineTool({
  name: 'navigate_page',
  description: 'Navigate a page to a URL, or go back/forward/reload',
  input: z.object({
    page: pageParam,
    action: z
      .enum(['url', 'back', 'forward', 'reload'])
      .default('url')
      .describe('Navigation action'),
    url: z
      .string()
      .optional()
      .describe("URL to navigate to (required when action is 'url')"),
  }),
  output: z.object({
    page: z.number(),
    action: z.enum(['url', 'back', 'forward', 'reload']),
    url: z.string().optional(),
  }),
  handler: async (args, ctx, response) => {
    if (args.action === 'url' && !args.url) {
      response.error(
        'URL is required when action is "url". Provide a url parameter.',
      )
      return
    }

    if (
      ctx.session?.origin === 'newtab' &&
      ctx.session.originPageId !== undefined &&
      args.page === ctx.session.originPageId
    ) {
      response.error(
        'Cannot navigate the origin tab in new-tab mode — this would destroy the chat UI. Use `new_page` to open a background tab instead.',
      )
      return
    }

    switch (args.action) {
      case 'url':
        await ctx.browser.goto(args.page, args.url as string)
        break
      case 'back':
        await ctx.browser.goBack(args.page)
        break
      case 'forward':
        await ctx.browser.goForward(args.page)
        break
      case 'reload':
        await ctx.browser.reload(args.page)
        break
    }

    const messages: Record<string, string> = {
      url: `Navigated to ${args.url}`,
      back: 'Navigated back',
      forward: 'Navigated forward',
      reload: 'Page reloaded',
    }
    response.text(messages[args.action] ?? 'Done')
    response.data({
      page: args.page,
      action: args.action,
      url: args.url,
    })
    response.includeSnapshot(args.page)
  },
})

export const new_page = defineTool({
  name: 'new_page',
  description:
    'Open a new page (tab) and navigate to a URL. Opens in background by default to keep the user on their current page. Use group_tabs to organize related tabs.',
  input: z.object({
    url: z.string().describe('URL to open'),
    hidden: z.boolean().default(false).describe('Create as hidden tab'),
    background: z
      .boolean()
      .default(true)
      .describe(
        'Open in background without stealing focus. Set to false only when user needs to see the tab immediately.',
      ),
    windowId: z.number().optional().describe('Window ID to create tab in'),
    tabGroupId: z
      .string()
      .optional()
      .describe('Tab group to place the new tab into'),
  }),
  output: z.object({
    pageId: z.number(),
    url: z.string(),
    hidden: z.boolean(),
    background: z.boolean(),
    windowId: z.number().optional(),
  }),
  handler: async (args, ctx, response) => {
    const pageId = await ctx.browser.newPage(args.url, {
      hidden: args.hidden ? true : undefined,
      background: args.background !== false,
      windowId: args.windowId ?? ctx.defaultWindowId,
    })
    await joinTabGroup(ctx, pageId, args.tabGroupId ?? ctx.defaultTabGroupId)
    response.text(`Opened new page: ${args.url}\nPage ID: ${pageId}`)
    response.data({
      pageId,
      url: args.url,
      hidden: args.hidden,
      background: args.background,
      windowId: args.windowId ?? ctx.defaultWindowId,
    })
    response.includePages()
  },
})

export const new_hidden_page = defineTool({
  name: 'new_hidden_page',
  description:
    'Open a new hidden page (tab) and navigate to a URL. Hidden pages are not visible to the user and useful for background data fetching or automation.',
  input: z.object({
    url: z.string().describe('URL to open'),
    windowId: z.number().optional().describe('Window ID to create tab in'),
    tabGroupId: z
      .string()
      .optional()
      .describe('Tab group the page joins when later shown'),
  }),
  output: z.object({
    pageId: z.number(),
    url: z.string(),
    hidden: z.literal(true),
    background: z.literal(true),
    windowId: z.number().optional(),
  }),
  handler: async (args, ctx, response) => {
    const pageId = await ctx.browser.newPage(args.url, {
      hidden: true,
      background: true,
      windowId: args.windowId ?? ctx.defaultWindowId,
    })
    await joinTabGroup(ctx, pageId, args.tabGroupId ?? ctx.defaultTabGroupId)
    response.text(`Opened hidden page: ${args.url}\nPage ID: ${pageId}`)
    response.data({
      pageId,
      url: args.url,
      hidden: true,
      background: true,
      windowId: args.windowId ?? ctx.defaultWindowId,
    })
    response.includePages()
  },
})

export const show_page = defineTool({
  name: 'show_page',
  description:
    'Restore a hidden page back into a visible browser window. Use after new_hidden_page when you want the user to inspect or interact with it. Errors if the page is already visible.',
  input: z.object({
    page: pageParam,
    windowId: z
      .number()
      .optional()
      .describe('Window ID to place the tab in (defaults to last active)'),
    index: z
      .number()
      .optional()
      .describe('Tab position index within the window'),
    activate: z
      .boolean()
      .default(true)
      .describe('Activate (focus) the tab after showing'),
    tabGroupId: z
      .string()
      .optional()
      .describe('Tab group to place the now-visible tab into'),
  }),
  output: z.object({ page: pageInfoSchema }),
  handler: async (args, ctx, response) => {
    const updated = await ctx.browser.showPage(args.page, {
      windowId: args.windowId ?? ctx.defaultWindowId,
      index: args.index,
      activate: args.activate,
    })
    await joinTabGroup(ctx, args.page, args.tabGroupId ?? ctx.defaultTabGroupId)
    response.text(
      `Page ${args.page} is now visible in window ${updated.windowId}`,
    )
    response.data({ page: updated })
    response.includePages()
  },
})

export const move_page = defineTool({
  name: 'move_page',
  description:
    'Move a page (tab) to a different window or position within a window.',
  input: z.object({
    page: pageParam,
    windowId: z
      .number()
      .optional()
      .describe('Target window ID to move the tab to'),
    index: z
      .number()
      .optional()
      .describe('Tab position index within the target window'),
    tabGroupId: z
      .string()
      .optional()
      .describe('Tab group to place the moved tab into'),
  }),
  output: z.object({ page: pageInfoSchema }),
  handler: async (args, ctx, response) => {
    const updated = await ctx.browser.movePage(args.page, {
      windowId: args.windowId ?? ctx.defaultWindowId,
      index: args.index,
    })
    await joinTabGroup(ctx, args.page, args.tabGroupId ?? ctx.defaultTabGroupId)
    response.text(
      `Moved page ${args.page} to window ${updated.windowId} at index ${updated.index}`,
    )
    response.data({ page: updated })
    response.includePages()
  },
})

export const close_page = defineTool({
  name: 'close_page',
  description: 'Close a page (tab)',
  input: z.object({
    page: pageParam,
  }),
  output: z.object({
    page: z.number(),
    action: z.literal('close_page'),
  }),
  handler: async (args, ctx, response) => {
    if (
      ctx.session?.origin === 'newtab' &&
      ctx.session.originPageId !== undefined &&
      args.page === ctx.session.originPageId
    ) {
      response.error(
        'Cannot close the origin tab in new-tab mode — this would destroy the chat UI.',
      )
      return
    }

    await ctx.browser.closePage(args.page)
    response.text(`Closed page ${args.page}`)
    response.data({ page: args.page, action: 'close_page' })
    response.includePages()
  },
})
