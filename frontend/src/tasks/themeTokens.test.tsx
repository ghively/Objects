// Light themes: no `[color-scheme:dark]` forced on native pickers and no Tailwind palette
// literals in the tasks and trash screens; colours come from the theme tokens (audit 2026-11-01).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { DeadlineLabel } from './DeadlineLabel'

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

  test('"Missed" is the danger token, "Planned past the deadline" the warning token', () => {
    const today = new Date(2026, 9, 31)
    render(<DeadlineLabel deadline={{ start: '2026-10-25', resolution: 'day' }} date={{ start: '2026-10-28', resolution: 'day' }} today={today} />)
    expect(screen.getByText('Missed').className).toContain('var(--danger)')
    expect(screen.getByText('Planned past the deadline').className).toContain('var(--warning)')
  })
})
