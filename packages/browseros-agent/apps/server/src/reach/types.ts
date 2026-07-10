/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type ReachTransportId = 'os-push' | 'email' | 'telegram'

export type ReachMessageType =
  | 'digest'
  | 'approval'
  | 'trigger'
  | 'nudge'
  | 'test'

export interface ReachMessage {
  type: ReachMessageType
  title: string
  body: string
  /** Optional deep link back into Pane (hash route). */
  deepLink?: string
  /** Approval tokens when type === 'approval' */
  approveToken?: string
  denyToken?: string
  runId?: string
  path?: string
}

export interface ReachInbound {
  transport: ReachTransportId
  senderId: string
  text: string
  raw?: unknown
}

export interface ReachTransport {
  id: ReachTransportId
  isConfigured(): Promise<boolean>
  send(msg: ReachMessage): Promise<void>
  startInbound?(handler: (cmd: ReachInbound) => Promise<void>): Promise<void>
  stopInbound?(): Promise<void>
}
