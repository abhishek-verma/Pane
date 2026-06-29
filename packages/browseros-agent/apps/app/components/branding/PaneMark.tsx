import type { FC, SVGProps } from 'react'
import { cn } from '@/lib/utils'
import paneMarkSvg from '../../../../../../docs/logo/pane-mark.svg?raw'

export interface PaneMarkProps extends SVGProps<SVGSVGElement> {
  size?: number | string
}

const PANE_MARK_PATH =
  paneMarkSvg.match(/d="([^"]+)"/)?.[1] ??
  'M0 0h100v100H0V0zm66 66h24v24H66V66z'

/** Renders docs/logo/pane-mark.svg (single source of truth). */
export const PaneMark: FC<PaneMarkProps> = ({
  size = 20,
  className,
  'aria-label': ariaLabel = 'Pane',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 100 100"
    width={size}
    height={size}
    role="img"
    aria-label={ariaLabel}
    className={cn('shrink-0', className)}
    {...props}
  >
    <path
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      d={PANE_MARK_PATH}
    />
  </svg>
)
