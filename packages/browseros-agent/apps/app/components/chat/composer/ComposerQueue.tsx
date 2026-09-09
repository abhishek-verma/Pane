import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Pause,
  Pencil,
  Play,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod/v3'
import { readableMessageText } from '@/modules/chat/composer-message'
import type { ChatComposerController } from '@/modules/chat/use-chat-composer'

export function ComposerQueue({
  composer,
}: {
  composer: ChatComposerController
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string>()
  const form = useForm<{ text: string }>({
    resolver: zodResolver(z.object({ text: z.string() })),
  })
  const { queue, paused, note } = composer.state
  if (!queue.length) return null
  const pending = queue.filter((item) => item.state !== 'sending')
  return (
    <div className="mb-2 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
        >
          <ChevronDown
            className={`size-3 shrink-0 ${open ? 'rotate-180' : ''}`}
          />
          <span className="shrink-0">
            {pending.length
              ? `${pending.length} ${paused ? 'paused' : 'queued'}`
              : 'Sending'}
          </span>
          <span className="truncate">
            {readableMessageText(
              pending[0]?.message.text ?? queue[0].message.text,
            ) || 'Attachments'}
          </span>
        </button>
        {pending.length > 0 && (
          <button
            type="button"
            onClick={() => (paused ? composer.resume() : composer.pause())}
            aria-label={paused ? 'Resume queue' : 'Pause queue'}
            title={paused ? 'Resume queue' : 'Pause queue'}
            className="rounded p-1 hover:bg-muted"
          >
            {paused ? (
              <Play className="size-3" />
            ) : (
              <Pause className="size-3" />
            )}
          </button>
        )}
      </div>
      {(open || note) && (
        <div className="space-y-2 rounded-xl border border-border/60 p-3">
          {note && (
            <p role="status" className="text-muted-foreground">
              {note}
            </p>
          )}
          {queue.map((item) => (
            <div key={item.id} className="flex items-start gap-2">
              {editing === item.id ? (
                <form
                  className="flex-1"
                  onSubmit={form.handleSubmit((values) => {
                    if (
                      !values.text.trim() &&
                      !item.message.attachments?.length
                    )
                      return
                    void composer.edit(item.id, values.text)
                    setEditing(undefined)
                  })}
                >
                  <textarea
                    aria-label="Edit queued message"
                    {...form.register('text')}
                    className="min-h-20 w-full resize-y rounded-lg border bg-background p-2 text-sm"
                  />
                  <div className="mt-1 flex justify-end gap-3">
                    <button type="button" onClick={() => setEditing(undefined)}>
                      Cancel
                    </button>
                    <button type="submit" className="font-medium">
                      Save
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-3 whitespace-pre-wrap">
                      {readableMessageText(item.message.text) ||
                        'Review attachments'}
                    </p>
                    {!!item.message.attachments?.length && (
                      <span className="text-muted-foreground">
                        {item.message.attachments.length} attachments
                      </span>
                    )}
                    {item.state === 'review' && (
                      <button
                        type="button"
                        onClick={() => composer.restore(item.id)}
                        className="mt-1 block underline"
                      >
                        Restore to draft
                      </button>
                    )}
                  </div>
                  {item.state === 'sending' ? (
                    <span className="text-muted-foreground">Sending…</span>
                  ) : (
                    <div className="flex gap-1">
                      {item.state === 'queued' && (
                        <>
                          <button
                            type="button"
                            title="Move earlier"
                            aria-label="Move earlier"
                            onClick={() => composer.move(item.id, -1)}
                            className="p-1"
                          >
                            <ArrowUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            title="Move later"
                            aria-label="Move later"
                            onClick={() => composer.move(item.id, 1)}
                            className="p-1"
                          >
                            <ArrowDown className="size-3" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        aria-label="Edit queued message"
                        onClick={() => {
                          setEditing(item.id)
                          form.reset({
                            text: readableMessageText(item.message.text),
                          })
                        }}
                        className="p-1"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Remove queued message"
                        onClick={() => composer.remove(item.id)}
                        className="p-1"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Queued on this device. Keep Pane chat open to send automatically.
          </p>
        </div>
      )}
    </div>
  )
}
