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

export type PiLabeledAction = {
  label: string
  action: PiAction
}

export type PiCardAction = PiAction | PiLabeledAction

export type PiNode =
  | { type: 'title'; text: string }
  | { type: 'text'; text: string }
  | { type: 'note'; text: string }
  | {
      type: 'badge'
      text: string
      tone?: 'neutral' | 'good' | 'warn' | 'bad'
    }
  | {
      type: 'stat'
      label: string
      value: string
      tone?: 'neutral' | 'good' | 'warn' | 'bad'
    }
  | { type: 'divider' }
  | {
      type: 'stack'
      id?: string
      direction?: 'row' | 'col'
      columns?: number
      children: PiNode[]
    }
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
        entityKey?: string
        title: string
        subtitle?: string
        actions?: PiCardAction[]
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

export type PiMaterializePhase =
  | 'atf'
  | 'btf-structure'
  | 'btf-filling'
  | 'done'

export type PiMaterializeSection = {
  id: string
  title: string
  status: 'shell' | 'filled' | 'skipped'
}

export type PiPageMeta = {
  entityKey?: string
  materialize?: {
    phase: PiMaterializePhase
    sections: PiMaterializeSection[]
  }
}

export type PiPageDoc = {
  version: 1
  title: string
  nodes: PiNode[]
  meta?: PiPageMeta
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
  lastUpdatedAt?: string
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
  proposeDoorways?: Array<{ siteId: string; name: string; route: string }>
}
