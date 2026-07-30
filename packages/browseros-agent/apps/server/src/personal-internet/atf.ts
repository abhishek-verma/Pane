/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Deterministic above-the-fold entity page from record data (no LLM).
 */

import { entityRoute } from './paths'
import type { PiNode, PiPageDoc } from './types'

export const BTF_LOADING_NOTE = 'More sections loading…'

export type EntityAtfInput = {
  company: string
  entityKey: string
  siteId: string
  role?: string
  stage?: string
  nextAction?: string
  url?: string
  notes?: string
}

export function buildEntityAtfDoc(input: EntityAtfInput): PiPageDoc {
  const badges: PiNode[] = []
  if (input.stage) {
    badges.push({ type: 'badge', text: input.stage, tone: 'neutral' })
  }
  if (input.role) {
    badges.push({ type: 'badge', text: input.role, tone: 'neutral' })
  }

  const actionButtons: PiNode[] = []
  if (input.nextAction) {
    actionButtons.push({
      type: 'button',
      label: 'Follow up',
      action: {
        kind: 'agent',
        query: `Follow up for ${input.company}: ${input.nextAction}`,
        metadata: {
          siteId: input.siteId,
          entityKey: input.entityKey,
          returnRoute: entityRoute(input.siteId, input.entityKey),
        },
      },
    })
  }
  if (input.url) {
    actionButtons.push({
      type: 'button',
      label: 'Open link',
      action: { kind: 'open-external', url: input.url },
    })
  }

  const nodes: PiNode[] = [{ type: 'title', text: input.company }]
  if (badges.length) {
    nodes.push({ type: 'stack', direction: 'row', children: badges })
  }
  if (input.nextAction) {
    nodes.push({ type: 'text', text: `Next: ${input.nextAction}` })
  }
  if (actionButtons.length) {
    nodes.push({ type: 'stack', direction: 'row', children: actionButtons })
  }
  if (input.notes) {
    nodes.push({ type: 'note', text: input.notes })
  }
  nodes.push({ type: 'divider' })
  nodes.push({
    type: 'stack',
    id: 'btf-root',
    direction: 'col',
    children: [{ type: 'note', text: BTF_LOADING_NOTE }],
  })

  return {
    version: 1,
    title: input.company,
    nodes,
    meta: {
      entityKey: input.entityKey,
      materialize: { phase: 'atf', sections: [] },
    },
  }
}
