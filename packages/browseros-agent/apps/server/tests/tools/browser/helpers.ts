import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { TOOL_LIMITS } from '@browseros/shared/constants/limits'
import type { Browser } from '../../../src/browser/browser'
import type { PageInfo } from '../../../src/browser/core/pages'
import { writeTempToolOutputFile } from '../../../src/tools/browser/output-file'
import { ToolResponse, type ToolResult } from '../../../src/tools/response'

export type { ToolResult }

export interface ToolSessionContext {
  origin?: 'sidepanel' | 'newtab'
  originPageId?: number
}

export interface ToolContext {
  browser: Browser
  directories: {
    workingDir?: string
    resourcesDir?: string
  }
  session?: ToolSessionContext
}

export interface ToolDefinition {
  name: string
  description: string
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
    response: ToolResponse,
  ) => Promise<void>
}

function defineCommand(def: ToolDefinition): ToolDefinition {
  return def
}

function textOfValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

function resolveOutputPath(
  ctx: ToolContext,
  targetPath: string,
  cwd?: string,
): string {
  return resolve(cwd ?? ctx.directories.workingDir ?? tmpdir(), targetPath)
}

function requireNotOriginTab(
  ctx: ToolContext,
  page: number,
  action: 'navigate' | 'close',
): string | undefined {
  if (ctx.session?.origin !== 'newtab') return undefined
  if (ctx.session.originPageId !== page) return undefined
  return action === 'navigate'
    ? 'Cannot navigate the origin tab from a new-tab session.'
    : 'Cannot close the origin tab from a new-tab session.'
}

function pageIdData(pageId: number, extra: Record<string, unknown> = {}) {
  return { pageId, ...extra }
}

