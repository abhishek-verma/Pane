import { defineExtensionMessaging } from '@webext-core/messaging'

export const RuntimeMessageType = {
  getTabId: 'runtime.getTabId',
  authSuccess: 'runtime.authSuccess',
  stopAgent: 'runtime.stopAgent',
  stopCapture: 'runtime.stopCapture',
  sidePanelScopeChanged: 'runtime.sidePanelScopeChanged',
  captureSessionStopped: 'runtime.captureSessionStopped',
  getCaptureServerUrl: 'runtime.getCaptureServerUrl',
  /** Background → offscreen: start MediaRecorder for a meeting session. */
  captureAudioStart: 'runtime.captureAudioStart',
  /** Background → offscreen: stop MediaRecorder for a meeting session. */
  captureAudioStop: 'runtime.captureAudioStop',
  /** Background → offscreen: list active recorder session ids. */
  captureAudioStatus: 'runtime.captureAudioStatus',
} as const

export interface RuntimeTabIdResponse {
  tabId?: number
}

export interface RuntimeStopAgentData {
  conversationId: string
}

export interface RuntimeStopCaptureData {
  sessionId: string
}

export interface RuntimeCaptureSessionStoppedData {
  sessionId: string
}

export interface RuntimeSidePanelScopeChangedData {
  perWindow: boolean
}

export interface RuntimeCaptureServerUrlResponse {
  serverUrl?: string
  error?: string
}

export interface RuntimeCaptureAudioStartData {
  sessionId: string
  tabId: number
  streamId: string
  serverUrl: string
  includeMic?: boolean
}

export interface RuntimeCaptureAudioStartResponse {
  ok: boolean
  includeMic?: boolean
  chunksUploaded?: number
  error?: string
}

export interface RuntimeCaptureAudioStopData {
  sessionId: string
}

export interface RuntimeCaptureAudioStopResponse {
  ok: boolean
  error?: string
}

export interface RuntimeCaptureAudioStatusResponse {
  sessionIds: string[]
  sessions: Array<{
    sessionId: string
    chunksUploaded: number
    uploadErrors: number
  }>
}

type RuntimeMessagesProtocol = {
  [RuntimeMessageType.getTabId](): RuntimeTabIdResponse
  [RuntimeMessageType.authSuccess](): void
  [RuntimeMessageType.stopAgent](data: RuntimeStopAgentData): void
  [RuntimeMessageType.stopCapture](data: RuntimeStopCaptureData): void
  [RuntimeMessageType.captureSessionStopped](
    data: RuntimeCaptureSessionStoppedData,
  ): void
  [RuntimeMessageType.sidePanelScopeChanged](
    data: RuntimeSidePanelScopeChangedData,
  ): void
  [RuntimeMessageType.getCaptureServerUrl](): RuntimeCaptureServerUrlResponse
  [RuntimeMessageType.captureAudioStart](
    data: RuntimeCaptureAudioStartData,
  ): RuntimeCaptureAudioStartResponse
  [RuntimeMessageType.captureAudioStop](
    data: RuntimeCaptureAudioStopData,
  ): RuntimeCaptureAudioStopResponse
  [RuntimeMessageType.captureAudioStatus](): RuntimeCaptureAudioStatusResponse
}

const { sendMessage, onMessage } =
  defineExtensionMessaging<RuntimeMessagesProtocol>()

export { onMessage as onRuntimeMessage, sendMessage as sendRuntimeMessage }
