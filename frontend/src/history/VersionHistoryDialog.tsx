/**
 * The Version History dialog (M8 Task 5). Mounted once in
 * `shell/GlobalOverlays.tsx`; the object's `…` menu ("Version History") calls
 * `useVersionHistory.open(path)`.
 *
 * Left: the versions, newest first, "Version {number}" with the time and the version's block and
 * property counts. Right: "Select a version" until one is picked, then its read-only preview
 * (`VersionPreview`), or for whiteboards "Preview isn't available". "Restore" asks
 * "Restore this version?" and restores; the open editor's pending save is flushed first and the
 * object's current version is the restore's base. A 409 reloads the list and says
 * "Changed elsewhere. Reloaded." (M5's string).
 *
 * 2026-11-08: below them, "In version control" lists the object's commits in the space's git
 * repository (`vcsApi.fileLog`, following renames) when version control is on; one can be previewed
 * and restored the same way, as a new commit (`vcsApi.fileRestore`).
 *
 * Our choices (listed for Gene): a successful restore closes the dialog after the
 * "Version brought back" toast; counts load in the background for object versions and
 * are left out for whiteboard versions; times show in the Time zone setting with the Language's
 * formatting locale.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import type { VersionInfo } from '@/api/types'
import { vcsApi, type VcsFileVersion } from '@/api/vcsClient'
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
import { formatInZone } from '@/lib/zonedTime'
import { formattingLocale } from '@/properties/format'
import { subject, VCS_TEXT } from '@/vcs/vcsText'
import { useVersionHistory } from './useVersionHistory'
import { blockCountLabel, propertyCountLabel, versionCounts, VersionPreview } from './VersionPreview'

/** The dialog's strings (en-US), plus M5's conflict string. */
export const VERSION_HISTORY = {
  title: 'Version History',
  backToList: 'All versions',
  versionLabel: (n: number) => `Version ${n}`,
  empty: 'No earlier versions',
  emptyDescription: 'Edit this object and its versions start to show up here.',
  fetchError: 'Version history unavailable',
  fetchErrorDescription: "The list of versions didn't load. Try again.",
  previewError: "Version unavailable",
  previewErrorDescription: "This version didn't load. Try again.",
  selectTitle: 'Select a version',
  selectDescription: 'Pick a version on the left to see it here.',
  restoreOnlyTitle: "Preview isn't available",
  restoreOnlyDescription: "Pick a version to bring back. Whiteboard versions can't be previewed.",
  restore: 'Restore',
  restoreConfirmTitle: 'Restore this version?',
  restoreConfirmDescription: (n: number) =>
    `Go back to version ${n}? What you have now is kept as its own version first.`,
  restoreKeepsFiles: 'Brings back the text and property values. Attached files are left alone.',
  restoreConfirmCancel: 'Cancel',
  restoreConfirmConfirm: 'Restore',
  restoreSuccess: 'Version brought back',
  restoreError: "Restore didn't work",
  restoreErrorDescription: "The version couldn't be brought back. Try again.",
  /** M5's string (`references/referencesUi.ts`). */
  changedElsewhere: 'Changed elsewhere. Reloaded.',
} as const

const S = VERSION_HISTORY

type Counts = { blocks: number; properties: number }
type Preview = { id: string; text: string } | { id: string; error: true } | { id: string; loading: true }

/** A version's time, in the Time zone setting and the Language's locale. */
export function formatVersionTime(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  try {
    return formatInZone(d, { dateStyle: 'medium', timeStyle: 'short' }, formattingLocale())
  } catch {
    return d.toLocaleString()
  }
}

