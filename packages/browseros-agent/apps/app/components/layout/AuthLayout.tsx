import type { FC } from 'react'
import { Outlet } from 'react-router'
import { PaneWordmark } from '@/components/branding/PaneWordmark'

export const AuthLayout: FC = () => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="mb-8 flex flex-col items-center">
        <PaneWordmark size="lg" />
      </div>
      <Outlet />
    </div>
  )
}
