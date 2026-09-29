/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { PiRailAction } from './PiChrome'
import { piPost } from './usePiApi'

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null)
  return new Error(typeof body?.error === 'string' ? body.error : fallback)
}

export function PiExportAction({
  siteId,
  name,
  disabled = false,
}: {
  siteId?: string
  name?: string
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const exportSites = async () => {
    setBusy(true)
    try {
      const base = await getAgentServerUrl()
      const response = await agentFetch(
        `${base}/pi/export${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`,
      )
      if (!response.ok)
        throw await responseError(response, 'Could not export sites.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      const filename =
        name?.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'sites'
      anchor.download = `pane-pi-${filename}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // Allow the browser to start the download before releasing the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not export sites.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <PiRailAction
      disabled={busy || disabled}
      onClick={() => void exportSites()}
    >
      {busy ? 'Exporting…' : siteId ? 'Export' : 'Export all sites'}
    </PiRailAction>
  )
}

export function PiImportAction({ onImported }: { onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const importSites = async (file: File) => {
    setBusy(true)
    try {
      if (file.size > 16 * 1024 * 1024)
        throw new Error('PI sites files must be 16 MB or smaller.')
      let archive: unknown
      try {
        archive = JSON.parse(await file.text())
      } catch {
        throw new Error('Choose a valid PI sites JSON file.')
      }
      const response = await piPost('/pi/import', archive)
      if (!response.ok)
        throw await responseError(response, 'Could not import sites.')
      const result = (await response.json()) as {
        sites: Array<{ siteId: string }>
      }
      toast.success(
        `Imported ${result.sites.length} ${result.sites.length === 1 ? 'site' : 'sites'}.`,
      )
      onImported()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not import sites.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Import PI sites file"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void importSites(file)
        }}
      />
      <PiRailAction disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Importing…' : 'Import sites'}
      </PiRailAction>
    </>
  )
}
