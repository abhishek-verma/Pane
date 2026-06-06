import type { FC } from 'react'
import { NewAgentDialog } from '@/entrypoints/app/agents/NewAgentDialog'
import type { CodingAgentsController } from './useCodingAgents'

/**
 * Shared New Agent dialog opened from provider-template cards. Agent rows live
 * with configured LLM providers in `CodingAgentsList`; the dialog stays mounted
 * here so creation works regardless of whether any agents already exist.
 */
export const CodingAgentsManager: FC<{
  controller: CodingAgentsController
}> = ({ controller }) => {
  const {
    createOpen,
    createAdapter,
    createAdapterId,
    newName,
    modelId,
    reasoningEffort,
    createError,
    creating,
    closeCreate,
    handleCreate,
    setNewName,
    setModelId,
    setReasoningEffort,
  } = controller

  return (
    <NewAgentDialog
      adapters={createAdapter ? [createAdapter] : []}
      createError={createError}
      createRuntime={createAdapterId ?? 'claude'}
      creating={creating}
      defaultProviderId=""
      harnessAdapterId={createAdapterId ?? 'claude'}
      harnessModelId={modelId}
      harnessReasoningEffort={reasoningEffort}
      hermesProviders={[]}
      hermesSelectedProviderId=""
      name={newName}
      open={createOpen}
      onCreate={handleCreate}
      onOpenChange={(open) => {
        if (!open) closeCreate()
      }}
      onRuntimeChange={() => {}}
      onHarnessAdapterChange={() => {}}
      onHarnessModelChange={setModelId}
      onHarnessReasoningChange={setReasoningEffort}
      onHermesProviderChange={() => {}}
      onNameChange={setNewName}
    />
  )
}
