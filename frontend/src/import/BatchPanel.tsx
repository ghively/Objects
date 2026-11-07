// M25: what the finish step shows about the batch: the counts that reconcile, "Removed at source",
// "Move batch to Trash" and, for objects changed at the source and edited in Object, "Take source" /
// "Keep mine" per item or for all (design sections 5, 7 and 10). The batch lives in the space the
// import went into, so the actions are offered only when that is the open space.
import { useCallback, useEffect, useState } from 'react'
import { announceResync, api } from '@/api/client'
import type { ImportBatchItem, ImportResult } from '@/api/types'
import { Button } from '@/components/ui/button'
import { IMPORT_TEXT as T } from './text'

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function BatchPanel({ result, inOpenSpace }: { result: ImportResult; inOpenSpace: boolean }) {
  const batch = result.batch ?? null
  const [pending, setPending] = useState<ImportBatchItem[]>([])
  const [confirming, setConfirming] = useState(false)
  const [moved, setMoved] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const conflicts = result.changedInBoth ?? 0

  const load = useCallback(() => {
    if (!batch || !inOpenSpace || conflicts === 0) return
    api
      .importBatch(batch)
      .then((r) => setPending(r.items.filter((i) => i.action === 'conflict')))
      .catch((err: unknown) => setError(message(err)))
  }, [batch, inOpenSpace, conflicts])
  useEffect(load, [load])

  if (!batch) return null

  const resolve = async (action: 'take' | 'keep', paths?: string[]) => {
    setBusy(true)
    setError(null)
    try {
      await api.resolveImportBatch(batch, action, paths)
      announceResync()
      load()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  const moveToTrash = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.trashImportBatch(batch)
      announceResync()
      setMoved(r.trashed)
      setConfirming(false)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="batch-panel">
      <p className="text-[13px]">{T.accountedFor({ ...result, sourceItems: result.sourceItems ?? 0 })}</p>
      {(result.removed ?? 0) > 0 && <p className="text-[13px] text-fg-muted">{T.removedAtSource(result.removed ?? 0)}</p>}

      {inOpenSpace && pending.length > 0 && (
        <section aria-labelledby="import-both-heading" className="flex flex-col gap-2">
          <h4 id="import-both-heading" className="text-[14px] font-semibold">
            {T.changedInBothHeading}
          </h4>
          <p className="text-[13px] text-fg-muted">{T.changedInBothNote}</p>
          <ul className="flex flex-col gap-1">
            {pending.map((it) => (
              <li key={it.path ?? it.sourcePath} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate" title={it.path ?? undefined}>
                  {it.title}
                </span>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void resolve('take', [it.path ?? ''])}>
                  {T.takeSource}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void resolve('keep', [it.path ?? ''])}>
                  {T.keepMine}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void resolve('take')}>
              {T.takeAll}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void resolve('keep')}>
              {T.keepAll}
            </Button>
          </div>
        </section>
      )}

      {inOpenSpace && result.objects > 0 && moved === null && !confirming && (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
            {T.moveBatch}
          </Button>
        </div>
      )}
      {confirming && (
        <div role="group" aria-label={T.moveBatch} className="flex items-center gap-2 text-[13px]">
          <span>{T.moveBatchConfirm(result.objects)}</span>
          <Button type="button" size="sm" disabled={busy} onClick={() => void moveToTrash()}>
            {T.moveBatchDo}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            {T.cancel}
          </Button>
        </div>
      )}
      {moved !== null && <p role="status" className="text-[13px]">{T.moveBatchDone(moved)}</p>}
      {!inOpenSpace && result.objects > 0 && <p className="text-[12px] text-fg-muted">{T.moveBatchOther}</p>}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
