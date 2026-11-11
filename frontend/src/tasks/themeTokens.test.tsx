// Light themes: no `[color-scheme:dark]` forced on native pickers and no Tailwind palette
// literals in the tasks and trash screens; colours come from the theme tokens (audit 2026-11-01).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { DeadlineLabel } from './DeadlineLabel'
import { TaskCheckbox } from './TaskCheckbox'
import { TASK_TYPE, taskRow } from './taskFixtures'

const SRC = join(process.cwd(), 'src')
const PALETTE = /\b(?:text|bg|border)-(?:red|amber|yellow|orange|green|blue)-\d{3}\b|\[color-scheme:dark\]/g

function sources(dir: string): string[] {
  return readdirSync(join(SRC, dir))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => `${dir}/${f}`)
}

describe('theme tokens in tasks and trash', () => {
  test('no forced dark pickers and no palette literals', () => {
    const offenders: string[] = []
    for (const f of [...sources('tasks'), ...sources('trash')]) {
      readFileSync(join(SRC, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(PALETTE)) offenders.push(`${f}:${i + 1}: ${m[0]}`)
        })
    }
    expect(offenders).toEqual([])
  })

  // M32: the lists of `views/` (the task lists, the Calendar's day list) draw the title themselves,
  // so the checkbox marks a done task and `tasks.css` strikes the title beside it.
  test('test a done task’s checkbox marks itself and tasks.css strikes the title of its row', () => {
    const { rerender } = render(<TaskCheckbox row={taskRow('Tasks/A.md', { status: ['Done'] })} type={TASK_TYPE} />)
    expect(screen.getByRole('checkbox').closest('[data-task-done]')).not.toBeNull()
    rerender(<TaskCheckbox row={taskRow('Tasks/A.md', { status: ['Next Up'] })} type={TASK_TYPE} />)
    expect(screen.getByRole('checkbox').closest('[data-task-done]')).toBeNull()
    const css = readFileSync(join(SRC, 'tasks/tasks.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toContain("li:has(> [data-slot='leading'] [data-task-done]) > button .truncate")
    expect(css).toContain('text-decoration: line-through')
    expect(css).toContain('var(--text-muted)')
    expect(readFileSync(join(SRC, 'tasks/TaskCheckbox.tsx'), 'utf8')).toContain("import './tasks.css'")
  })

  test('"Missed" is the danger token, "Planned past the deadline" the warning token', () => {
    const today = new Date(2026, 9, 31)
    render(<DeadlineLabel deadline={{ start: '2026-10-25', resolution: 'day' }} date={{ start: '2026-10-28', resolution: 'day' }} today={today} />)
    expect(screen.getByText('Missed').className).toContain('var(--danger)')
    expect(screen.getByText('Planned past the deadline').className).toContain('var(--warning)')
  })
})
