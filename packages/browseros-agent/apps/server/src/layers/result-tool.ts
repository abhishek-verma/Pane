import {
  type LayerActionBinding,
  type PageTaskResult,
  pageTaskResultSchema,
  type TranslationResult,
  translationResultSchema,
} from '@browseros/shared/layers/action-protocol'
import { type ToolSet, tool } from 'ai'
import type {
  PageTaskResultSink,
  TranslationResultSink,
} from './result-acceptance'

/** Install only into a constrained invocation. This tool is intentionally
 * absent from buildPaneToolSet and public MCP. The model supplies data only;
 * target identity and current authority remain in trusted closures. */
export function createTranslationResultTool(options: {
  sink: TranslationResultSink
  currentBinding: () => LayerActionBinding
  accepted: (data: TranslationResult) => void
}): ToolSet {
  let invalidAttempts = 0
  let published = false
  return {
    submit_layer_result: tool({
      description:
        'Return the requested translation data using the exact source block IDs and target language. This is the only result channel. Do not return HTML, selectors, target IDs or chat prose.',
      inputSchema: translationResultSchema,
      execute: async (data) => {
        if (invalidAttempts >= 2)
          return {
            accepted: false,
            code: 'INVALID_RESULT',
            repairRemaining: false,
          }
        const result = options.sink.submit(data, options.currentBinding())
        if (!result.accepted) {
          if (result.code === 'INVALID_RESULT') invalidAttempts += 1
          return {
            accepted: false,
            code: result.code,
            message: result.message,
            repairRemaining:
              result.code === 'INVALID_RESULT' && invalidAttempts < 2,
          }
        }
        if (!published) {
          published = true
          options.accepted(structuredClone(result.data))
        }
        return { accepted: true, duplicate: result.duplicate }
      },
    }),
  }
}

export function createPageTaskResultTool(options: {
  sink: PageTaskResultSink
  currentBinding: () => LayerActionBinding
  accepted: (data: PageTaskResult) => void
}): ToolSet {
  let invalidAttempts = 0
  let published = false
  return {
    submit_layer_result: tool({
      description:
        'Propose scoped collapse or highlight operations for the supplied node IDs. The browser applies and verifies them. Do not claim they have already run. No selectors, HTML, JavaScript, URLs or extra fields.',
      inputSchema: pageTaskResultSchema,
      execute: async (data) => {
        if (invalidAttempts >= 2)
          return {
            accepted: false,
            code: 'INVALID_RESULT',
            repairRemaining: false,
          }
        const result = options.sink.submit(data, options.currentBinding())
        if (!result.accepted) {
          if (result.code === 'INVALID_RESULT') invalidAttempts += 1
          return {
            accepted: false,
            code: result.code,
            message: result.message,
            repairRemaining:
              result.code === 'INVALID_RESULT' && invalidAttempts < 2,
          }
        }
        if (!published) {
          published = true
          options.accepted(structuredClone(result.data))
        }
        return { accepted: true, duplicate: result.duplicate }
      },
    }),
  }
}
