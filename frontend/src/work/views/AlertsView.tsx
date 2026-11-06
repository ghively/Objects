// M23 Task 13: Alerts. Active alerts grouped Critical, Warning, Info (each group's count in its
// header); a row is the dot, title, source, message, raised time and link. Cleared alerts sit in a
// folded `Cleared` list; a strip lists stale or failing sources; Check now scans the folder. With
// no folder set, a line points to Settings > Work (agents and automations can still write Alerts).
// Empty: `All quiet`.
import { useState, type JSX } from 'react'
import { api } from '@/api/client'
import type { AlertRow, AlertSeverity, AlertSourceStatus } from '@/api/types'
import { formatInZone } from '@/lib/zonedTime'
import { Chip, type ChipTone } from '../components/Chip'
import { safeUrl } from '../panel/WorkHeader'
import { openItemPanel } from '../state/workActions'
import { workToast } from '../state/workToasts'
import { useWorkData, type WorkDataState } from '../state/useWorkData'
import { WORK_TEXT } from '../workText'

const SEVERITIES: { id: AlertSeverity; label: string; tone: ChipTone }[] = [
  { id: 'Critical', label: WORK_TEXT.severityCritical, tone: 'critical' },
  { id: 'Warning', label: WORK_TEXT.severityWarning, tone: 'high' },
  { id: 'Info', label: WORK_TEXT.severityInfo, tone: 'muted' },
]
/** The link's text (ours: the Alert type's "Link" field). */
const OPEN_LINK = 'Link'
const TONE: Record<AlertSeverity, ChipTone> = { Critical: 'critical', Warning: 'high', Info: 'muted' }

const time = (iso: string, zone: string | undefined, today: string | undefined) => {
  const day = formatInZone(iso, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA', zone)
  const hm = formatInZone(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-US', zone)
  return day === today ? hm : `${formatInZone(iso, { month: 'short', day: 'numeric' }, 'en-US', zone)} ${hm}`
}

function Row({ a, zone, today }: { a: AlertRow; zone: string | undefined; today: string | undefined }): JSX.Element {
  const link = safeUrl(a.link)
  return (
    <li data-alert={a.path} className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 border-b border-line px-1 py-1 text-[13px]">
      <Chip tone={TONE[a.severity]}>
        <button type="button" onClick={() => openItemPanel(a.path)} className="text-fg hover:underline">
          {a.title}
        </button>
      </Chip>
      {a.source && <span className="shrink-0 text-[12px] text-fg-muted">{a.source}</span>}
      {a.message && <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">{a.message}</span>}
      {(a.clearedAt ?? a.raisedAt) && (
        <span className="shrink-0 text-[12px] tabular-nums text-fg-muted">{time((a.clearedAt ?? a.raisedAt) as string, zone, today)}</span>
      )}
      {link && (
        <a href={link} target="_blank" rel="noreferrer" className="shrink-0 text-[12px] text-[var(--work-you)] hover:underline">
          {OPEN_LINK}
        </a>
      )}
    </li>
  )
}

function sourceLine(s: AlertSourceStatus, zone: string | undefined, today: string | undefined): string {
  if (s.error) return s.error
  return WORK_TEXT.sourceNotFresh(s.source, s.generated ? time(s.generated, zone, today) : '-')
}

export function AlertsView({ data }: { data: WorkDataState; now: Date }): JSX.Element {
  const alerts = useWorkData((s) => s.alerts) ?? data.alerts
  const [busy, setBusy] = useState(false)
  const zone = data.board?.timeZone ?? undefined
  const today = data.board?.today
  const rows = alerts?.alerts ?? []
  const active = rows.filter((r) => r.active)
  const cleared = rows.filter((r) => !r.active)
  const bad = (alerts?.sources ?? []).filter((s) => s.stale || !s.ok || s.error)

  const checkNow = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await api.scanAlerts()
      useWorkData.setState({ alerts: res.alerts })
    } catch (e) {
      workToast(e instanceof Error && e.message ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-work-view="alerts" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void checkNow()}
          className="h-7 rounded border border-line px-2 text-[12px] text-fg hover:bg-hover disabled:opacity-50"
        >
          {WORK_TEXT.checkNow}
        </button>
        {alerts && !alerts.folder && <span className="text-[12px] text-fg-muted">{WORK_TEXT.pickMonitoringFolder}</span>}
      </div>
      {bad.length > 0 && (
        <ul data-alert-sources="" className="flex flex-col gap-0.5 text-[12px] text-[var(--work-high)]">
          {bad.map((s) => (
            <li key={s.file}>{sourceLine(s, zone, today)}</li>
          ))}
        </ul>
      )}
      {active.length === 0 && <p className="text-[13px] text-fg-muted">{WORK_TEXT.allQuiet}</p>}
      {SEVERITIES.map((sev) => {
        const group = active.filter((a) => a.severity === sev.id)
        if (!group.length) return null
        return (
          <section key={sev.id} data-alert-group={sev.id} aria-label={sev.label} className="flex min-w-0 flex-col gap-1">
            <h3 className="flex items-center gap-2 text-[12px] font-medium">
              <Chip tone={sev.tone}>{sev.label}</Chip>
              <span className="text-fg-muted">{alerts?.counts[sev.id] ?? group.length}</span>
            </h3>
            <ul className="flex min-w-0 flex-col">
              {group.map((a) => (
                <Row key={a.path} a={a} zone={zone} today={today} />
              ))}
            </ul>
          </section>
        )
      })}
      {cleared.length > 0 && (
        <details data-alerts-cleared="" className="min-w-0">
          <summary className="cursor-pointer text-[12px] font-medium text-fg-muted">
            {WORK_TEXT.clearedAlerts} <span>{cleared.length}</span>
          </summary>
          <ul className="flex min-w-0 flex-col">
            {cleared.map((a) => (
              <Row key={a.path} a={a} zone={zone} today={today} />
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
