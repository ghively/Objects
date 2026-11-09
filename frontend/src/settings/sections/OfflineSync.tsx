// "Offline & Sync", keeping only its local part: Object stores everything as files on this
// device and has no cloud, so the sync status, content download state, media loading, media cache
// and cloud media storage have nothing to show. What stays is "Rebuild search index"
// (`POST /api/search/reindex`), which lives here (M9 put it in Space Settings).
// 2026-11-08: the Backup rows: "Back up all spaces" (version control on for every registered
// space) and "Back up agents and settings" (the state folder's own git repository).
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { vcsApi, type VcsStatus } from '@/api/vcsClient'
import { useVcsStatus } from '@/vcs/useVcsStatus'
import { formatWhen, subject, VCS_TEXT } from '@/vcs/vcsText'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { SaveError, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'

export const OFFLINE_SYNC_TEXT = {
  heading: 'Offline & Sync',
  // our string (no cloud here)
  description: 'Your content is stored as Markdown files on this device and is always available offline.',
  offline: 'Offline',
  // our string
  offlineDescription: 'Object reads your notes from the space folder and keeps an index of them for search, backlinks and views.',
  reindexButton: 'Rebuild search index',
  reindexDescription:
    'Rebuilds the search index from your notes. Try it only when search misses things or views look out of date; normally it is never needed.',
  reindexingHeading: 'Rebuilding the index',
  reindexingDescription: 'Object is reading your notes again for search, backlinks and views.',
} as const

const T = OFFLINE_SYNC_TEXT

export const OFFLINE_SYNC_SEARCH: string[] = [T.offline, T.reindexButton, VCS_TEXT.backupAll, VCS_TEXT.backupState]

/** How often the reindex row asks search whether the index is still `partial` (our choice). */
export const REINDEX_POLL_MS = 1000

/**
 * "Rebuild search index": drops and rebuilds the search index in the background. While
 * search reports `partial` (the rebuild, or the start-up sync) the row shows the
 * "Rebuilding the index" state and the button waits. It only reads and asks; it writes no file.
 */
function ReindexRow() {
  const [indexing, setIndexing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ask on open and after each start (the server clears `ready` before it answers), then keep
  // asking while the index is partial.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      api
        .search('', { limit: 1 })
        .then((r) => {
          if (!alive) return
          setIndexing(r.partial)
          if (r.partial) timer = setTimeout(check, REINDEX_POLL_MS)
        })
        .catch(() => alive && setIndexing(false))
    }
    check()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [indexing])

  const start = () => {
    setError(null)
    api
      .reindex()
      .then(() => setIndexing(true))
      .catch((e: unknown) => setError(errorText(e)))
  }

  return (
    <SettingGroup title={T.reindexButton} help={T.reindexDescription}>
      <div>
        <Button type="button" variant="outline" size="sm" disabled={indexing} onClick={start}>
          <Icon name="ph-file-magnifying-glass" size={14} />
          {T.reindexButton}
        </Button>
      </div>
      {indexing && (
        <div role="status" className="text-[13px]">
          <p className="font-semibold text-fg">{T.reindexingHeading}</p>
          <p className="text-fg-muted">{T.reindexingDescription}</p>
        </div>
      )}
      <SaveError error={error} />
    </SettingGroup>
  )
}

export function OfflineSyncSection() {
  return (
    <div>
      <SectionHeader icon="ph-arrows-clockwise" heading={T.heading} description={T.description} />
      <SettingGroup title={T.offline} help={T.offlineDescription} className="pb-0" />
      <ReindexRow />
      <BackupRows />
    </div>
  )
}

/** "Back up all spaces" and "Back up agents and settings" (2026-11-08). Hidden without git. */
function BackupRows() {
  const [state, setState] = useState<VcsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')

  useEffect(() => {
    let live = true
    vcsApi.status('state').then(
      (s) => {
        if (!live || !s || typeof s !== 'object') return
        setState(s)
        setUrl(s.remote?.url ?? '')
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  if (!state) return null
  if (!state.gitAvailable) return <SettingGroup title={VCS_TEXT.gitMissing} help={VCS_TEXT.gitMissingHelp} />

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
      vcsApi.status('state').then(setState, () => undefined)
    }
  }

  const backupAll = () =>
    run(async () => {
      const res = await vcsApi.enableAll()
      const list = res?.spaces ?? []
      const ok = list.filter((x) => x.ok).length
      const failed = list.filter((x) => !x.ok)
      setDone([VCS_TEXT.backupAllDone(ok, failed.length), ...failed.map((x) => `${x.name}: ${x.message ?? ''}`)].join('\n'))
      void useVcsStatus.getState().refresh()
    })

  return (
    <>
      <SettingGroup title={VCS_TEXT.backupAll} help={VCS_TEXT.backupAllHelp}>
        <div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void backupAll()}>
            <Icon name="ph-git-branch" size={14} />
            {VCS_TEXT.backupAll}
          </Button>
        </div>
        {done && (
          <p role="status" className="text-[13px] whitespace-pre-line text-fg-muted">
            {done}
          </p>
        )}
      </SettingGroup>
      <SwitchRow
        title={VCS_TEXT.backupState}
        help={VCS_TEXT.backupStateHelp}
        checked={state.enabled}
        onChange={(v) => void run(() => (v ? vcsApi.enable('state') : vcsApi.disable('state')))}
      >
        {state.enabled && (
          <div className="flex flex-col gap-2 text-[14px]" data-vcs-state="">
            <span className="text-fg-muted">
              {VCS_TEXT.lastCommit}:{' '}
              {state.lastCommit ? `${subject(state.lastCommit.message)} · ${formatWhen(state.lastCommit.at)}` : VCS_TEXT.noCommit}
            </span>
            {state.error && (
              <span role="alert" className="text-[13px] text-[var(--danger)]">
                {state.error.message}
              </span>
            )}
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void run(() => vcsApi.setRemote('state', url.trim()))
              }}
            >
              <input
                aria-label={`${VCS_TEXT.backupState}: ${VCS_TEXT.remote}`}
                value={url}
                placeholder={VCS_TEXT.remotePlaceholder}
                onChange={(e) => setUrl(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-[14px] text-fg outline-none focus:border-fg-muted"
              />
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                {VCS_TEXT.saveRemote}
              </Button>
              {state.remote && (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => vcsApi.push('state'))}>
                  {VCS_TEXT.pushNow}
                </Button>
              )}
            </form>
            {!state.remote && <span className="text-[13px] text-fg-muted">{VCS_TEXT.noRemote}</span>}
          </div>
        )}
      </SwitchRow>
      <SaveError error={error} />
    </>
  )
}
