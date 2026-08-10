/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export interface ContextSelectionToolbarProps {
  count: number
  onClear: () => void
  onDelete: () => void
  deleting: boolean
}

export const ContextSelectionToolbar: FC<ContextSelectionToolbarProps> = ({
  count,
  onClear,
  onDelete,
  deleting,
}) => {
  if (count === 0) return null
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
      <span className="text-sm">{count} selected</span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {count} context items?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes them from Pane's indexed context. This can't be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
