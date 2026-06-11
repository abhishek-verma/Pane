import { AlertCircle, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  HarnessAdapterDescriptor,
  HarnessAgentAdapter,
} from '@/modules/agents/agent-harness-types'
import type {
  CreateAgentRuntime,
  ProviderOption,
} from '@/modules/agents/agents-page-types'
import { ProviderSelector } from './ProviderSelector'

export interface NewAgentDialogProps {
  adapters: HarnessAdapterDescriptor[]
  createError: string | null
  createRuntime: CreateAgentRuntime
  creating: boolean
  defaultProviderId: string
  harnessAdapterId: HarnessAgentAdapter
  harnessModelId: string
  harnessReasoningEffort: string
  hermesProviders: ProviderOption[]
  hermesSelectedProviderId: string
  name: string
  open: boolean
  onCreate: () => void
  onOpenChange: (open: boolean) => void
  onRuntimeChange: (runtime: CreateAgentRuntime) => void
  onHarnessAdapterChange: (adapter: HarnessAgentAdapter) => void
  onHarnessModelChange: (modelId: string) => void
  onHarnessReasoningChange: (reasoningEffort: string) => void
  onHermesProviderChange: (providerId: string) => void
  onNameChange: (name: string) => void
}

export const NewAgentDialog: FC<NewAgentDialogProps> = ({
  adapters,
  createError,
  createRuntime,
  creating,
  defaultProviderId,
  harnessAdapterId,
  harnessModelId,
  harnessReasoningEffort,
  hermesProviders,
  hermesSelectedProviderId,
  name,
  open,
  onCreate,
  onOpenChange,
  onRuntimeChange,
  onHarnessAdapterChange,
  onHarnessModelChange,
  onHarnessReasoningChange,
  onHermesProviderChange,
  onNameChange,
}) => {
  const selectedHarnessAdapter =
    adapters.find((adapter) => adapter.id === harnessAdapterId) ?? adapters[0]
  // When scoped to a single adapter (opened from a specific coding-agent card),
  // the picker is redundant — the runtime is already implied.
  const showAdapterPicker = adapters.length > 1
  const isHermesRuntime = createRuntime === 'hermes'
  const isClassicHarnessRuntime = !isHermesRuntime
  const hermesBlocked =
    isHermesRuntime &&
    (hermesProviders.length === 0 || !hermesSelectedProviderId)
  const canCreate =
    Boolean(name.trim()) &&
    !creating &&
    !hermesBlocked &&
    Boolean(selectedHarnessAdapter)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Agent</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {createError ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Create failed</AlertTitle>
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Review bot"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canCreate) onCreate()
              }}
            />
          </div>

          {showAdapterPicker ? (
            <div className="grid gap-2">
              <Label htmlFor="agent-runtime">Adapter</Label>
              <Select
                value={createRuntime}
                onValueChange={(value) => {
                  if (
                    value === 'claude' ||
                    value === 'codex' ||
                    value === 'hermes'
                  ) {
                    onRuntimeChange(value)
                    onHarnessAdapterChange(value)
                  }
                }}
              >
                <SelectTrigger id="agent-runtime">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {adapters.map((adapter) => (
                    <SelectItem key={adapter.id} value={adapter.id}>
                      {adapter.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {isHermesRuntime ? (
            <ProviderSelector
              providers={hermesProviders}
              defaultProviderId={defaultProviderId}
              selectedId={hermesSelectedProviderId}
              onSelect={onHermesProviderChange}
            />
          ) : null}

          {isClassicHarnessRuntime ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="harness-model">Model</Label>
                <Select
                  value={harnessModelId}
                  onValueChange={onHarnessModelChange}
                >
                  <SelectTrigger id="harness-model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedHarnessAdapter?.models ?? []).map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="harness-effort">Reasoning</Label>
                <Select
                  value={harnessReasoningEffort}
                  onValueChange={onHarnessReasoningChange}
                >
                  <SelectTrigger id="harness-effort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedHarnessAdapter?.reasoningEfforts ?? []).map(
                      (effort) => (
                        <SelectItem key={effort.id} value={effort.id}>
                          {effort.label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button disabled={!canCreate} onClick={onCreate}>
            {creating ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
