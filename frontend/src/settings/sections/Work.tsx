// "Work" (M22, our section; Space group, after Automations). M32: its first row is the Work
// switch, "Use the Work page in this space" (`workEnabled` in `.object/space.json`, through
// `setWorkEnabled`); while the Work page is off the rest of the section stays where it is, every
// control disabled under one line ("Turn on the Work page to use these."). Then "Your name in Activity" (a device
// setting, `activityName`, the name every work write puts in `## Activity`) and "Jira site" (a
// space setting, `jiraSite` in `.object/space.json`, which makes a Jira ticket's browse link). A
// refused save (422) shows the server's message under its field. M23 adds its alert rows after
// these two (Alert folder, Alert intervals, Add the Alert type), and M24 its work agent group after
// those.
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { WORK } from '@/lib/words'
import { cn } from '@/lib/utils'
import { useSettings } from '@/settings/useSettings'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { WorkAgentSettings } from '@/work/agent/WorkAgentSettings'
import { WORK_AGENT_TEXT } from '@/work/agent/workAgentText'
import { setWorkEnabled, useWorkOn } from '@/work/useWorkOn'
import { SaveError, SecondaryButton, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'

export const WORK_TEXT = {
  heading: WORK, // our string
  description: 'An optional page for tickets, queues and alerts, and how its items are logged and linked.', // our string
  // M32: the Work switch (per space) and the line over the rest while it is off.
  usePage: 'Use the Work page in this space',
  usePageHelp:
    'Adds a Work page under Tasks: the Now view, queues, captures, alerts and tickets, and ticket fields on tasks and projects. Off: Tasks is a plain task list.',
  offNote: 'Turn on the Work page to use these.',
  yourName: 'Your name in Activity', // our string
  yourNameHelp: 'The name each step action, note and field change puts in the Activity log on this device.', // our string
  jiraSite: 'Jira site', // our string
  jiraSiteHelp: 'The web address of your Jira site. A Jira ticket ID then links to its page.', // our string
  jiraSitePlaceholder: 'https://example.atlassian.net', // our string
  // M23: the monitoring folder watch (all our strings).
  alertFolder: 'Alert folder',
  alertFolderHelp:
    'The folder your monitoring jobs write their JSON results to. Each alert becomes a note of the Alert type. Leave it empty to turn this off.',
  alertFolderPlaceholder: 'C:\\Monitoring\\results',
  alertIntervals: 'Alert intervals',
  alertIntervalsHelp:
    'How often each source runs, in minutes. A source is stale when its file is older than twice this (a day when not set).',
  intervalSource: 'Source',
  intervalMinutes: 'Minutes',
  addInterval: 'Add an interval',
  removeInterval: 'Remove',
  alertType: 'Alert type',
  alertTypeHelp: 'Alerts are ordinary notes of the Alert type, made when the first alert arrives.',
  addAlertType: 'Add the Alert type',
  alertTypeExists: 'The Alert type exists.',
} as const

const T = WORK_TEXT

export const WORK_SEARCH: string[] = [T.usePage, T.yourName, T.jiraSite, T.alertFolder, T.alertIntervals, T.addAlertType, WORK_AGENT_TEXT.group, WORK_AGENT_TEXT.acts, WORK_AGENT_TEXT.autoRun, WORK_AGENT_TEXT.readTools, WORK_AGENT_TEXT.deskSync]

/** Longest alert folder path the server accepts (`settings.WORK_ALERT_FOLDER_MAX`). */
export const MAX_ALERT_FOLDER = 500
/** Most interval rows the server accepts (`settings.WORK_ALERT_INTERVALS_MAX`). */
export const MAX_ALERT_INTERVALS = 50

/** Longest Activity name the server accepts (`settings._valid`). */
export const MAX_ACTIVITY_NAME = 60
/** Longest Jira site the server accepts (`spaceconfig._checked`). */
export const MAX_JIRA_SITE = 300

const INPUT =
  'h-9 w-full max-w-[420px] rounded-md border border-line bg-raised px-2 text-[15px] text-fg outline-none focus:border-fg-muted'

export function WorkSection() {
  const activityName = useSettings((s) => s.settings.activityName)
  const space = useSpaceInfo((s) => s.space)
  const storedSite = space?.jiraSite ?? ''
  const [name, setName] = useState(activityName ?? '')
  const [site, setSite] = useState(storedSite)
  const [nameError, setNameError] = useState<string | null>(null)
  const [siteError, setSiteError] = useState<string | null>(null)
  const workOn = useWorkOn()
  const [switchError, setSwitchError] = useState<string | null>(null)

  useEffect(() => {
    void useSpaceInfo.getState().ensure()
  }, [])
  // Follow the stored values (the first load, another window's edit).
  useEffect(() => setName(activityName ?? ''), [activityName])
  useEffect(() => setSite(storedSite), [storedSite])

  const commitName = () => {
    if (name === activityName) return
    setNameError(null)
    useSettings
      .getState()
      .patch({ activityName: name })
      .catch((e: unknown) => setNameError(errorText(e)))
  }

  const commitSite = () => {
    if (!space) return
    const typed = site
    const next = typed.trim() === '' ? null : typed.trim()
    if (next === (space.jiraSite ?? null)) return
    setSiteError(null)
    useSpaceInfo
      .getState()
      .patch({ jiraSite: next })
      .catch((e: unknown) => {
        setSiteError(errorText(e))
        // The refused patch reloads the stored info; keep what was typed so it can be fixed.
        setSite(typed)
      })
  }

  return (
    <div>
      <SectionHeader icon="ph-briefcase" heading={T.heading} description={T.description} />
      <SwitchRow
        title={T.usePage}
        help={T.usePageHelp}
        checked={workOn}
        onChange={(on) => {
          if (!space) return
          setSwitchError(null)
          setWorkEnabled(on).catch((e: unknown) => setSwitchError(errorText(e)))
        }}
      >
        <SaveError error={switchError} />
      </SwitchRow>
      {!workOn && (
        <p data-work-off-note="" className="flex gap-1.5 text-[13px] text-fg-muted">
          <Icon name="ph-info" size={14} className="mt-0.5 shrink-0" />
          {T.offNote}
        </p>
      )}
      {/* Off: nothing is removed. A disabled fieldset disables every control inside it (the work
          agent group's too), so nothing here can be changed until the Work page is on. */}
      <fieldset disabled={!workOn} data-work-settings={workOn ? 'on' : 'off'} className={cn('min-w-0', !workOn && 'opacity-60')}>
        <SettingGroup title={T.yourName} help={T.yourNameHelp}>
          <input
            aria-label={T.yourName}
            value={name}
            maxLength={MAX_ACTIVITY_NAME}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitName()
              }
            }}
            className={INPUT}
          />
          <SaveError error={nameError} />
        </SettingGroup>
        <SettingGroup title={T.jiraSite} help={T.jiraSiteHelp}>
          <input
            aria-label={T.jiraSite}
            type="text"
            inputMode="url"
            value={site}
            maxLength={MAX_JIRA_SITE}
            placeholder={T.jiraSitePlaceholder}
            disabled={!space}
            onChange={(e) => setSite(e.target.value)}
            onBlur={commitSite}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitSite()
              }
            }}
            className={INPUT}
          />
          <SaveError error={siteError} />
        </SettingGroup>
        <AlertFolderGroup />
        <AlertIntervalsGroup />
        <AlertTypeGroup />
        <WorkAgentSettings />
      </fieldset>
    </div>
  )
}

