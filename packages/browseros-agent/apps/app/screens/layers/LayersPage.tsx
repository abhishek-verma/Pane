import { DATA_OPERATIONS } from '@browseros/shared/layers/data'
import type {
  LayerDefinition,
  LayerManifest,
} from '@browseros/shared/layers/manifest'
import { Layers, Pause, Play, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { openSidePanel } from '@/lib/browseros/toggleSidePanel'
import { LAYER_CHANNEL } from '@/lib/layers/messages'
import { LayerActivity, type LayerRunView } from './LayerActivity'
import { LayerVersionHistory } from './LayerVersionHistory'

interface RecordView {
  id: string
  latestVersion: string
  activeVersion: string | null
  enabled: boolean
  definition: LayerDefinition
  activeScope?: LayerDefinition['scope'] | null
  activeName?: string | null
  verification?: { receiptId: string; expiresAt: number } | null
  outputBudget?: 'accepted-output' | 'provider-ceiling'
  previewAllowed?: boolean
}
interface LayerViewState {
  capabilities?: { javascript?: boolean }
  scripts?: Array<{
    tabId: number
    layerId: string
    url: string
    status: string
  }>
  activity?: LayerRunView[]
  online: boolean
  revision?: number
  records?: RecordView[]
  deleted?: RecordView[]
  paused?: boolean
  pausedOrigins?: string[]
  local?: {
    manifest: LayerManifest | null
    disabledIds: string[]
    paused: boolean
    pausedOrigins: string[]
  }
  documents?: Array<{ tabId: number; url: string; active: boolean }>
}
async function request(
  input: Record<string, unknown>,
): Promise<LayerViewState & { error?: string; disabledLocally?: boolean }> {
  return chrome.runtime.sendMessage({
    channel: LAYER_CHANNEL,
    kind: 'ui',
    ...input,
  })
}

export function LayersPage({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<LayerViewState>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [filter, setFilter] = useState('')
  const [activeTabId, setActiveTabId] = useState<number>()
  const [activeWindowId, setActiveWindowId] = useState<number>()
  const [activeUrl, setActiveUrl] = useState<string>()
  const refreshGeneration = useRef(0)
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      const value = await request({ action: 'state' })
      if (generation !== refreshGeneration.current) return
      if (!value || value.error)
        throw new Error(
          value?.error ?? 'Layers is unavailable in this browser.',
        )
      setState(value)
      setActiveTabId(activeTab?.id)
      setActiveWindowId(activeTab?.windowId)
      setActiveUrl(activeTab?.url)
    } catch (reason) {
      if (generation !== refreshGeneration.current) return
      setError(
        reason instanceof Error ? reason.message : 'Could not load Layers.',
      )
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, 5000)
    const tabChanged = () => {
      void refresh()
    }
    chrome.tabs.onActivated.addListener(tabChanged)
    chrome.tabs.onUpdated.addListener(tabChanged)
    return () => {
      refreshGeneration.current += 1
      clearInterval(timer)
      chrome.tabs.onActivated.removeListener(tabChanged)
      chrome.tabs.onUpdated.removeListener(tabChanged)
    }
  }, [refresh])
  const mutate = async (
    action: string,
    extra: Record<string, unknown> = {},
  ) => {
    setPending(true)
    setError(undefined)
    try {
      const result = await request({
        action,
        revision: state?.revision ?? state?.local?.manifest?.revision ?? 0,
        ...extra,
      })
      if (result.error)
        setError(
          result.disabledLocally
            ? `Paused on this browser. ${result.error}`
            : result.error,
        )
      await refresh()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not update this Layer.',
      )
    } finally {
      setPending(false)
    }
  }
  const cached = state?.local?.manifest
  const records: RecordView[] =
    state?.records ??
    cached?.layers.map((layer) => ({
      id: layer.id,
      latestVersion: layer.version,
      activeVersion: layer.version,
      enabled: true,
      definition: layer.definition,
    })) ??
    []
  const origin = (() => {
    try {
      const url = activeUrl ? new URL(activeUrl) : undefined
      return url && ['http:', 'https:'].includes(url.protocol)
        ? url.origin
        : undefined
    } catch {
      return undefined
    }
  })()
  const paused = state?.paused || state?.local?.paused || cached?.paused
  const sitePaused =
    origin &&
    (state?.pausedOrigins?.includes(origin) ||
      state?.local?.pausedOrigins.includes(origin) ||
      cached?.pausedOrigins.includes(origin))
  const visible = records.filter(
    (record) =>
      (!compact ||
        Boolean(
          origin &&
            (record.definition.scope.origin === origin ||
              record.activeScope?.origin === origin),
        )) &&
      `${record.definition.name} ${record.definition.scope.origin}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  )
  return (
    <div
      className={`${compact ? 'space-y-4 p-4' : 'space-y-6'} min-w-0 [overflow-wrap:anywhere]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-2xl">
            <Layers className="size-6" />
            Layers
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Your changes, remembered on every visit.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh Layers"
          className="text-foreground hover:text-foreground"
          onClick={() => {
            setError(undefined)
            void refresh()
          }}
        >
          <RefreshCw />
        </Button>
      </div>
      {!state ? (
        <p role="status">Loading Layers…</p>
      ) : (
        <>
          {!state.online && (
            <p role="status" className="rounded-lg bg-muted p-3 text-sm">
              The agent server is offline. Saved local changes and pause
              controls still work. Reconnect to create or enable Layers.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {compact && (
              <Button
                disabled={!origin}
                onClick={() => {
                  if (activeTabId === undefined || activeWindowId === undefined)
                    return
                  void openSidePanel({
                    tabId: activeTabId,
                    windowId: activeWindowId,
                  }).catch((reason) =>
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : 'Could not open Pane.',
                    ),
                  )
                }}
              >
                Ask Pane to add a Layer
              </Button>
            )}
            <Button
              variant="outline"
              disabled={pending || Boolean(paused && !state.online)}
              onClick={() => void mutate('pause', { paused: !paused })}
            >
              {paused ? <Play /> : <Pause />}
              {paused ? 'Resume Layers' : 'Pause all'}
            </Button>
            {origin && (
              <Button
                variant="outline"
                disabled={pending || Boolean(sitePaused && !state.online)}
                onClick={() =>
                  void mutate('site-pause', { origin, paused: !sitePaused })
                }
              >
                {sitePaused ? 'Resume this site' : 'Pause this site'}
              </Button>
            )}
          </div>
          {compact && origin && (
            <p className="break-all text-muted-foreground text-xs">{origin}</p>
          )}
          <input
            aria-label="Search Layers"
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search by name or site"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          {visible.length === 0 && (
            <div className="rounded-xl border border-dashed p-6">
              <p>No Layers here yet.</p>
              <p className="mt-2 text-muted-foreground text-sm">
                Open a website and ask Pane to remember a change, such as “Hide
                this recommendations panel whenever I visit.” Pane will check
                what is possible and show a preview first.
              </p>
            </div>
          )}
          <div className="space-y-3">
            {visible.map((record) => {
              const disabled =
                !record.enabled || state.local?.disabledIds.includes(record.id)
              const needsKeep = record.activeVersion !== record.latestVersion
              const verified =
                record.verification &&
                record.verification.expiresAt > Date.now()
              return (
                <article
                  key={record.id}
                  aria-labelledby={`layer-name-${record.id}`}
                  className="min-w-0 rounded-xl border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2
                        id={`layer-name-${record.id}`}
                        dir="auto"
                        className="font-medium [overflow-wrap:anywhere]"
                      >
                        {record.definition.name}
                      </h2>
                      <p className="mt-1 break-all text-muted-foreground text-xs">
                        {record.definition.scope.origin}
                      </p>
                    </div>
                    {record.activeVersion && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || Boolean(disabled && !state.online)}
                        aria-label={`${disabled ? 'Enable' : 'Disable'} ${record.definition.name}`}
                        onClick={() =>
                          void mutate(disabled ? 'enable' : 'disable', {
                            id: record.id,
                          })
                        }
                      >
                        {disabled ? 'Enable' : 'Disable'}
                      </Button>
                    )}
                  </div>
                  <p className="mt-3 text-sm">{record.definition.intent}</p>
                  {needsKeep && record.activeName && (
                    <p className="mt-2 text-muted-foreground text-xs">
                      Working version: {record.activeName} ·{' '}
                      {record.activeScope?.origin}. The details below describe
                      the draft.
                    </p>
                  )}
                  <p className="mt-2 text-muted-foreground text-xs">
                    {needsKeep
                      ? record.activeVersion
                        ? 'Draft changes · previous version is still saved'
                        : 'Draft changes'
                      : disabled
                        ? 'Disabled'
                        : paused ||
                            (sitePaused &&
                              origin === record.definition.scope.origin)
                          ? 'Paused'
                          : 'Enabled'}{' '}
                    ·{' '}
                    {record.definition.mode === 'managed'
                      ? 'Managed changes'
                      : 'Advanced JavaScript'}
                  </p>
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer">
                      Scope and behavior
                    </summary>
                    <div className="mt-2 space-y-2 text-muted-foreground">
                      <p>
                        Applies to paths:{' '}
                        {record.definition.scope.paths.join(', ')}
                      </p>
                      {record.definition.scope.excludePaths.length > 0 && (
                        <p>
                          Except:{' '}
                          {record.definition.scope.excludePaths.join(', ')}
                        </p>
                      )}
                      {record.definition.actions.length === 0 ? (
                        <p>Runs locally. No agent call when the page loads.</p>
                      ) : (
                        record.definition.actions.map((action) => (
                          <p key={action.id}>
                            {action.kind} ·{' '}
                            {action.trigger === 'click'
                              ? 'When clicked'
                              : 'When the page loads'}{' '}
                            {action.kind === 'data' &&
                            action.dataOperationId ? (
                              DATA_OPERATIONS[action.dataOperationId].disclosure
                            ) : (
                              <>
                                · Provider:{' '}
                                {action.providerId ?? 'Not configured'} · Up to{' '}
                                {action.limits.maxSteps} steps,{' '}
                                {action.limits.maxOutputTokens.toLocaleString()}{' '}
                                {record.outputBudget === 'accepted-output'
                                  ? 'accepted output tokens'
                                  : 'output tokens'}{' '}
                                · {action.limits.deadlineMs / 1000} seconds.
                                Provider usage may apply.
                                {record.outputBudget === 'accepted-output' &&
                                  ' Codex account usage has no hard token-spend ceiling and may exceed the accepted-output limit.'}
                              </>
                            )}
                          </p>
                        ))
                      )}
                      {record.definition.mode === 'javascript' && (
                        <p>
                          This script can read and change the matching page and
                          make network requests. Disabling stops future
                          injection and agent requests. Reload the page to
                          remove existing script effects.
                        </p>
                      )}
                      <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
                        {record.definition.source ??
                          JSON.stringify(record.definition.operations, null, 2)}
                      </pre>
                    </div>
                  </details>
                  <LayerVersionHistory
                    id={record.id}
                    latestVersion={record.latestVersion}
                    activeVersion={record.activeVersion}
                    disabled={pending || !state.online}
                    restore={(version) =>
                      mutate('restore-version', { id: record.id, version })
                    }
                  />
                  {needsKeep && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {record.definition.mode === 'javascript' &&
                        !record.previewAllowed && (
                          <Button
                            variant="outline"
                            disabled={
                              pending ||
                              !state.online ||
                              !state.capabilities?.javascript
                            }
                            onClick={() =>
                              void mutate('grant-preview', {
                                id: record.id,
                                version: record.latestVersion,
                              })
                            }
                          >
                            Allow script preview
                          </Button>
                        )}
                      <Button
                        disabled={pending || !verified || !state.online}
                        onClick={() =>
                          void mutate('keep', {
                            id: record.id,
                            version: record.latestVersion,
                            receiptId: record.verification?.receiptId,
                          })
                        }
                      >
                        Keep for this site
                      </Button>
                      <span className="text-muted-foreground text-xs">
                        {verified
                          ? record.definition.mode === 'javascript'
                            ? 'Declared page outcomes and reload checked. Script cleanup may require a reload.'
                            : 'Preview, cleanup and reload verified.'
                          : record.definition.mode === 'javascript' &&
                              !record.previewAllowed
                            ? 'Review the source and allow a preview before Pane can test this script.'
                            : 'Ask Pane to preview and verify this version first.'}
                      </span>
                    </div>
                  )}
                  {record.definition.actions.some(
                    (action) => action.execution === 'javascript',
                  ) && (
                    <p className="mt-3 text-muted-foreground text-sm">
                      This Layer lets the agent write and run new page scripts
                      when you click its action button. Approval includes those
                      generated changes on this site. Reload may be needed to
                      remove them.
                    </p>
                  )}
                  {record.definition.mode === 'javascript' &&
                    !state.capabilities?.javascript && (
                      <Button
                        variant="link"
                        onClick={() =>
                          void chrome.tabs.create({
                            url: `chrome://extensions/?id=${chrome.runtime.id}`,
                          })
                        }
                      >
                        Script access settings
                      </Button>
                    )}
                  {activeTabId !== undefined &&
                    state.scripts?.some(
                      (script) =>
                        script.tabId === activeTabId &&
                        script.layerId === record.id &&
                        (script.status === 'reload-required' ||
                          script.status === 'failed' ||
                          script.url !== activeUrl),
                    ) && (
                      <p className="mt-3 text-sm" role="status">
                        This page needs a reload to apply or remove script
                        changes.{' '}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void chrome.tabs.reload(activeTabId)}
                        >
                          Reload page
                        </Button>
                      </p>
                    )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3 text-foreground hover:text-foreground"
                    disabled={pending}
                    onClick={() => void mutate('delete', { id: record.id })}
                  >
                    Delete Layer
                  </Button>
                </article>
              )
            })}
          </div>
        </>
      )}
      <LayerActivity
        runs={(state?.activity ?? []).filter(
          (run) =>
            !compact || visible.some((record) => record.id === run.layerId),
        )}
        disabled={pending || !state?.online}
        stop={(invocationId) => mutate('stop', { invocationId })}
      />
      {Boolean(state?.deleted?.length) && (
        <details className="rounded-xl border p-4 text-sm">
          <summary className="cursor-pointer">Recently deleted</summary>
          <p className="mt-2 text-muted-foreground text-sm">
            Deleted Layers and their saved versions are recoverable for 30 days.
          </p>
          <p className="mt-2 text-muted-foreground">
            Restored Layers stay disabled until you enable them.
          </p>
          {state?.deleted
            ?.filter(
              (record) => !compact || record.definition.scope.origin === origin,
            )
            .map((record) => (
              <div
                key={record.id}
                className="mt-3 flex items-center justify-between gap-3"
              >
                <span>{record.definition.name}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !state.online}
                  onClick={() => void mutate('restore', { id: record.id })}
                >
                  Restore
                </Button>
              </div>
            ))}
        </details>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm"
        >
          {error}
        </p>
      )}
      {compact && (
        <a
          href={chrome.runtime.getURL('/app.html#/layers')}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm underline"
        >
          Open all Layers
        </a>
      )}
    </div>
  )
}
