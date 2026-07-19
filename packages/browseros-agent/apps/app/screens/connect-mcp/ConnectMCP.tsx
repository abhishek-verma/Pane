import { Plus, Server, Trash2 } from 'lucide-react'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CUSTOM_MCP_ADDED_EVENT } from '@/lib/constants/analyticsEvents'
import { useMcpServers } from '@/lib/mcp/mcpServerStorage'
import { track } from '@/lib/metrics/track'
import { AddCustomMCPDialog } from './AddCustomMCPDialog'

/**
 * @public
 */
export const ConnectMCP: FC = () => {
  const { servers: createdServers, addServer, removeServer } = useMcpServers()
  const [addingCustomMcp, setAddingCustomMcp] = useState(false)

  const addCustomServer = (config: {
    name: string
    url: string
    description: string
  }) => {
    addServer({
      id: Date.now().toString(),
      displayName: config.name,
      type: 'custom',
      config: {
        url: config.url,
        description: config.description,
      },
    })
    track(CUSTOM_MCP_ADDED_EVENT)
  }

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      {/* Header */}
      <div className="rounded-md border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--accent-orange)]/10">
            <Server className="h-6 w-6 text-[var(--accent-orange)]" />
          </div>
          <div className="flex-1">
            <h2 className="mb-1 font-semibold text-xl">Connected Apps</h2>
            <p className="mb-6 text-muted-foreground text-sm">
              Connect Pane assistant to apps to send email, schedule calendar
              events, write docs, and more
            </p>

            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => setAddingCustomMcp(true)}
              >
                <Plus className="h-4 w-4" />
                <span>Add custom app</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Created Servers */}
      {createdServers.length > 0 && (
        <div className="rounded-md border border-border bg-card p-6">
          <h3 className="mb-4 font-semibold text-lg">Your Connected Apps</h3>
          <div className="space-y-3">
            {createdServers.map((server) => (
              <div
                key={server.id}
                className="flex items-center gap-4 rounded-md border border-border bg-background p-4 transition-colors hover:border-[var(--accent-orange)]/50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--accent-orange)]/10">
                  <Server className="h-5 w-5 text-[var(--accent-orange)]" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-semibold">{server.displayName}</span>
                    <span className="rounded bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
                      Custom
                    </span>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {server.config?.description || server.config?.url}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeServer(server.id)}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Remove server"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <AddCustomMCPDialog
        open={addingCustomMcp}
        onOpenChange={setAddingCustomMcp}
        onAddServer={addCustomServer}
      />
    </div>
  )
}
