/**
 * @public
 */
export interface GlowMessage {
  conversationId?: string
  sessionId?: string
  isActive: boolean
  mode?: 'agent' | 'capture'
  captureClass?: 'meeting' | 'browsing' | 'research'
  showConfetti?: boolean
}
