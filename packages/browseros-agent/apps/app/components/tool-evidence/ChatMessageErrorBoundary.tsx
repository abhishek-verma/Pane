import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Cleared automatically when this changes (e.g. streamed text growing). */
  resetKey: string | number
}

type State = {
  error: Error | null
}

/**
 * Isolates one message segment's render failure (markdown/mermaid/etc.) so
 * the rest of the conversation — header, composer, other messages — stays
 * usable instead of the whole panel going blank. Modeled on
 * PiPageErrorBoundary/PiNodeErrorBoundary.
 */
export class ChatMessageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Isolated fallback UI — sentryRootErrorHandler's onCaughtError reports.
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="my-2 rounded-md border border-border/60 bg-muted/20 p-3 text-muted-foreground text-xs">
          Couldn’t render this message.
        </div>
      )
    }
    return this.props.children
  }
}
