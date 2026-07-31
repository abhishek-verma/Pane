/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * On pi.html, non-PI HashRouter routes must leave for app.html.
 */

import { type FC, type ReactNode, useEffect } from 'react'
import { useLocation } from 'react-router'
import { isPiDocument, isPiRoutePath, navigateAppShell } from './pi-document'

export const PiDocumentShellGuard: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const location = useLocation()

  useEffect(() => {
    if (!isPiDocument()) return
    if (isPiRoutePath(location.pathname)) return
    navigateAppShell(`${location.pathname}${location.search}`)
  }, [location.pathname, location.search])

  // Avoid flashing home/settings chrome on the PI document.
  if (isPiDocument() && !isPiRoutePath(location.pathname)) {
    return null
  }

  return children
}
