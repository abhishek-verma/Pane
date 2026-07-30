/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useQueryClient } from '@tanstack/react-query'
import { type FC, useState } from 'react'
import { Link } from 'react-router'
import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { executePiAction } from '@/lib/pi-actions'
import { executeWidgetAction } from '@/lib/widget-actions'
import { HOME_QUERY_KEY } from '@/screens/newtab/home/home-data'
import {
  PiRailAction,
  PiSectionLabel,
} from '@/screens/personal-internet/PiChrome'
import type { PiHomeProjection } from '@/screens/personal-internet/types'
import { piPost } from '@/screens/personal-internet/usePiApi'

function approvalTokens(metadata: Record<string, unknown> | undefined): {
  approvalId: string
  approveToken: string
  denyToken: string
  conversationId: string | null
} | null {
  if (metadata?.kind !== 'approval') return null
  const approvalId =
    typeof metadata.approvalId === 'string' ? metadata.approvalId : ''
  const approveToken =
    typeof metadata.approveToken === 'string' ? metadata.approveToken : ''
  const denyToken =
    typeof metadata.denyToken === 'string' ? metadata.denyToken : ''
  const conversationId =
    typeof metadata.conversationId === 'string' ? metadata.conversationId : null
  if (!approvalId || !approveToken || !denyToken) return null
  return { approvalId, approveToken, denyToken, conversationId }
}

function routePath(route: string): string {
  return route.startsWith('#/') ? route.slice(1) : route
}

function sectionLabel(index: number, title: string): string {
  return `${String(index).padStart(2, '0')} ${title}`
}

