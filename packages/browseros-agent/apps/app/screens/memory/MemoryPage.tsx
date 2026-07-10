/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  useMemoryFiles,
  useMemorySkills,
  usePersonas,
  useStagedSkills,
} from './useMemoryApi'

export const MemoryPage: FC = () => {
  const { data, isLoading, error, save } = useMemoryFiles()
  const staged = useStagedSkills()
  const skills = useMemorySkills()
  const personas = usePersonas()

  const [soul, setSoul] = useState('')
  const [user, setUser] = useState('')
  const [memory, setMemory] = useState('')
  const [importPath, setImportPath] = useState('')

  useEffect(() => {
    if (!data?.files) return
    setSoul(data.files.soul)
    setUser(data.files.user)
    setMemory(data.files.memory)
  }, [data])

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-8 duration-500">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">
          Memory & Skills
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Edit Pane&apos;s persona and notes. Files under memories/ are the
          source of truth.
        </p>
      </div>

      {error && (
        <p className="text-destructive text-sm">{(error as Error).message}</p>
      )}
      {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}

      <section className="space-y-3">
        <h2 className="font-medium text-sm">Persona</h2>
        <div className="flex flex-wrap gap-2">
          {(personas.data?.personas ?? []).map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant="outline"
              onClick={() => personas.apply.mutate(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <Textarea
          className="min-h-40 font-mono text-xs"
          value={soul}
          onChange={(e) => setSoul(e.target.value)}
        />
        <Button
          size="sm"
          onClick={() => save.mutate({ which: 'soul', content: soul })}
        >
          Save SOUL.md
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-sm">USER.md</h2>
        <Textarea
          className="min-h-32 font-mono text-xs"
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
        <Button
          size="sm"
          onClick={() => save.mutate({ which: 'user', content: user })}
        >
          Save USER.md
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-sm">MEMORY.md</h2>
        <Textarea
          className="min-h-40 font-mono text-xs"
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
        />
        <Button
          size="sm"
          onClick={() => save.mutate({ which: 'memory', content: memory })}
        >
          Save MEMORY.md
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-sm">Staged skills</h2>
        {(staged.data?.staged ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">No staged skills.</p>
        )}
        <ul className="space-y-3">
          {(staged.data?.staged ?? []).map((s) => (
            <li key={s.id} className="rounded-lg border px-3 py-2 text-sm">
              <div className="font-medium">{s.id}</div>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                {s.body?.slice(0, 800)}
              </pre>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => staged.approve.mutate(s.id)}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => staged.reject.mutate(s.id)}
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium text-sm">Skills</h2>
        <ul className="space-y-2">
          {(skills.data?.skills ?? []).map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">
                  {s.name}{' '}
                  <span className="text-muted-foreground text-xs">
                    ({s.status}, uses={s.uses})
                  </span>
                </div>
                <div className="text-muted-foreground text-xs">
                  {s.description}
                </div>
              </div>
              {s.status !== 'archived' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => skills.archive.mutate(s.id)}
                >
                  Archive
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            placeholder="Local path or https URL to SKILL.md"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => {
              if (!importPath.trim()) return
              skills.importPath.mutate(importPath.trim())
              setImportPath('')
            }}
          >
            Import
          </Button>
        </div>
      </section>
    </div>
  )
}
