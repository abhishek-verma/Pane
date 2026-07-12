/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Onboarding step: pick starter home widgets.
 * Shows after StepIcp (step 2) so selection can be ICP-aware.
 */

import { BookOpen, CheckCircle, FileText, RefreshCw } from 'lucide-react'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { ONBOARDING_STEP_COMPLETED_EVENT } from '@/lib/constants/analyticsEvents'
import { BUILTIN_TEMPLATES } from '@/lib/home/builtin-templates'
import { track } from '@/lib/metrics/track'
import type { OnboardingIcp } from '@/lib/onboarding/icp'
import { onboardingIcpStorage } from '@/lib/onboarding/onboardingStorage'
import { type StepDirection, StepTransition } from './StepTransition'

// ICP → suggested starter widget ids
const ICP_WIDGET_MAP: Record<OnboardingIcp | 'default', string[]> = {
  coding: ['open-tasks', 'next-scheduled-run', 'active-research-thread'],
  research: ['active-research-thread', 'daily-digest', 'open-tasks'],
  'personal-automation': ['daily-digest', 'open-tasks', 'next-scheduled-run'],
  privacy: ['daily-digest', 'open-tasks', 'active-research-thread'],
  'job-search': ['daily-digest', 'open-tasks', 'active-research-thread'],
  default: ['daily-digest', 'open-tasks', 'active-research-thread'],
}

const ICONS: Record<string, FC<{ className?: string }>> = {
  'daily-digest': FileText,
  'open-tasks': CheckCircle,
  'active-research-thread': BookOpen,
  'next-scheduled-run': RefreshCw,
  'pending-approvals': CheckCircle,
}

export interface StepWidgetsProps {
  direction: StepDirection
  onContinue: () => void
}

export const StepWidgets = ({ direction, onContinue }: StepWidgetsProps) => {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const icp = onboardingIcpStorage.fallbackValue as OnboardingIcp | null
  const preferredIds =
    ICP_WIDGET_MAP[icp ?? 'default'] ?? ICP_WIDGET_MAP['default']

  const starters = BUILTIN_TEMPLATES.filter((t) =>
    preferredIds.includes(t.id),
  ).slice(0, 4)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleContinue = async () => {
    setSaving(true)
    try {
      if (selected.size > 0) {
        const base = await getAgentServerUrl()
        for (const id of selected) {
          const tmpl = BUILTIN_TEMPLATES.find((t) => t.id === id)
          if (!tmpl) continue
          await fetch(`${base}/scheduler/home/widgets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: tmpl.title,
              source: tmpl.source,
              action: tmpl.action,
              refreshMinutes: tmpl.refreshMinutes,
              createdBy: 'user',
              whyText: tmpl.whyText,
              status: 'active',
            }),
          })
        }
      }
      track(ONBOARDING_STEP_COMPLETED_EVENT, {
        step: 'widgets',
        count: selected.size,
      })
    } finally {
      setSaving(false)
      onContinue()
    }
  }

  return (
    <StepTransition direction={direction}>
      <div className="mx-auto w-full max-w-lg space-y-6 px-6 py-10">
        <div className="space-y-2 text-center">
          <h2 className="font-bold text-2xl tracking-tight">
            Pick starter widgets
          </h2>
          <p className="text-muted-foreground text-sm">
            These will appear on your home tab. Add or remove widgets anytime.
          </p>
        </div>

        <div className="space-y-2">
          {starters.map((t) => {
            const Icon = ICONS[t.id] ?? FileText
            const active = selected.has(t.id)
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                  active
                    ? 'border-[var(--accent-orange)] bg-[var(--accent-orange)]/5'
                    : 'border-border bg-card hover:border-[var(--accent-orange)]/40'
                }`}
              >
                <Icon
                  className={`h-5 w-5 shrink-0 ${active ? 'text-[var(--accent-orange)]' : 'text-muted-foreground'}`}
                />
                <div>
                  <p className="font-medium text-sm">{t.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {t.description}
                  </p>
                </div>
                <div
                  className={`ml-auto h-4 w-4 shrink-0 rounded-full border-2 transition-colors ${
                    active
                      ? 'border-[var(--accent-orange)] bg-[var(--accent-orange)]'
                      : 'border-border'
                  }`}
                />
              </button>
            )
          })}
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onContinue()}
            disabled={saving}
          >
            Skip
          </Button>
          <Button
            className="flex-1"
            onClick={() => void handleContinue()}
            disabled={saving}
          >
            {saving
              ? 'Adding…'
              : selected.size > 0
                ? `Add ${selected.size} widget${selected.size === 1 ? '' : 's'}`
                : 'Continue'}
          </Button>
        </div>
      </div>
    </StepTransition>
  )
}
