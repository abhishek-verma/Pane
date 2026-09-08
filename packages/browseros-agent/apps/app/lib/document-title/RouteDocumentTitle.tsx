import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { PRODUCT_CHAT_NAME, PRODUCT_NAME } from '@/lib/constants/product'
import { setPageMetadata } from './page-metadata'

export function titleForAppPath(pathname: string): string | null {
  // These screens own metadata from their query results. Do not race their
  // effects, particularly when a page is already in the React Query cache.
  if (/^\/pi\/(sites|temp)\//.test(pathname)) return null
  if (pathname === '/' || pathname === '/home') return 'Home'
  if (pathname === '/pi/library') return `Library · ${PRODUCT_NAME}`
  if (pathname.startsWith('/home/agents')) return `Agents · ${PRODUCT_NAME}`
  if (pathname === '/home/personalize') return `Personalize · ${PRODUCT_NAME}`
  if (pathname.startsWith('/home/chat')) return PRODUCT_CHAT_NAME
  if (pathname.startsWith('/settings')) {
    const section = pathname.split('/')[2] ?? ''
    const sections: Record<string, string> = {
      ai: 'AI & Agents',
      mcp: 'MCP',
      customization: 'Customization',
      'action-log': 'Action Log',
      memory: 'Memory',
      reach: 'Reach',
      diagnostics: 'Diagnostics',
      permissions: 'Permissions',
      about: 'About',
      'connect-apps': 'Connect Apps',
      context: 'Context',
      workspaces: 'Workspaces',
    }
    return `${sections[section] || 'Settings'} · ${PRODUCT_NAME}`
  }
  if (pathname === '/meetings') return `Meetings · ${PRODUCT_NAME}`
  if (pathname === '/tasks') return `Tasks · ${PRODUCT_NAME}`
  if (pathname.startsWith('/onboarding')) return `Welcome to ${PRODUCT_NAME}`
  if (pathname.startsWith('/connect-apps'))
    return `${PRODUCT_NAME} Connect Apps`
  if (pathname.startsWith('/scheduled'))
    return `${PRODUCT_NAME} Scheduled Tasks`
  return PRODUCT_NAME
}

/** Keeps the new-tab / app shell document title aligned with the active route. */
export function RouteDocumentTitle() {
  const { pathname } = useLocation()

  useEffect(() => {
    const title = titleForAppPath(pathname)
    if (title !== null) setPageMetadata(title)
  }, [pathname])

  return null
}

/** Sets the side panel document title. */
export function SidePanelDocumentTitle() {
  useEffect(() => {
    document.title = PRODUCT_CHAT_NAME
  }, [])

  return null
}
