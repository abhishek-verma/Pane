import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  ShieldX,
  XCircle,
} from 'lucide-react'
import type { FC } from 'react'
import type { ToolEvidenceState } from '@/lib/tool-evidence/types'

export const ToolStatusIcon: FC<{ state: ToolEvidenceState }> = ({ state }) => {
  if (state === 'completed') {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-signal" />
  }
  if (state === 'denied') {
    return <ShieldX className="h-3.5 w-3.5 shrink-0 text-destructive" />
  }
  if (state === 'running') {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-signal" />
  }
  if (state === 'error') {
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
  }
  return <CircleDashed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
}
