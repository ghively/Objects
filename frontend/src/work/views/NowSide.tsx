// M23 Task 10: Now's side column: Up next (the next 3 of the pool, then `+N more hidden on
// purpose`), Agent is carrying, the focus widget (today's lines with progress, Edit, Keep on top),
// Parked dumps need you (only when there are any), Next meeting, Deadlines (amber under 21 days,
// ported), Alerts (active, not Info; none: `All quiet`) and Wins. Rows are about 36 px; a click on
// a row opens the item panel.
import { useState, type JSX, type ReactNode } from 'react'
import type { WorkBoardItem } from '@/api/types'
import { Icon } from '@/components/Icon'
import { useTabs } from '@/nav/tabs'
import { cn } from '@/lib/utils'
import { Chip } from '../components/Chip'
import { deadlines } from '../logic/deadlines'
import { focusProgress, isCleared } from '../logic/focusLines'
import { STEP_ENERGY, upNext } from '../logic/scoring'
import { FocusEditor } from '../page/FocusEditor'
import { KeepOnTopButton } from '../session/KeepOnTopButton'
import type { WorkDataState } from '../state/useWorkData'
import { openItemPanel } from '../state/workActions'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'
import { currentStepOf } from './NowCard'

/** Deadline countdowns turn amber under this many days (ported). */
const DEADLINE_AMBER = 21
const AGENT_ROWS = 5
const ALERT_ROWS = 5

// Ours; not in `WORK_TEXT` yet, kept here until the review.
const NO_MEETING = 'No more meetings today'
const STEPS_TODAY = 'Steps done today'
const FOCUS = 'Focus'

const ROW = 'flex min-h-9 w-full min-w-0 items-center gap-2 rounded px-1.5 text-left text-[13px] text-fg hover:bg-hover'

function Side({ id, label, icon, children }: { id: string; label: string; icon?: string; children: ReactNode }): JSX.Element {
  return (
    <section data-now-side={id} aria-label={label} className="flex min-w-0 flex-col gap-1">
      <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
        {icon ? <Icon name={icon} size={13} /> : null}
        {label}
      </h3>
      {children}
    </section>
  )
}

function UpNext({ pool }: { pool: WorkBoardItem[] }): JSX.Element {
  const { shown, hidden } = upNext(pool)
  return (
    <Side id="upNext" label={WORK_TEXT.upNext}>
      {shown.map((i) => {
        const step = currentStepOf(i)
        const energy = step ? STEP_ENERGY[step.kind] : null
        return (
          <button key={i.path} type="button" data-now-row={i.path} className={ROW} onClick={() => openItemPanel(i.path)}>
            <span className="w-4 shrink-0 text-fg-muted">{energy ? <Icon name={WORK_ICONS[energy]} size={13} /> : null}</span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{i.title}</span>
              {step ? <span className="truncate text-[12px] text-fg-muted">{step.text}</span> : null}
            </span>
          </button>
        )
      })}
      {hidden > 0 ? <span className="px-1.5 text-[12px] text-fg-muted">{WORK_TEXT.hiddenOnPurpose(hidden)}</span> : null}
    </Side>
  )
}

function AgentCarrying({ data }: { data: WorkDataState }): JSX.Element | null {
  const agent = data.agent
  const rows: { key: string; path: string; title: string; text: string | null }[] =
    agent?.available
      ? agent.rows
          .filter((r) => r.state === 'running' || r.state === 'pending')
          .map((r) => ({ key: r.id, path: r.path, title: r.title, text: r.stepText }))
      : (data.board?.items ?? [])
          .filter((i) => !i.done && i.turn === 'agent')
          .map((i) => ({ key: i.path, path: i.path, title: i.title, text: currentStepOf(i)?.text ?? null }))
  if (!rows.length) return null
  return (
    <Side id="agent" label={WORK_TEXT.agentIsCarrying} icon={WORK_ICONS.agent}>
      {rows.slice(0, AGENT_ROWS).map((r) => (
        <button key={r.key} type="button" data-now-row={r.path} className={ROW} onClick={() => openItemPanel(r.path)}>
          <span className="shrink-0 text-[var(--work-agent)]">
            <Icon name={WORK_ICONS.agent} size={13} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{r.title}</span>
            {r.text ? <span className="truncate text-[12px] text-fg-muted">{r.text}</span> : null}
          </span>
        </button>
      ))}
    </Side>
  )
}

function FocusWidget({ data }: { data: WorkDataState }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const lines = data.focus?.lines ?? []
  const items = data.board?.items ?? []
  return (
    <Side id="focus" label={FOCUS} icon={WORK_ICONS.focus}>
      {editing ? (
        <FocusEditor focus={data.focus} onClose={() => setEditing(false)} />
      ) : (
        <>
          {lines.length === 0 ? <span className="px-1.5 text-[12px] text-fg-muted">{WORK_TEXT.noFocusLines}</span> : null}
          {lines.map((l) => {
            const p = focusProgress(l, items)
            const done = isCleared(l, items)
            const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
            return (
              <div key={l.n} data-now-focus={l.n} className="flex min-h-9 min-w-0 flex-col justify-center gap-1 px-1.5">
                <span className={cn('truncate text-[13px] text-fg', done && 'text-fg-muted line-through')}>
                  {WORK_TEXT.focusLine(l.n, l.label)}
                </span>
                <span
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={p.total}
                  aria-valuenow={p.done}
                  aria-label={WORK_TEXT.focusLine(l.n, l.label)}
                  className="h-1 w-full overflow-hidden rounded bg-[var(--work-others-bg)]"
                >
                  <span className="block h-full bg-[var(--work-you)]" style={{ width: `${pct}%` }} />
                </span>
              </div>
            )
          })}
          <div className="flex flex-wrap gap-2 px-1.5">
            <button
              type="button"
              className="h-7 rounded border border-line px-2 text-[12px] text-fg-muted hover:bg-hover"
              onClick={() => setEditing(true)}
            >
              {WORK_TEXT.edit}
            </button>
            <KeepOnTopButton />
          </div>
        </>
      )}
    </Side>
  )
}

