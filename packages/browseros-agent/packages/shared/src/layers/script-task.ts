import { z } from 'zod'
import { layerScriptAssertionsSchema } from './manifest'
export const scriptTaskExecutionSchema = z
  .object({
    executionId: z.string().uuid(),
    source: z.string().min(1).max(128000),
    assertions: layerScriptAssertionsSchema,
  })
  .strict()
export type ScriptTaskExecution = z.infer<typeof scriptTaskExecutionSchema>
