/**
 * The app's own Trash (in `.object/trash/`, not the Windows Recycle Bin): deleted objects and
 * types (a type shows its object count), "Restore", "Delete permanently", and "Empty Trash", which
 * asks the user to type "Delete". Entries are removed after 30 days.
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { TrashItem } from '@/api/types'
import { Icon } from '@/components/Icon'
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
import { COLLECTION_ICON, QUERY_ICON } from '@/lib/defIcons'
import { formatInZone } from '@/lib/zonedTime'
import { invalidateLinkIndex } from '@/links/linkIndex'

export const TRASH_TEXT = {
  heading: 'Trash',
  info: 'Objects and object types are kept in the Trash for 30 days and are then removed completely. This is the app\'s Trash, not the Windows Recycle Bin.',
  empty: 'Trash is empty',
  restore: 'Restore',
  deletePermanently: 'Delete permanently',
  emptyTrash: 'Empty Trash',
  emptyConfirmDescription: (count: number) =>
    `Are you sure you want to permanently delete all ${count} object(s) in trash? This action cannot be undone.`,
  purgeConfirmTitle: 'Permanently delete',
  purgeConfirmDescription: (count: number) =>
    `Are you sure you want to permanently delete ${count} object(s)? This action cannot be undone.`,
  typeToConfirm: 'Type "Delete" to confirm',
  confirmWord: 'Delete',
  objectType: 'Object type',
  collection: 'Collection',
  query: 'Query',
  objects: (n: number) => `${n} object${n === 1 ? '' : 's'}`,
}

const ENTRY_ICON: Partial<Record<TrashItem['kind'], string>> = {
  type: 'ph-shapes',
  collection: COLLECTION_ICON,
  query: QUERY_ICON,
}

/** How many entries go with this one: a type or collection takes its objects with it. */
function entryCount(i: TrashItem): number {
  return i.kind === 'type' || i.kind === 'collection' ? 1 + (i.objectCount ?? 0) : 1
}

function formatDeletedAt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : formatInZone(d, { dateStyle: 'medium', timeStyle: 'short' })
}

export function TrashView() {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [typed, setTyped] = useState('')
  const [purging, setPurging] = useState<TrashItem | null>(null)

  const load = useCallback(() => {
    return api
      .trash()
      .then((ts) => {
        setItems(ts ?? [])
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    setError(null)
    try {
      await fn()
      void invalidateLinkIndex()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      await load()
    }
  }

  /** Objects of a deleted type or collection are restored with it, so they aren't listed on their own. */
  const visible = (items ?? []).filter((i) => i.kind !== 'object' || (!i.typeTrashId && !i.collectionTrashId))
  const total = visible.reduce((n, i) => n + entryCount(i), 0)

  return (
    <div className="w-full">
      <header className="flex items-center gap-2.5 border-b border-line px-4 pt-5 pb-4">
        <Icon name="ph-trash" size={26} />
        <h1 className="text-[24px] font-bold">{TRASH_TEXT.heading}</h1>
        <div className="flex-1" />
        <Button
          variant="destructive"
          size="sm"
          disabled={visible.length === 0 || busy !== null}
          onClick={() => {
            setTyped('')
            setConfirmEmpty(true)
          }}
        >
          {TRASH_TEXT.emptyTrash}
        </Button>
      </header>
      <div className="mx-auto w-full max-w-[1100px] px-10 pt-6 pb-16">
        <p className="mb-4 text-[14px] text-fg-muted">{TRASH_TEXT.info}</p>
        {error && (
          <p role="alert" className="mb-3 text-[13px] text-red-400">
            {error}
          </p>
        )}
        {items && visible.length === 0 && <p className="py-16 text-center font-semibold">{TRASH_TEXT.empty}</p>}
        {visible.length > 0 && (
          <ul aria-label={TRASH_TEXT.heading} className="flex flex-col">
            {visible.map((item) => (
              <li
                key={item.id}
                aria-label={item.title}
                className="flex min-h-12 items-center gap-2.5 border-b border-line/60 px-2 py-1.5 last:border-b-0"
              >
                <Icon name={ENTRY_ICON[item.kind] ?? 'ph-file-text'} size={18} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{item.title}</p>
                  <p className="truncate text-[13px] text-fg-muted">
                    {item.kind === 'type'
                      ? `${TRASH_TEXT.objectType} · ${TRASH_TEXT.objects(item.objectCount ?? 0)}`
                      : item.kind === 'collection'
                        ? `${TRASH_TEXT.collection} · ${TRASH_TEXT.objects(item.objectCount ?? 0)}`
                        : item.kind === 'query'
                          ? TRASH_TEXT.query
                          : `${item.type} · ${item.originalPath}`}
                    {' · '}
                    {formatDeletedAt(item.deletedAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void act(item.id, () => api.restore(item.id))}
                >
                  {TRASH_TEXT.restore}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-400"
                  disabled={busy !== null}
                  onClick={() => setPurging(item)}
                >
                  {TRASH_TEXT.deletePermanently}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AlertDialog open={purging !== null} onOpenChange={(o) => !o && setPurging(null)}>
        <AlertDialogContent className="border-line bg-raised-2 text-fg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px]">{TRASH_TEXT.purgeConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-[14px] text-fg-muted">
              {TRASH_TEXT.purgeConfirmDescription(purging ? entryCount(purging) : 1)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => {
                const item = purging
                setPurging(null)
                if (item) void act(item.id, () => api.purge(item.id))
              }}
            >
              {TRASH_TEXT.deletePermanently}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent className="border-line bg-raised-2 text-fg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px]">{TRASH_TEXT.emptyTrash}</AlertDialogTitle>
            <AlertDialogDescription className="text-[14px] text-fg-muted">
              {TRASH_TEXT.emptyConfirmDescription(total)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex flex-col gap-1 text-[13px] text-fg-muted">
            {TRASH_TEXT.typeToConfirm}
            <input
              aria-label={TRASH_TEXT.typeToConfirm}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="h-8 rounded-md border border-line bg-transparent px-2 text-[14px] text-fg outline-none"
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={typed !== TRASH_TEXT.confirmWord || busy !== null}
              onClick={() => {
                setConfirmEmpty(false)
                void act('*', () => api.emptyTrash())
              }}
            >
              {TRASH_TEXT.emptyTrash}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
