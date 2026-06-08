import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { logger } from '../lib/logger'
import type { CdpBackend } from './backends/types'
import type { BookmarkNode } from './bookmarks'
import * as bookmarks from './bookmarks'
import {
  buildContentMarkdownExpression,
  type ContentMarkdownOptions,
} from './content-markdown'
import { fetchLegacyAxTreeWithFrames } from './core/observer/ax-tree'
import type { PageInfo } from './core/pages'
import { BrowserSession } from './core/session'
import * as snapshot from './core/snapshot/legacy'
import { type DomSearchResult, parseNodeAttributes } from './dom'
import type { HistoryEntry } from './history'
import * as history from './history'
import type { TabGroup } from './tab-groups'
import * as tabGroups from './tab-groups'

export type { PageInfo } from './core/pages'

export interface WindowInfo {
  windowId: number
  windowType:
    | 'normal'
    | 'popup'
    | 'app'
    | 'devtools'
    | 'app_popup'
    | 'picture_in_picture'
  bounds: {
    left?: number
    top?: number
    width?: number
    height?: number
    windowState?: 'normal' | 'minimized' | 'maximized' | 'fullscreen'
  }
  isActive: boolean
  isVisible: boolean
  tabCount: number
  activeTabId?: number
}

export interface SetWindowVisibilityResult {
  window: WindowInfo
  replaced: boolean
  previousWindowId: number
}

export class Browser {
  private cdp: CdpBackend
  private core: BrowserSession

  constructor(cdp: CdpBackend) {
    this.cdp = cdp
    this.core = new BrowserSession(cdp)
  }

  isCdpConnected(): boolean {
    return this.core.isConnected()
  }

  /** Browser-core session shared by MCP and the in-process agent. */
  get session(): BrowserSession {
    return this.core
  }

  private async resolveSession(page: number): Promise<ProtocolApi> {
    return (await this.core.pages.getSession(page)).session
  }

  async getActivePageForWindow(windowId: number): Promise<{
    targetId: string
    session: ProtocolApi
    url: string
  }> {
    return this.core.pages.getActiveSessionForWindow(windowId)
  }

  /** Resolve a Browser-internal pageId to a CDP session bound to its tab. */
  async getPageSession(pageId: number): Promise<{
    targetId: string
    session: ProtocolApi
    url: string
  }> {
    return this.core.pages.getSession(pageId)
  }

  // --- Pages ---

  async listPages(): Promise<PageInfo[]> {
    return this.core.pages.list()
  }

  getTabIdForPage(pageId: number): number | undefined {
    return this.core.pages.getTabId(pageId)
  }

  getPageInfo(pageId: number): PageInfo | undefined {
    return this.core.pages.getInfo(pageId)
  }

  async refreshPageInfo(pageId: number): Promise<PageInfo | undefined> {
    return this.core.pages.refresh(pageId)
  }

  async getSession(pageId: number): Promise<ProtocolApi | null> {
    return this.core.pages.getAttachedSession(pageId)
  }

  async resolveTabIds(tabIds: number[]): Promise<Map<number, number>> {
    return this.core.pages.resolveTabIds(tabIds)
  }

  async getActivePage(): Promise<PageInfo | null> {
    return this.core.pages.getActive()
  }

  private async resolveWindowIdForNewPage(opts?: {
    hidden?: boolean
    windowId?: number
  }): Promise<number | undefined> {
    if (!opts?.hidden) {
      if (opts?.windowId !== undefined) return opts.windowId

      const windows = await this.listWindows()
      const visibleWindow =
        windows.find((window) => window.isVisible && window.isActive) ??
        windows.find((window) => window.isVisible)
      if (visibleWindow) return visibleWindow.windowId

      return (await this.createWindow({ hidden: false })).windowId
    }

    if (opts.windowId !== undefined) {
      const windows = await this.listWindows()
      const targetWindow = windows.find(
        (window) => window.windowId === opts.windowId,
      )
      if (targetWindow && !targetWindow.isVisible) {
        return targetWindow.windowId
      }
      if (targetWindow?.isVisible) {
        logger.warn(
          'Requested hidden page target window is visible, creating a new hidden window instead',
          {
            requestedWindowId: opts.windowId,
          },
        )
      }
    }

    const hiddenWindow = await this.createWindow({ hidden: true })
    return hiddenWindow.windowId
  }

  async newPage(
    url: string,
    opts?: { hidden?: boolean; background?: boolean; windowId?: number },
  ): Promise<number> {
    const windowId = await this.resolveWindowIdForNewPage(opts)
    return this.core.pages.newPage(url, {
      background: opts?.background,
      windowId,
    })
  }

