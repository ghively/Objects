// "Space history" (2026-11-08): the open space's git history. Left, the commits newest first
// (time, message, how many files changed); right, the picked commit's changes as text diffs, per
// file, and "Restore space to this point", which puts every file back as it was in that commit as
// a NEW commit (pending changes are committed first; history is never rewritten). Reached from the
// spaces menu, the command palette, Settings > Version control and the sidebar's backup line.
import { useCallback, useEffect, useState } from 'react'
import { vcsApi, type VcsCommit, type VcsFileDiff } from '@/api/vcsClient'
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
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { showToast } from '@/editor/media/upload'
import { flushAll } from '@/lib/flush'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { useVcsStatus } from './useVcsStatus'
import { formatWhen, subject, VCS_TEXT } from './vcsText'

const T = VCS_TEXT
const PAGE = 50

function lineClass(line: string): string {
  if (line.startsWith('+')) return 'bg-[var(--label-bg-green)]'
  if (line.startsWith('-')) return 'bg-[var(--label-bg-red)]'
  if (line.startsWith('@@')) return 'text-fg-muted'
  return ''
}

function FileDiff({ file }: { file: VcsFileDiff }) {
  return (
    <section aria-label={file.path} className="flex flex-col gap-1" data-diff-path={file.path}>
      <h3 className="text-[14px] font-semibold text-fg">
        <span className="mr-2 rounded-full bg-hover px-2 py-0.5 text-[12px] font-medium text-fg-muted">{file.status}</span>
        {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      </h3>
      {file.binary ? (
        <p className="text-[13px] text-fg-muted">{T.binary}</p>
      ) : (
        <pre className="overflow-x-auto rounded-md border border-line bg-raised p-2 font-mono text-[12px] leading-5 text-fg">
          {file.diff
            .split('\n')
            .filter((l) => l !== '\\ No newline at end of file')
            .map((l, i) => (
              <div key={i} className={lineClass(l)}>
                {l || ' '}
              </div>
            ))}
        </pre>
      )}
      {file.truncated && <p className="text-[12px] text-fg-muted">{T.truncated}</p>}
    </section>
  )
}

export function SpaceHistoryPage() {
  const status = useVcsStatus((s) => s.space)
  const [commits, setCommits] = useState<VcsCommit[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ sha: string; files: VcsFileDiff[] } | { sha: string; error: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await vcsApi.log(0, PAGE)
      setCommits(res?.commits ?? [])
      setMore(!!res?.more)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCommits([])
    }
  }, [])

  useEffect(() => {
    void useVcsStatus.getState().refresh()
    void load()
  }, [load])

  useEffect(() => {
    if (!selected) {
      setDiff(null)
      return
    }
    let live = true
    vcsApi.diff(selected).then(
      (res) => live && setDiff({ sha: selected, files: res?.files ?? [] }),
      (e: unknown) => live && setDiff({ sha: selected, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
  }, [selected])

  const loadMore = async () => {
    const res = await vcsApi.log(commits?.length ?? 0, PAGE).catch(() => null)
    if (!res) return
    setCommits((c) => [...(c ?? []), ...res.commits])
    setMore(res.more)
  }

  const current = commits?.find((c) => c.sha === selected) ?? null

  async function restore() {
    if (!current) return
    setConfirming(false)
    setRestoring(true)
    setError(null)
    try {
      await flushAll().catch(() => undefined)
      const res = await vcsApi.restore(current.sha)
      if (res?.status) useVcsStatus.getState().set(res.status)
      showToast(res?.commit ? T.restored : T.nothingToRestore)
      setSelected(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRestoring(false)
    }
  }

  const off = status !== null && (!status.gitAvailable || !status.enabled)

  return (
    <div className="flex h-full min-h-0 flex-col" data-space-history="">
      <header className="flex items-start gap-3 border-b border-line px-6 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-fg">
          <Icon name="ph-clock-counter-clockwise" size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[20px] leading-7 font-semibold text-fg">{T.historyTitle}</h1>
          <p className="text-[14px] text-fg-muted">{T.historyDescription}</p>
        </div>
      </header>
      {error && (
        <p role="alert" className="border-b border-line px-6 py-2 text-[14px] text-[var(--danger)]">
          {error}
        </p>
      )}
      {off && (commits?.length ?? 0) === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[14px]">
          <div className="font-medium text-fg">{status?.gitAvailable === false ? T.gitMissing : T.historyOff}</div>
          <div className="text-fg-muted">{status?.gitAvailable === false ? T.gitMissingHelp : T.historyOffHelp}</div>
          {status?.gitAvailable !== false && (
            <Button type="button" variant="outline" size="sm" onClick={() => useSettingsModal.getState().open('versionControl')}>
              {T.heading}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-80 shrink-0 flex-col overflow-y-auto border-r border-line">
            {commits !== null && commits.length === 0 ? (
              <p className="p-4 text-[14px] text-fg-muted">{T.historyEmpty}</p>
            ) : (
              <ul role="listbox" aria-label={T.historyTitle} className="flex flex-col gap-0.5 p-2">
                {(commits ?? []).map((c) => {
                  const active = c.sha === selected
                  return (
                    <li
                      key={c.sha}
                      role="option"
                      aria-selected={active}
                      tabIndex={0}
                      data-commit={c.short}
                      onClick={() => setSelected(c.sha)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelected(c.sha)
                        }
                      }}
                      className={`cursor-pointer rounded-md px-3 py-2 text-[14px] hover:bg-hover ${active ? 'bg-hover' : ''}`}
                    >
                      <div className="truncate font-medium text-fg">{subject(c.message)}</div>
                      <div className="text-[12px] text-fg-muted">
                        {formatWhen(c.at)} · {T.filesChanged(c.files.length)}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {more && (
              <div className="p-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()}>
                  {T.loadMore}
                </Button>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {current ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-line px-6 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-fg">{subject(current.message)}</div>
                    <div className="text-[13px] text-fg-muted">
                      {current.short} · {current.author} · {formatWhen(current.at)}
                    </div>
                  </div>
                  <Button size="sm" disabled={restoring} onClick={() => setConfirming(true)}>
                    {T.restoreSpace}
                  </Button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
                  {diff && diff.sha === current.sha && 'error' in diff ? (
                    <p role="alert" className="text-[14px] text-[var(--danger)]">
                      {diff.error}
                    </p>
                  ) : diff && diff.sha === current.sha && 'files' in diff ? (
                    diff.files.map((f) => <FileDiff key={`${f.oldPath ?? ''}>${f.path}`} file={f} />)
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-[14px]">
                <div className="font-medium text-fg">{T.selectCommit}</div>
                <div className="text-fg-muted">{T.selectCommitHelp}</div>
              </div>
            )}
          </div>
        </div>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{T.restoreConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{current ? T.restoreConfirmDescription(current.short, formatWhen(current.at)) : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void restore()}>{T.restoreConfirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default SpaceHistoryPage
