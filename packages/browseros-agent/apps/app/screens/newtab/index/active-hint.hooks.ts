import { useEffect, useState } from 'react'
import { useSessionInfo } from '@/lib/auth/sessionStorage'
import { cloudAccountEnabled } from '@/lib/constants/product-features'
import { signInHintDismissedAtStorage } from '@/lib/onboarding/onboardingStorage'

export type HintType = 'signin'

const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000

function isEligible(dismissedAt: number | null): boolean {
  return !dismissedAt || Date.now() - dismissedAt >= DISMISS_DURATION
}

/** Soft post-setup nudge. Import is owned by native first-run, not Home. */
export function useActiveHint(): HintType | null {
  const [hint, setHint] = useState<HintType | null>(null)
  const { sessionInfo, isLoading } = useSessionInfo()

  useEffect(() => {
    if (isLoading) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function resolve() {
      if (!cloudAccountEnabled || sessionInfo?.user) return

      const signinDismissedAt = await signInHintDismissedAtStorage.getValue()
      if (cancelled) return

      if (isEligible(signinDismissedAt)) {
        timer = setTimeout(() => {
          if (!cancelled) setHint('signin')
        }, 2000)
      }
    }

    void resolve()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isLoading, sessionInfo?.user])

  return hint
}
