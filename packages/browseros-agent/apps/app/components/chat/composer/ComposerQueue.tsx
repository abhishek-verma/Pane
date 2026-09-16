import { ArrowDown, ArrowUp, ChevronDown, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import { readableMessageText } from '@/modules/chat/composer-message'
import type { ChatComposerController } from '@/modules/chat/use-chat-composer'

export function ComposerQueue({
  composer,
}: {
  composer: ChatComposerController
}) {
  const [open, setOpen] = useState(true)
  const { queue, paused, note } = composer.state
  const pending = queue.filter((item) => item.state !== 'sending')
  if (!pending.length) return null

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
          <span className="shrink-0">{pending.length} queued</span>
          {!open && (
            <span className="truncate">
              {readableMessageText(pending[0].message.text) || 'Attachments'}
            </span>
          )}
        </button>
        {paused && !pending.some((item) => item.state === 'review') && (
          <button
            type="button"
            onClick={() => composer.resume()}
            className="rounded px-2 py-1 hover:bg-muted"
          >
            Send queued
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
          {pending.map((item, index) => (
            <div key={item.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 whitespace-pre-wrap">
                  {readableMessageText(item.message.text) ||
                    'Review attachments'}
                </p>
                {!!item.message.attachments?.length && (
                  <span className="text-muted-foreground">
                    {item.message.attachments.length} attachments
                  </span>
                )}
                {item.state === 'review' && (
                  <p className="text-muted-foreground">
                    Edit to retry, or remove
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {item.state === 'queued' && pending.length > 1 && (
                  <>
                    <button
                      type="button"
                      title="Move earlier"
                      aria-label="Move earlier"
                      disabled={index === 0}
                      onClick={() => composer.move(item.id, -1)}
                      className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      title="Move later"
                      aria-label="Move later"
                      disabled={index === pending.length - 1}
                      onClick={() => composer.move(item.id, 1)}
                      className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowDown className="size-3" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  title="Edit in composer"
                  aria-label="Edit queued message"
                  onClick={() => composer.restore(item.id)}
                  className="rounded p-1 hover:bg-muted"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  title="Remove queued message"
                  aria-label="Remove queued message"
                  onClick={() => composer.remove(item.id)}
                  className="rounded p-1 hover:bg-muted"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          ))}
          {!paused && (
            <p className="text-[11px] text-muted-foreground">
              Sends automatically after the current response.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
