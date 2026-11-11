/**
 * M31 item 9: the Version History of a type's, collection's or saved query's definition, in the
 * style of the object's Version History dialog. Opened from Object type settings ("Version
 * History" in the header), a saved query's `…` menu and a collection's `…` menu; each page mounts
 * its own dialog.
 *
 * Left: the versions the app kept before each save (`GET /api/history/definition`), newest first,
 * "Version {number}" with the time. Right: "Select a version" until one is picked, then a summary
 * of the version (name, properties or object types, filters…), what has changed since, and the
 * file itself pretty-printed. "Restore this version" asks "Restore this version?" and restores
 * through the space's own save (`POST /api/history/definition/restore`, revision checked, what is
 * there now kept as a version first); a type version that would remove values asks "Apply
 * changes?" (the type editor's dialog) and is sent again confirmed. A 409 reloads the list and
 * says "Changed elsewhere. Reloaded." (M5's string).
 *
 * Our calls (listed for Gene): the summary and its wording; the button reads "Restore this
 * version"; a restore reloads the definitions at once and closes the dialog after the "Version
 * brought back" toast; a read-only definition (its file can't be read) previews but can't be
 * restored.
 */
import { typeLabel } from '@/lib/typeLabel'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmRequiredError, ConflictError } from '@/api/client'
import { definitionHistoryApi, definitionPath, type DefinitionKind, type DefinitionVersion } from '@/api/d2Api'
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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { showToast } from '@/editor/media/upload'
import { flushAll } from '@/lib/flush'
import { invalidateLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { ConfirmChangesDialog } from '@/object/ConfirmChangesDialog'
import { reloadDefinitions } from '@/types/useDefinitions'
import { formatVersionTime } from './VersionHistoryDialog'
import { prettyDefinition, summarizeDefinition } from './definitionSummary'

const WHAT: Record<DefinitionKind, string> = { types: 'type', collections: 'collection', queries: 'saved search' }

/**
 * The dialog's strings: the object dialog's (`VERSION_HISTORY`) where they fit, written out here
 * because the pages that mount this dialog sit in an import cycle with that module; ours for the rest.
 */
export const DEFINITION_HISTORY = {
  title: 'Version History',
  /** The entry that opens it (type settings header, the query's and collection's `…` menus). */
  menuItem: 'Version History',
  versions: 'All versions',
  versionLabel: (n: number) => `Version ${n}`,
  empty: 'No earlier versions',
  emptyDescription: (kind: DefinitionKind) => `Change this ${WHAT[kind]} and its versions start to show up here.`,
  fetchError: 'Version history unavailable',
  fetchErrorDescription: "The list of versions didn't load. Try again.",
  previewError: 'Version unavailable',
  previewErrorDescription: "This version didn't load. Try again.",
  selectTitle: 'Select a version',
  selectDescription: 'Pick a version on the left to see it here.',
  inVersion: 'In this version',
  changedSince: 'Changed since',
  noChanges: 'Nothing has changed since.',
  file: 'Definition file',
  restore: 'Restore this version',
  restoreConfirmTitle: 'Restore this version?',
  restoreConfirmDescription: (n: number) => `Go back to version ${n}? What you have now is kept as its own version first.`,
  restoreConfirmCancel: 'Cancel',
  restoreConfirmConfirm: 'Restore',
  restoreSuccess: 'Version brought back',
  restoreError: "Restore didn't work",
  restoreErrorDescription: "The version couldn't be brought back. Try again.",
  /** M5's string (`references/referencesUi.ts`). */
  changedElsewhere: 'Changed elsewhere. Reloaded.',
} as const

const S = DEFINITION_HISTORY

type Preview = { id: string; text: string } | { id: string; error: true } | { id: string; loading: true }

export interface DefinitionHistoryDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  kind: DefinitionKind
  id: string
  /** The definition as it is now: compared with the version, and its `revision` is the restore's base. */
  current: { revision?: string } | null | undefined
  /** Restore is off (the definition's file can't be read). */
  readOnly?: boolean
  /** A type id's name in the summary (default: the space's types). */
  typeName?(id: string): string
}

