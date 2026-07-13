import { Monitor, Moon, Sun } from 'lucide-react'
import type { FC } from 'react'
import { useTheme } from '@/components/theme-provider'
import type { Theme } from '@/lib/theme/theme-storage'
import { cn } from '@/lib/utils'

const themes: { value: Theme; icon: typeof Monitor; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
]

export const ThemeSettingsCard: FC = () => {
  const { theme, setTheme } = useTheme()

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md">
      <h3 className="mb-1 font-semibold text-lg">App Theme</h3>
      <p className="mb-4 text-muted-foreground text-xs">
        Customize the visual appearance of Pane. Select between light mode, dark
        mode, or follow your system preferences.
      </p>

      <div className="grid grid-cols-3 gap-3">
        {themes.map(({ value, icon: Icon, label }) => {
          const isActive = theme === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={cn(
                'flex flex-col items-center justify-center gap-2.5 rounded-lg border p-4 font-medium text-sm transition-all hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                isActive
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-5 shrink-0" />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
