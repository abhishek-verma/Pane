/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ContextSelectionToolbar } from './ContextSelectionToolbar'
import { SelectableNodeList } from './SelectableNodeList'
import {
  type ContextNode,
  type CurrentWorkResponse,
  useContextBuckets,
  useContextCurrent,
  useContextNodes,
  useContextSearch,
  useDeleteContextNodes,
} from './useContextApi'
import { useNodeSelection } from './useNodeSelection'

const CATEGORY_KINDS: Array<{
  title: string
  kind: string
  workKey: keyof CurrentWorkResponse['work']
}> = [
  { title: 'Pages', kind: 'page', workKey: 'pages' },
  { title: 'Previously Opened Pages', kind: 'tab', workKey: 'tabs' },
  { title: 'Files', kind: 'file', workKey: 'files' },
  { title: 'Terminal', kind: 'terminal_session', workKey: 'terminal' },
  { title: 'Agent runs', kind: 'agent_run', workKey: 'runs' },
  { title: 'Research Pages', kind: 'research_page', workKey: 'research' },
  { title: 'Meetings', kind: 'meeting', workKey: 'meetings' },
]

// Mirrors GraphNodeKind (packages/context-graph/src/types.ts). Search hits are
// only deletable through /context/nodes when they're backed by a graph_nodes
// row — `kind` identifies that reliably; `sourceKind` does not, since the
// vector/embedding retrieval arm reports sourceKind "embedding" even for
// graph-node hits, and the path-search arm reports "file_path".
const GRAPH_NODE_KINDS = new Set([
  'tab',
  'page',
  'workspace',
  'file',
  'terminal_session',
  'agent_run',
  'task',
  'meeting',
  'research_page',
  'research_thread',
])

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

function CategorySection({
  title,
  kind,
  fallbackNodes,
  bucketId,
  selection,
}: {
  title: string
  kind: string
  fallbackNodes: ContextNode[]
  bucketId: string
  selection: ReturnType<typeof useNodeSelection>
}) {
  const [expanded, setExpanded] = useState(false)
  const paged = useContextNodes(bucketId, kind, expanded)
  const nodes = expanded ? paged.nodes : fallbackNodes
  const showShowAll = !expanded && fallbackNodes.length >= 8

  return (
    <div className="space-y-2">
      <SelectableNodeList
        title={title}
        nodes={nodes}
        selected={selection.selected}
        onClick={selection.click}
        hasMore={expanded ? paged.hasMore : false}
        loadingMore={paged.loadingMore}
        onLoadMore={paged.fetchMore}
      />
      {showShowAll && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
          Show all {title.toLowerCase()}
        </Button>
      )}
    </div>
  )
}

export const ContextPage: FC = () => {
  const { buckets, loading: bucketsLoading } = useContextBuckets()
  const [bucketId, setBucketId] = useState('default')
  const { data, loading, error, refetch } = useContextCurrent(bucketId)
  const work = data?.work

  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounced(searchInput, 300)
  const searching = debouncedSearch.trim().length > 0
  const search = useContextSearch(bucketId, debouncedSearch)

  const selection = useNodeSelection()
  const deleteMutation = useDeleteContextNodes(bucketId)

  const empty =
    work &&
    work.tabs.length === 0 &&
    work.pages.length === 0 &&
    work.files.length === 0 &&
    work.terminal.length === 0 &&
    work.runs.length === 0 &&
    (!work.research || work.research.length === 0) &&
    (!work.meetings || work.meetings.length === 0)

  const searchSnippets = search.data?.snippets ?? []
  const graphSearchHits = searchSnippets.filter((s) =>
    GRAPH_NODE_KINDS.has(s.kind),
  )
  const nonGraphSearchHits = searchSnippets.filter(
    (s) => !GRAPH_NODE_KINDS.has(s.kind),
  )
  const searchNodes: ContextNode[] = searchSnippets.map((s) => ({
    id: s.nodeId,
    kind: s.kind,
    title: s.title,
    uri: s.uri,
    summary: s.snippet,
  }))
  const nonSelectableIds = new Set(nonGraphSearchHits.map((s) => s.nodeId))

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Context</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            What Pane knows about your work on this device.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-sm">Bucket</span>
        <Select value={bucketId} onValueChange={setBucketId}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(buckets.length > 0
              ? buckets
              : [{ id: 'default', name: 'Default' }]
            ).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data?.indexingPaused && (
          <span className="rounded-md bg-amber-500/15 px-2 py-1 text-amber-700 text-xs dark:text-amber-300">
            Indexing paused
            {data.pauseReason ? ` (${data.pauseReason})` : ' (battery)'}
          </span>
        )}
      </div>

      <Input
        placeholder="Search your context (natural language — same search the agent uses)"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />

      <ContextSelectionToolbar
        count={selection.selected.size}
        onClear={selection.clear}
        deleting={deleteMutation.isPending}
        onDelete={() => {
          deleteMutation.mutate(Array.from(selection.selected), {
            onSuccess: () => selection.clear(),
          })
        }}
      />

      {(loading || bucketsLoading) && !searching && (
        <p className="text-muted-foreground text-sm">Loading context…</p>
      )}
      {error && !searching && (
        <p className="text-destructive text-sm">
          {error instanceof Error ? error.message : 'Failed to load context'}
        </p>
      )}

      {searching ? (
        <div className="space-y-3">
          {search.loading && (
            <p className="text-muted-foreground text-sm">Searching…</p>
          )}
          {!search.loading &&
            graphSearchHits.length === 0 &&
            nonGraphSearchHits.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No context matches for "{debouncedSearch}".
              </p>
            )}
          <SelectableNodeList
            title="Search results"
            nodes={searchNodes}
            selected={selection.selected}
            onClick={selection.click}
            nonSelectableIds={nonSelectableIds}
          />
          {nonGraphSearchHits.length > 0 && (
            <p className="text-muted-foreground text-xs">
              {nonGraphSearchHits.length} additional result
              {nonGraphSearchHits.length === 1 ? '' : 's'} from
              memory/chat/other sources aren't manageable from this page yet.
            </p>
          )}
        </div>
      ) : (
        <>
          {!loading && !error && empty && (
            <p className="text-muted-foreground text-sm">
              Nothing indexed yet. Browse with the agent, write a file, or run a
              terminal command to fill this view.
            </p>
          )}

          {work && !empty && (
            <div className="grid gap-6 md:grid-cols-2">
              {CATEGORY_KINDS.map(({ title, kind, workKey }) => (
                <CategorySection
                  key={kind}
                  title={title}
                  kind={kind}
                  fallbackNodes={work[workKey] ?? []}
                  bucketId={bucketId}
                  selection={selection}
                />
              ))}
            </div>
          )}
        </>
      )}

      <section className="space-y-3 border-t pt-4">
        <h2 className="font-medium text-sm">Privacy & Domains</h2>
        <p className="text-muted-foreground text-xs">
          Manage allowed domains for context search and indexing in the
          centralized permissions settings.
        </p>
        <div className="pt-1">
          <Link
            to="/settings/permissions"
            className="font-semibold text-[var(--accent-orange)] text-xs hover:underline"
          >
            Manage domain grants in Settings →
          </Link>
        </div>
      </section>
    </div>
  )
}
