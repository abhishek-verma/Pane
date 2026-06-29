import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { PRODUCT_CHAT_NAME, PRODUCT_NAME } from '@/lib/constants/product'

function titleForAppPath(pathname: string): string {
  if (pathname.startsWith('/home/chat')) return PRODUCT_CHAT_NAME
  if (pathname.startsWith('/settings/chat')) return `${PRODUCT_CHAT_NAME} & Hub`
  if (pathname.startsWith('/settings')) return `${PRODUCT_NAME} Settings`
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
    document.title = titleForAppPath(pathname)
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
