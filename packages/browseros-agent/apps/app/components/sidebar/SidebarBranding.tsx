import { ChevronDown, LogIn, LogOut, User } from 'lucide-react'
import type { FC } from 'react'
import { useNavigate } from 'react-router'
import { PaneMark } from '@/components/branding/PaneMark'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSessionInfo } from '@/lib/auth/sessionStorage'
import { PRODUCT_NAME } from '@/lib/constants/product'
import { cloudAccountEnabled } from '@/lib/constants/product-features'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/modules/workspace/workspace.hooks'

export interface SidebarBrandingProps {
  expanded?: boolean
}

export const SidebarBranding: FC<SidebarBrandingProps> = ({
  expanded = true,
}) => {
  const { selectedFolder } = useWorkspace()
  const { sessionInfo } = useSessionInfo()
  const navigate = useNavigate()

  const user = sessionInfo?.user
  const isLoggedIn = !!user

  const displayName = user?.name || 'User'
  const displayImage = user?.image

  const getInitials = (name?: string | null) => {
    if (!name) return '?'
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const headerIcon = isLoggedIn ? (
    displayImage ? (
      <img
        src={displayImage}
        alt={displayName}
        className="size-8 shrink-0 rounded-full object-cover"
      />
    ) : (
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-xs">
        {getInitials(displayName)}
      </div>
    )
  ) : (
    <PaneMark
      size={32}
      className="text-foreground"
      aria-label={PRODUCT_NAME}
      role="img"
    />
  )

  const hasDropdownItems = isLoggedIn || cloudAccountEnabled

  const brandContent = (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg p-1.5 text-left transition-colors',
        hasDropdownItems ? 'cursor-pointer hover:bg-sidebar-accent' : '',
        expanded ? 'pr-3' : '',
      )}
    >
      {headerIcon}
      <div
        className={cn(
          'flex min-w-0 flex-col gap-0.5 leading-none transition-opacity duration-200',
          expanded ? 'opacity-100' : 'hidden',
        )}
      >
        <div className="flex items-center gap-1">
          <span className="truncate font-semibold">
            {isLoggedIn ? displayName : selectedFolder?.name || PRODUCT_NAME}
          </span>
          {hasDropdownItems && (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </div>
        <span
          className={cn(
            'truncate text-xs',
            isLoggedIn
              ? 'text-muted-foreground'
              : cloudAccountEnabled
                ? 'font-medium text-primary'
                : 'text-muted-foreground',
          )}
        >
          {isLoggedIn
            ? 'Personal'
            : cloudAccountEnabled
              ? 'Sign in'
              : PRODUCT_NAME}
        </span>
      </div>
    </div>
  )

  if (hasDropdownItems) {
    return (
      <div className="flex h-14 items-center justify-between border-b px-2">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="focus-visible:outline-none">
              {brandContent}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={expanded ? 'bottom' : 'right'}
            align="start"
            className="w-56"
          >
            {isLoggedIn ? (
              <>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="font-medium text-sm leading-none">
                      {displayName}
                    </p>
                    <p className="text-muted-foreground text-xs leading-none">
                      Personal
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <User className="mr-2 size-4" />
                  Update Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => navigate('/logout')}
                  variant="destructive"
                >
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </DropdownMenuItem>
              </>
            ) : cloudAccountEnabled ? (
              <DropdownMenuItem onClick={() => navigate('/login')}>
                <LogIn className="mr-2 size-4" />
                Sign in
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <div className="flex h-14 items-center justify-between border-b px-2">
      {brandContent}
    </div>
  )
}