/** Alert folder (`workAlertFolder`): a full path; empty turns the folder watch off (null). */
function AlertFolderGroup() {
  const stored = useSettings((s) => s.settings.workAlertFolder)
  const [folder, setFolder] = useState(stored ?? '')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setFolder(stored ?? ''), [stored])

  const commit = () => {
    const typed = folder
    const next = typed.trim() === '' ? null : typed.trim()
    if (next === (stored ?? null)) return
    setError(null)
    useSettings
      .getState()
      .patch({ workAlertFolder: next })
      .catch((e: unknown) => {
        setError(errorText(e))
        // Keep what was typed so it can be fixed.
        setFolder(typed)
      })
  }

  return (
    <SettingGroup title={T.alertFolder} help={T.alertFolderHelp}>
      <input
        aria-label={T.alertFolder}
        type="text"
        value={folder}
        maxLength={MAX_ALERT_FOLDER}
        placeholder={T.alertFolderPlaceholder}
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
    </SettingGroup>
  )
}

interface IntervalRow {
  id: number
  source: string
  minutes: string
}

let nextRowId = 1
const rowsOf = (m: Record<string, number>): IntervalRow[] =>
  Object.entries(m).map(([source, minutes]) => ({ id: nextRowId++, source, minutes: String(minutes) }))

