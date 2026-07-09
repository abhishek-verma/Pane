/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type BucketKind =
  | 'general'
  | 'work'
  | 'personal'
  | 'project'
  | 'research'
  | 'meeting'

export type GraphNodeKind =
  | 'tab'
  | 'page'
  | 'workspace'
  | 'file'
  | 'terminal_session'
  | 'agent_run'
  | 'task'

export type GraphEdgeKind =
  | 'opened'
  | 'edited'
  | 'ran_in'
  | 'produced'
  | 'part_of_run'

export interface Bucket {
  id: string
  name: string
  kind: BucketKind
  createdAt: number
}

export interface GraphNode {
  id: string
  bucketId: string
  kind: GraphNodeKind
  title: string | null
  uri: string | null
  summary: string | null
  provenance: string
  createdAt: number
  updatedAt: number
}

export interface GraphEdge {
  id: string
  bucketId: string
  fromId: string
  toId: string
  kind: GraphEdgeKind
  createdAt: number
}

export interface GraphEvent {
  id: string
  bucketId: string
  runId: string | null
  toolName: string | null
  nodeId: string | null
  payloadJson: string
  createdAt: number
}

export interface SearchSnippet {
  nodeId: string
  bucketId: string
  kind: GraphNodeKind
  title: string | null
  uri: string | null
  snippet: string
}

export interface CurrentWork {
  tabs: GraphNode[]
  pages: GraphNode[]
  files: GraphNode[]
  runs: GraphNode[]
  terminal: GraphNode[]
}

export interface UpsertNodeInput {
  id?: string
  bucketId: string
  kind: GraphNodeKind
  title?: string | null
  uri?: string | null
  summary?: string | null
  provenance: string
  /** When set with uri, upsert by (bucket_id, kind, uri) instead of id. */
  matchByUri?: boolean
}

export interface AddEdgeInput {
  id?: string
  bucketId: string
  fromId: string
  toId: string
  kind: GraphEdgeKind
}

export interface AddEventInput {
  id?: string
  bucketId: string
  runId?: string | null
  toolName?: string | null
  nodeId?: string | null
  payload: Record<string, unknown> | string
}

/** Minimal SQLite surface used by the graph repository (Bun Database compatible). */
export interface GraphSqlStatement<T = unknown> {
  // Bun's prepare().run is contravariant on bindings; accept any for the interface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (...params: any[]) => unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all: (...params: any[]) => T[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (...params: any[]) => T | null | undefined
}

export interface GraphSqlDatabase {
  exec(sql: string): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare<T = unknown>(sql: string): GraphSqlStatement<T>
}
