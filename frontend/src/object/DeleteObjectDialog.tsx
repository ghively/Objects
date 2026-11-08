/**
 * "Delete this object?": moves the object to the app's Trash (restorable for 30 days; not the
 * computer's own). Its button counts like every other delete button (`deleteObjectsLabel`). The view that owns the object renders it, so the request carries the
 * version the view last saved (`baseVersion`).
 *
 * `requestDelete(path)` (Ctrl+Backspace) asks the view showing `path` to open its dialog.
 */
import { useState } from 'react'
import { create } from 'zustand'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { deleteObjectsLabel } from '@/lib/deleteText'

export const DELETE_OBJECT_TEXT = {
  title: 'Delete this object?',
  description: 'Moves it to the Trash, where it can be restored for 30 days.',
  /** The `…` menu row; the dialog's button is `deleteObjectsLabel(1)`. */
  action: 'Delete object',
}

interface DeleteRequestState {
  /** The object a shortcut asked to delete; `seq` makes repeated requests distinct. */
  request: { path: string; where: 'page' | 'peek'; seq: number } | null
  requestDelete(path: string, where: 'page' | 'peek'): void
  clear(): void
}

export const useDeleteRequest = create<DeleteRequestState>()((set, get) => ({
  request: null,
  requestDelete(path, where) {
    set({ request: { path, where, seq: (get().request?.seq ?? 0) + 1 } })
  },
  clear() {
    set({ request: null })
  },
}))

export interface DeleteObjectDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Do the delete (the owner sends its current `baseVersion`); reject to show the error. */
  onConfirm(): Promise<void>
}

export function DeleteObjectDialog({ open, onOpenChange, onConfirm }: DeleteObjectDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null)
        onOpenChange(o)
      }}
    >
      <AlertDialogContent className="border-line bg-raised-2 text-fg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[17px]">{DELETE_OBJECT_TEXT.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[14px] text-fg-muted">{DELETE_OBJECT_TEXT.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-[13px] text-red-400">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {deleteObjectsLabel(1)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