  async closePage(page: number): Promise<void> {
    await this.core.pages.close(page)
  }

  // --- Navigation ---

  async goto(page: number, url: string): Promise<void> {
    await this.core.nav(page).goto(url)
  }

  async goBack(page: number): Promise<void> {
    await this.core.nav(page).back()
  }

  async goForward(page: number): Promise<void> {
    await this.core.nav(page).forward()
  }

  async reload(page: number): Promise<void> {
    await this.core.nav(page).reload()
  }

  // --- Observation ---

  async snapshot(page: number): Promise<string> {
    const session = await this.resolveSession(page)
    const nodes = await fetchLegacyAxTreeWithFrames(session)
    if (nodes.length === 0) return ''

    const treeLines = snapshot.buildEnhancedTree(nodes)

    try {
      const cursorElements =
        await snapshot.findCursorInteractiveElements(session)

      if (cursorElements.length > 0) {
        const includedIds = new Set<number>()
        for (const line of treeLines) {
          const match = line.match(/\[(\d+)\]/)
          if (match) includedIds.add(Number(match[1]))
        }

        const extras: string[] = []
        for (const el of cursorElements) {
          if (includedIds.has(el.backendNodeId)) continue
          extras.push(
            `[${el.backendNodeId}] clickable "${el.text}" (${el.reasons.join(', ')})`,
          )
        }

        if (extras.length > 0) {
          treeLines.push('# Cursor-interactive (no ARIA role):')
          treeLines.push(...extras)
        }
      }
    } catch (err) {
      logger.debug('Cursor-interactive detection failed', {
        error: String(err),
      })
    }

    return treeLines.join('\n')
  }

  async getPageLinks(
    page: number,
  ): Promise<Array<{ text: string; href: string }>> {
    const session = await this.resolveSession(page)
    const nodes = await fetchLegacyAxTreeWithFrames(session)
    const linkNodes = snapshot.extractLinkNodes(nodes)
    if (linkNodes.length === 0) return []

    const results: Array<{ text: string; href: string }> = []
    const seen = new Set<string>()

    for (const link of linkNodes) {
      try {
        const resolved = await session.DOM.resolveNode({
          backendNodeId: link.backendDOMNodeId,
        })
        if (!resolved.object?.objectId) continue

        const hrefResult = await session.Runtime.callFunctionOn({
          objectId: resolved.object.objectId,
          functionDeclaration:
            'function() { return this.href || this.getAttribute("href") || ""; }',
          returnByValue: true,
        })

        const href = hrefResult.result?.value as string
        if (!href || href.startsWith('javascript:') || seen.has(href)) continue
        seen.add(href)
        results.push({ text: link.text, href })
      } catch {
        // skip unresolvable nodes
      }
    }

    return results
  }

