// Formatting for the "Task Stats" section (`components.RootTask.habitStats.*`): the server
// computes the numbers (`GET /api/tasks/stats`); these helpers only name them.
import type { TaskStats } from './taskContract'

export type CellState = TaskStats['cells'][number]['state']

export const STATS_TEXT = {
  heading: 'Task Stats',
  currentStreak: 'Streak',
  bestStreak: 'Best',
  completions: 'Completions',
  completionRate: 'Completion rate',
  completionRateSubtitle: 'Completed vs skipped or missed',
  allTime: 'All-time',
  atRisk: 'At risk',
  keepGoing: 'Keep it up',
  startToday: 'Start today',
} as const

/** `components.RootTask.habitStats.cellState.*`: each grid cell's tooltip. */
export const CELL_STATE_LABEL: Record<CellState, string> = {
  completed: 'Completed',
  excused: 'Excused',
  skipped: 'Skipped',
  missed: 'Missed',
  future: 'Scheduled',
  none: 'No occurrence',
}

const UNITS: Record<TaskStats['unit'], [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['year', 'years'],
}

/** `dayUnit` … `yearUnit` ("day | days"): the unit for a count. */
export const unitLabel = (unit: TaskStats['unit'], n: number): string => (UNITS[unit] ?? UNITS.day)[n === 1 ? 0 : 1]

/** "3 days". */
export const streakText = (n: number, unit: TaskStats['unit']): string => `${n} ${unitLabel(unit, n)}`

/** The streak's badge: "At risk", "Keep it up" or "Start today". */
export function streakBadge(stats: Pick<TaskStats, 'atRisk' | 'currentStreak'>): string {
  if (stats.atRisk) return STATS_TEXT.atRisk
  return stats.currentStreak > 0 ? STATS_TEXT.keepGoing : STATS_TEXT.startToday
}

/** The completion rate as a whole percent ("75%"); "–" when nothing counts yet (our choice). */
export const rateText = (rate: number | null): string => (rate === null || !Number.isFinite(rate) ? '–' : `${Math.round(rate * 100)}%`)
