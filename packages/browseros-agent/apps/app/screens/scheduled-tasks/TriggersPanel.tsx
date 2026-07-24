/**
 * Triggers tab — graph-event rules managed by the server scheduler (M5.1).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

interface TriggerMatch {
  toolName?: string
  occurrenceN?: number
  payloadContains?: string
}

interface TriggerRule {
  id: string
  name: string
  enabled: boolean
  match: TriggerMatch
  prompt: string
  cooldownMs: number
  matchCount: number
  lastFiredAt: number | null
}

const TRIGGERS_KEY = ['scheduler', 'triggers'] as const

async function fetchTriggers(): Promise<TriggerRule[]> {
  const base = await getAgentServerUrl()
  const res = await agentFetch(`${base}/scheduler/triggers`)
  if (!res.ok) throw new Error(`Failed to load triggers: ${res.status}`)
  const data = (await res.json()) as { rules: TriggerRule[] }
  return data.rules
}

export const TriggersPanel: FC = () => {
  const queryClient = useQueryClient()
  const {
    data: rules = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: TRIGGERS_KEY,
    queryFn: fetchTriggers,
  })

  const [name, setName] = useState('')
  const [toolName, setToolName] = useState('navigate')
  const [occurrenceN, setOccurrenceN] = useState('')
  const [prompt, setPrompt] = useState('')

  const createMutation = useMutation({
    mutationFn: async () => {
      const base = await getAgentServerUrl()
      const match: TriggerMatch = { toolName: toolName.trim() || undefined }
      const n = Number.parseInt(occurrenceN, 10)
      if (Number.isFinite(n) && n > 0) match.occurrenceN = n
      const res = await agentFetch(`${base}/scheduler/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          prompt: prompt.trim(),
          match,
          bucketId: 'default',
        }),
      })
      if (!res.ok) throw new Error(`Create failed: ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      setName('')
      setPrompt('')
      setOccurrenceN('')
      void queryClient.invalidateQueries({ queryKey: TRIGGERS_KEY })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const base = await getAgentServerUrl()
      const res = await agentFetch(`${base}/scheduler/triggers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error(`Update failed: ${res.status}`)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TRIGGERS_KEY })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const base = await getAgentServerUrl()
      const res = await agentFetch(`${base}/scheduler/triggers/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TRIGGERS_KEY })
    },
  })

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Triggers start an agent run when a matching Context Graph event is
        recorded. Example: on the 3rd <code>navigate</code> to a URL pattern,
        run a prompt. Cooldown default is 5 minutes.
      </p>

      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="font-medium text-sm">Add trigger</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="trg-name">Name</Label>
            <Input
              id="trg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Staging deploy watch"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="trg-tool">Tool name</Label>
            <Input
              id="trg-tool"
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              placeholder="navigate"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="trg-n">Nth occurrence (optional)</Label>
            <Input
              id="trg-n"
              value={occurrenceN}
              onChange={(e) => setOccurrenceN(e.target.value)}
              placeholder="e.g. 3"
              inputMode="numeric"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="trg-prompt">Prompt</Label>
          <Textarea
            id="trg-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="When this fires, what should Pane do?"
            rows={3}
          />
        </div>
        <Button
          disabled={!name.trim() || !prompt.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          Create trigger
        </Button>
        {createMutation.error && (
          <p className="text-destructive text-sm">
            {(createMutation.error as Error).message}
          </p>
        )}
      </div>

      {isLoading && (
        <p className="text-muted-foreground text-sm">Loading triggers…</p>
      )}
      {error && (
        <p className="text-destructive text-sm">{(error as Error).message}</p>
      )}

      <ul className="space-y-3">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="space-y-1">
              <div className="font-medium">{rule.name}</div>
              <div className="text-muted-foreground text-xs">
                match: {rule.match.toolName ?? '*'}
                {rule.match.occurrenceN ? ` · N=${rule.match.occurrenceN}` : ''}
                {' · '}
                matches={rule.matchCount}
                {rule.lastFiredAt
                  ? ` · last fired ${new Date(rule.lastFiredAt).toLocaleString()}`
                  : ''}
              </div>
              <p className="text-sm">{rule.prompt}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(enabled) =>
                    toggleMutation.mutate({ id: rule.id, enabled })
                  }
                />
                <span className="text-muted-foreground text-xs">
                  {rule.enabled ? 'On' : 'Off'}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteMutation.mutate(rule.id)}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
        {!isLoading && rules.length === 0 && (
          <li className="text-muted-foreground text-sm">
            No triggers yet. Create one above.
          </li>
        )}
      </ul>
    </div>
  )
}
