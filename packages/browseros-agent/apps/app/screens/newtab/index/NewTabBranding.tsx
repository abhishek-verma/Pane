import { motion } from 'motion/react'
import type { FC } from 'react'
import { PaneWordmark } from '@/components/branding/PaneWordmark'

export const NewTabBranding: FC = () => {
  return (
    <div className="space-y-4 text-center">
      <div className="mb-2 flex items-center justify-center gap-3">
        <motion.div
          layoutId="new-tab-branding"
          transition={{
            type: 'keyframes',
            damping: 20,
            stiffness: 300,
          }}
          className="flex items-center justify-center rounded-xl bg-transparent"
        >
          <PaneWordmark size="xl" />
        </motion.div>
      </div>
    </div>
  )
}
