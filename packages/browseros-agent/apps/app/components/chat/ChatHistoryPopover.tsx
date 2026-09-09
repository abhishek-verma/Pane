import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Archive, Download, History, Pencil, Pin, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router'
import { z } from 'zod/v3'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  fetchChatHistoryList,
  fetchChatMessagePage,
} from '@/lib/conversations/server-chat-history'
import { useOptionalChatSessionContext } from '@/modules/chat/chat-session-context'

type Preference = { title?: string; pinned?: boolean; archived?: boolean }
const key = 'chat-history-preferences-v1'
export function ChatHistoryPopover() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [archive, setArchive] = useState(false)
  const [editing, setEditing] = useState<string>()
  const rename = useForm<{ title: string }>({
    resolver: zodResolver(z.object({ title: z.string().trim().max(160) })),
  })
  const [preferences, setPreferences] = useState<Record<string, Preference>>({})
  const [error, setError] = useState<string>()
  const [exporting, setExporting] = useState(false)
  const session = useOptionalChatSessionContext()
  const location = useLocation()
  const navigate = useNavigate()
  const history = useQuery({
    queryKey: ['sidepanel-chat-history'],
    queryFn: () => fetchChatHistoryList(),
    enabled: open,
  })
  useEffect(() => {
    void chrome.storage.local
      .get(key)
      .then((value) =>
        setPreferences((value[key] as Record<string, Preference>) ?? {}),
      )
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'local' && changes[key])
        setPreferences(
          (changes[key].newValue as Record<string, Preference>) ?? {},
        )
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])
  async function update(id: string, change: Preference) {
    try {
      await navigator.locks.request(key, async () => {
        const saved =
          ((await chrome.storage.local.get(key))[key] as Record<
            string,
            Preference
          >) ?? {}
        await chrome.storage.local.set({
          [key]: { ...saved, [id]: { ...saved[id], ...change } },
        })
      })
    } catch {
      setError('Could not save the conversation preference. Try again.')
    }
  }
  async function exportChat() {
    if (!session) return
    setExporting(true)
    setError(undefined)
    try {
      let beforeId: string | undefined
      let messages: Awaited<
        ReturnType<typeof fetchChatMessagePage>
      >['messages'] = []
      const seen = new Set<string>()
      for (;;) {
        const page = await fetchChatMessagePage(session.conversationId, {
          beforeId,
          limit: 100,
        })
        messages = [...page.messages, ...messages]
        if (!page.hasMore) break
        const first = page.messages[0]?.id
        if (!first || seen.has(first))
          throw new Error(
            'Could not load the complete conversation. Please try again.',
          )
        seen.add(first)
        beforeId = first
      }
      const markdown = messages
        .map(
          (message) =>
            `## ${message.role === 'user' ? 'You' : 'Pane'}\n\n${message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : part.type === 'file' ? [`[Attachment: ${part.filename ?? 'file'}]`] : [])).join('\n\n')}`,
        )
        .join('\n\n---\n\n')
      const url = URL.createObjectURL(
        new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `Pane-${session.conversationId}.md`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not export this conversation.',
      )
    } finally {
      setExporting(false)
    }
  }
  const items = (history.data ?? [])
    .filter((item) => {
      const pref = preferences[item.id]
      return (
        !!pref?.archived === archive &&
        `${pref?.title ?? ''} ${item.previewText}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
    })
    .sort(
      (a, b) =>
        Number(!!preferences[b.id]?.pinned) -
          Number(!!preferences[a.id]?.pinned) ||
        b.lastMessagedAt - a.lastMessagedAt,
    )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Chat history"
          title="Chat history"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
        >
          <History className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-[min(380px,calc(100vw-24px))] p-2"
      >
        <label className="flex items-center gap-2 px-2 py-2">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and recent prompts"
            aria-label="Search titles and recent prompts"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <div className="flex items-center justify-between border-y px-2 py-2 text-muted-foreground text-xs">
          <button type="button" onClick={() => setArchive(!archive)}>
            {archive ? 'Show recent chats' : 'Show archived'}
          </button>
          {session?.messages.length ? (
            <button
              type="button"
              disabled={exporting}
              onClick={exportChat}
              className="flex items-center gap-1"
            >
              <Download className="size-3" />
              {exporting ? 'Exporting…' : 'Export this chat'}
            </button>
          ) : null}
        </div>
        {(error || history.error) && (
          <p role="alert" className="p-2 text-destructive text-xs">
            {error ?? 'Could not load history.'}
          </p>
        )}
        <div className="max-h-80 overflow-y-auto py-1">
          {history.isLoading ? (
            <p className="p-3 text-muted-foreground text-sm">Loading chats…</p>
          ) : !items.length ? (
            <p className="p-3 text-muted-foreground text-sm">
              {query
                ? 'No matching conversations.'
                : archive
                  ? 'No archived conversations.'
                  : 'No conversations yet.'}
            </p>
          ) : (
            items.map((item) => {
              const pref = preferences[item.id] ?? {}
              const label = pref.title || item.previewText || 'New conversation'
              return (
                <div
                  key={item.id}
                  className="group rounded-lg p-2 hover:bg-muted/60"
                >
                  {editing === item.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={rename.handleSubmit((values) => {
                        void update(item.id, { title: values.title })
                        setEditing(undefined)
                      })}
                    >
                      <input
                        aria-label="Conversation title"
                        {...rename.register('title')}
                        maxLength={160}
                        className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm"
                      />
                      <button type="submit" className="text-xs">
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(undefined)}
                        className="text-xs"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="block w-full truncate text-left text-sm"
                        title={label}
                        onClick={() => {
                          navigate(
                            `${location.pathname.startsWith('/home') ? '/home/chat' : '/'}?conversationId=${item.id}`,
                          )
                          setOpen(false)
                        }}
                      >
                        {pref.pinned ? '📌 ' : ''}
                        {label.replace(/@\[([^\]]+)\]\(tab:\d+\)/g, '@$1')}
                      </button>
                      <div className="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
                        <span className="flex-1">
                          {new Date(item.lastMessagedAt).toLocaleDateString()}
                        </span>
                        <button
                          type="button"
                          aria-label="Rename conversation"
                          title="Rename conversation"
                          onClick={() => {
                            setEditing(item.id)
                            rename.reset({ title: label })
                          }}
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={
                            pref.pinned
                              ? 'Unpin conversation'
                              : 'Pin conversation'
                          }
                          title={
                            pref.pinned
                              ? 'Unpin conversation'
                              : 'Pin conversation'
                          }
                          onClick={() =>
                            update(item.id, { pinned: !pref.pinned })
                          }
                        >
                          <Pin className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={
                            pref.archived
                              ? 'Restore conversation'
                              : 'Archive conversation'
                          }
                          title={
                            pref.archived
                              ? 'Restore conversation'
                              : 'Archive conversation'
                          }
                          onClick={() =>
                            update(item.id, { archived: !pref.archived })
                          }
                        >
                          <Archive className="size-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
