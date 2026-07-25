/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ONBOARDING_STEP_COMPLETED_EVENT } from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import {
  ONBOARDING_ICP_OPTIONS,
  type OnboardingIcp,
} from '@/lib/onboarding/icp'
import { onboardingIcpStorage } from '@/lib/onboarding/onboardingStorage'
import { useMemoryFiles, usePersonas } from '@/screens/memory/useMemoryApi'
import { type StepDirection, StepTransition } from './StepTransition'

export interface StepSoulProps {
  direction: StepDirection
  onContinue: () => void
}

function icpForPersona(personaId: string): OnboardingIcp {
  return (
    ONBOARDING_ICP_OPTIONS.find((option) => option.personaId === personaId)
      ?.id ?? 'coding'
  )
}

/** Soul setup matching Settings → Memory: template buttons + always-visible editor. */
export const StepSoul = ({ direction, onContinue }: StepSoulProps) => {
  const [soulDraft, setSoulDraft] = useState('')
  const [activePersonaId, setActivePersonaId] = useState('default')
  const [saving, setSaving] = useState(false)
  const didSeedDefault = useRef(false)
  /** When true, accept the next server soul payload into the textarea. */
  const acceptServerSoul = useRef(true)
  const personas = usePersonas()
  const memory = useMemoryFiles()

  useEffect(() => {
    if (!acceptServerSoul.current) return
    if (memory.data?.files.soul == null) return
    setSoulDraft(memory.data.files.soul)
    acceptServerSoul.current = false
  }, [memory.data?.files.soul])

  useEffect(() => {
    if (didSeedDefault.current) return
    if (personas.isLoading || memory.isLoading) return
    if (!personas.data) return

    const map = personas.data.map
    const alreadySet =
      Boolean(map.pinned) || Object.keys(map.bucketPersonas ?? {}).length > 0

    didSeedDefault.current = true
    if (alreadySet) {
      const pinned = map.pinned
      const bucketDefault = map.bucketPersonas?.default
      setActivePersonaId(pinned ?? bucketDefault ?? 'default')
      acceptServerSoul.current = true
      return
    }

    acceptServerSoul.current = true
    void personas.apply.mutateAsync('default').then(() => {
      setActivePersonaId('default')
    })
  }, [personas, memory.isLoading])

  const handleApplyPersona = async (personaId: string) => {
    setActivePersonaId(personaId)
    acceptServerSoul.current = true
    try {
      await personas.apply.mutateAsync(personaId)
    } catch {
      // Server may be down — user can still edit/save draft on continue.
    }
  }

  const handleContinue = async () => {
    setSaving(true)
    try {
      await onboardingIcpStorage.setValue(icpForPersona(activePersonaId))

      if (soulDraft.trim()) {
        try {
          await memory.save.mutateAsync({
            which: 'soul',
            content: soulDraft,
          })
        } catch {
          // best-effort
        }
      }

      track(ONBOARDING_STEP_COMPLETED_EVENT, {
        step: 3,
        step_name: 'soul',
        persona: activePersonaId,
      })
      onContinue()
    } finally {
      setSaving(false)
    }
  }

  const personaButtons = personas.data?.personas ?? [
    { id: 'default', label: 'Default' },
    { id: 'chief-of-staff', label: 'Chief of staff' },
    { id: 'research-buddy', label: 'Research buddy' },
    { id: 'job-search-partner', label: 'Job-search partner' },
  ]

  return (
    <StepTransition direction={direction}>
      <div className="mx-auto w-full max-w-lg space-y-5 px-6 py-6">
        <div className="space-y-2 text-center">
          <h2 className="font-bold text-2xl tracking-tight">
            How should Pane sound?
          </h2>
          <p className="text-muted-foreground text-sm">
            Pick a template or edit SOUL.md. You can change this anytime in
            Settings → Memory & Skills.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {personaButtons.map((persona) => (
            <Button
              key={persona.id}
              size="sm"
              variant={activePersonaId === persona.id ? 'default' : 'outline'}
              disabled={personas.apply.isPending}
              onClick={() => void handleApplyPersona(persona.id)}
            >
              {persona.label}
            </Button>
          ))}
        </div>

        <Textarea
          className="min-h-40 font-mono text-xs"
          value={soulDraft}
          onChange={(e) => {
            acceptServerSoul.current = false
            setSoulDraft(e.target.value)
          }}
          placeholder="Loading soul…"
        />

        <Button
          className="w-full bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange)]/90"
          disabled={saving}
          onClick={() => void handleContinue()}
        >
          {saving ? 'Saving…' : 'Continue'}
        </Button>
      </div>
    </StepTransition>
  )
}
