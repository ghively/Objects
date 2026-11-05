/**
 * "Delete this object type?": moves the type, its objects, its templates and the saved queries of
 * only this type to the app's Trash (restorable for 30 days; other queries drop the type until
 * it is restored), so "This can't be undone." is not shown.
 */
import { useState } from 'react'
import { api } from '@/api/client'
import type { TypeDef } from '@/api/types'
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
import { invalidateLinkIndex } from '@/links/linkIndex'

export const DELETE_TYPE_TEXT = {
  title: 'Delete this object type?',
  // The saved-queries part is our string (what a type delete does to queries is our choice).
  description:
    'Moves the type, all its objects, its templates and the saved queries of only this type to the Trash; other queries stop using it. You can restore them from there for 30 days.',
  action: 'Delete object type',
}

export interface DeleteTypeDialogProps {
  type: Pick<TypeDef, 'id' | 'name'>
  open: boolean
  onOpenChange(open: boolean): void
  /** After the type went to the Trash. */
  onDeleted?(trashId: string): void
}

export function DeleteTypeDialog({ type, open, onOpenChange, onDeleted }: DeleteTypeDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      // The dialog is the confirmation, so the request says so (no 428 round trip).
      const res = await api.deleteType(type.id, { confirm: true })
      onOpenChange(false)
      void invalidateLinkIndex()
      onDeleted?.(res.trashId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-line bg-raised-2 text-fg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[17px]">{DELETE_TYPE_TEXT.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[14px] text-fg-muted">{DELETE_TYPE_TEXT.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-[13px] text-red-400">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            {DELETE_TYPE_TEXT.action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