export const PiHomeRegions: FC<{ data?: PiHomeProjection | null }> = ({
  data,
}) => {
  const queryClient = useQueryClient()
  const [resolveBusyId, setResolveBusyId] = useState<string | null>(null)
  const [resolveNote, setResolveNote] = useState<{
    id: string
    text: string
  } | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)

  if (!data) return null
  const { doorways, continuity, libraryCount, proposeDoorways } = data
  if (
    doorways.length === 0 &&
    continuity.length === 0 &&
    libraryCount === 0 &&
    !(proposeDoorways && proposeDoorways.length > 0)
  ) {
    return null
  }

  const showToday = continuity.length > 0
  const showLiving = doorways.length > 0
  const showLibraryOnly = !showLiving && libraryCount > 0
  const showPropose = Boolean(proposeDoorways && proposeDoorways.length > 0)
  let next = 1
  const todayIndex = showToday ? next++ : 0
  const livingIndex = showLiving || showLibraryOnly ? next++ : 0
  const proposeIndex = showPropose ? next++ : 0

  const resolveApproval = async (
    blockId: string,
    tokens: NonNullable<ReturnType<typeof approvalTokens>>,
    resolution: 'approve' | 'deny',
  ) => {
    setResolveBusyId(blockId)
    setResolveNote(null)
    try {
      const result = await executeWidgetAction(
        {
          type: 'resolve-approval',
          approvalId: tokens.approvalId,
          token:
            resolution === 'approve' ? tokens.approveToken : tokens.denyToken,
          resolution,
        },
        queryClient,
      )
      setResolveNote({
        id: blockId,
        text:
          result?.detail ?? (resolution === 'approve' ? 'Approved' : 'Denied'),
      })
    } finally {
      setResolveBusyId(null)
    }
  }

  const openApprovalAgent = async (blockId: string, conversationId: string) => {
    setOpeningId(blockId)
    try {
      await openSidePanelWithSearch('open', {
        query: '',
        mode: 'agent',
        conversationId,
      })
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div className="w-full divide-y divide-border border-border border-t">
      {showToday ? (
        <section>
          <div className="flex items-center justify-between gap-3 py-3">
            <PiSectionLabel>{sectionLabel(todayIndex, 'Today')}</PiSectionLabel>
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
              {continuity.length}
            </span>
          </div>
          <div className="divide-y divide-border border-border border-t">
            {continuity.map((block) => {
              const tokens = approvalTokens(block.metadata)
              const note =
                resolveNote?.id === block.id ? resolveNote.text : null
              return (
                <div key={block.id} className="py-3">
                  <div className="font-medium text-sm">{block.title}</div>
                  <div className="mt-0.5 whitespace-pre-line text-muted-foreground text-xs leading-5">
                    {block.body}
                  </div>
                  {note ? (
                    <div className="mt-2 font-mono text-[11px] text-[var(--signal)] tracking-wide">
                      {note}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tokens ? (
                      <>
                        <PiRailAction
                          disabled={resolveBusyId === block.id}
                          onClick={() =>
                            void resolveApproval(block.id, tokens, 'approve')
                          }
                        >
                          Approve
                        </PiRailAction>
                        <PiRailAction
                          disabled={resolveBusyId === block.id}
                          onClick={() =>
                            void resolveApproval(block.id, tokens, 'deny')
                          }
                        >
                          Deny
                        </PiRailAction>
                        {tokens.conversationId ? (
                          <PiRailAction
                            disabled={openingId === block.id}
                            onClick={() => {
                              const cid = tokens.conversationId
                              if (!cid) return
                              void openApprovalAgent(block.id, cid)
                            }}
                          >
                            {openingId === block.id ? 'Opening…' : 'Open agent'}
                          </PiRailAction>
                        ) : (
                          <PiRailAction to="/settings/action-log">
                            Action log
                          </PiRailAction>
                        )}
                      </>
                    ) : null}
                    {!tokens && block.route ? (
                      <PiRailAction to={routePath(block.route)}>
                        Open
                      </PiRailAction>
                    ) : null}
                    {!tokens && block.agentQuery ? (
                      <PiRailAction
                        onClick={() => {
                          const query = block.agentQuery
                          if (!query) return
                          void executePiAction({
                            kind: 'agent',
                            query,
                            metadata: block.metadata ?? {},
                          })
                        }}
                      >
                        Handle
                      </PiRailAction>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {showLiving ? (
        <section>
          <div className="flex items-center justify-between gap-3 py-3">
            <PiSectionLabel>
              {sectionLabel(livingIndex, 'Living work')}
            </PiSectionLabel>
            <PiRailAction to="/pi/library">
              My sites ({libraryCount})
            </PiRailAction>
          </div>
          <div className="divide-y divide-border border-border border-t">
            {doorways.map((d) => (
              <div
                key={d.siteId}
                className="flex items-center justify-between gap-4 py-3"
              >
                <Link
                  to={routePath(d.primaryRoute)}
                  className="min-w-0 flex-1 transition-opacity hover:opacity-80"
                >
                  <div className="truncate font-medium text-sm">{d.name}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground tracking-wide">
                    {d.pulseLine}
                    {d.lastUpdatedAt
                      ? ` · ${new Date(d.lastUpdatedAt).toLocaleString()}`
                      : ''}
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  {d.secondary ? (
                    d.secondary.deepLink ? (
                      <PiRailAction to={routePath(d.secondary.deepLink)}>
                        {d.secondary.label.slice(0, 24)}
                      </PiRailAction>
                    ) : d.secondary.agentQuery ? (
                      <PiRailAction
                        onClick={() => {
                          const q = d.secondary?.agentQuery
                          if (!q) return
                          void executePiAction({
                            kind: 'agent',
                            query: q,
                            metadata: d.secondary?.metadata ?? {},
                          })
                        }}
                      >
                        {d.secondary.label.slice(0, 24)}
                      </PiRailAction>
                    ) : null
                  ) : null}
                  <PiRailAction to={routePath(d.primaryRoute)}>
                    Open
                  </PiRailAction>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : showLibraryOnly ? (
        <section>
          <div className="flex items-center justify-between gap-3 py-3">
            <PiSectionLabel>
              {sectionLabel(livingIndex, 'Library')}
            </PiSectionLabel>
            <PiRailAction to="/pi/library">
              My sites ({libraryCount})
            </PiRailAction>
          </div>
        </section>
      ) : null}

      {showPropose && proposeDoorways ? (
        <section>
          <div className="flex items-center justify-between gap-3 py-3">
            <PiSectionLabel>
              {sectionLabel(proposeIndex, 'Suggest for home')}
            </PiSectionLabel>
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
              {proposeDoorways.length}
            </span>
          </div>
          <div className="divide-y divide-border border-border border-t">
            {proposeDoorways.map((p) => (
              <div
                key={p.siteId}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">{p.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground tracking-wide">
                    Add to Living work on home
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <PiRailAction
                    onClick={() => {
                      void piPost(`/pi/sites/${p.siteId}/doorway`, {
                        eligible: true,
                        pin: true,
                      }).then((res) => {
                        if (res.ok) {
                          void queryClient.invalidateQueries({
                            queryKey: [...HOME_QUERY_KEY],
                          })
                        }
                      })
                    }}
                  >
                    Add to home
                  </PiRailAction>
                  <PiRailAction to={routePath(p.route)}>Open</PiRailAction>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
