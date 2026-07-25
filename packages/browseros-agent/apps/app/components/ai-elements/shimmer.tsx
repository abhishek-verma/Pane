'use client'

import { motion } from 'motion/react'
import {
  type CSSProperties,
  type ElementType,
  type JSX,
  memo,
  useMemo,
} from 'react'
import { cn } from '@/lib/utils'

export type TextShimmerProps = {
  children: string
  as?: ElementType
  className?: string
  duration?: number
  spread?: number
}

// Cache motion wrappers — `motion.create` inside render remounts every frame
// and can contribute to React max-update-depth (#185) on the streaming path.
const motionComponentCache = new Map<string, ReturnType<typeof motion.create>>()

function getMotionComponent(as: keyof JSX.IntrinsicElements) {
  const key = String(as)
  const cached = motionComponentCache.get(key)
  if (cached) return cached
  const created = motion.create(as)
  motionComponentCache.set(key, created)
  return created
}

const ShimmerComponent = ({
  children,
  as: Component = 'p',
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const MotionComponent = getMotionComponent(
    Component as keyof JSX.IntrinsicElements,
  )

  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread],
  )

  return (
    <MotionComponent
      animate={{ backgroundPosition: '0% center' }}
      className={cn(
        'relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent',
        '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]',
        className,
      )}
      initial={{ backgroundPosition: '100% center' }}
      style={
        {
          '--spread': `${dynamicSpread}px`,
          backgroundImage:
            'var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))',
        } as CSSProperties
      }
      transition={{
        repeat: Number.POSITIVE_INFINITY,
        duration,
        ease: 'linear',
      }}
    >
      {children}
    </MotionComponent>
  )
}

/**
 * @public
 */
export const Shimmer = memo(ShimmerComponent)