  async content(page: number, selector?: string): Promise<string> {
    const session = await this.resolveSession(page)
    const expression = selector
      ? `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '')`
      : `(document.body?.innerText ?? '')`

    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
    })

    return (result.result?.value as string) ?? ''
  }

  async contentAsMarkdown(
    page: number,
    opts?: Omit<ContentMarkdownOptions, 'selector'> & { selector?: string },
  ): Promise<string> {
    const session = await this.resolveSession(page)
    const expression = buildContentMarkdownExpression({
      selector: opts?.selector,
      viewportOnly: opts?.viewportOnly,
      includeLinks: opts?.includeLinks,
      includeImages: opts?.includeImages,
    })

    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
    })

    return (result.result?.value as string) ?? ''
  }

  async screenshot(
    page: number,
    opts: { format: string; quality?: number; fullPage: boolean },
  ): Promise<{ data: string; mimeType: string; devicePixelRatio: number }> {
    const session = await this.resolveSession(page)

    const params: Record<string, unknown> = {
      format: opts.format,
      captureBeyondViewport: opts.fullPage,
    }
    if (opts.quality !== undefined) params.quality = opts.quality

    const [screenshotResult, dprResult] = await Promise.allSettled([
      session.Page.captureScreenshot(
        params as Parameters<ProtocolApi['Page']['captureScreenshot']>[0],
      ),
      session.Runtime.evaluate({
        expression: 'window.devicePixelRatio',
        returnByValue: true,
      }),
    ])

    if (screenshotResult.status === 'rejected') throw screenshotResult.reason

    const result = screenshotResult.value
    const devicePixelRatio =
      dprResult.status === 'fulfilled' &&
      typeof dprResult.value.result?.value === 'number'
        ? dprResult.value.result.value
        : 1

    return {
      data: result.data,
      mimeType: `image/${opts.format}`,
      devicePixelRatio,
    }
  }

  async evaluate(
    page: number,
    expression: string,
  ): Promise<{
    value?: unknown
    error?: string
    description?: string
  }> {
    const session = await this.resolveSession(page)

    const result = await session.Runtime.evaluate({
      expression,
      returnByValue: true,
      awaitPromise: true,
    })

    if (result.exceptionDetails) {
      return {
        error:
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      }
    }

    return {
      value: result.result?.value,
      description: result.result?.description,
    }
  }

  async getDom(page: number, opts?: { selector?: string }): Promise<string> {
    const session = await this.resolveSession(page)
    const doc = await session.DOM.getDocument({ depth: 0 })

    let nodeId = doc.root.nodeId
    if (opts?.selector) {
      const found = await session.DOM.querySelector({
        nodeId: doc.root.nodeId,
        selector: opts.selector,
      })
      if (!found.nodeId) return ''
      nodeId = found.nodeId
    }

    const result = await session.DOM.getOuterHTML({ nodeId })
    return result.outerHTML
  }

  async searchDom(
    page: number,
    query: string,
    opts?: { limit?: number },
  ): Promise<{ results: DomSearchResult[]; totalCount: number }> {
    const session = await this.resolveSession(page)
    const limit = opts?.limit ?? 25

    await session.DOM.getDocument({ depth: 0 })
    const search = await session.DOM.performSearch({ query })
    const count = Math.min(search.resultCount, limit)

    if (count === 0) {
      await session.DOM.discardSearchResults({ searchId: search.searchId })
      return { results: [], totalCount: search.resultCount }
    }

    try {
      const matched = await session.DOM.getSearchResults({
        searchId: search.searchId,
        fromIndex: 0,
        toIndex: count,
      })

      const results: DomSearchResult[] = []
      const seen = new Set<number>()
      for (const nodeId of matched.nodeIds) {
        try {
          const desc = await session.DOM.describeNode({ nodeId, depth: 0 })
          let node = desc.node
          let resolvedNodeId = nodeId

          // Text/comment nodes: resolve to parent element via JS
          if (node.nodeType !== 1) {
            const resolved = await session.DOM.resolveNode({ nodeId })
            if (!resolved.object.objectId) continue
            const parentResult = await session.Runtime.callFunctionOn({
              objectId: resolved.object.objectId,
              functionDeclaration: 'function() { return this.parentElement; }',
              returnByValue: false,
            })
            if (!parentResult.result.objectId) continue
            const parentNode = await session.DOM.requestNode({
              objectId: parentResult.result.objectId,
            })
            resolvedNodeId = parentNode.nodeId
            const parentDesc = await session.DOM.describeNode({
              nodeId: parentNode.nodeId,
              depth: 0,
            })
            node = parentDesc.node
          }

          if (node.nodeType !== 1) continue
          if (seen.has(node.backendNodeId)) continue
          seen.add(node.backendNodeId)

          results.push({
            tag: node.localName,
            nodeId: resolvedNodeId,
            backendNodeId: node.backendNodeId,
            attributes: parseNodeAttributes(node),
          })
        } catch {
          // node may have been removed between search and describe
        }
      }

      return { results, totalCount: search.resultCount }
    } finally {
      await session.DOM.discardSearchResults({ searchId: search.searchId })
    }
  }

  // --- Input ---

  async click(
    page: number,
    element: number,
    opts?: { button?: string; clickCount?: number },
  ): Promise<{ x: number; y: number } | undefined> {
    return this.core.input(page).clickBackendNode(element, opts)
  }

  async clickAt(
    page: number,
    x: number,
    y: number,
    opts?: { button?: string; clickCount?: number },
  ): Promise<void> {
    await this.core.input(page).clickAt(x, y, opts)
  }

  async hoverAt(page: number, x: number, y: number): Promise<void> {
    await this.core.input(page).hoverAt(x, y)
  }

  async typeAt(
    page: number,
    x: number,
    y: number,
    text: string,
    clear = false,
  ): Promise<void> {
    await this.core.input(page).typeAt(x, y, text, clear)
  }

  async dragAt(
    page: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Promise<void> {
    await this.core.input(page).dragAt(from, to)
  }

  async hover(
    page: number,
    element: number,
  ): Promise<{ x: number; y: number }> {
    return this.core.input(page).hoverBackendNode(element)
  }

  async fill(
    page: number,
    element: number,
    text: string,
    clear = true,
  ): Promise<{ x: number; y: number } | undefined> {
    return this.core.input(page).fillBackendNode(element, text, { clear })
  }

  async pressKey(page: number, key: string): Promise<void> {
    await this.core.input(page).press(key)
  }

  async drag(
    page: number,
    sourceElement: number,
    target: { element?: number; x?: number; y?: number },
  ): Promise<{
    from: { x: number; y: number }
    to: { x: number; y: number }
  }> {
    return this.core.input(page).dragBackendNode(sourceElement, target)
  }

  async scroll(
    page: number,
    direction: string,
    amount: number,
    element?: number,
  ): Promise<void> {
    await this.core.input(page).scrollLegacy(direction, amount, element)
  }

  async handleDialog(
    page: number,
    accept: boolean,
    promptText?: string,
  ): Promise<void> {
    await this.core.input(page).handleDialog(accept, promptText)
  }

  async selectOption(
    page: number,
    element: number,
    value: string,
  ): Promise<string | null> {
    return this.core.input(page).selectBackendNode(element, value)
  }

  // --- Form helpers ---

  async focus(page: number, element: number): Promise<void> {
    await this.core.input(page).focusBackendNode(element)
  }

  async check(page: number, element: number): Promise<boolean> {
    return this.core.input(page).checkBackendNode(element)
  }

  async uncheck(page: number, element: number): Promise<boolean> {
    return this.core.input(page).uncheckBackendNode(element)
  }

  async uploadFile(
    page: number,
    element: number,
    files: string[],
  ): Promise<void> {
    await this.core.input(page).uploadFile(element, files)
  }

  // --- File operations ---

  async printToPDF(
    page: number,
    opts?: { landscape?: boolean; printBackground?: boolean },
  ): Promise<{ data: string }> {
    const session = await this.resolveSession(page)
    const result = await session.Page.printToPDF({
      landscape: opts?.landscape ?? false,
      printBackground: opts?.printBackground ?? true,
    })
    return { data: result.data }
  }

  async downloadViaClick(
    page: number,
    element: number,
    downloadPath: string,
  ): Promise<{ filePath: string; suggestedFilename: string }> {
    await this.cdp.Browser.setDownloadBehavior({
      behavior: 'allowAndName',
      downloadPath,
      eventsEnabled: true,
    })

    return new Promise<{ filePath: string; suggestedFilename: string }>(
      (resolve, reject) => {
        let guid = ''
        let suggestedFilename = ''
        const timeout = setTimeout(() => {
          cleanUp()
          reject(new Error('Download timed out after 60s'))
        }, 60000)

        const unsubBegin = this.cdp.Browser.on(
          'downloadWillBegin',
          (params) => {
            guid = params.guid
            suggestedFilename = params.suggestedFilename
          },
        )

        const unsubProgress = this.cdp.Browser.on(
          'downloadProgress',
          (params) => {
            if (params.guid === guid && params.state === 'completed') {
              cleanUp()
              resolve({
                filePath: `${downloadPath}/${guid}`,
                suggestedFilename,
              })
            }
            if (params.guid === guid && params.state === 'canceled') {
              cleanUp()
              reject(new Error('Download was canceled'))
            }
          },
        )

        const cleanUp = () => {
          clearTimeout(timeout)
          unsubBegin()
          unsubProgress()
          this.cdp.Browser.setDownloadBehavior({ behavior: 'default' }).catch(
            () => {},
          )
        }

        this.click(page, element).catch((err) => {
          cleanUp()
          reject(err)
        })
      },
    )
  }

  // --- Windows ---

  async listWindows(): Promise<WindowInfo[]> {
    const result = await this.cdp.Browser.getWindows()
    return result.windows as WindowInfo[]
  }

  async createWindow(opts?: { hidden?: boolean }): Promise<WindowInfo> {
    const result = await this.cdp.Browser.createWindow({
      hidden: opts?.hidden ?? false,
    })
    return result.window as WindowInfo
  }

  async closeWindow(windowId: number): Promise<void> {
    await this.cdp.Browser.closeWindow({ windowId })
  }

  async activateWindow(windowId: number): Promise<void> {
    await this.cdp.Browser.activateWindow({ windowId })
  }

  /**
   * Changes a window between hidden and visible states.
   * BrowserOS may replace the underlying window, so callers must use the returned window ID.
   */
  async setWindowVisibility(
    windowId: number,
    opts: { visible: boolean; activate?: boolean },
  ): Promise<SetWindowVisibilityResult> {
    const result = await this.cdp.Browser.setWindowVisibility({
      windowId,
      visible: opts.visible,
      ...(opts.activate !== undefined && { activate: opts.activate }),
    })
    return {
      window: result.window as WindowInfo,
      replaced: result.replaced,
      previousWindowId: result.previousWindowId,
    }
  }

  async showPage(
    page: number,
    opts?: { windowId?: number; index?: number; activate?: boolean },
  ): Promise<PageInfo> {
    return this.core.pages.show(page, opts)
  }

  async movePage(
    page: number,
    opts?: { windowId?: number; index?: number },
  ): Promise<PageInfo> {
    return this.core.pages.move(page, opts)
  }

  // --- Bookmarks ---

  async getBookmarks(): Promise<BookmarkNode[]> {
    return bookmarks.getBookmarks(this.cdp)
  }

  async createBookmark(params: {
    title: string
    url?: string
    parentId?: string
  }): Promise<BookmarkNode> {
    return bookmarks.createBookmark(this.cdp, params)
  }

  async removeBookmark(id: string): Promise<void> {
    return bookmarks.removeBookmark(this.cdp, id)
  }

  async updateBookmark(
    id: string,
    changes: { url?: string; title?: string },
  ): Promise<BookmarkNode> {
    return bookmarks.updateBookmark(this.cdp, id, changes)
  }

  async moveBookmark(
    id: string,
    destination: { parentId?: string; index?: number },
  ): Promise<BookmarkNode> {
    return bookmarks.moveBookmark(this.cdp, id, destination)
  }

  async searchBookmarks(query: string): Promise<BookmarkNode[]> {
    return bookmarks.searchBookmarks(this.cdp, query)
  }

  // --- History ---

  async searchHistory(
    query: string,
    maxResults?: number,
  ): Promise<HistoryEntry[]> {
    return history.searchHistory(this.cdp, query, maxResults)
  }

  async getRecentHistory(maxResults?: number): Promise<HistoryEntry[]> {
    return history.getRecentHistory(this.cdp, maxResults)
  }

  async deleteHistoryUrl(url: string): Promise<void> {
    return history.deleteUrl(this.cdp, url)
  }

  async deleteHistoryRange(startTime: number, endTime: number): Promise<void> {
    return history.deleteRange(this.cdp, startTime, endTime)
  }

  // --- Tab Groups ---

  private resolvePageIdsToTabIds(pageIds: number[]): number[] {
    return pageIds.map((pageId) => {
      const info = this.getPageInfo(pageId)
      if (!info)
        throw new Error(
          `Unknown page ${pageId}. Use list_pages to see available pages.`,
        )
      return info.tabId
    })
  }

  async listTabGroups(): Promise<
    (Omit<TabGroup, 'tabIds'> & { pageIds: number[] })[]
  > {
    const pages = await this.listPages()
    const groups = await tabGroups.listTabGroups(this.cdp)

    const tabToPage = new Map<number, number>()
    for (const info of pages) {
      tabToPage.set(info.tabId, info.pageId)
    }

    return groups.map((group) => {
      const { tabIds, ...rest } = group
      return {
        ...rest,
        pageIds: tabIds
          .map((tabId) => tabToPage.get(tabId))
          .filter((id): id is number => id !== undefined),
      }
    })
  }

  async groupTabs(
    pageIds: number[],
    opts?: { title?: string; groupId?: string },
  ): Promise<Omit<TabGroup, 'tabIds'> & { pageIds: number[] }> {
    const pages = await this.listPages()
    const tabIds = this.resolvePageIdsToTabIds(pageIds)
    const group = await tabGroups.groupTabs(this.cdp, tabIds, opts)

    const tabToPage = new Map<number, number>()
    for (const info of pages) {
      tabToPage.set(info.tabId, info.pageId)
    }

    const { tabIds: groupTabIds, ...rest } = group
    return {
      ...rest,
      pageIds: groupTabIds
        .map((tabId) => tabToPage.get(tabId))
        .filter((id): id is number => id !== undefined),
    }
  }

  async updateTabGroup(
    groupId: string,
    opts: { title?: string; color?: string; collapsed?: boolean },
  ): Promise<TabGroup> {
    return tabGroups.updateTabGroup(this.cdp, groupId, opts)
  }

  async ungroupTabs(pageIds: number[]): Promise<void> {
    await this.listPages()
    const tabIds = this.resolvePageIdsToTabIds(pageIds)
    return tabGroups.ungroupTabs(this.cdp, tabIds)
  }

  async closeTabGroup(groupId: string): Promise<void> {
    return tabGroups.closeTabGroup(this.cdp, groupId)
  }
}
