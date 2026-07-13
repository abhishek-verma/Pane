import type { FC } from 'react'
import { TrustPinsSettings } from '@/screens/trust/TrustPinsSettings'
import { CustomizationHeader } from './CustomizationHeader'
import { ThemeSettingsCard } from './ThemeSettingsCard'
import { ToolbarSettingsCard } from './ToolbarSettingsCard'

export const CustomizationPage: FC = () => {
  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <CustomizationHeader />
      <ThemeSettingsCard />
      <TrustPinsSettings />
      <ToolbarSettingsCard />
    </div>
  )
}
