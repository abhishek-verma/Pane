import type { ToolSet } from 'ai'
import { buildAgendaToolSet } from '../agenda/tools'
import { buildCaptureToolSet } from '../capture/tools'
import { buildContextToolSet, buildTasksToolSet } from '../context/tools'
import { buildMemoryToolSet } from '../memory/tools'
import { buildPersonalInternetToolSet } from '../personal-internet/tools'
import { filterToolsForChatMode } from './chat-mode'
import { buildNudgeToolSet } from './nudge-tools'
import { buildSchedulerToolSet } from './scheduler-tools'

export interface PaneToolContext {
  bucketId?: string
  workingDir?: string | null
  runId?: string
  chatMode?: boolean
  isScheduledTask?: boolean
}

/** The provider-independent Pane capabilities. Register new core tools here,
 * never in an individual provider or transport adapter. */
export function buildPaneToolSet(context: PaneToolContext = {}): ToolSet {
  const getBucketId = () => context.bucketId ?? 'default'
  const tools: ToolSet = {
    ...buildContextToolSet(getBucketId, () => context.workingDir ?? null),
    ...buildTasksToolSet(getBucketId),
    ...buildMemoryToolSet(getBucketId, () => context.runId),
    ...buildCaptureToolSet(getBucketId, { includeStartTool: false }),
    ...buildPersonalInternetToolSet(getBucketId),
    ...buildSchedulerToolSet(),
    ...buildAgendaToolSet(),
    ...buildNudgeToolSet(),
  }
  if (context.isScheduledTask) delete tools.suggest_schedule
  return context.chatMode ? filterToolsForChatMode(tools) : tools
}
