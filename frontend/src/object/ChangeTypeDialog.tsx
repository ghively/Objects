/**
 * "Change object type?": maps each property of the object to a property of the new type (the
 * server suggests a mapping), warns when a mapping loses data and then requires the checkbox,
 * and moves the object. The caller retargets its tab to the returned path.
 */
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { MappingRow, RenameResult, TypeDef } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export const CHANGE_TYPE_TEXT = {
  heading: 'Change object type?',
  description: 'Map each property to the new type. Unmapped data may be lost.',
  mappings: 'Property Mappings',
  lossy: 'This property might not be transferable to the target property, some information might be lost.',
  confirmLoss: 'I know that with this transformation all or parts of my notes will get lost.',
  none: 'Do not transfer',
  action: 'Change type',
}

export interface ChangeTypeDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  path: string
  toType: TypeDef
  /** Flush pending edits; resolves with the `baseVersion` to send. */
  prepare(): Promise<string>
  /** The change failed after `prepare` (rejected, conflict, read-only): release what it paused. */
  onAbort?(err: unknown): void
  onChanged(res: RenameResult): void
}

export function ChangeTypeDialog({ open, onOpenChange, path, toType, prepare, onAbort, onChanged }: ChangeTypeDialogProps) {
  const [rows, setRows] = useState<MappingRow[] | null>(null)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setRows(null)
    setAccepted(false)
    setError(null)
    api
      .suggestMapping(path, toType.id)
      .then((rs) => {
        if (!alive) return
        setRows(rs)
        setMapping(Object.fromEntries(rs.map((r) => [r.fromKey, r.toKey])))
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [open, path, toType.id])

  /** A row loses data when it keeps a lossy suggestion, or maps to a target the server didn't suggest. */
  const lossyRows = useMemo(() => {
    const out = new Set<string>()
    for (const r of rows ?? []) {
      const to = mapping[r.fromKey] ?? null
      if (to === null) continue
      if (to !== r.toKey || r.lossy) out.add(r.fromKey)
    }
    return out
  }, [rows, mapping])
  const lossy = lossyRows.size > 0

  /** The new type's properties, plus any suggested key it doesn't define (a reserved key). */
  const targets = useMemo(() => {
    const out = toType.propertyDefinitions.map((p) => ({ key: p.key, name: p.name }))
    for (const r of rows ?? []) {
      if (r.toKey && !out.some((t) => t.key === r.toKey)) out.push({ key: r.toKey, name: r.toKey })
    }
    return out
  }, [toType.propertyDefinitions, rows])

  const submit = async () => {
    setBusy(true)
    setError(null)
    let prepared = false
    try {
      const baseVersion = await prepare()
      prepared = true
      const res = await api.changeType(path, toType.id, mapping, baseVersion)
      onOpenChange(false)
      onChanged(res)
    } catch (err) {
      if (prepared) onAbort?.(err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))] border-line bg-raised-2 text-fg">
        <DialogHeader>
          <DialogTitle className="text-[17px]">{CHANGE_TYPE_TEXT.heading}</DialogTitle>
          <DialogDescription className="text-[14px] text-fg-muted">{CHANGE_TYPE_TEXT.description}</DialogDescription>
        </DialogHeader>
        {rows && rows.length > 0 && (
          <section aria-label={CHANGE_TYPE_TEXT.mappings} className="flex flex-col gap-1.5">
            <h3 className="text-[13px] font-semibold text-fg-muted">{CHANGE_TYPE_TEXT.mappings}</h3>
            {rows.map((r) => (
              <div key={r.fromKey} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2 text-[14px]">
                  <span className="min-w-0 flex-1 truncate">{r.fromKey}</span>
                  <span aria-hidden className="text-fg-muted">
                    →
                  </span>
                  <select
                    aria-label={`Map ${r.fromKey}`}
                    value={mapping[r.fromKey] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [r.fromKey]: e.target.value || null }))}
                    className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-[14px]"
                  >
                    <option value="">{CHANGE_TYPE_TEXT.none}</option>
                    {targets.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {lossyRows.has(r.fromKey) && <p className="text-[12px] text-amber-400">{CHANGE_TYPE_TEXT.lossy}</p>}
              </div>
            ))}
          </section>
        )}
        {lossy && (
          <label className="flex items-start gap-2 text-[14px]">
            <Checkbox
              aria-label={CHANGE_TYPE_TEXT.confirmLoss}
              checked={accepted}
              onCheckedChange={(v) => setAccepted(v === true)}
              className="mt-0.5"
            />
            <span>{CHANGE_TYPE_TEXT.confirmLoss}</span>
          </label>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-red-400">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || rows === null || (lossy && !accepted)} onClick={() => void submit()}>
            {CHANGE_TYPE_TEXT.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
