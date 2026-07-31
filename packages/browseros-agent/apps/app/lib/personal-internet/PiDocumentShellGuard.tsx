/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Keep PI routes on pi.html and home/settings on app.html.
 * Client-side HashRouter links (Home → Library, etc.) only change the hash,
 * so load-time migrateLegacyPiDocumentIfNeeded never runs for those — this
 * guard hard-navigates between documents.
 */

import { type FC, type ReactNode, useEffect } from 'react'
import { useLocation } from 'react-router'
import {
  documentForRoute,
  isPiDocument,
  replaceAppDocument,
  replacePiDocument,
} from './pi-document'

export const PiDocumentShellGuard: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const location = useLocation()
  const onPiDoc = isPiDocument()
  const targetDocument = documentForRoute(location.pathname)
  const onCorrectDocument = onPiDoc === (targetDocument === 'pi')

  useEffect(() => {
    if (onCorrectDocument) return
    if (targetDocument === 'app') {
      replaceAppDocument(`${location.pathname}${location.search}`)
      return
    }
    replacePiDocument(`${location.pathname}${location.search}`)
  }, [location.pathname, location.search, onCorrectDocument, targetDocument])

  // Avoid flashing the wrong shell while the hard navigation starts.
  if (!onCorrectDocument) {
    return null
  }

  return children
}
