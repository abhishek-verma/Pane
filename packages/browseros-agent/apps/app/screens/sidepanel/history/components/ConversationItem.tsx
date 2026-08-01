import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Bot, MessageSquare, Trash2 } from 'lucide-react'
import { type FC, useState } from 'react'
import { Link } from 'react-router'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { backgroundAgentLabel } from '@/lib/conversations/background-agent-label'
import type { HistoryConversation } from './types'

dayjs.extend(relativeTime)

export interface ConversationItemProps {
  conversation: HistoryConversation
  onDelete?: (id: string) => void
  isActive: boolean
}

export const ConversationItem: FC<ConversationItemProps> = ({
  conversation,
  onDelete,
  isActive,
}) => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const label = conversation.lastUserMessage
  const relativeTimeAgo = dayjs(conversation.lastMessagedAt).fromNow()
  const isBackground = Boolean(conversation.isBackground)
  const bgLabel = isBackground
    ? backgroundAgentLabel(conversation.backgroundSource)
    : null

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setShowDeleteDialog(true)
  }

  const handleConfirmDelete = () => {
    onDelete?.(conversation.id)
    setShowDeleteDialog(false)
  }

  return (
    <>
      <Link
        to={`/?conversationId=${conversation.id}`}
        className={`group flex w-full items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/50 ${
          isActive ? 'bg-muted/70' : ''
        }`}
      >
        <div
          className={`mt-0.5 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
        >
          {isBackground ? (
            <Bot className="h-4 w-4" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          {bgLabel ? (
            <p className="font-mono text-[10px] text-[var(--signal)] uppercase tracking-wide">
              {bgLabel}
            </p>
          ) : null}
          <p className="truncate font-medium text-foreground text-sm">
            {label}
          </p>
          <p className="text-muted-foreground text-xs">{relativeTimeAgo}</p>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={handleDeleteClick}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            title="Delete conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </Link>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              conversation and all its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
