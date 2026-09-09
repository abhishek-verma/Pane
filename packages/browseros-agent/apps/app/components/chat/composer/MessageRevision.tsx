import { zodResolver } from '@hookform/resolvers/zod'
import type { UIMessage } from 'ai'
import { Copy, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod/v3'
import { useChatSessionContext } from '@/modules/chat/chat-session-context'
import {
  composerMetadata,
  messageAttachments,
  readableMessageText,
} from '@/modules/chat/composer-message'

const schema = z.object({ text: z.string().trim().min(1, 'Enter a message.') })
export function MessageRevision({ message }: { message: UIMessage }) {
  const session = useChatSessionContext()
  const canRevise =
    session.canSend &&
    session.selectedProvider?.kind !== 'acp' &&
    !['codex', 'claude-code', 'acp-custom'].includes(
      session.selectedProvider?.type ?? '',
    )
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string>()
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { text: readableMessageText(text) },
  })
  if (message.role !== 'user') return null
  function restoreDraft() {
    window.dispatchEvent(
      new CustomEvent('pane:chat-draft', {
        detail: {
          conversationId: session.conversationId,
          text,
          tabs: composerMetadata(message)?.action?.tabs ?? [],
          attachments: messageAttachments(message),
        },
      }),
    )
  }
  return editing ? (
    <form
      className="my-2 space-y-2 rounded-xl border p-3"
      onSubmit={form.handleSubmit(async (values) => {
        setError(undefined)
        try {
          const metadata = composerMetadata(message)
          const action =
            metadata?.action?.type === 'browseros'
              ? { ...metadata.action, message: values.text }
              : metadata?.action
          const outcome = await session.sendComposerMessage({
            text: values.text,
            action,
            attachments: messageAttachments(message),
            mode: metadata?.mode ?? session.mode,
            selection: metadata?.selection,
            revision: {
              conversationId: session.conversationId,
              messageId: message.id,
            },
          })
          if (outcome !== 'done')
            setError(
              'The revised conversation is open. Check its response before retrying.',
            )
          else setEditing(false)
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : 'Could not revise this message.',
          )
        }
      })}
    >
      <textarea
        aria-label="Edit message"
        {...form.register('text')}
        className="min-h-24 w-full resize-y rounded-lg bg-muted/30 p-2 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
      <p className="text-muted-foreground text-xs">
        Starts a revised conversation from this message. The original remains in
        history. Earlier browser and file actions stay as they are.
      </p>
      {(error || form.formState.errors.text) && (
        <p role="alert" className="text-destructive text-xs">
          {error ?? form.formState.errors.text?.message}
        </p>
      )}
      <div className="flex justify-end gap-3 text-xs">
        <button type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={!session.canSend || form.formState.isSubmitting}
          className="rounded-lg bg-foreground px-3 py-2 text-background disabled:opacity-40"
        >
          Save & rerun
        </button>
      </div>
    </form>
  ) : (
    <div className="flex justify-end gap-1 py-1 text-muted-foreground">
      <button
        type="button"
        aria-label="Copy message"
        title="Copy message"
        className="rounded-md p-1.5 hover:bg-muted"
        onClick={() => navigator.clipboard.writeText(readableMessageText(text))}
      >
        <Copy className="size-3" />
      </button>
      <button
        type="button"
        aria-label={canRevise ? 'Edit message' : 'Use message as draft'}
        title={canRevise ? 'Edit message' : 'Use message as draft'}
        className="rounded-md p-1.5 hover:bg-muted"
        onClick={() => (canRevise ? setEditing(true) : restoreDraft())}
      >
        <Pencil className="size-3" />
      </button>
    </div>
  )
}
