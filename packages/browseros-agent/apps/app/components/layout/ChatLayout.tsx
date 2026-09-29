import type { FC } from 'react'
import { Outlet } from 'react-router'
import { ChatSessionCrashBoundary } from '@/components/chat/ChatSessionCrashBoundary'
import {
  ChatSessionProvider,
  useChatSessionContext,
} from '@/modules/chat/chat-session-context'
import { ChatHeader } from '@/screens/sidepanel/index/ChatHeader'

const ChatLayoutContent: FC = () => {
  const {
    providers,
    selectedProvider,
    handleSelectProvider,
    resetConversation,
  } = useChatSessionContext()

  return (
    <div className="mx-auto flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <ChatHeader
        selectedProvider={selectedProvider}
        onSelectProvider={handleSelectProvider}
        providers={providers}
        onNewConversation={resetConversation}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}

export const ChatLayout: FC = () => {
  return (
    <ChatSessionCrashBoundary>
      <ChatSessionProvider>
        <ChatLayoutContent />
      </ChatSessionProvider>
    </ChatSessionCrashBoundary>
  )
}
