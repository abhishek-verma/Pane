/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { cn } from '@/lib/utils'
import { BoardKanban } from './BoardKanban'
import { PiRailAction } from './PiChrome'
import { PiMarkdown } from './PiMarkdown'
import { PiNodeErrorBoundary } from './PiNodeErrorBoundary'
import type { PiAction, PiNode, PiPageDoc } from './types'
import { PiChartView } from './viz/PiChartView'
import { PiMermaidView } from './viz/PiMermaidView'
import { PiSvgView } from './viz/PiSvgView'

const toneClass: Record<string, string> = {
  neutral: 'border-border text-muted-foreground',
  good: 'border-emerald-600/40 text-emerald-800 dark:text-emerald-300',
  warn: 'border-amber-600/40 text-amber-900 dark:text-amber-200',
  bad: 'border-red-600/40 text-red-800 dark:text-red-300',
}

export type PiActionHandler = (
  action: PiAction,
  ctx?: { pendingKey?: string },
) => void | Promise<void>

function safeLen(value: unknown): number {
  return typeof value === 'string' || Array.isArray(value) ? value.length : 0
}

function nodeKey(node: PiNode, path: string): string {
  switch (node.type) {
    case 'title':
    case 'text':
    case 'note':
      return `${path}:${node.type}:${String(node.text ?? '').slice(0, 48)}`
    case 'badge':
      return `${path}:badge:${node.tone ?? 'neutral'}:${String(node.text ?? '').slice(0, 32)}`
    case 'divider':
      return `${path}:divider`
    case 'button':
      return `${path}:button:${node.label ?? ''}`
    case 'link':
      return `${path}:link:${node.label ?? ''}`
    case 'stack':
      return `${path}:stack:${node.direction ?? 'col'}:${safeLen(node.children)}`
    case 'table':
      return `${path}:table:${Array.isArray(node.rows) ? node.rows.map((r) => r.id).join(',') : ''}`
    case 'board':
      return `${path}:board:${Array.isArray(node.cards) ? node.cards.map((c) => c.id ?? c.title).join(',') : ''}`
    case 'chart':
      return `${path}:chart:${node.chartType}:${Array.isArray(node.data) ? node.data.map((d) => d.label).join(',') : ''}`
    case 'mermaid':
      return `${path}:mermaid:${String(node.title ?? '').slice(0, 24)}:${safeLen(node.source)}`
    case 'svg':
      return `${path}:svg:${String(node.title ?? node.alt ?? '').slice(0, 24)}:${safeLen(node.markup)}`
    default:
      return `${path}:unknown`
  }
}

const PiBrokenBlock: FC<{ reason: string }> = ({ reason }) => (
  <div className="border-border border-y px-3 py-4 font-mono text-[11px] text-muted-foreground tracking-wide">
    Skipped broken block ({reason}).
  </div>
)

