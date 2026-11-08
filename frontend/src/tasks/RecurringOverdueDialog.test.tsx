import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { OverdueInfo } from './taskContract'
import { formatDate } from '@/properties/format'
import { RecurringOverdueDialog, overdueChoices } from './RecurringOverdueDialog'
import { parseRepeat } from './repeat'

const INFO: OverdueInfo = {
  count: 3,
  capped: false,
  missed: ['2026-10-24', '2026-10-25', '2026-10-26'],
  current: { start: '2026-10-24', resolution: 'day' },
  today: '2026-10-27',
}
const day = (s: string) => formatDate({ start: s, resolution: 'day' })

describe('RecurringOverdueDialog', () => {
  test('test overdue dialog strings match the catalog', () => {
    const rule = parseRepeat('every day')
    const cases = [
      {
        action: 'complete' as const,
        title: 'Mark recurring task done',
        description: '"Water plants" is overdue by 3 occurrences. Which instance are you marking done?',
        buttons: [
          [`Mark as done for ${day('2026-10-24')}`, 'This occurrence only'],
          [`Mark as done for ${day('2026-10-26')}`, 'All missed before today'],
          [`Mark as done for ${day('2026-10-26')}`, 'Also logs all missed as done'],
        ],
      },
      {
        action: 'skip' as const,
        title: 'Skip recurring task',
        description: '"Water plants" is overdue by 3 occurrences. Which instance are you skipping?',
        buttons: [
          [`Skip to ${day('2026-10-25')}`, 'This occurrence only'],
          [`Skip to ${day('2026-10-27')}`, 'All missed before today'],
          [`Skip to ${day('2026-10-27')}`, 'Also skips all missed'],
        ],
      },
      {
        action: 'excuse' as const,
        title: 'Excuse recurring occurrence',
        description: '"Water plants" is overdue by 3 occurrences. Which occurrence are you excusing?',
        buttons: [
          [`Excuse for ${day('2026-10-24')}`, 'This occurrence only'],
          [`Excuse for ${day('2026-10-26')}`, 'All missed before today'],
        ],
      },
    ]
    for (const c of cases) {
      const { unmount } = render(
        <RecurringOverdueDialog open action={c.action} title="Water plants" info={INFO} rule={rule} onChoose={() => {}} onOpenChange={() => {}} />,
      )
      const dialog = screen.getByRole('alertdialog')
      expect(within(dialog).getByText(c.title)).toBeInTheDocument()
      expect(within(dialog).getByText(c.description)).toBeInTheDocument()
      const buttons = within(dialog)
        .getAllByRole('button')
        .filter((b) => b.dataset.catchUp)
      expect(buttons.map((b) => [b.children[0].textContent, b.children[1].textContent])).toEqual(c.buttons)
      unmount()
    }
  })

  test('the count is capped as "{count}+"', () => {
    render(
      <RecurringOverdueDialog
        open
        action="complete"
        title="T"
        info={{ ...INFO, count: 99, capped: true }}
        rule={parseRepeat('every day')}
        onChoose={() => {}}
        onOpenChange={() => {}}
      />,
    )
    expect(screen.getByText('"T" is overdue by 99+ occurrences. Which instance are you marking done?')).toBeInTheDocument()
  })

  test('a choice reports its catch-up; skip names the next day of a custom rule', async () => {
    const onChoose = vi.fn()
    render(<RecurringOverdueDialog open action="skip" title="T" info={INFO} rule={parseRepeat('every day')} onChoose={onChoose} onOpenChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /Also skips all missed/ }))
    expect(onChoose).toHaveBeenCalledWith('catchUpThroughNow')
    // every week on mon, fri, missed 2026-10-23 and 2026-10-26: caught up on Friday 2026-10-30
    const info = { ...INFO, count: 2, missed: ['2026-10-23', '2026-10-26'], current: { start: '2026-10-23', resolution: 'day' as const } }
    const labels = overdueChoices('skip', info, parseRepeat('every week on mon, fri')).map((c) => c.label)
    expect(labels).toEqual([`Skip to ${day('2026-10-26')}`, `Skip to ${day('2026-10-30')}`, `Skip to ${day('2026-10-30')}`])
  })
})