/** The rows as the stored map, or null while a row is half written (a source without minutes, or the reverse). */
function mapOf(rows: IntervalRow[]): Record<string, number> | null {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const source = r.source.trim()
    const minutes = r.minutes.trim()
    if (source === '' && minutes === '') continue
    if (source === '' || !/^\d+$/.test(minutes)) return null
    out[source] = Number(minutes)
  }
  return out
}

function sameMap(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] === a[k])
}

/** Alert intervals (`workAlertIntervals`): one row per source and its minutes, saved once every row is complete. */
function AlertIntervalsGroup() {
  const stored = useSettings((s) => s.settings.workAlertIntervals)
  const [rows, setRows] = useState<IntervalRow[]>(() => rowsOf(stored ?? {}))
  const [error, setError] = useState<string | null>(null)
  // Follow the stored map when it changes elsewhere (another window); our own save already matches the rows.
  useEffect(() => {
    setRows((cur) => {
      const mine = mapOf(cur)
      return mine && sameMap(mine, stored ?? {}) ? cur : rowsOf(stored ?? {})
    })
  }, [stored])

  const save = (next: IntervalRow[]) => {
    const map = mapOf(next)
    if (!map || sameMap(map, stored ?? {})) return
    setError(null)
    useSettings
      .getState()
      .patch({ workAlertIntervals: map })
      .catch((e: unknown) => setError(errorText(e)))
  }

  const edit = (id: number, patch: Partial<IntervalRow>) =>
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const remove = (id: number) => {
    const next = rows.filter((r) => r.id !== id)
    setRows(next)
    save(next)
  }

  const FIELD = 'h-9 rounded-md border border-line bg-raised px-2 text-[15px] text-fg outline-none focus:border-fg-muted'

  return (
    <SettingGroup title={T.alertIntervals} help={T.alertIntervalsHelp}>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.id} data-interval-row={r.source} className="flex items-center gap-2">
              <input
                aria-label={T.intervalSource}
                type="text"
                value={r.source}
                maxLength={100}
                placeholder="printer-watch"
                spellCheck={false}
                onChange={(e) => edit(r.id, { source: e.target.value })}
                onBlur={() => save(rows)}
                className={`${FIELD} w-full max-w-[260px]`}
              />
              <input
                aria-label={T.intervalMinutes}
                type="number"
                min={1}
                max={10080}
                step={1}
                value={r.minutes}
                onChange={(e) => edit(r.id, { minutes: e.target.value })}
                onBlur={() => save(rows)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    save(rows)
                  }
                }}
                className={`${FIELD} w-[110px]`}
              />
              <button
                type="button"
                aria-label={`${T.removeInterval} ${r.source.trim()}`.trim()}
                onClick={() => remove(r.id)}
                className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Icon name="ph-x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <SecondaryButton
        disabled={rows.length >= MAX_ALERT_INTERVALS}
        onClick={() => setRows((cur) => [...cur, { id: nextRowId++, source: '', minutes: '' }])}
      >
        <Icon name="ph-plus" size={14} />
        {T.addInterval}
      </SecondaryButton>
      <SaveError error={error} />
    </SettingGroup>
  )
}

/** Add the Alert type (`api.ensureAlertType`); disabled, with a note, once the type exists. */
function AlertTypeGroup() {
  const [exists, setExists] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .workAlerts()
      .then((a) => {
        if (live) setExists(a.typeExists)
      })
      .catch(() => {
        if (live) setExists(false)
      })
    return () => {
      live = false
    }
  }, [])

  const add = () => {
    setBusy(true)
    setError(null)
    api
      .ensureAlertType()
      .then(() => setExists(true))
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false))
  }

  return (
    <SettingGroup title={T.alertType} help={T.alertTypeHelp}>
      <SecondaryButton disabled={exists !== false || busy} onClick={add}>
        <Icon name="ph-warning" size={14} />
        {T.addAlertType}
      </SecondaryButton>
      {exists && <p className="text-[13px] text-fg-muted">{T.alertTypeExists}</p>}
      <SaveError error={error} />
    </SettingGroup>
  )
}