function formatElement(result: {
  tag: string
  nodeId: number
  backendNodeId: number
  attributes: Record<string, string>
}): string {
  const attrs = Object.entries(result.attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')
  const tag = attrs ? `<${result.tag} ${attrs}>` : `<${result.tag}>`
  return `${tag} nodeId: ${result.nodeId} backendNodeId: ${result.backendNodeId}`
}

/** Executes a legacy-shaped browser command against the current browser core for tests. */
export async function executeTool(
  command: ToolDefinition,
  args: unknown,
  ctx: ToolContext,
  signal: AbortSignal = AbortSignal.timeout(30_000),
): Promise<ToolResult> {
  const response = new ToolResponse()
  if (signal.aborted) {
    response.error('Request was aborted')
    return response.toResult()
  }

  try {
    await command.handler(
      (args ?? {}) as Record<string, unknown>,
      ctx,
      response,
    )
  } catch (error) {
    response.error(
      `${command.name} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  const result = await response.build(ctx.browser)
  const page = (args as Record<string, unknown> | undefined)?.page
  if (typeof page === 'number') {
    const tabId = ctx.browser.getTabIdForPage(page)
    if (tabId !== undefined) result.metadata = { ...result.metadata, tabId }
  }
  return result
}

export const get_bookmarks = defineCommand({
  name: 'get_bookmarks',
  description: 'List browser bookmarks.',
  handler: async (_args, ctx, response) => {
    const bookmarks = await ctx.browser.getBookmarks()
    response.text(`Retrieved ${bookmarks.length} bookmarks.`)
    response.data({
      action: 'get_bookmarks',
      bookmarks,
      count: bookmarks.length,
    })
  },
})

export const create_bookmark = defineCommand({
  name: 'create_bookmark',
  description: 'Create a bookmark or folder.',
  handler: async (args, ctx, response) => {
    const bookmark = await ctx.browser.createBookmark({
      title: args.title as string,
      ...(typeof args.url === 'string' && { url: args.url }),
      ...(typeof args.parentId === 'string' && { parentId: args.parentId }),
    })
    response.text(`Created bookmark ${bookmark.title}.`)
    response.data({ action: 'create_bookmark', bookmark })
  },
})

export const remove_bookmark = defineCommand({
  name: 'remove_bookmark',
  description: 'Remove a bookmark.',
  handler: async (args, ctx, response) => {
    const id = args.id as string
    await ctx.browser.removeBookmark(id)
    response.text(`Removed bookmark ${id}.`)
    response.data({ action: 'remove_bookmark', id })
  },
})

export const update_bookmark = defineCommand({
  name: 'update_bookmark',
  description: 'Update a bookmark.',
  handler: async (args, ctx, response) => {
    const bookmark = await ctx.browser.updateBookmark(args.id as string, {
      ...(typeof args.title === 'string' && { title: args.title }),
      ...(typeof args.url === 'string' && { url: args.url }),
    })
    response.text(`Updated bookmark ${bookmark.id}.`)
    response.data({ action: 'update_bookmark', bookmark })
  },
})

export const move_bookmark = defineCommand({
  name: 'move_bookmark',
  description: 'Move a bookmark.',
  handler: async (args, ctx, response) => {
    const bookmark = await ctx.browser.moveBookmark(args.id as string, {
      ...(typeof args.parentId === 'string' && { parentId: args.parentId }),
      ...(typeof args.index === 'number' && { index: args.index }),
    })
    response.text(`Moved bookmark ${bookmark.id}.`)
    response.data({ action: 'move_bookmark', bookmark })
  },
})

export const search_bookmarks = defineCommand({
  name: 'search_bookmarks',
  description: 'Search browser bookmarks.',
  handler: async (args, ctx, response) => {
    const query = args.query as string
    const bookmarks = await ctx.browser.searchBookmarks(query)
    response.text(`Found ${bookmarks.length} bookmarks for "${query}".`)
    response.data({ action: 'search_bookmarks', query, bookmarks })
  },
})

export const search_history = defineCommand({
  name: 'search_history',
  description: 'Search browser history.',
  handler: async (args, ctx, response) => {
    const query = args.query as string
    const items = await ctx.browser.searchHistory(
      query,
      args.maxResults as number | undefined,
    )
    response.text(`Retrieved ${items.length} history items for "${query}".`)
    response.data({
      action: 'search_history',
      query,
      items,
      count: items.length,
    })
  },
})

export const get_recent_history = defineCommand({
  name: 'get_recent_history',
  description: 'Get recent browser history.',
  handler: async (args, ctx, response) => {
    const items = await ctx.browser.getRecentHistory(
      args.maxResults as number | undefined,
    )
    response.text(`Retrieved ${items.length} recent history items.`)
    response.data({ action: 'get_recent_history', items, count: items.length })
  },
})

export const delete_history_url = defineCommand({
  name: 'delete_history_url',
  description: 'Delete one history URL.',
  handler: async (args, ctx, response) => {
    const url = args.url as string
    await ctx.browser.deleteHistoryUrl(url)
    response.text(`Deleted history URL ${url}.`)
    response.data({ action: 'delete_history_url', url })
  },
})

export const delete_history_range = defineCommand({
  name: 'delete_history_range',
  description: 'Delete a history time range.',
  handler: async (args, ctx, response) => {
    const startTime = args.startTime as number
    const endTime = args.endTime as number
    await ctx.browser.deleteHistoryRange(startTime, endTime)
    response.text(`Deleted history from ${startTime} to ${endTime}.`)
    response.data({ action: 'delete_history_range', startTime, endTime })
  },
})

export const list_pages = defineCommand({
  name: 'list_pages',
  description: 'List open pages.',
  handler: async (_args, ctx, response) => {
    const pages = await ctx.browser.listPages()
    response.text(`Found ${pages.length} pages.`)
    response.data({ action: 'list_pages', pages, count: pages.length })
  },
})

export const get_active_page = defineCommand({
  name: 'get_active_page',
  description: 'Get the active page.',
  handler: async (_args, ctx, response) => {
    const page = await ctx.browser.getActivePage()
    if (!page) {
      response.error('No active page.')
      return
    }
    response.text(`Active page ${page.pageId}: ${page.url}`)
    response.data({ action: 'get_active_page', page })
  },
})

export const new_page = defineCommand({
  name: 'new_page',
  description: 'Open a new page.',
  handler: async (args, ctx, response) => {
    const pageId = await ctx.browser.newPage(
      (args.url as string) ?? 'about:blank',
      {
        ...(typeof args.background === 'boolean' && {
          background: args.background,
        }),
        ...(typeof args.windowId === 'number' && { windowId: args.windowId }),
      },
    )
    response.text(`Opened page ${pageId}.`)
    response.data(pageIdData(pageId, { hidden: false }))
  },
})

export const new_hidden_page = defineCommand({
  name: 'new_hidden_page',
  description: 'Open a hidden page.',
  handler: async (args, ctx, response) => {
    const pageId = await ctx.browser.newPage(
      (args.url as string) ?? 'about:blank',
      {
        hidden: true,
        background: true,
        ...(typeof args.windowId === 'number' && { windowId: args.windowId }),
      },
    )
    response.text(`Opened hidden page ${pageId}.`)
    response.data(pageIdData(pageId, { hidden: true }))
  },
})

export const navigate_page = defineCommand({
  name: 'navigate_page',
  description: 'Navigate a page.',
  handler: async (args, ctx, response) => {
    const page = args.page as number
    const guard = requireNotOriginTab(ctx, page, 'navigate')
    if (guard) {
      response.error(guard)
      return
    }

    const action = (args.action as string) ?? 'url'
    if (action === 'url') {
      await ctx.browser.goto(page, args.url as string)
      response.text(`Navigated to ${args.url}.`)
      response.data({ action, page, url: args.url })
      return
    }
    if (action === 'back') {
      await ctx.browser.goBack(page)
      response.text(`Navigated page ${page} back.`)
      response.data({ action, page })
      return
    }
    if (action === 'forward') {
      await ctx.browser.goForward(page)
      response.text(`Navigated page ${page} forward.`)
      response.data({ action, page })
      return
    }
    if (action === 'reload') {
      await ctx.browser.reload(page)
      response.text(`Reloaded page ${page}.`)
      response.data({ action, page })
      return
    }

    response.error(`Unknown navigation action: ${action}`)
  },
})

export const show_page = defineCommand({
  name: 'show_page',
  description: 'Show a hidden page.',
  handler: async (args, ctx, response) => {
    const page = await ctx.browser.showPage(args.page as number, {
      ...(typeof args.windowId === 'number' && { windowId: args.windowId }),
      ...(typeof args.index === 'number' && { index: args.index }),
      ...(typeof args.activate === 'boolean' && { activate: args.activate }),
    })
    response.text(`Page ${page.pageId} is now visible.`)
    response.data({ action: 'show_page', page })
  },
})

export const move_page = defineCommand({
  name: 'move_page',
  description: 'Move a page to another window.',
  handler: async (args, ctx, response) => {
    const page = await ctx.browser.movePage(args.page as number, {
      ...(typeof args.windowId === 'number' && { windowId: args.windowId }),
      ...(typeof args.index === 'number' && { index: args.index }),
    })
    response.text(`Moved page ${page.pageId}.`)
    response.data({ action: 'move_page', page })
  },
})

export const close_page = defineCommand({
  name: 'close_page',
  description: 'Close a page.',
  handler: async (args, ctx, response) => {
    const page = args.page as number
    const guard = requireNotOriginTab(ctx, page, 'close')
    if (guard) {
      response.error(guard)
      return
    }
    await ctx.browser.closePage(page)
    response.text(`Closed page ${page}.`)
    response.data({ action: 'close_page', page })
  },
})

export const take_snapshot = defineCommand({
  name: 'take_snapshot',
  description: 'Capture a page accessibility snapshot.',
  handler: async (args, ctx, response) => {
    const page = args.page as number
    const snapshot = await ctx.browser.snapshot(page)
    response.text(snapshot || '(empty snapshot)')
    response.data({ action: 'take_snapshot', page, snapshot })
  },
})

export const evaluate_script = defineCommand({
  name: 'evaluate_script',
  description: 'Evaluate JavaScript on a page.',
  handler: async (args, ctx, response) => {
    const result = await ctx.browser.evaluate(
      args.page as number,
      args.expression as string,
    )
    if (result.error) {
      response.error(result.error)
      return
    }
    response.text(textOfValue(result.value ?? result.description))
    response.data({ action: 'evaluate_script', value: result.value })
  },
})

export const get_page_content = defineCommand({
  name: 'get_page_content',
  description: 'Read page content as markdown.',
  handler: async (args, ctx, response) => {
    const page = args.page as number
    const content = await ctx.browser.contentAsMarkdown(page, {
      ...(typeof args.selector === 'string' && { selector: args.selector }),
      includeLinks: true,
      includeImages: false,
    })
    if (content.length <= TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS) {
      response.text(content || '(empty)')
      response.data({
        action: 'get_page_content',
        page,
        content,
        contentLength: content.length,
        writtenToFile: false,
      })
      return
    }

    const path = await writeTempToolOutputFile({
      toolName: 'page-content',
      extension: 'md',
      content,
    })
    response.text(
      `${content.slice(0, TOOL_LIMITS.INLINE_PAGE_CONTENT_MAX_CHARS)}\n\nContent truncated. Full content saved to: ${path}`,
    )
    response.data({
      action: 'get_page_content',
      page,
      path,
      contentLength: content.length,
      writtenToFile: true,
    })
  },
})

export const take_screenshot = defineCommand({
  name: 'take_screenshot',
  description: 'Capture a page screenshot.',
  handler: async (args, ctx, response) => {
    const format = (args.format as string) ?? 'png'
    const shot = await ctx.browser.screenshot(args.page as number, {
      format,
      ...(typeof args.quality === 'number' && { quality: args.quality }),
      fullPage: typeof args.fullPage === 'boolean' ? args.fullPage : false,
    })
    response.image(shot.data, shot.mimeType)
    response.data({
      action: 'take_screenshot',
      page: args.page,
      mimeType: shot.mimeType,
      devicePixelRatio: shot.devicePixelRatio,
    })
  },
})

export const get_page_links = defineCommand({
  name: 'get_page_links',
  description: 'Extract links from a page.',
  handler: async (args, ctx, response) => {
    const links = await ctx.browser.getPageLinks(args.page as number)
    if (links.length === 0) {
      response.text('No links found.')
    } else {
      response.text(
        links.map((link) => `${link.text}: ${link.href}`).join('\n'),
      )
    }
    response.data({ action: 'get_page_links', links, count: links.length })
  },
})

export const get_dom = defineCommand({
  name: 'get_dom',
  description: 'Save page DOM HTML to a temp file.',
  handler: async (args, ctx, response) => {
    const html = await ctx.browser.getDom(args.page as number, {
      ...(typeof args.selector === 'string' && { selector: args.selector }),
    })
    if (!html && typeof args.selector === 'string') {
      response.error(`No element found for selector ${args.selector}.`)
      return
    }

    const path = await writeTempToolOutputFile({
      toolName: 'dom',
      extension: 'html',
      content: html,
    })
    response.text(`Saved DOM to ${path}.`)
    response.data({
      action: 'get_dom',
      page: args.page,
      selector: args.selector,
      path,
      totalLength: html.length,
    })
  },
})

export const search_dom = defineCommand({
  name: 'search_dom',
  description: 'Search the DOM.',
  handler: async (args, ctx, response) => {
    const query = args.query as string
    const limit = typeof args.limit === 'number' ? args.limit : 25
    const result = await ctx.browser.searchDom(args.page as number, query, {
      limit,
    })
    if (result.totalCount === 0) {
      response.text(`No elements matching "${query}".`)
      response.data({
        action: 'search_dom',
        query,
        results: [],
        shownCount: 0,
        totalCount: 0,
      })
      return
    }

    const lines = [
      `Found ${result.totalCount} matching elements for "${query}".`,
      ...(result.results.length < result.totalCount
        ? [`Showing ${result.results.length} of ${result.totalCount}.`]
        : []),
      ...result.results.map(formatElement),
    ]
    response.text(lines.join('\n'))
    response.data({
      action: 'search_dom',
      query,
      results: result.results,
      shownCount: result.results.length,
      totalCount: result.totalCount,
    })
  },
})

export const click = defineCommand({
  name: 'click',
  description: 'Click an element by backend node ID.',
  handler: async (args, ctx, response) => {
    const coords = await ctx.browser.click(
      args.page as number,
      args.element as number,
      {
        ...(typeof args.button === 'string' && { button: args.button }),
        ...(typeof args.clickCount === 'number' && {
          clickCount: args.clickCount,
        }),
      },
    )
    response.text(`Clicked element ${args.element}.`)
    response.data({
      action: 'click',
      page: args.page,
      element: args.element,
      coords,
    })
  },
})

export const click_at = defineCommand({
  name: 'click_at',
  description: 'Click page coordinates.',
  handler: async (args, ctx, response) => {
    await ctx.browser.clickAt(
      args.page as number,
      args.x as number,
      args.y as number,
      {
        ...(typeof args.button === 'string' && { button: args.button }),
        ...(typeof args.clickCount === 'number' && {
          clickCount: args.clickCount,
        }),
      },
    )
    response.text(`Clicked at ${args.x}, ${args.y}.`)
    response.data({ action: 'click_at', ...args })
  },
})

export const hover_at = defineCommand({
  name: 'hover_at',
  description: 'Hover page coordinates.',
  handler: async (args, ctx, response) => {
    await ctx.browser.hoverAt(
      args.page as number,
      args.x as number,
      args.y as number,
    )
    response.text(`Hovered at ${args.x}, ${args.y}.`)
    response.data({ action: 'hover_at', ...args })
  },
})

export const type_at = defineCommand({
  name: 'type_at',
  description: 'Type at page coordinates.',
  handler: async (args, ctx, response) => {
    await ctx.browser.typeAt(
      args.page as number,
      args.x as number,
      args.y as number,
      args.text as string,
      args.clear === true,
    )
    response.text(`Typed ${String(args.text ?? '').length} characters.`)
    response.data({
      action: 'type_at',
      page: args.page,
      textLength: String(args.text ?? '').length,
    })
  },
})

export const drag_at = defineCommand({
  name: 'drag_at',
  description: 'Drag between page coordinates.',
  handler: async (args, ctx, response) => {
    await ctx.browser.dragAt(
      args.page as number,
      { x: args.fromX as number, y: args.fromY as number },
      { x: args.toX as number, y: args.toY as number },
    )
    response.text('Dragged between coordinates.')
    response.data({ action: 'drag_at', ...args })
  },
})

export const hover = defineCommand({
  name: 'hover',
  description: 'Hover an element by backend node ID.',
  handler: async (args, ctx, response) => {
    const coords = await ctx.browser.hover(
      args.page as number,
      args.element as number,
    )
    response.text(`Hovered element ${args.element}.`)
    response.data({
      action: 'hover',
      page: args.page,
      element: args.element,
      coords,
    })
  },
})

export const clear = defineCommand({
  name: 'clear',
  description: 'Clear an input element.',
  handler: async (args, ctx, response) => {
    await ctx.browser.fill(
      args.page as number,
      args.element as number,
      '',
      true,
    )
    response.text(`Cleared element ${args.element}.`)
    response.data({ action: 'clear', page: args.page, element: args.element })
  },
})

export const fill = defineCommand({
  name: 'fill',
  description: 'Fill an input element.',
  handler: async (args, ctx, response) => {
    await ctx.browser.fill(
      args.page as number,
      args.element as number,
      args.text as string,
      args.clear !== false,
    )
    response.text(`Filled element ${args.element}.`)
    response.data({
      action: 'fill',
      page: args.page,
      element: args.element,
      textLength: String(args.text ?? '').length,
    })
  },
})

export const press_key = defineCommand({
  name: 'press_key',
  description: 'Press a keyboard key.',
  handler: async (args, ctx, response) => {
    await ctx.browser.pressKey(args.page as number, args.key as string)
    response.text(`Pressed ${args.key}.`)
    response.data({ action: 'press_key', page: args.page, key: args.key })
  },
})

export const drag = defineCommand({
  name: 'drag',
  description: 'Drag from one element to a target.',
  handler: async (args, ctx, response) => {
    const result = await ctx.browser.drag(
      args.page as number,
      args.element as number,
      {
        ...(typeof args.targetElement === 'number' && {
          element: args.targetElement,
        }),
        ...(typeof args.x === 'number' && { x: args.x }),
        ...(typeof args.y === 'number' && { y: args.y }),
      },
    )
    response.text(`Dragged element ${args.element}.`)
    response.data({
      action: 'drag',
      page: args.page,
      element: args.element,
      ...result,
    })
  },
})

export const scroll = defineCommand({
  name: 'scroll',
  description: 'Scroll a page or element.',
  handler: async (args, ctx, response) => {
    await ctx.browser.scroll(
      args.page as number,
      (args.direction as string) ?? 'down',
      (args.amount as number) ?? 3,
      args.element as number | undefined,
    )
    response.text(`Scrolled ${args.direction}.`)
    response.data({
      action: 'scroll',
      page: args.page,
      direction: args.direction,
      amount: args.amount,
      element: args.element,
    })
  },
})

export const handle_dialog = defineCommand({
  name: 'handle_dialog',
  description: 'Handle a JavaScript dialog.',
  handler: async (args, ctx, response) => {
    await ctx.browser.handleDialog(
      args.page as number,
      args.accept !== false,
      args.promptText as string | undefined,
    )
    response.text(
      args.accept === false ? 'Dismissed dialog.' : 'Accepted dialog.',
    )
    response.data({ action: 'handle_dialog', ...args })
  },
})

export const focus = defineCommand({
  name: 'focus',
  description: 'Focus an element by backend node ID.',
  handler: async (args, ctx, response) => {
    await ctx.browser.focus(args.page as number, args.element as number)
    response.text(`Focused element ${args.element}.`)
    response.data({ action: 'focus', page: args.page, element: args.element })
  },
})

export const check = defineCommand({
  name: 'check',
  description: 'Check a checkbox or radio element.',
  handler: async (args, ctx, response) => {
    const checked = await ctx.browser.check(
      args.page as number,
      args.element as number,
    )
    response.text(`Checked element ${args.element}.`)
    response.data({
      action: 'check',
      page: args.page,
      element: args.element,
      checked,
    })
  },
})

export const uncheck = defineCommand({
  name: 'uncheck',
  description: 'Uncheck a checkbox.',
  handler: async (args, ctx, response) => {
    const checked = await ctx.browser.uncheck(
      args.page as number,
      args.element as number,
    )
    response.text(`Unchecked element ${args.element}.`)
    response.data({
      action: 'uncheck',
      page: args.page,
      element: args.element,
      checked,
    })
  },
})

export const upload_file = defineCommand({
  name: 'upload_file',
  description: 'Upload files into a file input.',
  handler: async (args, ctx, response) => {
    const files = args.files as string[]
    await ctx.browser.uploadFile(
      args.page as number,
      args.element as number,
      files,
    )
    response.text(`Uploaded ${files.length} file(s).`)
    response.data({
      action: 'upload_file',
      page: args.page,
      element: args.element,
      files,
    })
  },
})

export const select_option = defineCommand({
  name: 'select_option',
  description: 'Select an option in a select control.',
  handler: async (args, ctx, response) => {
    const selected = await ctx.browser.selectOption(
      args.page as number,
      args.element as number,
      args.value as string,
    )
    response.text(`Selected ${selected ?? args.value}.`)
    response.data({
      action: 'select_option',
      page: args.page,
      element: args.element,
      value: args.value,
      selected,
    })
  },
})

export const save_pdf = defineCommand({
  name: 'save_pdf',
  description: 'Save a page as PDF.',
  handler: async (args, ctx, response) => {
    const outputPath = resolveOutputPath(
      ctx,
      args.path as string,
      args.cwd as string | undefined,
    )
    await mkdir(dirname(outputPath), { recursive: true })
    const pdf = await ctx.browser.printToPDF(args.page as number, {
      ...(typeof args.landscape === 'boolean' && { landscape: args.landscape }),
      ...(typeof args.printBackground === 'boolean' && {
        printBackground: args.printBackground,
      }),
    })
    await Bun.write(outputPath, Buffer.from(pdf.data, 'base64'))
    response.text(`Saved PDF to ${outputPath}.`)
    response.data({ action: 'save_pdf', page: args.page, path: outputPath })
  },
})

export const save_screenshot = defineCommand({
  name: 'save_screenshot',
  description: 'Save a page screenshot.',
  handler: async (args, ctx, response) => {
    const outputPath = resolveOutputPath(
      ctx,
      args.path as string,
      args.cwd as string | undefined,
    )
    await mkdir(dirname(outputPath), { recursive: true })
    const format = outputPath.toLowerCase().endsWith('.jpg') ? 'jpeg' : 'png'
    const shot = await ctx.browser.screenshot(args.page as number, {
      format,
      fullPage: typeof args.fullPage === 'boolean' ? args.fullPage : true,
    })
    await Bun.write(outputPath, Buffer.from(shot.data, 'base64'))
    response.text(`Saved screenshot to ${outputPath}.`)
    response.data({
      action: 'save_screenshot',
      page: args.page,
      path: outputPath,
      mimeType: shot.mimeType ?? `image/${format}`,
    })
  },
})

export const download_file = defineCommand({
  name: 'download_file',
  description: 'Download a file by clicking an element.',
  handler: async (args, ctx, response) => {
    const directory = resolveOutputPath(
      ctx,
      (args.path as string | undefined) ?? '.',
      args.cwd as string | undefined,
    )
    await mkdir(directory, { recursive: true })
    const stagingDir = await mkdtemp(join(directory, 'browseros-dl-'))
    try {
      const download = await ctx.browser.downloadViaClick(
        args.page as number,
        args.element as number,
        stagingDir,
      )
      const destinationPath = join(directory, download.suggestedFilename)
      await copyFile(download.filePath, destinationPath)
      response.text(`Downloaded file to ${destinationPath}.`)
      response.data({
        action: 'download_file',
        page: args.page,
        element: args.element,
        directory,
        destinationPath,
        suggestedFilename: download.suggestedFilename,
      })
    } finally {
      await rm(stagingDir, { recursive: true, force: true })
    }
  },
})

export const list_windows = defineCommand({
  name: 'list_windows',
  description: 'List browser windows.',
  handler: async (_args, ctx, response) => {
    const windows = await ctx.browser.listWindows()
    response.text(`Found ${windows.length} windows.`)
    response.data({ action: 'list_windows', windows, count: windows.length })
  },
})

export const create_window = defineCommand({
  name: 'create_window',
  description: 'Create a visible browser window.',
  handler: async (_args, ctx, response) => {
    const window = await ctx.browser.createWindow({ hidden: false })
    response.text(`Created window ${window.windowId}.`)
    response.data({ action: 'create_window', window })
  },
})

export const create_hidden_window = defineCommand({
  name: 'create_hidden_window',
  description: 'Create a hidden browser window.',
  handler: async (_args, ctx, response) => {
    const window = await ctx.browser.createWindow({ hidden: true })
    response.text(`Created hidden window ${window.windowId}.`)
    response.data({ action: 'create_hidden_window', window })
  },
})

export const close_window = defineCommand({
  name: 'close_window',
  description: 'Close a browser window.',
  handler: async (args, ctx, response) => {
    await ctx.browser.closeWindow(args.windowId as number)
    response.text(`Closed window ${args.windowId}.`)
    response.data({ action: 'close_window', windowId: args.windowId })
  },
})

export const activate_window = defineCommand({
  name: 'activate_window',
  description: 'Activate a browser window.',
  handler: async (args, ctx, response) => {
    await ctx.browser.activateWindow(args.windowId as number)
    response.text(`Activated window ${args.windowId}.`)
    response.data({ action: 'activate_window', windowId: args.windowId })
  },
})

export const set_window_visibility = defineCommand({
  name: 'set_window_visibility',
  description: 'Set a browser window visible or hidden.',
  handler: async (args, ctx, response) => {
    const result = await ctx.browser.setWindowVisibility(
      args.windowId as number,
      {
        visible: args.visible as boolean,
        ...(typeof args.activate === 'boolean' && { activate: args.activate }),
      },
    )
    const window = result.window
    response.text(
      result.replaced
        ? `Window ${result.previousWindowId} was replaced. New window ID: ${window.windowId}.`
        : `Window ${window.windowId} visibility updated.`,
    )
    response.data({
      action: 'set_window_visibility',
      previousWindowId: result.previousWindowId,
      newWindowId: window.windowId,
      replaced: result.replaced,
      window,
    })
  },
})

export const list_tab_groups = defineCommand({
  name: 'list_tab_groups',
  description: 'List tab groups.',
  handler: async (_args, ctx, response) => {
    const groups = await ctx.browser.listTabGroups()
    response.text(`Found ${groups.length} tab groups.`)
    response.data({ action: 'list_tab_groups', groups, count: groups.length })
  },
})

export const group_tabs = defineCommand({
  name: 'group_tabs',
  description: 'Group tabs.',
  handler: async (args, ctx, response) => {
    const group = await ctx.browser.groupTabs(args.pageIds as number[], {
      ...(typeof args.title === 'string' && { title: args.title }),
      ...(typeof args.groupId === 'string' && { groupId: args.groupId }),
    })
    response.text(`Grouped ${group.pageIds.length} pages.`)
    response.data({ action: 'group_tabs', group })
  },
})

export const update_tab_group = defineCommand({
  name: 'update_tab_group',
  description: 'Update a tab group.',
  handler: async (args, ctx, response) => {
    const group = await ctx.browser.updateTabGroup(args.groupId as string, {
      ...(typeof args.title === 'string' && { title: args.title }),
      ...(typeof args.color === 'string' && { color: args.color }),
      ...(typeof args.collapsed === 'boolean' && { collapsed: args.collapsed }),
    })
    response.text(`Updated tab group ${group.groupId}.`)
    response.data({ action: 'update_tab_group', group })
  },
})

export const ungroup_tabs = defineCommand({
  name: 'ungroup_tabs',
  description: 'Ungroup tabs.',
  handler: async (args, ctx, response) => {
    const pageIds = args.pageIds as number[]
    await ctx.browser.ungroupTabs(pageIds)
    response.text(`Ungrouped ${pageIds.length} pages.`)
    response.data({ action: 'ungroup_tabs', pageIds, count: pageIds.length })
  },
})

export const close_tab_group = defineCommand({
  name: 'close_tab_group',
  description: 'Close a tab group.',
  handler: async (args, ctx, response) => {
    await ctx.browser.closeTabGroup(args.groupId as string)
    response.text(`Closed tab group ${args.groupId}.`)
    response.data({ action: 'close_tab_group', groupId: args.groupId })
  },
})

export function getVisiblePages(pages: PageInfo[]): PageInfo[] {
  return pages.filter((page) => !page.isHidden)
}
