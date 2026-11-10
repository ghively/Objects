// "Offline & Sync", keeping only its local part: Object stores everything as files on this
// device and has no cloud, so the sync status, content download state and cloud media storage
// have nothing to show. What stays is "Rebuild search index"
// (`POST /api/search/reindex`), which lives here (M9 put it in Space Settings).
// 2026-11-08: the Backup rows: "Back up all spaces" (version control on for every registered
// space) and "Back up agents and settings" (the state folder's own git repository).
// M31 (catalog: "Local Storage (size estimate); Media loading (Everything | Required only); Clear
// media cache"): the space's disk use (`GET /api/storage`), the device setting `mediaLoading`, and
// Clear media cache (`POST /api/storage/clear-media-cache`, then pages load media afresh).
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { laneFApi, type StorageEstimate } from '@/api/laneFApi'
import { vcsApi, type VcsStatus } from '@/api/vcsClient'
import { invalidateAttachments } from '@/editor/media/upload'
import { bumpMediaToken } from '@/settings/mediaLoading'
import { useSettings } from '@/settings/useSettings'
import { useVcsStatus } from '@/vcs/useVcsStatus'
import { formatWhen, subject, VCS_TEXT } from '@/vcs/vcsText'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { OptionCards, SaveError, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'

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
  // M31: the labels are the catalog's; the help, rows and messages are ours.
  storage: 'Local Storage',
  storageDescription: 'An estimate of the disk space this space uses on this device.',
  storageSpace: 'Notes and files (the space folder)',
  storageCache: 'Cache (rebuilt when needed)',
  storageState: "Object's data for this space (saved versions and the like)",
  storageTotal: 'Total',
  storageLoading: 'Measuring…',
  mediaLoading: 'Media loading',
  mediaLoadingDescription:
    'When images, video, audio and PDFs load: in pages, cover images, cards and galleries, image properties and whiteboards.',
  mediaEverything: 'Everything',
  mediaEverythingDescription: 'Media loads as soon as a page opens.',
  mediaRequired: 'Required only',
  mediaRequiredDescription: 'Media shows a placeholder and loads when you click Load.',
  clearMedia: 'Clear media cache',
  clearMediaDescription:
    'Object reads media straight from your files and keeps no copies of its own, so this clears only cached media and makes pages load media again from your files. Your notes and files are never touched.',
  clearConfirmTitle: 'Clear the media cache?',
  clearConfirmDescription:
    'Cached media is removed and pages load images, video, audio and PDFs again from your files. Notes and files are not touched.',
  cancel: 'Cancel',
  cleared: (files: number, size: string) => `Cleared ${files} cached ${files === 1 ? 'file' : 'files'} (${size}). Pages load media again from your files.`,
  nothingCleared: 'There was no cached media to clear. Pages load media again from your files.',
} as const

const T = OFFLINE_SYNC_TEXT

export const OFFLINE_SYNC_SEARCH: string[] = [
  T.offline,
  T.reindexButton,
  T.storage,
  T.mediaLoading,
  T.mediaEverything,
  T.mediaRequired,
  T.clearMedia,
  VCS_TEXT.backupAll,
  VCS_TEXT.backupState,
]

/** "2.5 MB" (1024-based, as the media blocks show sizes; our format). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

/** "Local Storage": the space folder, its cache and Object's own data for it, and the total. */
function StorageRows({ estimate, error }: { estimate: StorageEstimate | null; error: string | null }) {
  const rows: [string, number][] = estimate
    ? [
        [T.storageSpace, estimate.space.bytes],
        [T.storageCache, estimate.cache.bytes],
        [T.storageState, estimate.state.bytes],
      ]
    : []
  return (
    <SettingGroup title={T.storage} help={T.storageDescription}>
      {!estimate && !error && <p className="text-[13px] text-fg-muted">{T.storageLoading}</p>}
      {estimate && (
        <dl className="flex max-w-md flex-col gap-1 text-[14px]">
          {rows.map(([label, bytes]) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="text-fg tabular-nums">{formatBytes(bytes)}</dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-line pt-1 font-semibold">
            <dt className="text-fg">{T.storageTotal}</dt>
            <dd className="text-fg tabular-nums">{formatBytes(estimate.total)}</dd>
          </div>
        </dl>
      )}
      <SaveError error={error} />
    </SettingGroup>
  )
}

/** "Media loading": Everything | Required only (the device setting `mediaLoading`). */
function MediaLoadingRow() {
  const value = useSettings((s) => s.settings.mediaLoading) ?? 'everything'
  const [error, setError] = useState<string | null>(null)
  return (
    <SettingGroup title={T.mediaLoading} help={T.mediaLoadingDescription}>
      <OptionCards
        label={T.mediaLoading}
        value={value}
        columns={2}
        options={[
          { value: 'everything', label: T.mediaEverything, description: T.mediaEverythingDescription },
          { value: 'required', label: T.mediaRequired, description: T.mediaRequiredDescription },
        ]}
        onChange={(mediaLoading) => {
          setError(null)
          useSettings
            .getState()
            .patch({ mediaLoading })
            .catch((e: unknown) => setError(errorText(e)))
        }}
      />
      <SaveError error={error} />
    </SettingGroup>
  )
}

/** "Clear media cache", behind a confirmation; reports what it freed. */
function ClearMediaRow({ onCleared }: { onCleared(): void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const clear = () => {
    setConfirming(false)
    setBusy(true)
    setError(null)
    setDone(null)
    laneFApi
      .clearMediaCache()
      .then((r) => {
        // The page's media load afresh: a new token on their URLs, the attachment list read again.
        bumpMediaToken()
        invalidateAttachments()
        setDone(r.files > 0 ? T.cleared(r.files, formatBytes(r.bytes)) : T.nothingCleared)
        onCleared()
      })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false))
  }
  return (
    <SettingGroup title={T.clearMedia} help={T.clearMediaDescription}>
      <div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
          <Icon name="ph-trash" size={14} />
          {T.clearMedia}
        </Button>
      </div>
      {done && (
        <p role="status" className="text-[13px] text-fg-muted">
          {done}
        </p>
      )}
      <SaveError error={error} />
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="border-line bg-raised-2 text-fg sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[17px]">{T.clearConfirmTitle}</DialogTitle>
            <DialogDescription className="text-[13px] text-fg-muted">{T.clearConfirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
              {T.cancel}
            </Button>
            <Button type="button" size="sm" onClick={clear}>
              {T.clearMedia}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingGroup>
  )
}

/** The M31 local rows: Local Storage, Media loading, Clear media cache. */
function LocalRows() {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    let live = true
    laneFApi.storage().then(
      (s) => {
        if (!live) return
        setEstimate(s)
        setError(null)
      },
      (e: unknown) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [])
  useEffect(load, [load])
  return (
    <>
      <StorageRows estimate={estimate} error={error} />
      <MediaLoadingRow />
      <ClearMediaRow onCleared={() => void load()} />
    </>
  )
}

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
      <LocalRows />
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
