/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type PiAction =
  | { kind: 'open-internal'; route: string }
  | { kind: 'open-external'; url: string }
  | {
      kind: 'local'
      op: 'filter' | 'expand' | 'copy' | 'dismiss'
      args?: Record<string, unknown>
    }
  | { kind: 'agent'; query: string; metadata: Record<string, unknown> }

export type PiNode =
  | { type: 'title'; text: string }
  | { type: 'text'; text: string }
  | { type: 'note'; text: string }
  | {
      type: 'badge'
      text: string
      tone?: 'neutral' | 'good' | 'warn' | 'bad'
    }
  | { type: 'divider' }
  | { type: 'stack'; direction?: 'row' | 'col'; children: PiNode[] }
  | {
      type: 'button'
      label: string
      action: PiAction
      replaceWith?: PiNode
    }
  | {
      type: 'link'
      label: string
      action: Extract<PiAction, { kind: 'open-internal' | 'open-external' }>
    }
  | {
      type: 'table'
      columns: Array<{ id: string; header: string }>
      rows: Array<{
        id: string
        recordId?: string
        cells: Record<string, PiNode | string>
      }>
    }
  | {
      type: 'board'
      columns: Array<{ id: string; title: string; cardIds: string[] }>
      cards: Array<{
        id: string
        recordId?: string
        title: string
        subtitle?: string
        actions?: PiAction[]
      }>
    }
  | {
      type: 'chart'
      chartType: 'bar' | 'line' | 'pie' | 'horizontal-bar'
      title?: string
      unit?: string
      data: Array<{ label: string; value: number }>
    }
  | {
      type: 'mermaid'
      source: string
      title?: string
    }
  | {
      type: 'svg'
      markup: string
      title?: string
      alt?: string
    }

export type PiPageDoc = {
  version: 1
  title: string
  nodes: PiNode[]
}

export type PiDoorway = {
  siteId: string
  name: string
  address: string
  pulseLine: string
  primaryRoute: string
  secondary?: {
    label: string
    deepLink: string
    agentQuery?: string
    metadata?: Record<string, unknown>
  }
}

export type PiContinuityBlock = {
  id: string
  title: string
  body: string
  route?: string
  agentQuery?: string
  metadata?: Record<string, unknown>
}

export type PiHomeProjection = {
  doorways: PiDoorway[]
  continuity: PiContinuityBlock[]
  libraryCount: number
  generatedAt: string
}