export function VersionHistoryDialog() {
  const path = useVersionHistory((s) => s.path)
  const close = useVersionHistory((s) => s.close)
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const [gitVersions, setGitVersions] = useState<VcsFileVersion[]>([])
  const [fetchFailed, setFetchFailed] = useState(false)
  const [counts, setCounts] = useState<Record<string, Counts>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [notice, setNotice] = useState<{ title: string; description?: string } | null>(null)
  const texts = useRef(new Map<string, string>())
  const gen = useRef(0)

  const load = useCallback(async (p: string) => {
    const g = ++gen.current
    setVersions(null)
    setFetchFailed(false)
    vcsApi.fileLog(p).then(
      (git) => g === gen.current && setGitVersions(Array.isArray(git) ? git : []),
      () => g === gen.current && setGitVersions([]),
    )
    let list: VersionInfo[]
    try {
      list = await api.history(p)
    } catch {
      if (g === gen.current) setFetchFailed(true)
      return
    }
    if (g !== gen.current) return
    setVersions(list)
    setSelected((cur) => (cur && (cur.startsWith('git:') || list.some((v) => v.id === cur)) ? cur : null))
    // The counts come from each object version's text, fetched in the background.
    for (const v of list) {
      if (v.kind === 'whiteboard') continue
      const known = texts.current.get(v.id)
      const done = (text: string) => {
        if (g !== gen.current) return
        setCounts((c) => (c[v.id] ? c : { ...c, [v.id]: versionCounts(text) }))
      }
      if (known !== undefined) {
        done(known)
        continue
      }
      api
        .historyVersion(p, v.id)
        .then((res) => {
          if (res && typeof res.text === 'string') {
            texts.current.set(v.id, res.text)
            done(res.text)
          }
        })
        .catch(() => undefined)
    }
  }, [])

  // Opening (or switching objects) starts afresh.
  useEffect(() => {
    gen.current++
    texts.current = new Map()
    setVersions(null)
    setGitVersions([])
    setCounts({})
    setSelected(null)
    setPreview(null)
    setNotice(null)
    setConfirming(false)
    setRestoring(false)
    if (path) void load(path)
  }, [path, load])

  const current = versions?.find((v) => v.id === selected) ?? null
  const currentGit = selected?.startsWith('git:') ? (gitVersions.find((v) => `git:${v.sha}` === selected) ?? null) : null

  // The selected commit's text (version control).
  useEffect(() => {
    if (!path || !currentGit) return
    const id = `git:${currentGit.sha}`
    const known = texts.current.get(id)
    if (known !== undefined) {
      setPreview({ id, text: known })
      return
    }
    let live = true
    setPreview({ id, loading: true })
    vcsApi.file(path, currentGit.sha, currentGit.path).then(
      (res) => {
        if (!live) return
        const text = typeof res?.text === 'string' ? res.text : ''
        texts.current.set(id, text)
        setPreview({ id, text })
      },
      () => live && setPreview({ id, error: true }),
    )
    return () => {
      live = false
    }
  }, [path, currentGit])

  // The selected object version's text.
  useEffect(() => {
    if (currentGit) return
    if (!path || !current || current.kind === 'whiteboard') {
      setPreview(null)
      return
    }
    const id = current.id
    const known = texts.current.get(id)
    if (known !== undefined) {
      setPreview({ id, text: known })
      return
    }
    let live = true
    setPreview({ id, loading: true })
    api
      .historyVersion(path, id)
      .then((res) => {
        if (!live) return
        const text = typeof res?.text === 'string' ? res.text : ''
        texts.current.set(id, text)
        setPreview({ id, text })
      })
      .catch(() => {
        if (live) setPreview({ id, error: true })
      })
    return () => {
      live = false
    }
  }, [path, current, currentGit])

  async function restore() {
    if (path && currentGit) {
      setConfirming(false)
      setRestoring(true)
      setNotice(null)
      try {
        await flushAll().catch(() => undefined)
        const { version } = await api.object(path)
        await vcsApi.fileRestore(path, currentGit.sha, version, currentGit.path)
        showToast(S.restoreSuccess)
        close()
      } catch (err) {
        if (err instanceof ConflictError) {
          setNotice({ title: S.changedElsewhere })
          await load(path)
        } else {
          setNotice({ title: S.restoreError, description: err instanceof Error && err.message ? err.message : S.restoreErrorDescription })
        }
      } finally {
        setRestoring(false)
      }
      return
    }
    if (!path || !current) return
    setConfirming(false)
    setRestoring(true)
    setNotice(null)
    try {
      await flushAll().catch(() => undefined)
      const { version } = await api.object(path)
      await api.restoreVersion(path, current.id, { baseVersion: version })
      showToast(S.restoreSuccess)
      close()
    } catch (err) {
      if (err instanceof ConflictError) {
        setNotice({ title: S.changedElsewhere })
        texts.current = new Map()
        setCounts({})
        await load(path)
      } else {
        setNotice({ title: S.restoreError, description: S.restoreErrorDescription })
      }
    } finally {
      setRestoring(false)
    }
  }

  const open = path !== null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex h-[min(80vh,720px)] flex-col gap-0 p-0 sm:max-w-4xl" data-testid="version-history">
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
          <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r" aria-label={S.backToList}>
            {fetchFailed ? (
              <div className="p-4 text-sm" role="alert">
                <div className="font-medium">{S.fetchError}</div>
                <div className="text-muted-foreground">{S.fetchErrorDescription}</div>
              </div>
            ) : versions === null ? null : versions.length === 0 && gitVersions.length === 0 ? (
              <div className="p-4 text-sm">
                <div className="font-medium">{S.empty}</div>
                <div className="text-muted-foreground">{S.emptyDescription}</div>
              </div>
            ) : (
              <ul role="listbox" aria-label={S.backToList} className="p-2">
                {versions.map((v) => {
                  const c = counts[v.id]
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
                      {c && (
                        <div className="text-xs text-muted-foreground">
                          {blockCountLabel(c.blocks)} · {propertyCountLabel(c.properties)}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {gitVersions.length > 0 && (
              <ul role="listbox" aria-label={VCS_TEXT.gitVersions} className="border-t p-2" data-git-versions="">
                <li role="presentation" className="px-3 pt-1 pb-1 text-xs font-medium text-muted-foreground">
                  {VCS_TEXT.gitVersions}
                </li>
                {gitVersions.map((v) => {
                  const key = `git:${v.sha}`
                  const active = key === selected
                  return (
                    <li
                      key={key}
                      role="option"
                      aria-selected={active}
                      tabIndex={0}
                      data-commit={v.short}
                      onClick={() => setSelected(key)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelected(key)
                        }
                      }}
                      className={`cursor-pointer rounded-md px-3 py-2 text-sm hover:bg-accent ${active ? 'bg-accent' : ''}`}
                    >
                      <div className="font-medium">{VCS_TEXT.gitVersion(v.short)}</div>
                      <div className="text-xs text-muted-foreground">{formatVersionTime(v.at)}</div>
                      <div className="truncate text-xs text-muted-foreground">{subject(v.message)}</div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {currentGit ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b px-6 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">{VCS_TEXT.gitVersion(currentGit.short)}</div>
                    <div className="truncate text-xs text-muted-foreground">{subject(currentGit.message)}</div>
                  </div>
                  <Button size="sm" disabled={restoring} onClick={() => setConfirming(true)}>
                    {S.restore}
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                  {preview && 'error' in preview ? (
                    <div className="text-sm" role="alert">
                      <div className="font-medium">{S.previewError}</div>
                      <div className="text-muted-foreground">{S.previewErrorDescription}</div>
                    </div>
                  ) : preview && 'text' in preview && preview.id === `git:${currentGit.sha}` ? (
                    <VersionPreview path={path ?? ''} versionId={preview.id} text={preview.text} />
                  ) : null}
                </div>
              </>
            ) : current ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b px-6 py-3">
                  <div className="font-medium">{S.versionLabel(current.number)}</div>
                  <Button size="sm" disabled={restoring} onClick={() => setConfirming(true)}>
                    {S.restore}
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                  {current.kind === 'whiteboard' ? (
                    <div className="text-sm">
                      <div className="font-medium">{S.restoreOnlyTitle}</div>
                      <div className="text-muted-foreground">{S.restoreOnlyDescription}</div>
                    </div>
                  ) : preview && 'error' in preview ? (
                    <div className="text-sm" role="alert">
                      <div className="font-medium">{S.previewError}</div>
                      <div className="text-muted-foreground">{S.previewErrorDescription}</div>
                    </div>
                  ) : preview && 'text' in preview && preview.id === current.id ? (
                    <VersionPreview path={path ?? ''} versionId={current.id} text={preview.text} />
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
              <AlertDialogDescription>
                {currentGit ? VCS_TEXT.gitRestoreDescription(currentGit.short) : current ? S.restoreConfirmDescription(current.number) : ''}
              </AlertDialogDescription>
              <p className="text-sm text-muted-foreground">{S.restoreKeepsFiles}</p>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{S.restoreConfirmCancel}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void restore()}>{S.restoreConfirmConfirm}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}

export default VersionHistoryDialog
