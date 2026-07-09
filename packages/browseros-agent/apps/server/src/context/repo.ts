/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Thin server wiring for the context graph: DB access helpers used by
 * ingest, tools, and HTTP routes. Repository logic lives in
 * `@browseros/context-graph`.
 */

import {
  addEdge,
  addEvent,
  currentWork,
  ensureDefaultBucket,
  search,
  upsertNode,
} from '@browseros/context-graph/repo'
import type {
  AddEdgeInput,
  AddEventInput,
  CurrentWork,
  GraphEdge,
  GraphEvent,
  GraphNode,
  GraphSqlDatabase,
  SearchSnippet,
  UpsertNodeInput,
} from '@browseros/context-graph/types'
import { getDbHandle } from '../lib/db'

function sqlite(): GraphSqlDatabase {
  return getDbHandle().sqlite as unknown as GraphSqlDatabase
}

export function ensureGraphReady(): void {
  ensureDefaultBucket(sqlite())
}

export function graphUpsertNode(input: UpsertNodeInput): GraphNode {
  return upsertNode(sqlite(), input)
}

export function graphAddEdge(input: AddEdgeInput): GraphEdge {
  return addEdge(sqlite(), input)
}

export function graphAddEvent(input: AddEventInput): GraphEvent {
  return addEvent(sqlite(), input)
}

export function graphSearch(
  bucketId: string,
  query: string,
  limit?: number,
  options?: { deniedHosts?: Set<string> | string[] },
): SearchSnippet[] {
  return search(sqlite(), bucketId, query, limit, options)
}

export function graphCurrentWork(
  bucketId: string,
  options?: { deniedHosts?: Set<string> | string[]; limitPerKind?: number },
): CurrentWork {
  return currentWork(sqlite(), bucketId, options)
}

export type { CurrentWork, GraphNode, SearchSnippet }
