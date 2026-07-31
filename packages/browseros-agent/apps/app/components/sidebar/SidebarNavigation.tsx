import { CheckSquare, Home, Mic } from 'lucide-react'
import type { FC, MouseEvent } from 'react'
import { NavLink, useLocation } from 'react-router'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  isPiDocument,
  isPiRoutePath,
  navigateAppShell,
} from '@/lib/personal-internet/pi-document'
import { cn } from '@/lib/utils'

export interface SidebarNavigationProps {
  expanded?: boolean
}

type NavItem = {
  name: string
  to: string
  icon: typeof Home
}

const primaryNavItems: NavItem[] = [
  { name: 'Home', to: '/home', icon: Home },
  { name: 'Tasks', to: '/tasks', icon: CheckSquare },
  { name: 'Meetings', to: '/meetings', icon: Mic },
]

function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/tasks') {
    return pathname.startsWith('/tasks')
  }
  return pathname === item.to
}

export const SidebarNavigation: FC<SidebarNavigationProps> = ({
  expanded = true,
}) => {
  const location = useLocation()

  return (
    <TooltipProvider delayDuration={0}>
      <div className="overflow-x-hidden p-2">
        <nav className="space-y-1">
          {primaryNavItems.map((item) => {
            const Icon = item.icon
            const isActive = isNavItemActive(item, location.pathname)

            const leavePiDocument = isPiDocument() && !isPiRoutePath(item.to)
            const onNavClick = (event: MouseEvent<HTMLAnchorElement>) => {
              if (!leavePiDocument) return
              event.preventDefault()
              navigateAppShell(item.to)
            }

            const navItem = (
              <NavLink
                to={item.to}
                onClick={onNavClick}
                className={cn(
                  'flex h-9 items-center gap-2 overflow-hidden whitespace-nowrap rounded-md px-3 font-medium text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  isActive &&
                    'bg-sidebar-accent text-sidebar-accent-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span
                  className={cn(
                    'truncate transition-opacity duration-200',
                    expanded ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  {item.name}
                </span>
              </NavLink>
            )

            if (!expanded) {
              return (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>{navItem}</TooltipTrigger>
                  <TooltipContent side="right">{item.name}</TooltipContent>
                </Tooltip>
              )
            }

            return <div key={item.to}>{navItem}</div>
          })}
        </nav>
      </div>
    </TooltipProvider>
  )
}
