import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { clearLastActiveConversation } from '@/lib/browseros/lastActiveConversationStorage'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Top-of-tree safety net for the chat session. ChatMessageErrorBoundary
 * only isolates individual message rows, several layers below
 * ChatSessionProvider — nothing above it catches anything, so before this,
 * any uncaught error here (including a future instance of the
 * effect-writes-back-into-its-own-state-loop class that produced React
 * error #185 in production before) unmounted the whole panel to a blank
 * screen with no recovery but manually reopening it.
 *
 * Reload (rather than resetting local boundary state and remounting in
 * place) is deliberate: the crash may be caused by data that gets reloaded
 * right back in on remount (e.g. a poisoned conversation resumed from
 * storage), which an in-place reset would immediately re-trigger.
 */
export class ChatSessionCrashBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Isolated fallback UI — sentryRootErrorHandler's onCaughtError reports.
  }

  handleReload = (): void => {
    // Clearing the resume pointer first stops the reload from immediately
    // resuming into whatever conversation triggered the crash.
    void clearLastActiveConversation().finally(() => {
      window.location.reload()
    })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <p className="font-medium text-sm">Chat ran into a problem.</p>
          <p className="max-w-xs text-muted-foreground text-xs">
            Reloading starts a fresh session — your conversations are saved.
          </p>
          <Button onClick={this.handleReload} size="sm">
            Reload chat
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
