import type { FC } from 'react'
import { PaneWordmark } from '@/components/branding/PaneWordmark'
import { Button } from '@/components/ui/button'
import { githubOrgUrl } from '@/lib/constants/productUrls'

export interface OnboardingHeaderProps {
  isMounted: boolean
}

export const OnboardingHeader: FC<OnboardingHeaderProps> = ({ isMounted }) => {
  return (
    <header
      className={`border-border/40 border-b transition-all duration-700 ${isMounted ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <PaneWordmark size="md" className="text-accent-orange" />
        <nav className="hidden items-center gap-1 md:flex">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <a href={githubOrgUrl} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </Button>
        </nav>
      </div>
    </header>
  )
}
