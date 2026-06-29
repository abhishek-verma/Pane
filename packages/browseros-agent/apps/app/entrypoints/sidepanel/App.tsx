import type { FC } from 'react'
import { HashRouter, Route, Routes } from 'react-router'
import { ChatLayout } from '@/components/layout/ChatLayout'
import { SidePanelDocumentTitle } from '@/lib/document-title/RouteDocumentTitle'
import { ChatHistory } from '@/screens/sidepanel/history/ChatHistory'
import { Chat } from '@/screens/sidepanel/index/Chat'

export const App: FC = () => {
  return (
    <HashRouter>
      <SidePanelDocumentTitle />
      <Routes>
        <Route element={<ChatLayout />}>
          <Route index element={<Chat />} />
          <Route path="history" element={<ChatHistory />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