function Dumps({ data }: { data: WorkDataState }): JSX.Element | null {
  const dumps = data.needsYou ?? []
  if (!dumps.length) return null
  return (
    <Side id="dumps" label={WORK_TEXT.parkedDumps} icon={WORK_ICONS.capture}>
      {dumps.map((d) => (
        <button
          key={d.path}
          type="button"
          data-now-row={d.path}
          className={ROW}
          onClick={() => useTabs.getState().openInSidepanel({ kind: 'object', path: d.path })}
        >
          <span className="shrink-0 text-[var(--work-capture)]">
            <Icon name={WORK_ICONS.capture} size={13} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{d.text}</span>
            {d.question ? <span className="truncate text-[12px] text-fg-muted">{d.question}</span> : null}
          </span>
        </button>
      ))}
    </Side>
  )
}

function NextMeeting({ data, now }: { data: WorkDataState; now: Date }): JSX.Element {
  const next = (data.today?.meetings ?? []).find((m) => new Date(m.start).getTime() > now.getTime()) ?? null
  return (
    <Side id="meeting" label={WORK_TEXT.nextMeeting} icon={WORK_ICONS.meeting}>
      {next ? (
        <button
          type="button"
          data-now-row={next.path}
          className={ROW}
          onClick={() => useTabs.getState().openInSidepanel({ kind: 'object', path: next.path })}
        >
          <span className="shrink-0 text-[12px] tabular-nums text-fg-muted">{next.startLocal}</span>
          <span className="truncate">{next.title}</span>
        </button>
      ) : (
        <span className="px-1.5 text-[12px] text-fg-muted">{NO_MEETING}</span>
      )}
    </Side>
  )
}

function Deadlines({ data }: { data: WorkDataState }): JSX.Element | null {
  const rows = data.board ? deadlines(data.board.items, data.board.today) : []
  if (!rows.length) return null
  return (
    <Side id="deadlines" label={WORK_TEXT.deadlines} icon={WORK_ICONS.deadline}>
      {rows.map((d) => (
        <button key={d.path} type="button" data-now-row={d.path} className={ROW} onClick={() => openItemPanel(d.path)}>
          <span className="min-w-0 flex-1 truncate">{d.title}</span>
          <Chip tone={d.daysLeft < DEADLINE_AMBER ? 'high' : 'muted'}>{WORK_TEXT.daysLeft(d.daysLeft)}</Chip>
        </button>
      ))}
    </Side>
  )
}

function Alerts({ data }: { data: WorkDataState }): JSX.Element {
  const active = (data.alerts?.alerts ?? []).filter((a) => a.active && a.severity !== 'Info')
  return (
    <Side id="alerts" label={WORK_TEXT.alerts} icon={WORK_ICONS.alert}>
      {active.length === 0 ? <span className="px-1.5 text-[12px] text-fg-muted">{WORK_TEXT.allQuiet}</span> : null}
      {active.slice(0, ALERT_ROWS).map((a) => (
        <button
          key={a.path}
          type="button"
          data-now-row={a.path}
          className={ROW}
          onClick={() => useTabs.getState().openInSidepanel({ kind: 'object', path: a.path })}
        >
          <Chip tone={a.severity === 'Critical' ? 'critical' : 'high'}>{a.title}</Chip>
        </button>
      ))}
    </Side>
  )
}

function Wins({ data }: { data: WorkDataState }): JSX.Element {
  const wins = data.wins
  const today = data.board?.today ?? null
  const todays = wins?.days.find((d) => d.day === today)?.stepsDone ?? 0
  return (
    <Side id="wins" label={WORK_TEXT.wins} icon={WORK_ICONS.win}>
      <div className="flex min-h-9 items-center gap-4 px-1.5 text-[12px] text-fg-muted">
        <span>
          {STEPS_TODAY}: <span className="text-fg tabular-nums">{todays}</span>
        </span>
        <span>
          {WORK_TEXT.stepsDone14}: <span className="text-fg tabular-nums">{wins?.stepsDone ?? 0}</span>
        </span>
      </div>
    </Side>
  )
}

export function NowSide({ data, now, pool }: { data: WorkDataState; now: Date; pool: WorkBoardItem[] }): JSX.Element {
  return (
    <aside data-now-sidebar="" className="flex min-w-0 flex-col gap-4">
      {pool.length > 1 ? <UpNext pool={pool} /> : null}
      <AgentCarrying data={data} />
      <FocusWidget data={data} />
      <Dumps data={data} />
      <NextMeeting data={data} now={now} />
      <Deadlines data={data} />
      <Alerts data={data} />
      <Wins data={data} />
    </aside>
  )
}
