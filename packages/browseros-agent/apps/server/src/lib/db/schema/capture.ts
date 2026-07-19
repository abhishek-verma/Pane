/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { buckets } from './buckets'
import { graphNodes } from './graph-nodes'

export const captureConsents = sqliteTable(
  'capture_consents',
  {
    domain: text('domain').notNull(),
    class: text('class', {
      enum: ['meeting', 'browsing', 'research'],
    }).notNull(),
    bucketId: text('bucket_id')
      .notNull()
      .references(() => buckets.id),
    allowed: integer('allowed').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.domain, table.class] }),
  }),
)

export const captureSessions = sqliteTable('capture_sessions', {
  id: text('id').primaryKey().notNull(),
  bucketId: text('bucket_id')
    .notNull()
    .references(() => buckets.id),
  kind: text('kind', {
    enum: ['meeting', 'browsing', 'research'],
  }).notNull(),
  tabId: integer('tab_id'),
  url: text('url'),
  title: text('title'),
  status: text('status', {
    enum: ['active', 'interrupted', 'paused', 'stopped', 'error'],
  }).notNull(),
  provider: text('provider').notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  transcriptPath: text('transcript_path'),
  summaryPath: text('summary_path'),
  graphNodeId: text('graph_node_id').references(() => graphNodes.id),
  site: text('site'),
  roomKey: text('room_key'),
  lastChunkAt: integer('last_chunk_at'),
  asrWatermarkPcm: integer('asr_watermark_pcm').default(0),
  lastAsrSequence: integer('last_asr_sequence').default(-1),
  includeMic: integer('include_mic').default(0),
})

export const researchThreads = sqliteTable('research_threads', {
  id: text('id').primaryKey().notNull(),
  bucketId: text('bucket_id')
    .notNull()
    .references(() => buckets.id),
  topic: text('topic'),
  status: text('status', {
    enum: ['active', 'paused', 'closed'],
  }).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const researchThreadPages = sqliteTable(
  'research_thread_pages',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => researchThreads.id),
    nodeId: text('node_id')
      .notNull()
      .references(() => graphNodes.id),
    orderIndex: integer('order_index').notNull(),
    quote: text('quote'),
    url: text('url').notNull(),
    capturedAt: integer('captured_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.nodeId] }),
  }),
)

export type CaptureConsentRow = InferSelectModel<typeof captureConsents>
export type NewCaptureConsentRow = InferInsertModel<typeof captureConsents>
export type CaptureSessionRow = InferSelectModel<typeof captureSessions>
export type NewCaptureSessionRow = InferInsertModel<typeof captureSessions>
export type ResearchThreadRow = InferSelectModel<typeof researchThreads>
export type NewResearchThreadRow = InferInsertModel<typeof researchThreads>
export type ResearchThreadPageRow = InferSelectModel<typeof researchThreadPages>
export type NewResearchThreadPageRow = InferInsertModel<
  typeof researchThreadPages
>
