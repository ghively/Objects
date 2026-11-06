// M23 Task 11: the Projects map. One card per line (a project's steps then its tasks, or an area's
// loose work): its title, the open count, a line of stations (done filled, doing glowing, waiting
// dashed, not started hollow), a progress meter, the percent done and the next step for Gene. A
// station opens its item.
import type { JSX } from 'react'
import { cn } from '@/lib/utils'
import { StatusIcon } from '../components/StatusIcon'
import { projectLines, type MapLine, type Station } from '../logic/stations'
import { openItemPanel } from '../state/workActions'
import type { WorkDataState } from '../state/useWorkData'
import { WORK_TEXT } from '../workText'

function StationDot({ station }: { station: Station }): JSX.Element {
  return (
    <button
      type="button"
      data-station={station.key}
      data-state={station.state}
      title={station.label}
      aria-label={station.label}
      onClick={() => openItemPanel(station.path)}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full p-0.5 hover:bg-hover',
        station.state === 'doing' && 'ring-2 ring-[var(--work-you)]',
      )}
    >
      <StatusIcon state={station.state} />
    </button>
  )
}

function LineCard({ line }: { line: MapLine }): JSX.Element {
  const open = line.stations.filter((s) => s.state !== 'done').length
  return (
    <section data-map-line={line.key} className="flex min-w-0 flex-col gap-2 rounded border border-line px-3 py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="truncate text-[14px] font-medium text-fg">{line.title}</h3>
        <span className="shrink-0 text-[12px] text-fg-muted">{WORK_TEXT.openCount(open)}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {line.stations.map((s, k) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            {k > 0 && <span aria-hidden="true" className="h-px w-3 bg-line" />}
            <StationDot station={s} />
          </span>
        ))}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={line.percentDone}
        aria-label={WORK_TEXT.percentDone(line.percentDone)}
        className="h-1 w-full overflow-hidden rounded-full bg-line"
      >
        <div className="h-full bg-[var(--work-ok)]" style={{ width: `${line.percentDone}%` }} />
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-[12px]">
        <span className="text-fg-muted">{WORK_TEXT.percentDone(line.percentDone)}</span>
        {line.nextForYou && (
          <button
            type="button"
            onClick={() => openItemPanel(line.nextForYou!.path)}
            className="min-w-0 truncate text-left text-[var(--work-you)] hover:underline"
          >
            {WORK_TEXT.nextForYou(line.nextForYou.text)}
          </button>
        )}
      </div>
    </section>
  )
}

export function ProjectsMapView({ data }: { data: WorkDataState; now: Date }): JSX.Element {
  const lines = projectLines(data.board?.items ?? [])
  return (
    <div data-work-view="projects" className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
      {lines.map((l) => (
        <LineCard key={l.key} line={l} />
      ))}
    </div>
  )
}
