/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type PiSiteStatus =
  | 'drafting'
  | 'active'
  | 'dormant'
  | 'archived'
  | 'deleted'

export type PiPageKind = 'index' | 'entity' | 'home_region'

export type PiPageStatus =
  | 'active'
  | 'stale'
  | 'refreshing'
  | 'error-stale'
  | 'archived'

export type PiTempStatus =
  | 'active'
  | 'refreshing'
  | 'kept-pending'
  | 'expired'
  | 'discarded'

export type PiRefreshKind = 'A' | 'B' | 'C' | 'D' | 'E'

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
  | {
      type: 'stack'
      direction?: 'row' | 'col'
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
        title: string
        subtitle?: string
        actions?: PiAction[]
      }>
    }

export type PiPageDoc = {
  version: 1
  title: string
  nodes: PiNode[]
}

export type TableRow = {
  id: string
  recordId?: string
  cells: Record<string, PiNode | string>
}

export type PiPatchOp =
  | { op: 'setTitle'; title: string }
  | { op: 'replaceNodes'; nodes: PiNode[] }
  | { op: 'upsertTableRow'; row: TableRow }
  | {
      op: 'setCell'
      rowId: string
      columnId: string
      value: PiNode | string
    }
  | {
      op: 'upsertBoardCard'
      card: {
        id: string
        recordId?: string
        title: string
        subtitle?: string
        columnId: string
        actions?: PiAction[]
      }
    }
  | { op: 'moveBoardCard'; cardId: string; toColumnId: string }
  | { op: 'bindRecord'; recordId: string; data: Record<string, unknown> }

export type PiUrgency = {
  label: string
  deepLink: string
  agentQuery?: string
  metadata?: Record<string, unknown>
}

export type PiPulse = {
  siteId: string
  name: string
  address: string
  pulseLine: string
  counts: Record<string, number>
  topUrgencies: PiUrgency[]
  lastUpdatedAt: string
  staleAt: string | null
  status: PiSiteStatus
}

export type PiDoorway = {
  siteId: string
  name: string
  address: string
  pulseLine: string
  primaryRoute: string
  secondary?: PiUrgency
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

export type PiRefreshPolicy = {
  triggers: Array<{ name: string; filter?: string; kind: PiRefreshKind }>
  guards?: { cooldownMs?: number; requireHarvestEnabled?: boolean }
}

export type PreserveMode = 'attach' | 'new_site' | 'standalone'

export type PiTemplateId = 'job-search' | 'research-hub' | 'sales-leads'
