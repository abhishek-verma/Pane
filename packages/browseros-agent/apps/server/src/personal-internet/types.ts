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

/** Board/table row action with a visible label (preferred authoring shape). */
export type PiLabeledAction = {
  label: string
  action: PiAction
}

export type PiCardAction = PiAction | PiLabeledAction

export type PiNode =
  | { type: 'title'; id?: string; text: string }
  | { type: 'text'; id?: string; text: string }
  | { type: 'note'; id?: string; text: string }
  | {
      type: 'badge'
      id?: string
      text: string
      tone?: 'neutral' | 'good' | 'warn' | 'bad'
    }
  /** Small KPI tile — a headline number/value with a label. */
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
      /**
       * When set (2-4), renders children as a top-aligned equal-width column
       * grid instead of the flex-wrap row/col layout — for side-by-side
       * sections (e.g. a paragraph next to a table), not chip rows.
       */
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
  /** Structured chart — renderer draws SVG from data (prefer over freeform svg). */
  | {
      type: 'chart'
      chartType: 'bar' | 'line' | 'pie' | 'horizontal-bar'
      title?: string
      unit?: string
      data: Array<{ label: string; value: number }>
    }
  /** Mermaid diagram source — rendered client-side. */
  | {
      type: 'mermaid'
      source: string
      title?: string
    }
  /** Sanitized inline SVG markup for custom visuals. */
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

export type TableRow = {
  id: string
  recordId?: string
  cells: Record<string, PiNode | string>
}

export type PiPatchOp =
  | { op: 'setTitle'; title: string }
  | { op: 'setNodeText'; id: string; text: string }
  | { op: 'replaceNodes'; nodes: PiNode[] }
  /** Append nodes after existing body (preferred for BTF section fills). */
  | { op: 'appendNodes'; nodes: PiNode[] }
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
        entityKey?: string
        title: string
        subtitle?: string
        columnId: string
        actions?: PiCardAction[]
      }
    }
  | { op: 'moveBoardCard'; cardId: string; toColumnId: string }
  | { op: 'bindRecord'; recordId: string; data: Record<string, unknown> }
  | { op: 'setMeta'; meta: PiPageMeta }
  | {
      op: 'setMaterializeSection'
      id: string
      status: PiMaterializeSection['status']
      title?: string
    }

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
  templateId: PiTemplateId
  pinned: boolean
  updatedSinceLastVisit: boolean
  secondary?: PiUrgency
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
  /** Non-P0 active sites that could become doorways if pinned. */
  proposeDoorways?: Array<{ siteId: string; name: string; route: string }>
}

export type PiRefreshPolicy = {
  triggers: Array<{ name: string; filter?: string; kind: PiRefreshKind }>
  guards?: { cooldownMs?: number; requireHarvestEnabled?: boolean }
}

export type PreserveMode = 'attach' | 'new_site' | 'standalone'

export type PiTemplateId =
  | 'job-search'
  | 'research-hub'
  | 'sales-leads'
  | 'reading-list'
  | 'habit-tracker'
  | 'project-tracker'
  | 'blank'
