// The right panel's mini month: Month ▾ Year ▾ with ‹ › around a 6×7 grid. Today is a filled red
// rounded square, the selected day a neutral one, days outside the month are muted, and a small dot
// marks each day that has a daily note (our marker).
import { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { monthGrid, monthName, type Day, type WeekStart } from './dates'
import { useCalendarRange } from './useCalendarRange'

const SUNDAY_FIRST = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONDAY_FIRST = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const YEAR_SPAN = 50

export interface MiniMonthProps {
  /** The calendar's active day. */
  anchor: Day
  /** The viewer's local day. */
  today: Day
  weekStart: WeekStart
  onSelect(day: Day): void
}

interface Shown {
  year: number
  month: number
}

const shownOf = (day: Day): Shown => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) })

function shift({ year, month }: Shown, n: number): Shown {
  const total = year * 12 + (month - 1) + n
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

const NAV_BTN =
  'flex size-10 items-center justify-center rounded-lg border border-line text-fg-muted hover:bg-hover hover:text-fg'
const DROP_BTN = 'flex h-10 items-center gap-1.5 rounded-lg px-3 text-[15px] font-medium text-fg hover:bg-hover'

export function MiniMonth({ anchor, today, weekStart, onSelect }: MiniMonthProps) {
  const [shown, setShown] = useState<Shown>(() => shownOf(anchor))
  // The shown month follows the calendar when the anchor moves to another month.
  const anchorMonth = anchor.slice(0, 7)
  const [followed, setFollowed] = useState(anchorMonth)
  if (followed !== anchorMonth) {
    setFollowed(anchorMonth)
    setShown(shownOf(anchor))
  }

  const grid = useMemo(() => monthGrid(shown.year, shown.month, weekStart), [shown, weekStart])
  const range = useMemo(() => ({ from: grid[0][0], to: grid[5][6] }), [grid])
  const { data } = useCalendarRange(range)
  const prefix = `${String(shown.year).padStart(4, '0')}-${String(shown.month).padStart(2, '0')}`
  const thisYear = Number(today.slice(0, 4))
  const years = useMemo(() => {
    const ys: number[] = []
    for (let y = thisYear - YEAR_SPAN; y <= thisYear + YEAR_SPAN; y++) ys.push(y)
    if (!ys.includes(shown.year)) ys.push(shown.year)
    return ys.sort((a, b) => a - b)
  }, [thisYear, shown.year])

  return (
    <div className="border-b border-line px-3 pt-4 pb-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Go to previous month"
          title="Go to previous month"
          className={NAV_BTN}
          onClick={() => setShown((s) => shift(s, -1))}
        >
          <Icon name="ph-caret-left" size={16} />
        </button>
        <div className="flex items-center rounded-lg border border-line">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Month" title="Jump to" className={DROP_BTN}>
                {monthName(shown.month)}
                <Icon name="ph-caret-down" size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-80 overflow-auto border-line bg-raised">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <DropdownMenuItem key={m} onSelect={() => setShown((s) => ({ ...s, month: m }))}>
                  {monthName(m)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Year" title="Jump to" className={DROP_BTN}>
                {shown.year}
                <Icon name="ph-caret-down" size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-80 overflow-auto border-line bg-raised">
              {years.map((y) => (
                <DropdownMenuItem key={y} onSelect={() => setShown((s) => ({ ...s, year: y }))}>
                  {y}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <button
          type="button"
          aria-label="Go to next month"
          title="Go to next month"
          className={NAV_BTN}
          onClick={() => setShown((s) => shift(s, 1))}
        >
          <Icon name="ph-caret-right" size={16} />
        </button>
      </div>

      <div role="grid" aria-label={`${monthName(shown.month)} ${shown.year}`} className="mt-6">
        <div role="row" className="grid grid-cols-7">
          {(weekStart === 'monday' ? MONDAY_FIRST : SUNDAY_FIRST).map((w) => (
            <div key={w} role="columnheader" className="py-2 text-center text-sm text-fg-muted">
              {w}
            </div>
          ))}
        </div>
        {grid.map((row) => (
          <div key={row[0]} role="row" className="grid grid-cols-7 gap-y-1">
            {row.map((day) => {
              const outside = !day.startsWith(prefix)
              const isToday = day === today
              const selected = day === anchor && !isToday
              const hasNote = !!data?.days[day]?.dailyNote
              return (
                <div key={day} role="gridcell" className="flex justify-center">
                  <button
                    type="button"
                    aria-label={day}
                    aria-current={isToday ? 'date' : undefined}
                    aria-selected={day === anchor}
                    data-outside={outside || undefined}
                    data-has-note={hasNote || undefined}
                    onClick={() => onSelect(day)}
                    className={cn(
                      'relative flex h-10 w-16 items-center justify-center rounded-xl text-[15px] font-semibold',
                      outside ? 'font-normal text-fg-muted' : 'text-fg',
                      isToday ? 'bg-today text-white' : selected ? 'bg-hover-2' : 'hover:bg-hover',
                    )}
                  >
                    {Number(day.slice(8))}
                    {hasNote && (
                      <span
                        aria-hidden
                        data-testid="daily-note-dot"
                        className={cn('absolute bottom-1 size-1 rounded-full', isToday ? 'bg-white' : 'bg-fg-muted')}
                      />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
