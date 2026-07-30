/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { PiBrokenPagePanel } from './PiBrokenPagePanel'
import type { PiRepairFindingClient } from './piPageRepair'

type Props = {
  children: ReactNode
  siteId: string
  pageId: string
  pageTitle?: string
  entityKey?: string
  issues?: string[]
  fixHint?: string
  agentBrief?: string
  findings?: PiRepairFindingClient[]
  contentSummary?: {
    title?: string
    nodeTypes?: string[]
    boardSummaries?: Array<{
      columns: string[]
      cardTitles: string[]
      shape: string
    }>
  }
}

type State = {
  error: Error | null
}

/** Page-level isolation: keep site chrome; offer agent repair with diagnostics. */
export class PiPageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Isolated fallback UI — avoid console noise in production builds.
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.pageId !== this.props.pageId && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <PiBrokenPagePanel
          siteId={this.props.siteId}
          pageId={this.props.pageId}
          pageTitle={this.props.pageTitle}
          entityKey={this.props.entityKey}
          issues={this.props.issues}
          fixHint={this.props.fixHint}
          agentBrief={this.props.agentBrief}
          findings={this.props.findings}
          contentSummary={this.props.contentSummary}
          renderError={this.state.error.message}
        />
      )
    }
    return this.props.children
  }
}
