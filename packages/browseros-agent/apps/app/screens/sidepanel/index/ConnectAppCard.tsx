import { Plug, X } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  BREADCRUMB_CONNECT_CLICKED_EVENT,
  BREADCRUMB_CONNECT_DISMISSED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import type { NudgeData } from './getMessageSegments'

export interface ConnectAppCardProps {
  data: NudgeData
  isLastMessage: boolean
}

export const ConnectAppCard: FC<ConnectAppCardProps> = ({
  data,
  isLastMessage,
}) => {
  const [dismissed, setDismissed] = useState(!isLastMessage)

  const appName = (data.appName as string) ?? 'this app'
  const reason = (data.reason as string) ?? ''

  useEffect(() => {
    if (!isLastMessage) {
      setDismissed(true)
    }
  }, [isLastMessage])

  const handleDismiss = () => {
    track(BREADCRUMB_CONNECT_DISMISSED_EVENT, { app_name: appName })
    setDismissed(true)
  }

  if (dismissed) return null

  const handleConnect = () => {
    track(BREADCRUMB_CONNECT_CLICKED_EVENT, { app_name: appName })
    setDismissed(true)
    const url = chrome.runtime.getURL('app.html#/settings/connect-apps')
    chrome.tabs.create({ url })
  }

  return (
    <div className="agent-trace relative py-3">
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-2 right-0 rounded p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <Plug className="h-4 w-4 shrink-0 text-[var(--accent-orange)]" />
        <div>
          <p className="font-medium text-sm">Connect {appName}?</p>
          {reason && (
            <p className="mt-1 text-muted-foreground text-xs">{reason}</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={handleConnect}>
          Connect {appName}
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDismiss}>
          Maybe later
        </Button>
      </div>
    </div>
  )
}
