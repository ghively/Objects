// "Full Export" (M31; catalog section 1, General): "Automated Full Exports" and "Manual Full
// Export with Spaces (All Spaces) and options Include media, Links as wikilinks ([[title]]), Add
// the title as a top heading; "Export All Spaces"". The spaces, the three options and the folder
// are device settings (`fullExportScope`, `fullExportMedia`, `fullExportWikilinks`,
// `fullExportTitleHeading`, `fullExportFolder`) that the manual export and the automated one share;
// the automated one adds `fullExportAuto` and `fullExportInterval`. An export runs on the server
// (`/api/full-export`, `fullExportApi`) and writes a new dated folder in the chosen folder only;
// this section follows its job until it is done. The catalog's "(desktop app only)" note has no
// counterpart here: Object always runs on this device, so automated exports are simply available.
import { useCallback, useEffect, useState } from 'react'
import { fullExportApi, type FullExportJob, type FullExportScope, type FullExportStatus } from '@/api/fullExportApi'
import type { DeviceSettings } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { NOTE_LOWER, NOTES_LOWER } from '@/lib/words'
import { useSettings } from '@/settings/useSettings'
import { formatWhen } from '@/vcs/vcsText'
import { OptionCards, SaveError, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'

export const FULL_EXPORT_TEXT = {
  heading: 'Full Export',
  // our string
  description: 'Save your notes as Markdown files in a folder of your choice, to read or keep outside Object.',
  auto: 'Automated Full Exports',
  // our string
  autoHelp: 'Exports on a schedule, with the spaces, options and folder set below. Each run makes a new dated folder.',
  interval: 'How often', // our string
  daily: 'Daily', // our string
  weekly: 'Weekly', // our string
  lastRun: 'Last export', // our string
  nextRun: 'Next export', // our string
  never: 'Not yet', // our string
  manual: 'Manual Full Export',
  // our string
  manualHelp: 'Each note becomes a Markdown file, in one folder per space, inside a new dated folder.',
  spaces: 'Spaces',
  thisSpace: 'This space', // our string
  allSpaces: 'All Spaces',
  includeMedia: 'Include media',
  includeMediaHelp: 'Copies attached files and pictures too.', // our string
  wikilinks: 'Links as wikilinks',
  wikilinksHelp: 'Writes links as [[title]] rather than [title](path).',
  titleHeading: 'Add the title as a top heading',
  titleHeadingHelp: 'Each exported note opens with its title as a top-level heading.',
  folder: 'Folder', // our string
  folderHelp: 'Where the export goes: a full path to a folder outside your spaces.', // our string
  folderPlaceholder: 'C:\\Exports', // our string
  exportButton: 'Export',
  exportAllButton: 'Export All Spaces',
  exporting: (done: number, total: number) => `Exporting… ${done} of ${total} files`, // our string
  // our string
  exported: (objects: number, media: number) =>
    `Exported ${objects} ${objects === 1 ? NOTE_LOWER : NOTES_LOWER}${media ? ` and ${media} media ${media === 1 ? 'file' : 'files'}` : ''} to`,
} as const

const T = FULL_EXPORT_TEXT

export const FULL_EXPORT_SEARCH: string[] = [
  T.auto,
  T.manual,
  T.spaces,
  T.allSpaces,
  T.includeMedia,
  T.wikilinks,
  T.titleHeading,
  T.exportAllButton,
]

/** How often a running export's job is asked for its progress (our choice). */
export const JOB_POLL_MS = 400

/** Longest folder path the server accepts (`settings.WORK_ALERT_FOLDER_MAX`, shared). */
export const MAX_EXPORT_FOLDER = 500

const INPUT =
  'h-9 w-full max-w-[420px] rounded-md border border-line bg-raised px-2 text-[15px] text-fg outline-none focus:border-fg-muted'

function useStatus() {
  const [status, setStatus] = useState<FullExportStatus | null>(null)
  const refresh = useCallback(() => {
    fullExportApi.status().then(setStatus, () => undefined)
  }, [])
  return { status, refresh }
}

export function FullExportSection() {
  const { status, refresh } = useStatus()
  const auto = useSettings((s) => s.settings.fullExportAuto)
  const interval = useSettings((s) => s.settings.fullExportInterval)
  const scope = useSettings((s) => s.settings.fullExportScope)
  const folder = useSettings((s) => s.settings.fullExportFolder)
  const [error, setError] = useState<string | null>(null)

  // The status again whenever a setting it reads changes (saved first, then read).
  useEffect(() => {
    refresh()
  }, [refresh, auto, interval, scope, folder])

  const patch = (p: Partial<DeviceSettings>) => {
    setError(null)
    useSettings
      .getState()
      .patch(p)
      .then(refresh, (e: unknown) => setError(errorText(e)))
  }

  return (
    <div>
      <SectionHeader icon="ph-export" heading={T.heading} description={T.description} />
      <SwitchRow title={T.auto} help={T.autoHelp} checked={auto} onChange={(v) => patch({ fullExportAuto: v })}>
        {auto && (
          <div className="flex flex-col gap-3" data-full-export-auto="">
            <OptionCards
              label={T.interval}
              value={interval}
              columns={2}
              options={[
                { value: 'daily', label: T.daily },
                { value: 'weekly', label: T.weekly },
              ]}
              onChange={(v) => patch({ fullExportInterval: v })}
            />
            <dl className="grid w-fit grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
              <dt className="text-fg-muted">{T.lastRun}</dt>
              <dd data-full-export-last="" className="text-fg">
                {status?.auto.lastRun ? formatWhen(status.auto.lastRun) : T.never}
                {status?.auto.lastFolder && <span className="block text-[13px] break-all text-fg-muted">{status.auto.lastFolder}</span>}
              </dd>
              {status?.auto.nextRun && !status.auto.blocked && (
                <>
                  <dt className="text-fg-muted">{T.nextRun}</dt>
                  <dd className="text-fg">{formatWhen(status.auto.nextRun)}</dd>
                </>
              )}
            </dl>
            {status?.auto.blocked && (
              <p role="status" data-full-export-blocked="" className="text-[13px] text-[var(--danger)]">
                {status.auto.blocked}
              </p>
            )}
            {status?.auto.lastError && !status.auto.blocked && (
              <p role="alert" className="text-[13px] text-[var(--danger)]">
                {status.auto.lastError}
              </p>
            )}
          </div>
        )}
      </SwitchRow>
      <SaveError error={error} />
      <ManualExport scope={scope} onPatch={patch} />
    </div>
  )
}

function ManualExport({
  scope,
  onPatch,
}: {
  scope: FullExportScope
  onPatch(p: Partial<DeviceSettings>): void
}) {
  const media = useSettings((s) => s.settings.fullExportMedia)
  const wikilinks = useSettings((s) => s.settings.fullExportWikilinks)
  const titleHeading = useSettings((s) => s.settings.fullExportTitleHeading)
  const [job, setJob] = useState<FullExportJob | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Follow the started job until it is done or failed.
  useEffect(() => {
    if (jobId === null) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = () => {
      fullExportApi.job(jobId).then(
        (j) => {
          if (!alive) return
          setJob(j)
          if (j.state === 'running') timer = setTimeout(poll, JOB_POLL_MS)
          else if (j.state === 'failed') setError(j.error)
        },
        (e: unknown) => alive && setError(errorText(e)),
      )
    }
    poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [jobId])

  const running = job?.state === 'running'

  const start = (which: FullExportScope) => {
    setError(null)
    const folder = useSettings.getState().settings.fullExportFolder
    fullExportApi.start({ scope: which, folder, media, wikilinks, titleHeading }).then(
      (j) => {
        setJob(j)
        setJobId(j.id)
      },
      (e: unknown) => setError(errorText(e)),
    )
  }

  return (
    <SettingGroup title={T.manual} help={T.manualHelp}>
      <div className="flex flex-col gap-1 pt-1">
        <h4 className="text-[14px] font-medium text-fg">{T.spaces}</h4>
        <OptionCards
          label={T.spaces}
          value={scope}
          columns={2}
          options={[
            { value: 'current', label: T.thisSpace },
            { value: 'all', label: T.allSpaces },
          ]}
          onChange={(v) => onPatch({ fullExportScope: v })}
        />
      </div>
      <SwitchRow title={T.includeMedia} help={T.includeMediaHelp} checked={media} onChange={(v) => onPatch({ fullExportMedia: v })} />
      <SwitchRow title={T.wikilinks} help={T.wikilinksHelp} checked={wikilinks} onChange={(v) => onPatch({ fullExportWikilinks: v })} />
      <SwitchRow
        title={T.titleHeading}
        help={T.titleHeadingHelp}
        checked={titleHeading}
        onChange={(v) => onPatch({ fullExportTitleHeading: v })}
      />
      <FolderField />
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" size="sm" disabled={running} onClick={() => start(scope)}>
          <Icon name="ph-export" size={14} />
          {T.exportButton}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={running} onClick={() => start('all')}>
          <Icon name="ph-export" size={14} />
          {T.exportAllButton}
        </Button>
      </div>
      {running && (
        <div role="status" className="flex flex-col gap-1 text-[13px] text-fg-muted" data-full-export-progress="">
          <span>{T.exporting(job.done, job.total)}</span>
          <progress max={Math.max(job.total, 1)} value={job.done} className="h-1.5 w-full max-w-[420px] accent-[var(--accent)]" />
        </div>
      )}
      {job?.state === 'done' && job.result && (
        <p role="status" data-full-export-result="" className="text-[13px] text-fg-muted">
          {T.exported(job.result.objects, job.result.media)} <span className="break-all text-fg">{job.result.folder}</span>
        </p>
      )}
      <SaveError error={error} />
    </SettingGroup>
  )
}

/** Folder (`fullExportFolder`): a full path; empty saves null. A refused save shows why. */
function FolderField() {
  const stored = useSettings((s) => s.settings.fullExportFolder)
  const [folder, setFolder] = useState(stored ?? '')
  const [shown, setShown] = useState(stored)
  const [error, setError] = useState<string | null>(null)
  if (stored !== shown) {
    // Saved elsewhere (another window, the other field): show the stored folder.
    setShown(stored)
    setFolder(stored ?? '')
  }

  const commit = () => {
    const typed = folder
    const next = typed.trim() === '' ? null : typed.trim()
    if (next === (stored ?? null)) return
    setError(null)
    useSettings
      .getState()
      .patch({ fullExportFolder: next })
      .catch((e: unknown) => {
        setError(errorText(e))
        setFolder(typed)
      })
  }

  return (
    <div className="flex flex-col gap-1 pt-2">
      <h4 className="text-[14px] font-medium text-fg">{T.folder}</h4>
      <p className="text-[13px] text-fg-muted">{T.folderHelp}</p>
      <input
        aria-label={T.folder}
        type="text"
        value={folder}
        maxLength={MAX_EXPORT_FOLDER}
        placeholder={T.folderPlaceholder}
        spellCheck={false}
        onChange={(e) => setFolder(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        className={INPUT}
      />
      <SaveError error={error} />
    </div>
  )
}
