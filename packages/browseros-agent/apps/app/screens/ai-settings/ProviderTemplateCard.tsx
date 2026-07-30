import type { FC } from 'react'
import { Badge } from '@/components/ui/badge'
import { ProviderIcon } from '@/lib/llm-providers/providerIcons'
import type { ProviderTemplate } from '@/lib/llm-providers/providerTemplates'
import { cn } from '@/lib/utils'

export interface ProviderTemplateCardProps {
  template: ProviderTemplate
  highlighted?: boolean
  onUseTemplate: (template: ProviderTemplate) => void
}

export const ProviderTemplateCard: FC<ProviderTemplateCardProps> = ({
  template,
  highlighted = false,
  onUseTemplate,
}) => {
  return (
    <button
      type="button"
      onClick={() => onUseTemplate(template)}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-md border bg-background p-4 text-left transition-colors hover:border-[var(--accent-orange)]',
        highlighted
          ? 'border-[var(--signal)]/50 bg-[var(--signal)]/8 ring-1 ring-[var(--signal)]/35'
          : 'border-border',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ProviderIcon
          type={template.id}
          size={28}
          className="shrink-0 text-accent-orange/70 transition-colors group-hover:text-accent-orange"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{template.name}</span>
            {highlighted && (
              <span className="rounded-full border border-[var(--signal)]/45 bg-[var(--signal)]/15 px-2 py-0.5 font-semibold text-[10px] text-[var(--signal-foreground)] dark:text-[var(--signal)]">
                Recommended
              </span>
            )}
          </div>
        </div>
      </div>
      <Badge
        variant="outline"
        className={cn(
          'shrink-0 rounded-md px-3 py-1 transition-colors group-hover:border-[var(--accent-orange)] group-hover:text-[var(--accent-orange)]',
          highlighted &&
            'border-[var(--accent-orange)] bg-[var(--accent-orange)]/5 text-[var(--accent-orange)]',
        )}
      >
        USE
      </Badge>
    </button>
  )
}
