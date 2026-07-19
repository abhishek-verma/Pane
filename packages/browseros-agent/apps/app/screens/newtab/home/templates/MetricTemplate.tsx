import { useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { type FC, useState } from 'react'
import { executeWidgetAction } from '@/lib/widget-actions'

export interface TaskItem {
  id?: string
  label: string
  meta?: string
}

export interface MetricTemplateProps {
  label: string
  count: number
  items: TaskItem[]
}

export const MetricTemplate: FC<MetricTemplateProps> = ({
  label,
  count,
  items,
}) => {
  const queryClient = useQueryClient()
  const [completingId, setCompletingId] = useState<string | null>(null)

  const handleComplete = async (taskId: string) => {
    setCompletingId(taskId)
    await executeWidgetAction({ type: 'complete-task', taskId }, queryClient)
    setCompletingId(null)
  }

  // Parse metric title: e.g. "5 tasks" -> "5" and "tasks"
  const metricMatch = label.match(/^(\d+)\s+(.*)$/)
  const heroNum = metricMatch ? metricMatch[1] : String(count)
  const heroText = metricMatch ? metricMatch[2] : label || 'Items'

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="font-extrabold text-3xl text-foreground tracking-tight">
          {heroNum}
        </span>
        <span className="font-bold text-muted-foreground text-xs uppercase tracking-wider">
          {heroText}
        </span>
      </div>
      {items.length > 0 && (
        <div className="space-y-1.5 border-border/40 border-t pt-2">
          {items.slice(0, 3).map((item, i) => (
            <div
              key={item.id ?? String(i)}
              className="group flex items-center justify-between gap-3 rounded p-1 text-xs transition-all hover:bg-muted/40"
            >
              <span className="truncate font-medium text-muted-foreground group-hover:text-foreground">
                {item.label}
              </span>
              {item.id ? (
                <button
                  type="button"
                  disabled={completingId === item.id}
                  onClick={() => handleComplete(item.id as string)}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/30 text-transparent transition-all hover:border-green-500 hover:bg-green-500/10 hover:text-green-500"
                >
                  <Check className="h-2.5 w-2.5" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
