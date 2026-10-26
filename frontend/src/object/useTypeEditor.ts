/**
 * Edits one type definition: saves it with `baseRevision`, adopts the revision each response
 * returns, asks before a change that rewrites objects' values (428: an AlertDialog with the
 * server's `detail` and `affected`, then a resend with `confirm`), and on a revision conflict
 * (409) reloads the index and reports the error.
 *
 * Saves are serialized, so two quick edits never race each other's revision. The caller renders
 * `dialog` (the confirmation) somewhere in its tree.
 */
import { createElement, useCallback, useRef, useState, type ReactElement } from 'react'
import { api, ConfirmRequiredError, RevisionConflictError } from '@/api/client'
import type { ChangeKindResult, PropertyType, SaveTypeResult, SyncResult, TypeDef } from '@/api/types'
import { invalidateLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { ConfirmChangesDialog } from './ConfirmChangesDialog'

export interface TypeEditor {
  type: TypeDef | undefined
  /** Save `next`; resolves null when it was cancelled or failed (see `error`). */
  save(next: TypeDef, opts?: { confirm?: boolean }): Promise<SaveTypeResult | null>
  /** "Change property type": a new property of `toType` with converted values. */
  changeKind(propertyId: string, toType: PropertyType): Promise<ChangeKindResult | null>
  /** Two-way link an entity property (`null` unlinks; `createName` creates the target property). */
  setSync(propertyId: string, targetPropertyId: string | null, createName?: string): Promise<SyncResult | null>
  /** The last failure, if any. */
  error: string | null
  /** The 428 confirmation; render it. */
  dialog: ReactElement
}

interface Ask {
  detail: string
  affected: number
  resolve(ok: boolean): void
}

/** Put a saved type into the index, so every view shows it (and its revision) at once. */
function adoptType(t: TypeDef) {
  useLinkIndex.setState((s) => ({
    types: s.types.some((x) => x.id === t.id) ? s.types.map((x) => (x.id === t.id ? t : x)) : [...s.types, t],
    revision: s.revision + 1,
  }))
}

export function useTypeEditor(typeId: string | undefined | null): TypeEditor {
  const type = useLinkIndex((s) => (typeId ? s.types.find((t) => t.id === typeId) : undefined))
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const chainRef = useRef<Promise<unknown>>(Promise.resolve())

  const revision = useCallback(
    (id: string) => useLinkIndex.getState().types.find((t) => t.id === id)?.revision ?? '',
    [],
  )

  const confirm = useCallback(
    (detail: string, affected: number) =>
      new Promise<boolean>((resolve) => {
        setAsk({ detail, affected, resolve })
      }),
    [],
  )

  /** Run `attempt` after earlier saves, handling 428 (ask, then retry confirmed), 409 and errors. */
  const run = useCallback(
    <T>(attempt: (confirmed: boolean) => Promise<T>, confirmed = false): Promise<T | null> => {
      const go = async (): Promise<T | null> => {
        setError(null)
        let ok = confirmed
        for (;;) {
          try {
            return await attempt(ok)
          } catch (err) {
            if (err instanceof ConfirmRequiredError && !ok) {
              ok = await confirm(err.message, err.affected)
              if (!ok) return null
              continue
            }
            if (err instanceof RevisionConflictError) {
              setError('The type was changed elsewhere. It has been reloaded; try again.')
              await invalidateLinkIndex()
              return null
            }
            setError(err instanceof Error ? err.message : String(err))
            return null
          }
        }
      }
      const p = chainRef.current.then(go, go)
      chainRef.current = p.catch(() => undefined)
      return p
    },
    [confirm],
  )

  const save = useCallback(
    (next: TypeDef, opts?: { confirm?: boolean }) =>
      run(async (confirmed) => {
        const res = await api.saveType(next, {
          baseRevision: revision(next.id) || next.revision,
          ...(confirmed ? { confirm: true } : {}),
        })
        if (res?.type) adoptType(res.type)
        return res
      }, opts?.confirm ?? false),
    [run, revision],
  )

  const changeKind = useCallback(
    (propertyId: string, toType: PropertyType) =>
      run(async () => {
        if (!typeId) throw new Error('No type')
        const res = await api.changePropertyKind(typeId, propertyId, toType, revision(typeId))
        if (res?.type) adoptType(res.type)
        return res
      }),
    [run, revision, typeId],
  )

  const setSync = useCallback(
    (propertyId: string, targetPropertyId: string | null, createName?: string) =>
      run(async () => {
        if (!typeId) throw new Error('No type')
        const res = await api.setPropertySync(typeId, propertyId, targetPropertyId, revision(typeId), createName)
        for (const t of res?.types ?? []) adoptType(t)
        return res
      }),
    [run, revision, typeId],
  )

  const close = (ok: boolean) => {
    const a = ask
    setAsk(null)
    a?.resolve(ok)
  }

  const dialog = createElement(ConfirmChangesDialog, {
    open: ask !== null,
    detail: ask?.detail ?? '',
    affected: ask?.affected ?? 0,
    onConfirm: () => close(true),
    onCancel: () => close(false),
  })

  return { type, save, changeKind, setSync, error, dialog }
}
