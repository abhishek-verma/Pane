import type { FC } from 'react'
import { HashRouter, Route, Routes } from 'react-router'
import { ChatLayout } from '@/components/layout/ChatLayout'
import { SidePanelDocumentTitle } from '@/lib/document-title/RouteDocumentTitle'
import { useOnboardingCompleted } from '@/lib/onboarding/useOnboardingCompleted'
import { ChatHistory } from '@/screens/sidepanel/history/ChatHistory'
import { Chat } from '@/screens/sidepanel/index/Chat'
import { FinishOnboardingPanel } from '@/screens/sidepanel/index/FinishOnboardingPanel'

const SidepanelRoutes: FC = () => {
  const onboarding = useOnboardingCompleted()

  if (onboarding.status === 'loading') {
    return null
  }

  if (!onboarding.completed) {
    return <FinishOnboardingPanel />
  }

  return (
    <Routes>
      <Route element={<ChatLayout />}>
        <Route index element={<Chat />} />
        <Route path="history" element={<ChatHistory />} />
      </Route>
    </Routes>
  )
}

export const App: FC = () => {
  return (
    <HashRouter>
      <SidePanelDocumentTitle />
      <SidepanelRoutes />
    </HashRouter>
  )
}
