import { Loader2, Play } from 'lucide-react'
import { type FC, useState } from 'react'
import { executeWidgetAction } from '@/lib/widget-actions'

export interface SkillItem {
  id: string
  name: string
  description?: string
}

export interface ActionGridTemplateProps {
  skills: SkillItem[]
}

export const ActionGridTemplate: FC<ActionGridTemplateProps> = ({ skills }) => {
  const [runningId, setRunningId] = useState<string | null>(null)

  const handleRunSkill = async (skillId: string) => {
    setRunningId(skillId)
    await executeWidgetAction({ type: 'run-skill', skillId })
    // Wait a brief moment to show active execution feedback before navigation
    setTimeout(() => {
      setRunningId(null)
    }, 1000)
  }

  if (skills.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No cadenced skills configured.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {skills.slice(0, 4).map((s) => (
        <button
          key={s.id}
          type="button"
          disabled={runningId !== null}
          onClick={() => handleRunSkill(s.id)}
          className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 p-2.5 text-left font-medium text-foreground text-xs transition-all duration-200 hover:border-[var(--accent-orange)]/25 hover:bg-muted/65"
        >
          {runningId === s.id ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--accent-orange)]" />
          ) : (
            <Play className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{s.name}</span>
        </button>
      ))}
    </div>
  )
}
