import { Bot, Plus, SettingsIcon } from 'lucide-react'
import type { FC } from 'react'
import { useLocation } from 'react-router'
import { PaneWordmark } from '@/components/branding/PaneWordmark'
import { ChatHistoryPopover } from '@/components/chat/ChatHistoryPopover'
import { ChatProviderSelector } from '@/components/chat/ChatProviderSelector'
import type { Provider } from '@/components/chat/chatComponentTypes'
import { CreditBadge } from '@/components/credits/CreditBadge'
import { Feature } from '@/lib/browseros/capabilities'
import { ProviderIcon } from '@/lib/llm-providers/providerIcons'
import type { ProviderType } from '@/lib/llm-providers/types'
import { useCapabilities } from '@/modules/browseros/capabilities.hooks'
import { useCredits } from '@/modules/credits/credits.hooks'
import { LayersButton } from '@/screens/layers/LayersButton'

const CreditsBadgeWrapper: FC = () => {
  const { supports } = useCapabilities()
  const { data } = useCredits()
  if (!supports(Feature.CREDITS_SUPPORT) || data === undefined) return null
  return (
    <CreditBadge
      credits={data.credits}
      onClick={() => window.open('/app.html#/settings/usage', '_blank')}
    />
  )
}

export interface ChatHeaderProps {
  selectedProvider: Provider
  providers: Provider[]
  onSelectProvider: (provider: Provider) => void
  onNewConversation: () => void
  hasMessages: boolean
  hideHistory?: boolean
}

export const ChatHeader: FC<ChatHeaderProps> = ({
  selectedProvider,
  providers,
  onSelectProvider,
  onNewConversation,
  hasMessages,
}) => {
  const location = useLocation()
  const isHistoryPage = location.pathname === '/history'

  return (
    <header className="flex items-center justify-between bg-background/90 px-3 py-2 backdrop-blur-md">
      <div className="flex items-center gap-2">
        {/* Provider Selector */}
        <ChatProviderSelector
          providers={providers}
          selectedProvider={selectedProvider}
          onSelectProvider={onSelectProvider}
        >
          <button
            type="button"
            className="group relative inline-flex cursor-pointer items-center gap-2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-accent"
            title="Change AI Provider"
          >
            {selectedProvider.kind === 'acp' ? (
              <>
                <Bot className="h-[18px] w-[18px]" />
                <span className="font-medium text-sm">
                  {selectedProvider.name}
                </span>
              </>
            ) : selectedProvider.type === 'browseros' ? (
              <PaneWordmark size="sm" className="text-foreground" />
            ) : (
              <>
                <ProviderIcon
                  type={selectedProvider.type as ProviderType}
                  size={18}
                />
                <span className="font-medium text-sm">
                  {selectedProvider.name}
                </span>
              </>
            )}
          </button>
        </ChatProviderSelector>
        {selectedProvider.type === 'browseros' && <CreditsBadgeWrapper />}
      </div>

      <div className="flex items-center gap-1">
        <LayersButton />
        {!isHistoryPage && hasMessages && (
          <button
            type="button"
            onClick={onNewConversation}
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="New conversation"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}

        <ChatHistoryPopover />

        <a
          href="/app.html#/settings"
          target="_blank"
          rel="noopener noreferrer"
          className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          title="Settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </a>
      </div>
    </header>
  )
}
