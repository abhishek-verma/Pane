import { Bot, Settings } from 'lucide-react'
import type { FC } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { PRODUCT_NAME } from '@/lib/constants/product'

const isSidePanel = location.pathname.endsWith('/sidepanel.html')

const openSettings = () => {
  const url = chrome.runtime.getURL('app.html#/settings/ai')
  void chrome.tabs.create({ url })
}

/** Shown when chat is opened before the user adds an LLM provider. */
export const NoProviderConfigured: FC = () => {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
        <Bot className="h-7 w-7 text-[var(--accent-orange)]" />
      </div>
      <div className="max-w-sm space-y-2">
        <h2 className="font-semibold text-lg">Add an AI provider</h2>
        <p className="text-muted-foreground text-sm">
          {PRODUCT_NAME} needs your own API key or a local model (Ollama, LM
          Studio) before chat and agent features can run.
        </p>
      </div>
      {isSidePanel ? (
        <Button onClick={openSettings}>
          <Settings className="mr-2 h-4 w-4" />
          Configure in Settings
        </Button>
      ) : (
        <Button asChild>
          <Link to="/settings/ai">
            <Settings className="mr-2 h-4 w-4" />
            Configure in Settings
          </Link>
        </Button>
      )}
    </div>
  )
}
