// The collection dialogs: create, delete (with the Trash note) and "Remove from collection?".
import { useEffect, useState } from 'react'
import { api, ConfirmRequiredError } from '@/api/client'
import type { Collection, DeleteCollectionResult } from '@/api/types'
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
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { deleteObjectsLabel } from '@/lib/deleteText'
import { invalidateLinkIndex } from '@/links/linkIndex'

export const COLLECTION_DIALOG_TEXT = {
  createTitle: 'New collection',
  createTooltip: 'Sort notes of this type into collections; a note can sit in more than one.',
  defaultName: 'New Collection',
  deleteTitle: 'Delete this collection?',
  deleteBody:
    'Its entries are deleted with it, except those that also belong to another collection, which stay there.',
  deleteTrash: 'Everything moves to the Trash, where you can restore it for 30 days.',
  deleteAction: 'Delete collection',
  removeTitle: 'Remove from collection?',
  removeBody: 'Take it out of just this collection, or use the option below to delete it everywhere.',
  removeAction: 'Remove from collection',
}

/** "{n} note(s) couldn't be updated and still list this collection." (our string) */
export function skippedMessage(n: number): string {
  return `${n} ${n === 1 ? 'note' : 'notes'} couldn't be updated and still list this collection.`
}

/** "Delete {count} object(s)": the shared wording. */
export { deleteObjectsLabel }

// ---------------------------------------------------------------------------------------------

export interface CreateCollectionDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** The object type the collection holds. */
  typeId?: string
  onCreated?(collection: Collection): void
}

export function CreateCollectionDialog({ open, onOpenChange, typeId, onCreated }: CreateCollectionDialogProps) {
  const [name, setName] = useState(COLLECTION_DIALOG_TEXT.defaultName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(COLLECTION_DIALOG_TEXT.defaultName)
      setError(null)
    }
  }, [open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const c = await api.createCollection(name.trim() || COLLECTION_DIALOG_TEXT.defaultName, typeId ? [typeId] : [])
      onOpenChange(false)
      onCreated?.(c)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{COLLECTION_DIALOG_TEXT.createTitle}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{COLLECTION_DIALOG_TEXT.createTooltip}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <input
            autoFocus
            aria-label="Collection name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 rounded-md border border-line bg-transparent px-2 text-[15px] outline-none focus:border-fg-muted"
          />
          {error && (
            <p role="alert" className="text-[13px] text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {COLLECTION_DIALOG_TEXT.createTitle}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------------------------

export interface DeleteCollectionDialogProps {
  collection: Pick<Collection, 'id' | 'name'>
  open: boolean
  onOpenChange(open: boolean): void
  /** The collection went to the Trash (before any "couldn't be updated" note is read). */
  onDeleted?(result: DeleteCollectionResult): void
}

/**
 * "Delete this collection?" The affected count comes from the server's 428
 * (it refuses a delete without `confirm`); the confirmed request then moves everything to the Trash.
 */
export function DeleteCollectionDialog({ collection, open, onOpenChange, onDeleted }: DeleteCollectionDialogProps) {
  const [affected, setAffected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DeleteCollectionResult | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setAffected(null)
    setError(null)
    setResult(null)
    api
      .deleteCollection(collection.id)
      .then((res) => {
        // The server did not ask for a confirmation: it is done.
        if (!alive) return
        setResult(res)
        void invalidateLinkIndex()
        onDeleted?.(res)
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof ConfirmRequiredError) setAffected(e.affected)
        else setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open, collection.id])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.deleteCollection(collection.id, { confirm: true })
      setResult(res)
      void invalidateLinkIndex()
      onDeleted?.(res)
      if (res.skipped.length === 0) onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const skipped = result?.skipped ?? []

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-line bg-raised-2 text-fg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[17px]">{COLLECTION_DIALOG_TEXT.deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription className="text-[14px] text-fg-muted">
            {result ? `Deleted ${collection.name}.` : `${COLLECTION_DIALOG_TEXT.deleteBody} ${COLLECTION_DIALOG_TEXT.deleteTrash}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!result && affected !== null && (
          <p className="text-[14px]">
            {affected === 1 ? '1 note is affected.' : `${affected} notes are affected.`}
          </p>
        )}
        {skipped.length > 0 && (
          <div role="status" className="text-[13px]">
            <p>{skippedMessage(skipped.length)}</p>
            <ul className="mt-1 list-disc pl-5 text-fg-muted">
              {skipped.map((s) => (
                <li key={s.path}>{s.path}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-red-400">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          {result ? (
            <AlertDialogCancel>Close</AlertDialogCancel>
          ) : (
            <>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busy || affected === null}
                onClick={(e) => {
                  e.preventDefault()
                  void confirm()
                }}
              >
                {COLLECTION_DIALOG_TEXT.deleteAction}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------------------------

export interface RemoveFromCollectionDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** How many objects the request covers. */
  count: number
  onRemove(): void | Promise<void>
  /** Delete the objects everywhere (to the Trash). */
  onDelete(): void | Promise<void>
}

/** "Remove from collection?": remove here, or delete everywhere. */
export function RemoveFromCollectionDialog({ open, onOpenChange, count, onRemove, onDelete }: RemoveFromCollectionDialogProps) {
  const [busy, setBusy] = useState(false)
  const run = async (job: () => void | Promise<void>) => {
    setBusy(true)
    try {
      await job()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-line bg-raised-2 text-fg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[17px]">{COLLECTION_DIALOG_TEXT.removeTitle}</AlertDialogTitle>
          <AlertDialogDescription className="text-[14px] text-fg-muted">{COLLECTION_DIALOG_TEXT.removeBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="outline" disabled={busy} onClick={() => void run(onRemove)}>
            {COLLECTION_DIALOG_TEXT.removeAction}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void run(onDelete)}>
            {deleteObjectsLabel(count)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