const PiNodeView: FC<{
  node: PiNode
  path: string
  onAction: PiActionHandler
  pendingKey?: string | null
  onMoveCard?: (cardId: string, toColumnId: string) => void | Promise<void>
  siteId?: string
  titleIndex?: number
}> = ({ node, path, onAction, pendingKey, onMoveCard, siteId, titleIndex }) => {
  switch (node.type) {
    case 'title':
      return (
        <header className="flex flex-col gap-1 border-border border-b pb-4">
          {titleIndex != null && titleIndex > 0 ? (
            <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
              {String(titleIndex).padStart(2, '0')}
            </div>
          ) : null}
          <h1
            className={cn(
              'text-foreground tracking-tight',
              titleIndex === 0 || titleIndex == null
                ? 'font-semibold text-3xl'
                : 'font-medium text-xl',
            )}
          >
            {node.text}
          </h1>
        </header>
      )
    case 'text':
      return (
        <div className="max-w-prose text-foreground/85 text-sm leading-relaxed">
          <PiMarkdown>{node.text ?? ''}</PiMarkdown>
        </div>
      )
    case 'note':
      return (
        <div className="border-border border-l-2 pl-3 text-foreground/80 text-sm leading-relaxed">
          <PiMarkdown>{node.text ?? ''}</PiMarkdown>
        </div>
      )
    case 'badge':
      return (
        <span
          className={cn(
            'inline-flex border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]',
            toneClass[node.tone ?? 'neutral'],
          )}
        >
          {node.text}
        </span>
      )
    case 'divider':
      return <hr className="border-border" />
    case 'stack':
      if (!Array.isArray(node.children)) {
        return <PiBrokenBlock reason="stack without children" />
      }
      return (
        <div
          className={cn(
            'flex gap-3',
            node.direction === 'row'
              ? 'flex-row flex-wrap items-center'
              : 'flex-col',
          )}
        >
          {node.children.map((child, i) => {
            const childPath = `${nodeKey(child, path)}:${i}`
            return (
              <PiNodeErrorBoundary key={childPath} label={child.type}>
                <PiNodeView
                  node={child}
                  path={childPath}
                  onAction={onAction}
                  pendingKey={pendingKey}
                  onMoveCard={onMoveCard}
                  siteId={siteId}
                />
              </PiNodeErrorBoundary>
            )
          })}
        </div>
      )
    case 'button': {
      const key = `btn:${node.label}`
      const pending = pendingKey === key
      return (
        <PiRailAction
          disabled={pending}
          onClick={() => void onAction(node.action, { pendingKey: key })}
        >
          {pending ? 'Working…' : node.label}
        </PiRailAction>
      )
    }
    case 'link':
      return (
        <button
          type="button"
          className="text-foreground/80 text-sm underline-offset-4 transition-colors hover:text-foreground hover:underline"
          onClick={() => void onAction(node.action)}
        >
          {node.label}
        </button>
      )
    case 'table':
      if (!Array.isArray(node.columns) || !Array.isArray(node.rows)) {
        return <PiBrokenBlock reason="table missing columns/rows" />
      }
      return (
        <div className="overflow-x-auto border-border border-y">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead>
              <tr className="border-border border-b">
                {node.columns.map((c) => (
                  <th
                    key={c.id}
                    className="px-3 py-2.5 font-mono font-normal text-[10px] text-muted-foreground uppercase tracking-[0.06em]"
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row) => (
                <tr key={row.id} className="border-border/70 border-t">
                  {node.columns.map((c) => {
                    const cell = row.cells?.[c.id]
                    return (
                      <td
                        key={c.id}
                        className="px-3 py-2.5 align-top text-foreground"
                      >
                        {typeof cell === 'string' || cell == null ? (
                          cell ? (
                            <PiMarkdown>{cell}</PiMarkdown>
                          ) : (
                            ''
                          )
                        ) : (
                          <PiNodeErrorBoundary label="cell">
                            <PiNodeView
                              node={cell}
                              path={`${path}:cell:${row.id}:${c.id}`}
                              onAction={onAction}
                              pendingKey={pendingKey}
                              siteId={siteId}
                            />
                          </PiNodeErrorBoundary>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'board':
      return (
        <BoardKanban
          node={node}
          siteId={siteId}
          onAction={(action) => void onAction(action)}
          onMoveCard={onMoveCard}
        />
      )
    case 'chart':
      if (!Array.isArray(node.data) || node.data.length === 0) {
        return <PiBrokenBlock reason="chart without data" />
      }
      return <PiChartView node={node} />
    case 'mermaid':
      if (typeof node.source !== 'string' || !node.source.trim()) {
        return <PiBrokenBlock reason="mermaid without source" />
      }
      return <PiMermaidView node={node} />
    case 'svg':
      if (typeof node.markup !== 'string' || !node.markup.trim()) {
        return <PiBrokenBlock reason="svg without markup" />
      }
      return <PiSvgView node={node} />
    default:
      return <PiBrokenBlock reason="unknown node type" />
  }
}

export const PiPageRenderer: FC<{
  doc: PiPageDoc
  onAction: PiActionHandler
  pendingKey?: string | null
  onMoveCard?: (cardId: string, toColumnId: string) => void | Promise<void>
  siteId?: string
}> = ({ doc, onAction, pendingKey, onMoveCard, siteId }) => {
  let titleCount = 0
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : []
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-8"
      style={
        {
          '--pi-accent': 'var(--signal)',
        } as React.CSSProperties
      }
    >
      {nodes.map((node, i) => {
        const path = `${nodeKey(node, 'root')}:${i}`
        const titleIndex = node.type === 'title' ? titleCount++ : undefined
        return (
          <PiNodeErrorBoundary key={path} label={node.type}>
            <PiNodeView
              node={node}
              path={path}
              onAction={onAction}
              pendingKey={pendingKey}
              onMoveCard={onMoveCard}
              siteId={siteId}
              titleIndex={titleIndex}
            />
          </PiNodeErrorBoundary>
        )
      })}
    </div>
  )
}
