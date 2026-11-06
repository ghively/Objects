// M23 Task 13: Wins. The KPIs (steps done, items closed and objects changed in 14 days, changed
// today), a done-per-day chart (14 CSS bars of steps done plus items closed, weekday labels, the ok
// tone; no chart library), What got done (time, item title, text; newest first) and the closing
// line. `wins` loads with the page; the view asks for it when it isn't there yet.
import { useEffect, type JSX } from 'react'
import { formatInZone } from '@/lib/zonedTime'
import { openItemPanel } from '../state/workActions'
import { useWorkData, type WorkDataState } from '../state/useWorkData'
import { WORK_TEXT } from '../workText'

const CHART_DAYS = 14
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const weekday = (day: string) => WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()] ?? ''

function Kpi({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div data-work-kpi="" className="flex min-w-0 flex-col rounded border border-line px-3 py-2">
      <span className="text-[20px] font-semibold text-fg">{value}</span>
      <span className="text-[12px] text-fg-muted">{label}</span>
    </div>
  )
}

export function WinsView({ data }: { data: WorkDataState; now: Date }): JSX.Element {
  const wins = data.wins
  const loaded = wins !== null

  useEffect(() => {
    if (!loaded) void useWorkData.getState().load(['wins'])
  }, [loaded])

  const zone = data.board?.timeZone ?? undefined
  const days = (wins?.days ?? []).slice(-CHART_DAYS)
  const counts = days.map((d) => d.stepsDone + d.itemsClosed)
  const max = Math.max(1, ...counts)
  const today = data.board?.today ?? days.at(-1)?.day
  const changedToday = days.find((d) => d.day === today)?.objectsChanged ?? 0
  const got = [...(wins?.got ?? [])].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <div data-work-view="wins" className="flex min-w-0 flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label={WORK_TEXT.stepsDone14} value={wins?.stepsDone ?? 0} />
        <Kpi label={WORK_TEXT.itemsClosed14} value={wins?.itemsClosed ?? 0} />
        <Kpi label={WORK_TEXT.objectsChanged14} value={wins?.objectsChanged ?? 0} />
        <Kpi label={WORK_TEXT.changedToday} value={changedToday} />
      </div>
      <div className="flex h-32 items-end gap-1" aria-hidden="true">
        {days.map((d, k) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div
              data-win-bar=""
              data-day={d.day}
              data-count={counts[k]}
              title={`${d.day}: ${counts[k]}`}
              className="w-full rounded-sm bg-[var(--work-ok)]"
              style={{ height: `${(counts[k] / max) * 100}%`, minHeight: counts[k] ? 2 : 0 }}
            />
            <span className="text-[10px] text-fg-muted">{weekday(d.day)}</span>
          </div>
        ))}
      </div>
      <section aria-label={WORK_TEXT.whatGotDone} className="flex min-w-0 flex-col gap-1">
        <h3 className="text-[12px] font-medium text-fg-muted">{WORK_TEXT.whatGotDone}</h3>
        <ul className="flex min-w-0 flex-col">
          {got.map((g) => (
            <li key={`${g.at}|${g.path}|${g.text}`} className="flex min-h-9 min-w-0 items-center gap-2 border-b border-line px-1 py-1 text-[13px]">
              <span className="shrink-0 text-[12px] tabular-nums text-fg-muted">
                {formatInZone(g.at, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-US', zone)}
              </span>
              <button type="button" onClick={() => openItemPanel(g.path)} className="min-w-0 truncate text-left text-fg hover:underline">
                {g.title}
              </button>
              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">{g.text}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-[13px] text-fg-muted">{WORK_TEXT.noStreaks}</p>
    </div>
  )
}
