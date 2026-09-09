import {
  type InstalledLayer,
  installedLayerSchema,
} from '@browseros/shared/layers/manifest'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { LAYER_CHANNEL } from '@/lib/layers/messages'

export function LayerVersionHistory({
  id,
  latestVersion,
  activeVersion,
  disabled,
  restore,
}: {
  id: string
  latestVersion: string
  activeVersion: string | null
  disabled: boolean
  restore: (version: string) => Promise<void>
}) {
  const [versions, setVersions] = useState<
    Array<{ version: string; createdAt: number }>
  >([])
  const [selected, setSelected] = useState<InstalledLayer>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const read = async (version?: string) => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await chrome.runtime.sendMessage({
        channel: LAYER_CHANNEL,
        kind: 'ui',
        action: 'version',
        id,
        ...(version ? { version } : {}),
      })
      if (!result || result.error)
        throw new Error(result?.error ?? 'Version history is unavailable.')
      if (version) setSelected(installedLayerSchema.parse(result.layer))
      else setVersions(result.versions)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not load version history.',
      )
    } finally {
      setLoading(false)
    }
  }
  return (
    <details
      className="mt-3 text-sm"
      onToggle={(event) => {
        if (event.currentTarget.open) void read()
      }}
    >
      <summary className="cursor-pointer">Version history</summary>
      <p className="mt-2 text-muted-foreground">
        Choosing an older version creates a draft. Preview and verify it before
        keeping it; the working version stays active.
      </p>
      {loading && <p role="status">Loading versions…</p>}
      <ol className="mt-2 max-h-48 space-y-2 overflow-auto">
        {versions.map((item) => (
          <li
            key={item.version}
            className="flex items-center justify-between gap-2"
          >
            <span>
              {new Date(item.createdAt).toLocaleString()} ·{' '}
              {item.version.slice(0, 8)}
              {item.version === activeVersion ? ' · Active' : ''}
              {item.version === latestVersion && item.version !== activeVersion
                ? ' · Latest draft'
                : ''}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || disabled}
              onClick={() => void read(item.version)}
            >
              Inspect
            </Button>
          </li>
        ))}
      </ol>
      {selected && (
        <div className="mt-3 space-y-2">
          <p>
            {selected.definition.name} · {selected.version.slice(0, 8)}
          </p>
          <pre className="max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(selected.definition, null, 2)}
          </pre>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || selected.version === latestVersion}
            onClick={() => void restore(selected.version)}
          >
            Use this version as draft
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
    </details>
  )
}