export function DefinitionHistoryDialog({ open, onOpenChange, kind, id, current, readOnly, typeName }: DefinitionHistoryDialogProps) {
  const path = definitionPath(kind, id)
  const types = useLinkIndex((s) => s.types)
  const nameOf = useMemo(() => {
    if (typeName) return typeName
    const names = new Map(types.map((t) => [t.id, typeLabel(t)]))
    return (tid: string) => names.get(tid) ?? tid
  }, [typeName, types])
  const [versions, setVersions] = useState<DefinitionVersion[] | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [ask, setAsk] = useState<{ detail: string; affected: number } | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [notice, setNotice] = useState<{ title: string; description?: string } | null>(null)
  const texts = useRef(new Map<string, string>())
  const gen = useRef(0)

  const load = useCallback(async (p: string) => {
    const g = ++gen.current
    setVersions(null)
    setFetchFailed(false)
    let list: DefinitionVersion[]
    try {
      list = await definitionHistoryApi.versions(p)
    } catch {
      if (g === gen.current) setFetchFailed(true)
      return
    }
    if (g !== gen.current) return
    setVersions(list)
    setSelected((cur) => (cur && list.some((v) => v.id === cur) ? cur : null))
  }, [])

  // Opening (or switching definitions) starts afresh.
  useEffect(() => {
    gen.current++
    texts.current = new Map()
    setVersions(null)
    setSelected(null)
    setPreview(null)
    setNotice(null)
    setConfirming(false)
    setAsk(null)
    setRestoring(false)
    if (open) void load(path)
  }, [open, path, load])

  const picked = versions?.find((v) => v.id === selected) ?? null

  useEffect(() => {
    if (!picked) {
      setPreview(null)
      return
    }
    const vid = picked.id
    const known = texts.current.get(vid)
    if (known !== undefined) {
      setPreview({ id: vid, text: known })
      return
    }
    let live = true
    setPreview({ id: vid, loading: true })
    definitionHistoryApi.version(path, vid).then(
      (res) => {
        if (!live) return
        const text = typeof res?.text === 'string' ? res.text : ''
        texts.current.set(vid, text)
        setPreview({ id: vid, text })
      },
      () => live && setPreview({ id: vid, error: true }),
    )
    return () => {
      live = false
    }
  }, [path, picked])

  const summary = useMemo(() => {
    if (!preview || !('text' in preview)) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(preview.text)
    } catch {
      return null
    }
    return summarizeDefinition(kind, parsed, current ?? null, nameOf)
  }, [preview, kind, current, nameOf])

  async function restore(confirm: boolean) {
    if (!picked) return
    setConfirming(false)
    setAsk(null)
    setRestoring(true)
    setNotice(null)
    try {
      await flushAll().catch(() => undefined)
      await definitionHistoryApi.restore(path, picked.id, current?.revision ?? '', confirm)
      await (kind === 'types' ? invalidateLinkIndex() : reloadDefinitions()).catch(() => undefined)
      showToast(S.restoreSuccess)
      onOpenChange(false)
    } catch (err) {
      if (err instanceof ConfirmRequiredError && !confirm) {
        setAsk({ detail: err.message, affected: err.affected })
      } else if (err instanceof ConflictError) {
        setNotice({ title: S.changedElsewhere })
        texts.current = new Map()
        await (kind === 'types' ? invalidateLinkIndex() : reloadDefinitions()).catch(() => undefined)
        await load(path)
      } else {
        // A refusal's own reason (a read-only file, a version the save turns down) says more.
        const description = err instanceof Error && err.message ? err.message : S.restoreErrorDescription
        setNotice({ title: S.restoreError, description })
      }
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(80vh,720px)] flex-col gap-0 p-0 sm:max-w-4xl" data-testid="definition-history">
        <div className="border-b px-6 py-4">
          <DialogTitle>{S.title}</DialogTitle>
          <DialogDescription className="sr-only">{S.selectDescription}</DialogDescription>
        </div>
        {notice && (
          <div role="status" className="border-b bg-muted px-6 py-2 text-sm">
            <div className="font-medium">{notice.title}</div>
            {notice.description && <div className="text-muted-foreground">{notice.description}</div>}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r">
            {fetchFailed ? (
              <div className="p-4 text-sm" role="alert">
                <div className="font-medium">{S.fetchError}</div>
                <div className="text-muted-foreground">{S.fetchErrorDescription}</div>
              </div>
            ) : versions === null ? null : versions.length === 0 ? (
              <div className="p-4 text-sm">
                <div className="font-medium">{S.empty}</div>
                <div className="text-muted-foreground">{S.emptyDescription(kind)}</div>
              </div>
            ) : (
              <ul role="listbox" aria-label={S.versions} className="p-2">
                {versions.map((v) => {
                  const active = v.id === selected
                  return (
                    <li
                      key={v.id}
                      role="option"
                      aria-selected={active}
                      tabIndex={0}
                      data-version-id={v.id}
                      onClick={() => setSelected(v.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelected(v.id)
                        }
                      }}
                      className={`cursor-pointer rounded-md px-3 py-2 text-sm hover:bg-accent ${active ? 'bg-accent' : ''}`}
                    >
                      <div className="font-medium">{S.versionLabel(v.number)}</div>
                      <div className="text-xs text-muted-foreground">{formatVersionTime(v.at)}</div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {picked ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b px-6 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">{S.versionLabel(picked.number)}</div>
                    <div className="text-xs text-muted-foreground">{formatVersionTime(picked.at)}</div>
                  </div>
                  <Button size="sm" disabled={restoring || readOnly || !preview || !('text' in preview)} onClick={() => setConfirming(true)}>
                    {S.restore}
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm">
                  {preview && 'error' in preview ? (
                    <div role="alert">
                      <div className="font-medium">{S.previewError}</div>
                      <div className="text-muted-foreground">{S.previewErrorDescription}</div>
                    </div>
                  ) : preview && 'text' in preview && preview.id === picked.id ? (
                    <div className="flex flex-col gap-5">
                      {summary && (
                        <>
                          <section aria-label={S.inVersion}>
                            <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{S.inVersion}</h3>
                            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                              {summary.rows.map((r) => (
                                <div key={r.label} className="contents">
                                  <dt className="text-muted-foreground">{r.label}</dt>
                                  <dd className="min-w-0 break-words">{r.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </section>
                          {current && (
                            <section>
                              <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{S.changedSince}</h3>
                              {summary.changes.length === 0 ? (
                                <p className="text-muted-foreground">{S.noChanges}</p>
                              ) : (
                                <ul aria-label={S.changedSince} className="list-disc pl-5">
                                  {summary.changes.map((c) => (
                                    <li key={c}>{c}</li>
                                  ))}
                                </ul>
                              )}
                            </section>
                          )}
                        </>
                      )}
                      <details open={!summary}>
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{S.file}</summary>
                        <pre
                          data-testid="definition-json"
                          className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre"
                        >
                          {prettyDefinition(preview.text)}
                        </pre>
                      </details>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-sm">
                <div className="font-medium">{S.selectTitle}</div>
                <div className="text-muted-foreground">{S.selectDescription}</div>
              </div>
            )}
          </div>
        </div>
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{S.restoreConfirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>{picked ? S.restoreConfirmDescription(picked.number) : ''}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{S.restoreConfirmCancel}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void restore(false)}>{S.restoreConfirmConfirm}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <ConfirmChangesDialog
          open={ask !== null}
          detail={ask?.detail ?? ''}
          affected={ask?.affected ?? 0}
          onConfirm={() => void restore(true)}
          onCancel={() => setAsk(null)}
        />
      </DialogContent>
    </Dialog>
  )
}
