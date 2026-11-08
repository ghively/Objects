// M23 Task 12: Today. The day's name, a horizontal 07:00-17:30 timeline with hour marks and the
// blocks (Morning brief, meetings, focus lines in the free gaps, Wrap-up: ported), a now-line while
// now is inside the range (moved every minute), the deadline countdowns (amber under 21 days,
// ported), and the focus lines with their slot times. A meeting click opens it in the side panel.
import type { JSX } from 'react'
import { useTabs } from '@/nav/tabs'
import { cn } from '@/lib/utils'
import { formatInZone, zonedParts } from '@/lib/zonedTime'
import { Chip, type ChipTone } from '../components/Chip'
import { dayBlocks, type DayBlock } from '../logic/daySlots'
import { deadlines } from '../logic/deadlines'
import type { WorkDataState } from '../state/useWorkData'
import { WORK_ICONS } from '../workIcons'
import { WORK_TEXT } from '../workText'

const DAY_START = 7 * 60
const DAY_END = 17 * 60 + 30
const SPAN = DAY_END - DAY_START
/** Deadline countdowns turn amber under this many days (ported). */
const DEADLINE_AMBER = 21

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const clamp = (m: number) => Math.min(Math.max(m, DAY_START), DAY_END)
const pct = (m: number) => `${((clamp(m) - DAY_START) / SPAN) * 100}%`

const BLOCK_TONE: Record<DayBlock['kind'], ChipTone> = {
  meeting: 'you',
  focus: 'you',
  brief: 'muted',
  wrapUp: 'muted',
}

// Meetings in the you tone, focus lines in the accent (Object's accent is the you indigo; a focus
// block is its outline), the brief and the wrap-up muted.
const BLOCK_CLASS: Record<DayBlock['kind'], string> = {
  meeting: 'border-[var(--work-you)] bg-[var(--work-you-bg)] text-[var(--work-you)]',
  focus: 'border-dashed border-[var(--work-you)] text-[var(--work-you)]',
  brief: 'border-line text-fg-muted',
  wrapUp: 'border-line text-fg-muted',
}

function Block({ b }: { b: DayBlock }): JSX.Element {
  const start = clamp(b.start)
  const end = clamp(b.end)
  const time = `${hhmm(b.start)}-${hhmm(b.end)}`
  const body = (
    <>
      <span className="truncate text-[12px] font-medium">{b.label}</span>
      <span className="truncate text-[11px] opacity-80">{time}</span>
    </>
  )
  const style = { left: pct(start), width: `${((end - start) / SPAN) * 100}%` }
  const cls = cn(
    'absolute top-0 flex h-full min-w-0 flex-col justify-center overflow-hidden rounded border px-1.5 text-left',
    BLOCK_CLASS[b.kind],
  )
  const attrs = {
    'data-block-kind': b.kind,
    'data-start': hhmm(b.start),
    'data-end': hhmm(b.end),
    'data-tone': BLOCK_TONE[b.kind],
    title: `${b.label} ${time}`,
  }
  if (b.kind === 'meeting' && b.path) {
    const path = b.path
    return (
      <button
        type="button"
        {...attrs}
        style={style}
        className={cn(cls, 'hover:opacity-90')}
        onClick={() => useTabs.getState().openInSidepanel({ kind: 'object', path })}
      >
        {body}
      </button>
    )
  }
  return (
    <div {...attrs} style={style} className={cls}>
      {body}
    </div>
  )
}

export function TodayView({ data, now }: { data: WorkDataState; now: Date }): JSX.Element {
  // The now-line moves every minute: `now` is the page's clock, which ticks once a minute already.
  const zone = data.board?.timeZone ?? undefined
  const parts = zonedParts(now, zone)
  const nowMinutes = parts.hour * 60 + parts.minute
  const day = data.today?.day ?? data.board?.today ?? parts.date

  const blocks = dayBlocks(data.today?.meetings ?? [], data.focus?.lines ?? [], nowMinutes)
  const focusBlocks = blocks.filter((b) => b.kind === 'focus')
  const due = deadlines(data.board?.items ?? [], day)
  const hours = Array.from({ length: 11 }, (_, k) => 7 + k)
  const inRange = nowMinutes >= DAY_START && nowMinutes <= DAY_END

  return (
    <div data-work-view="today" className="flex min-w-0 flex-col gap-4">
      <h2 className="text-[15px] font-semibold text-fg">
        {formatInZone(`${day}T12:00:00Z`, { weekday: 'long', month: 'long', day: 'numeric' }, 'en-US', 'UTC')}
      </h2>

      <div className="overflow-x-auto">
        <div className="relative min-w-[640px] px-2 pb-1">
          <div className="relative h-4 text-[11px] text-fg-muted">
            {hours.map((h) => (
              <span key={h} data-hour-mark={h} className="absolute -translate-x-1/2" style={{ left: pct(h * 60) }}>
                {String(h).padStart(2, '0')}
              </span>
            ))}
          </div>
          <div className="relative h-14 rounded border border-line">
            {hours.map((h) => (
              <span
                key={h}
                aria-hidden="true"
                className="absolute top-0 h-full border-l border-line"
                style={{ left: pct(h * 60) }}
              />
            ))}
            {blocks.map((b) => (
              <Block key={`${b.kind}-${b.start}-${b.label}`} b={b} />
            ))}
            {inRange && (
              <span
                data-work-now-line=""
                data-time={hhmm(nowMinutes)}
                aria-hidden="true"
                className="absolute -top-1 z-10 h-[calc(100%+0.5rem)] w-0.5 bg-[var(--work-critical)]"
                style={{ left: `${((nowMinutes - DAY_START) / SPAN) * 100}%` }}
              />
            )}
          </div>
        </div>
      </div>

      {due.length > 0 && (
        <section className="flex flex-col">
          <h3 className="text-[12px] font-medium text-fg-muted">{WORK_TEXT.deadlines}</h3>
          {due.map((d) => (
            <div key={d.path} data-work-deadline={d.path} className="flex h-9 items-center gap-2 text-[13px]">
              <Chip tone={d.daysLeft < DEADLINE_AMBER ? 'high' : 'muted'} icon={WORK_ICONS.deadline}>
                {WORK_TEXT.daysLeft(d.daysLeft)}
              </Chip>
              <span className="truncate text-fg">{d.title}</span>
              <span className="text-[12px] text-fg-muted">{d.deadline}</span>
            </div>
          ))}
        </section>
      )}

      {focusBlocks.length > 0 && (
        <section data-work-focus-slots="" className="flex flex-col">
          {focusBlocks.map((b, k) => (
            <div key={`${b.start}-${k}`} className="flex h-9 items-center gap-2 text-[13px]">
              <Chip tone="you" icon={WORK_ICONS.focus}>
                {`${hhmm(b.start)}-${hhmm(b.end)}`}
              </Chip>
              <span className="truncate text-fg">{b.label}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
