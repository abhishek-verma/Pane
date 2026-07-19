export type ToolVisibilityKind =
  | 'file-change'
  | 'browser-action'
  | 'screenshot'
  | 'terminal'
  | 'app-send'
  | 'generic'

export type ToolEvidenceState =
  | 'running'
  | 'completed'
  | 'error'
  | 'denied'
  | 'approval'

export interface ToolMedia {
  mimeType: string
  /** raw base64 (no data: prefix) or full data URL */
  data: string
}

export interface FileChangeDetail {
  path: string
  kind: 'edit' | 'create' | 'overwrite' | 'binary' | 'empty'
  additions?: number
  deletions?: number
  bytesWritten?: number
  /** unified-ish lines for peek + modal */
  diffLines: string[]
  omitFullContent?: boolean
  omitReason?: string
}

export interface BrowserActionDetail {
  caption: string
  hostname?: string
  url?: string
  pageDiffSummary?: string
  media: ToolMedia[]
}

export interface TerminalDetail {
  command: string
  exitCode?: number
  stdout?: string
  stderr?: string
  truncated?: boolean
}

export interface AppSendDetail {
  title: string
  destination?: string
  summary?: string
}

export interface GenericToolDetail {
  title: string
  subtitle?: string
  inputJson?: string
  outputText?: string
  detailsUnavailable?: boolean
}

export interface ToolEvidence {
  toolCallId: string
  toolName: string
  kind: ToolVisibilityKind
  state: ToolEvidenceState
  /** High-signal cards pin outside the generics chevron */
  specialized: boolean
  title: string
  errorText?: string
  file?: FileChangeDetail
  browser?: BrowserActionDetail
  terminal?: TerminalDetail
  appSend?: AppSendDetail
  generic?: GenericToolDetail
}

export const DIFF_PEEK_LINES = 10
export const DIFF_MODAL_SOFT_CAP_LINES = 5000
export const CREATE_PREVIEW_MAX_BYTES = 200_000
export const GENERIC_JSON_MAX_CHARS = 20_000
export const TERMINAL_OUTPUT_CLAMP_CHARS = 4_000
export const APP_SEND_SUMMARY_MAX_CHARS = 500
