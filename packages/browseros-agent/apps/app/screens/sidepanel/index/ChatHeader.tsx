import { Bot, ChevronDown, Plus, SettingsIcon } from 'lucide-react'
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
  selectedProvider: Provider | undefined
  providers: Provider[]
  onSelectProvider: (provider: Provider) => void
  onNewConversation: () => void
  hideHistory?: boolean
}

export const ChatHeader: FC<ChatHeaderProps> = ({
  selectedProvider,
  providers,
  onSelectProvider,
  onNewConversation,
}) => {
  const location = useLocation()
  const isHistoryPage = location.pathname === '/history'

  return (
    <header className="flex min-w-0 items-center justify-between gap-2 bg-background px-3 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {/* Provider Selector */}
        {selectedProvider ? (
          <ChatProviderSelector
            providers={providers}
            selectedProvider={selectedProvider}
            onSelectProvider={onSelectProvider}
          >
            <button
              type="button"
              className="group relative inline-flex min-w-0 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-accent"
              title="Change AI provider"
              aria-label="Change AI provider"
            >
              {selectedProvider.kind === 'acp' ? (
                <>
                  <Bot className="size-[18px] shrink-0" />
                  <span className="truncate font-medium text-sm">
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
                  <span className="truncate font-medium text-sm">
                    {selectedProvider.name}
                  </span>
                </>
              )}
              <ChevronDown className="size-3 shrink-0 opacity-50" />
            </button>
          </ChatProviderSelector>
        ) : (
          <PaneWordmark size="sm" className="text-foreground" />
        )}
        {selectedProvider?.type === 'browseros' && <CreditsBadgeWrapper />}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <LayersButton />
        {!isHistoryPage && (
          <button
            type="button"
            onClick={onNewConversation}
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            title="New conversation"
            aria-label="New conversation"
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
          aria-label="Settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </a>
      </div>
    </header>
  )
}
