import { storage } from '@wxt-dev/storage'
import {
  Activity,
  CheckCircle,
  Database,
  FolderOpen,
  HardDrive,
  Mic,
  Radio,
  RefreshCw,
  Server,
  Shield,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  useDiagnostics,
  useDiagnosticsLogs,
  useWipeContextIndex,
} from './useDiagnosticsApi'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`
}

function formatUptime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function DiagnosticsPage() {
  const { data, isLoading, error, refetch } = useDiagnostics()
  const { data: logsData } = useDiagnosticsLogs()
  const wipeIndex = useWipeContextIndex()
  const [showLogs, setShowLogs] = useState(false)

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="font-medium text-destructive text-sm">
            Cannot reach the agent server.
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            Make sure Pane is running and the server is healthy.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => refetch()}
          >
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-xl">Diagnostics</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            System health and self-service tools
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-1.5 size-3.5" />
          Refresh
        </Button>
      </div>

      {/* Server Health */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="size-4" />
            Server
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Status</span>
            <div className="mt-0.5 flex items-center gap-1.5">
              <CheckCircle className="size-3.5 text-green-500" />
              Running on port {data.serverHealth.port}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Uptime</span>
            <div className="mt-0.5">
              {formatUptime(data.serverHealth.uptimeMs)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">CDP Connection</span>
            <div className="mt-0.5 flex items-center gap-1.5">
              {data.cdpStatus.connected ? (
                <>
                  <CheckCircle className="size-3.5 text-green-500" />
                  Connected
                </>
              ) : (
                <>
                  <XCircle className="size-3.5 text-orange-500" />
                  Disconnected
                </>
              )}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Platform</span>
            <div className="mt-0.5">
              {data.serverHealth.platform} (PID {data.serverHealth.pid})
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Disk Usage */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="size-4" />
            Disk Usage
          </CardTitle>
          <CardDescription>
            {formatBytes(data.diskUsage.total)} total in{' '}
            <code className="text-xs">{data.dataDir}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 text-sm">
            {Object.entries(data.diskUsage.breakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([name, size]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded px-2 py-1 hover:bg-accent/30"
                >
                  <span className="text-muted-foreground">{name}/</span>
                  <span>{formatBytes(size)}</span>
                </div>
              ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              if (data.dataDir) {
                chrome.tabs?.create?.({ url: `file://${data.dataDir}` })
              }
            }}
          >
            <FolderOpen className="mr-1.5 size-3.5" />
            Open Data Folder
          </Button>
        </CardContent>
      </Card>

      {/* Capture State */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mic className="size-4" />
            Capture
          </CardTitle>
          <CardDescription>
            {formatBytes(data.captureState.diskUsed)} used by recordings
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.captureState.consents.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No domains have capture consent enabled.
            </p>
          ) : (
            <div className="space-y-1 text-sm">
              {data.captureState.consents.map((consent) => (
                <div key={consent.domain} className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {consent.domain}
                  </span>
                  {consent.meeting && (
                    <Badge variant="secondary">meeting</Badge>
                  )}
                  {consent.browsing && (
                    <Badge variant="secondary">browsing</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reach + Keep-Alive */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="size-4" />
            Reach & Keep-Alive
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="font-medium">Transports</span>
            <div className="mt-1 space-y-1">
              {data.reachStatus.transports.map((t) => (
                <div key={t.type} className="flex items-center gap-2">
                  {t.configured ? (
                    <CheckCircle className="size-3.5 text-green-500" />
                  ) : (
                    <XCircle className="size-3.5 text-muted-foreground" />
                  )}
                  <span>{t.type}</span>
                  <Badge variant={t.configured ? 'default' : 'outline'}>
                    {t.configured ? 'configured' : 'not configured'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
          <div>
            <span className="font-medium">Keep-Alive</span>
            <div className="mt-1 flex items-center gap-2">
              {data.keepAliveStatus.implemented ? (
                data.keepAliveStatus.installed ? (
                  <>
                    <CheckCircle className="size-3.5 text-green-500" />
                    <span>Installed</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5 text-muted-foreground" />
                    <span>Not installed</span>
                  </>
                )
              ) : (
                <>
                  <XCircle className="size-3.5 text-muted-foreground" />
                  <span>Not available on {data.keepAliveStatus.platform}</span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Log Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="size-4" />
            Action Log (7 days)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-4 gap-4 text-center text-sm">
          <div>
            <div className="font-semibold text-lg">
              {data.actionLogSummary.total}
            </div>
            <div className="text-muted-foreground text-xs">total</div>
          </div>
          <div>
            <div className="font-semibold text-green-600 text-lg">
              {data.actionLogSummary.approved}
            </div>
            <div className="text-muted-foreground text-xs">approved</div>
          </div>
          <div>
            <div className="font-semibold text-lg text-red-600">
              {data.actionLogSummary.denied}
            </div>
            <div className="text-muted-foreground text-xs">denied</div>
          </div>
          <div>
            <div className="font-semibold text-blue-600 text-lg">
              {data.actionLogSummary.replayed}
            </div>
            <div className="text-muted-foreground text-xs">replayed</div>
          </div>
        </CardContent>
      </Card>

      {/* Self-Service */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4" />
            Self-Service
          </CardTitle>
          <CardDescription>
            Maintenance actions for your local Pane installation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Wipe Context Index</p>
              <p className="text-muted-foreground text-xs">
                Clears the graph index. Memory files are preserved.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (
                  confirm(
                    'This will clear the context graph. Memory files survive. Continue?',
                  )
                ) {
                  wipeIndex.mutate()
                }
              }}
              disabled={wipeIndex.isPending}
            >
              <Database className="mr-1.5 size-3.5" />
              Wipe
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Reset Onboarding</p>
              <p className="text-muted-foreground text-xs">
                Re-run the setup flow on next app open.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await storage.removeItem('local:onboardingCompleted')
                await storage.removeItem('local:onboardingIcp')
              }}
            >
              <RefreshCw className="mr-1.5 size-3.5" />
              Reset
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Logs</p>
              <p className="text-muted-foreground text-xs">
                View recent server logs inline.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLogs(!showLogs)}
            >
              {showLogs ? 'Hide' : 'Show'}
            </Button>
          </div>
          {showLogs && logsData && (
            <div className="styled-scrollbar mt-2 max-h-64 overflow-y-auto rounded border bg-muted/30 p-3">
              <pre className="whitespace-pre-wrap font-mono text-xs">
                {logsData.lines?.length
                  ? logsData.lines.join('\n')
                  : 'No log entries yet.'}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
