import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { TaskStatsSection } from './TaskStatsSection'
import type { TaskStats } from './taskContract'
import { rateText, streakBadge, streakText } from './taskStats'

const STATS: TaskStats = {
  unit: 'day',
  currentStreak: 3,
  bestStreak: 1,
  completions: 7,
  completionRate: 0.75,
  atRisk: false,
  cells: [
    { scheduled: '2026-10-21', state: 'completed' },
    { scheduled: '2026-10-22', state: 'excused' },
    { scheduled: '2026-10-23', state: 'skipped' },
    { scheduled: '2026-10-24', state: 'missed' },
    { scheduled: '2026-10-27', state: 'future' },
    { scheduled: '2026-10-28', state: 'none' },
  ],
}

describe('TaskStatsSection', () => {
  test('test task stats renders streaks rate and grid', async () => {
    const client = { taskStats: vi.fn().mockResolvedValue(STATS) }
    render(<TaskStatsSection path="Tasks/Water plants.md" version="v1" client={client} />)
    const section = await screen.findByRole('region', { name: 'Task Stats' })
    expect(client.taskStats).toHaveBeenCalledWith('Tasks/Water plants.md')
    expect(within(section).getByRole('heading', { name: 'Task Stats' })).toBeInTheDocument()
    for (const s of ['Streak', '3 days', 'Keep it up', 'Best', '1 day', 'Completions', '7', 'All-time', 'Completion rate', '75%', 'Done out of all occurrences due'])
      expect(within(section).getByText(s)).toBeInTheDocument()
    const cells = within(section).getAllByRole('listitem')
    expect(cells.map((c) => c.getAttribute('title'))).toEqual(['Completed', 'Excused', 'Skipped', 'Missed', 'Scheduled', 'No occurrence'])
    expect(cells[0]).toHaveAttribute('aria-label', '2026-10-21: Completed')
  })

  test('a task that is not recurring shows nothing', async () => {
    const client = { taskStats: vi.fn().mockRejectedValue(new Error('422')) }
    const { container } = render(<TaskStatsSection path="Tasks/A.md" version="v1" client={client} />)
    await vi.waitFor(() => expect(client.taskStats).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  test('badges, units and rate', () => {
    expect(streakBadge({ atRisk: true, currentStreak: 2 })).toBe('At risk')
    expect(streakBadge({ atRisk: false, currentStreak: 2 })).toBe('Keep it up')
    expect(streakBadge({ atRisk: false, currentStreak: 0 })).toBe('Start today')
    expect(streakText(1, 'week')).toBe('1 week')
    expect(streakText(0, 'month')).toBe('0 months')
    expect(streakText(2, 'year')).toBe('2 years')
    expect(rateText(null)).toBe('–')
    expect(rateText(1 / 3)).toBe('33%')
  })
})
