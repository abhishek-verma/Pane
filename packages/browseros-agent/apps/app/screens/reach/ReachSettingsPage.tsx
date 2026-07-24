/**
 * Reach + keep-alive settings (M5.3 / M5.4).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

const REACH_KEY = ['reach', 'status'] as const
const KEEP_KEY = ['scheduler', 'keep-alive'] as const

export const ReachSettingsPage: FC = () => {
  const qc = useQueryClient()
  const reach = useQuery({
    queryKey: REACH_KEY,
    queryFn: async () => {
      const base = await getAgentServerUrl()
      const res = await agentFetch(`${base}/reach/status`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res.json() as Promise<{
        configured: Record<string, boolean>
        quietHours: {
          enabled: boolean
          startHour: number
          endHour: number
        }
        pairingCode: string | null
      }>
    },
  })

  const keepAlive = useQuery({
    queryKey: KEEP_KEY,
    queryFn: async () => {
      const base = await getAgentServerUrl()
      const res = await agentFetch(`${base}/scheduler/keep-alive`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res.json() as Promise<{
        installed: boolean
        implemented: boolean
        limitations: string[]
        platform: string
      }>
    },
  })

  const [botToken, setBotToken] = useState('')
  const [email, setEmail] = useState({
    host: '',
    port: '587',
    user: '',
    password: '',
    from: '',
    to: '',
  })

  const testSend = useMutation({
    mutationFn: async (transport?: string) => {
      const base = await getAgentServerUrl()
      const res = await agentFetch(`${base}/reach/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transport }),
      })
      return res.json()
    },
  })

  const saveTelegram = useMutation({
    mutationFn: async () => {
      const base = await getAgentServerUrl()
      const res = await agentFetch(`${base}/reach/telegram/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken }),
      })
      if (!res.ok) throw new Error(`save failed ${res.status}`)
      return res.json() as Promise<{ pairingCode: string; hint: string }>
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: REACH_KEY }),
  })

  const saveEmail = useMutation({
    mutationFn: async () => {
      const base = await getAgentServerUrl()
      const res = await agentFetch(`${base}/reach/email/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...email,
          port: Number.parseInt(email.port, 10),
        }),
      })
      if (!res.ok) throw new Error(`save failed ${res.status}`)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: REACH_KEY }),
  })

  const installKeepAlive = useMutation({
    mutationFn: async (install: boolean) => {
      const base = await getAgentServerUrl()
      const res = await agentFetch(
        `${base}/scheduler/keep-alive/${install ? 'install' : 'uninstall'}`,
        { method: 'POST' },
      )
      const data = await res.json()
      if (!res.ok)
        throw new Error((data as { error?: string }).error ?? 'failed')
      return data
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEEP_KEY }),
  })

  return (
    <div className="mx-auto max-w-2xl space-y-10 p-6">
      <div>
        <h1 className="font-semibold text-2xl">Reach & keep-alive</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Peer-to-peer notifications (OS push, your SMTP, Telegram). No Pane
          cloud relay. Quiet hours default 22:00–08:00 local; max 20
          messages/day per transport.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">Keep Pane agent running at login</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground text-sm">
          {(keepAlive.data?.limitations ?? []).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <Switch
            checked={Boolean(keepAlive.data?.installed)}
            disabled={
              !keepAlive.data?.implemented || installKeepAlive.isPending
            }
            onCheckedChange={(on) => installKeepAlive.mutate(on)}
          />
          <span className="text-sm">
            {keepAlive.data?.installed ? 'Installed' : 'Off'}
            {!keepAlive.data?.implemented
              ? ` (macOS only — ${keepAlive.data?.platform ?? '…'})`
              : ''}
          </span>
        </div>
        {installKeepAlive.error && (
          <p className="text-destructive text-sm">
            {(installKeepAlive.error as Error).message}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">OS push</h2>
        <p className="text-muted-foreground text-sm">
          Always available. Server queues notifications for the app to show via
          chrome.notifications when attached.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => testSend.mutate('os-push')}
        >
          Send test
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Email (SMTP)</h2>
        <p className="text-muted-foreground text-sm">
          Credentials stored in the local SQLite secret store (same pattern as
          OAuth tokens) — never in prefs JSON.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['host', 'Host', 'smtp.gmail.com'],
              ['port', 'Port', '587'],
              ['user', 'User', 'you@gmail.com'],
              ['password', 'Password / app password', 'app password'],
              ['from', 'From', 'you@gmail.com'],
              ['to', 'To', 'you@gmail.com'],
            ] as const
          ).map(([key, label, placeholder]) => (
            <div key={key} className="space-y-1">
              <Label>{label}</Label>
              <Input
                type={key === 'password' ? 'password' : 'text'}
                value={email[key]}
                placeholder={placeholder}
                onChange={(e) =>
                  setEmail((prev) => ({ ...prev, [key]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => saveEmail.mutate()}>
            Save SMTP
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => testSend.mutate('email')}
          >
            Send test
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Telegram</h2>
        <div className="space-y-1">
          <Label>Bot token</Label>
          <Input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="from @BotFather"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => saveTelegram.mutate()}>
            Save & get pairing code
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => testSend.mutate('telegram')}
          >
            Send test
          </Button>
        </div>
        {(saveTelegram.data?.pairingCode || reach.data?.pairingCode) && (
          <p className="text-sm">
            Pairing code:{' '}
            <code>
              {saveTelegram.data?.pairingCode ?? reach.data?.pairingCode}
            </code>
            . Message your bot{' '}
            <code>
              /pair {saveTelegram.data?.pairingCode ?? reach.data?.pairingCode}
            </code>
            .
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Configured: os-push=
          {String(reach.data?.configured?.['os-push'])}, email=
          {String(reach.data?.configured?.email)}, telegram=
          {String(reach.data?.configured?.telegram)}
        </p>
      </section>

      {testSend.data && (
        <pre className="overflow-auto rounded border p-3 text-xs">
          {JSON.stringify(testSend.data, null, 2)}
        </pre>
      )}
    </div>
  )
}
