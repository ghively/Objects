// "Task Stats" (`components.RootTask.habitStats.*`) under the property panel of a recurring Task:
// Streak (with "At risk" / "Keep it up" / "Start today"), Best, Completions (All-time), Completion
// rate ("Completed vs skipped or missed") and the occurrence grid (the last 26 scheduled
// occurrences and the next 4), each cell's state name its tooltip. The server computes everything
// (`GET /api/tasks/stats`); a task that isn't recurring (422) shows nothing. Reading writes nothing.
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { lineColor } from '@/theme/palette'
import { taskClient, type TaskClient, type TaskStats } from './taskContract'
import { CELL_STATE_LABEL, STATS_TEXT, rateText, streakBadge, streakText, type CellState } from './taskStats'

const CELL_STYLE: Record<CellState, { background?: string; border?: string }> = {
  completed: { background: lineColor('green') },
  excused: { background: lineColor('blue') },
  skipped: { background: lineColor('yellow') },
  missed: { background: lineColor('red') },
  future: { border: '1.5px dashed var(--text-muted)' },
  none: { background: 'var(--bg-hover)' },
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-line px-3 py-2">
      <span className="text-[12px] text-fg-muted">{label}</span>
      <span className="text-[16px] font-semibold text-fg">{value}</span>
      {sub && <span className="text-[12px] text-fg-muted">{sub}</span>}
    </div>
  )
}

export function TaskStatsSection({
  path,
  version,
  client = taskClient,
}: {
  path: string
  version: string
  /** Injected in tests. */
  client?: Pick<TaskClient, 'taskStats'>
}) {
  const [stats, setStats] = useState<TaskStats | null>(null)

  useEffect(() => {
    let alive = true
    client.taskStats(path).then(
      (s) => alive && setStats(s ?? null),
      () => alive && setStats(null),
    )
    return () => {
      alive = false
    }
  }, [path, version, client])

  if (!stats) return null
  const badge = streakBadge(stats)
  return (
    <section aria-label={STATS_TEXT.heading} className="mt-4 flex flex-col gap-2" data-testid="task-stats">
      <h3 className="text-[14px] font-semibold text-fg">{STATS_TEXT.heading}</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={STATS_TEXT.currentStreak} value={streakText(stats.currentStreak, stats.unit)} sub={badge} />
        <Tile label={STATS_TEXT.bestStreak} value={streakText(stats.bestStreak, stats.unit)} />
        <Tile label={STATS_TEXT.completions} value={String(stats.completions)} sub={STATS_TEXT.allTime} />
        <Tile label={STATS_TEXT.completionRate} value={rateText(stats.completionRate)} sub={STATS_TEXT.completionRateSubtitle} />
      </div>
      {stats.cells.length > 0 && (
        <div role="list" aria-label="Occurrences" className="flex flex-wrap gap-1">
          {stats.cells.map((c, i) => (
            <span
              key={`${c.scheduled}-${i}`}
              role="listitem"
              title={CELL_STATE_LABEL[c.state]}
              aria-label={`${c.scheduled.slice(0, 10)}: ${CELL_STATE_LABEL[c.state]}`}
              data-state={c.state}
              className={cn('size-3.5 rounded-[3px]')}
              style={CELL_STYLE[c.state]}
            />
          ))}
        </div>
      )}
    </section>
  )
}
