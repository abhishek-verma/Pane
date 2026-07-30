/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  label?: string
}

type State = {
  error: Error | null
}

/** Isolate one PI node failure so the rest of the page still renders. */
export class PiNodeErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Isolated fallback UI — avoid console noise in production builds.
  }

  render() {
    if (this.state.error) {
      return (
        <div className="border-border border-y px-3 py-4 font-mono text-[11px] text-muted-foreground tracking-wide">
          Couldn’t render this block
          {this.props.label ? ` (${this.props.label})` : ''}. Refresh the page
          with the agent to repair it.
        </div>
      )
    }
    return this.props.children
  }
}
