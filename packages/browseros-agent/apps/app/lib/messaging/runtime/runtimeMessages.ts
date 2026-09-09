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
  /** Background → offscreen: mic RMS speaking hint for speaker labels. */
  captureMicSpeaking: 'runtime.captureMicSpeaking',
  /** Background → offscreen: pause/resume mic recorder based on meeting mute state. */
  captureMicMute: 'runtime.captureMicMute',
} as const

export interface RuntimeTabIdResponse {
  tabId?: number
}

export interface RuntimeStopAgentData {
  conversationId: string
}

interface RuntimeStopCaptureData {
  sessionId: string
}

interface RuntimeCaptureSessionStoppedData {
  sessionId: string
}

export interface RuntimeSidePanelScopeChangedData {
  perWindow: boolean
}

interface RuntimeCaptureServerUrlResponse {
  serverUrl?: string
  error?: string
}

interface RuntimeCaptureAudioStartData {
  sessionId: string
  tabId: number
  streamId: string
  serverUrl: string
  includeMic?: boolean
  profileKey: string
}

interface RuntimeCaptureAudioStartResponse {
  ok: boolean
  includeMic?: boolean
  chunksUploaded?: number
  error?: string
}

interface RuntimeCaptureAudioStopData {
  sessionId: string
}

interface RuntimeCaptureAudioStopResponse {
  ok: boolean
  error?: string
}

interface RuntimeCaptureAudioStatusResponse {
  sessionIds: string[]
  sessions: Array<{
    sessionId: string
    chunksUploaded: number
    uploadErrors: number
  }>
}

interface RuntimeCaptureMicSpeakingData {
  sessionId: string
}

interface RuntimeCaptureMicSpeakingResponse {
  localSpeaking: boolean
}

interface RuntimeCaptureMicMuteData {
  sessionId: string
  muted: boolean
}

interface RuntimeCaptureMicMuteResponse {
  ok: boolean
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
  [RuntimeMessageType.captureMicSpeaking](
    data: RuntimeCaptureMicSpeakingData,
  ): RuntimeCaptureMicSpeakingResponse
  [RuntimeMessageType.captureMicMute](
    data: RuntimeCaptureMicMuteData,
  ): RuntimeCaptureMicMuteResponse
}

const { sendMessage, onMessage } =
  defineExtensionMessaging<RuntimeMessagesProtocol>({ breakError: true })

export { onMessage as onRuntimeMessage, sendMessage as sendRuntimeMessage }
