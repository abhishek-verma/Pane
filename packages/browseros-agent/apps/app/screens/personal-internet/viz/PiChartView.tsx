/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import type { PiNode } from '../types'

type ChartNode = Extract<PiNode, { type: 'chart' }>

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
]

function VizFrame({
  title,
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
  return (
    <figure className="border-border border-y py-4">
      {title ? (
        <figcaption className="mb-3 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
          {title}
        </figcaption>
      ) : null}
      {children}
    </figure>
  )
}

export const PiChartView: FC<{ node: ChartNode }> = ({ node }) => {
  const max = Math.max(...node.data.map((d) => Math.abs(d.value)), 1)
  const w = 480
  const h = 220
  const pad = { t: 16, r: 16, b: 40, l: 40 }
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b

  if (node.chartType === 'pie') {
    const total = node.data.reduce((s, d) => s + Math.abs(d.value), 0) || 1
    let angle = -Math.PI / 2
    const cx = 120
    const cy = 110
    const r = 80
    const slices = node.data.map((d, i) => {
      const sweep = (Math.abs(d.value) / total) * Math.PI * 2
      const x1 = cx + r * Math.cos(angle)
      const y1 = cy + r * Math.sin(angle)
      angle += sweep
      const x2 = cx + r * Math.cos(angle)
      const y2 = cy + r * Math.sin(angle)
      const large = sweep > Math.PI ? 1 : 0
      return {
        d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
        color: COLORS[i % COLORS.length],
        label: d.label,
        value: d.value,
      }
    })
    return (
      <VizFrame title={node.title}>
        <div className="flex flex-wrap items-center gap-4">
          <svg viewBox="0 0 240 220" className="h-48 w-48 shrink-0" role="img">
            <title>{node.title ?? 'Pie chart'}</title>
            {slices.map((s) => (
              <path key={s.label} d={s.d} fill={s.color} opacity={0.9} />
            ))}
          </svg>
          <ul className="space-y-1 text-muted-foreground text-xs">
            {slices.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: s.color }}
                />
                {s.label}
                {node.unit ? ` · ${s.value}${node.unit}` : ` · ${s.value}`}
              </li>
            ))}
          </ul>
        </div>
      </VizFrame>
    )
  }

  if (node.chartType === 'horizontal-bar') {
    const rowH = Math.min(28, innerH / node.data.length)
    return (
      <VizFrame title={node.title}>
        <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full" role="img">
          <title>{node.title ?? 'Bar chart'}</title>
          {node.data.map((d, i) => {
            const barW = (Math.abs(d.value) / max) * (innerW - 80)
            const y = pad.t + i * rowH
            return (
              <g key={d.label}>
                <text
                  x={pad.l - 6}
                  y={y + rowH * 0.65}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  fontSize={10}
                >
                  {d.label.slice(0, 12)}
                </text>
                <rect
                  x={pad.l}
                  y={y + 4}
                  width={Math.max(barW, 1)}
                  height={rowH - 8}
                  fill={COLORS[i % COLORS.length]}
                  rx={2}
                  opacity={0.9}
                />
                <text
                  x={pad.l + Math.max(barW, 1) + 4}
                  y={y + rowH * 0.65}
                  className="fill-foreground"
                  fontSize={10}
                >
                  {d.value}
                  {node.unit ?? ''}
                </text>
              </g>
            )
          })}
        </svg>
      </VizFrame>
    )
  }

  // bar + line share axes
  const n = node.data.length
  const gap = innerW / Math.max(n, 1)
  const points = node.data.map((d, i) => {
    const x = pad.l + gap * i + gap / 2
    const y = pad.t + innerH - (Math.abs(d.value) / max) * innerH
    return { x, y, ...d }
  })

  return (
    <VizFrame title={node.title}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-56 w-full" role="img">
        <title>{node.title ?? 'Chart'}</title>
        <line
          x1={pad.l}
          y1={pad.t + innerH}
          x2={pad.l + innerW}
          y2={pad.t + innerH}
          stroke="currentColor"
          className="text-border"
          strokeWidth={1}
        />
        {node.chartType === 'line' ? (
          <>
            <polyline
              fill="none"
              stroke={COLORS[0]}
              strokeWidth={2}
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
            />
            {points.map((p) => (
              <circle key={p.label} cx={p.x} cy={p.y} r={3} fill={COLORS[0]} />
            ))}
          </>
        ) : (
          points.map((p, i) => {
            const barW = gap * 0.55
            const barH = pad.t + innerH - p.y
            return (
              <rect
                key={p.label}
                x={p.x - barW / 2}
                y={p.y}
                width={barW}
                height={Math.max(barH, 1)}
                fill={COLORS[i % COLORS.length]}
                rx={2}
                opacity={0.9}
              />
            )
          })
        )}
        {points.map((p) => (
          <text
            key={`lbl-${p.label}`}
            x={p.x}
            y={h - 12}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={9}
          >
            {p.label.slice(0, 10)}
          </text>
        ))}
      </svg>
    </VizFrame>
  )
}
