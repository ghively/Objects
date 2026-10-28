/**
 * "Delete this space?": deletes a space folder that is not the current one through
 * `POST /api/spaces/delete`. The folder goes to the OS trash; when the trash is unavailable the
 * server answers 428 and the dialog's second step adds "This can't be undone." and sends
 * `permanent: true` with the 428's folder identity token (the server refuses with 409 when the
 * folder was replaced in between, and re-checks it is still the same folder). Either way the space
 * leaves the list. The current space is never offered (switch away from it first; our choice).
 */
import { useEffect, useState } from 'react'
import { api, ConfirmRequiredError } from '@/api/client'
import type { SpaceEntry } from '@/api/types'
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

export const DELETE_SPACE_TEXT = {
  menuItem: 'Delete space', // DeleteHandler.space.fullDeleteButton
  heading: 'Delete this space?', // DeleteHandler.space.heading
  description: 'Deletes the space and everything in it.', // DeleteHandler.space.description
  confirm: 'Delete space', // DeleteHandler.space.fullDeleteButton
  warning: "This can't be undone.", // DeleteHandler.space.warning
  cancel: 'Cancel', // general.cancel
  currentHint: 'Switch to another space to delete this one.', // our string
} as const

const T = DELETE_SPACE_TEXT

export interface DeleteSpaceDialogProps {
  /** The space to delete; `null` closes the dialog. */
  entry: Pick<SpaceEntry, 'path' | 'name'> | null
  onClose(): void
  /** After the folder was trashed (`trashed: true`) or deleted for good. */
  onDeleted(path: string, trashed: boolean): void
}

export function DeleteSpaceDialog({ entry, onClose, onDeleted }: DeleteSpaceDialogProps) {
  const [permanent, setPermanent] = useState(false)
  /** The 428's folder identity token, sent back with the permanent delete. */
  const [folder, setFolder] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPermanent(false)
    setFolder(null)
    setBusy(false)
    setError(null)
  }, [entry?.path])

  const run = async () => {
    if (!entry || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.deleteSpace(
        entry.path,
        permanent ? (folder ? { permanent: true, folder } : { permanent: true }) : {},
      )
      onDeleted(entry.path, res.trashed)
      onClose()
    } catch (e) {
      if (e instanceof ConfirmRequiredError && !permanent) {
        setFolder(e.folder)
        setPermanent(true)
      }
      else setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="border-line bg-raised-2 text-fg" data-step={permanent ? 'permanent' : 'trash'}>
        <AlertDialogHeader>
          <AlertDialogTitle>{T.heading}</AlertDialogTitle>
          <AlertDialogDescription className="text-fg-muted">
            {T.description}
            {entry && (
              <span className="mt-1 block truncate font-mono text-[12px]" title={entry.path}>
                {entry.name} · {entry.path}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {permanent && (
          <p role="note" className="text-[14px] font-semibold text-danger">
            {T.warning}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{T.cancel}</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void run()}>
            {T.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
