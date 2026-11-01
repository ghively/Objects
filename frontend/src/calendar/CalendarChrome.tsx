// The Calendar's top bar: period title on the left, the centred Month · Week · Three days · Day
// segmented control, and on the right the ‹ Today › pager and the calendar-sidebar toggle.
import { useEffect, useRef } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { useZonedToday } from '@/lib/zonedShell'
import { currentTarget, useTabs, type Target } from '@/nav/tabs'
import { formatMonthTitle, todayYmd, weekNumber, type CalendarView, type WeekStart } from './dates'
import { useCalendar, type StepKey } from './useCalendar'

/** Labels (`RenderWeek.*`) and tooltips (`shortcuts.setViewTo*.name`), in the control's order. */
const VIEW_TABS: { view: CalendarView; label: string; tooltip: string }[] = [
  { view: 'month', label: 'Month', tooltip: 'Go to monthly view' },
  { view: 'week', label: 'Week', tooltip: 'Go to weekly view' },
  { view: 'rolling', label: 'Three days', tooltip: 'Go to 3 days rolling view' },
  { view: 'day', label: 'Day', tooltip: 'Go to daily view' },
]

/**
 * Calendar shortcut keys. The trimmed reference has the shortcut ids and names
 * (`shortcuts.setViewTo*`, `goToToday`) but not their key bindings (the bundle that holds them is
 * not in `reference/`), so these keys are ours: one letter per view, T for today.
 */
const VIEW_KEYS: Record<string, CalendarView> = { m: 'month', w: 'week', r: 'rolling', d: 'day' }
const TODAY_KEY = 't'

const PREVIOUS_TIP = 'Go to previous day, week, or month'
const NEXT_TIP = 'Go to next day, week, or month'
const TODAY_TIP = 'Set active date to today'
const HIDE_SIDEBAR = 'Hide calendar sidebar'
const SHOW_SIDEBAR = 'Show calendar sidebar'

const ARROWS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** Inputs, text areas, selects, contenteditable (the inline daily note) and CodeMirror. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false
  if (el.closest('input, textarea, select, .cm-editor')) return true
  const ce = el.closest('[contenteditable]')
  return !!ce && ce.getAttribute('contenteditable') !== 'false'
}

export interface CalendarChromeProps {
  weekStart: WeekStart
  rightPanelOpen: boolean
  onToggleRightPanel: () => void
  onOpenTarget: (t: Target) => void
}

export function CalendarChrome({ weekStart, rightPanelOpen, onToggleRightPanel, onOpenTarget }: CalendarChromeProps) {
  const view = useCalendar((s) => s.view)
  const anchor = useCalendar((s) => s.anchor)
  const { setView, previous, next } = useCalendar.getState()
  // Re-renders when the day changes, so the Today button's bold state rolls over at midnight.
  const today = useZonedToday()

  const openTargetRef = useRef(onOpenTarget)
  useEffect(() => {
    openTargetRef.current = onOpenTarget
  }, [onOpenTarget])

  // Shift+Today also opens today's daily note as a page, when it exists (it is never created here).
  const goToday = (openNote: boolean) => {
    useCalendar.getState().today()
    if (!openNote) return
    const day = todayYmd()
    api
      .calendar(day, day)
      .then((r) => {
        const note = r?.days?.[day]?.dailyNote
        if (note) openTargetRef.current({ kind: 'object', path: note.path })
      })
      .catch((e: unknown) => console.warn("Could not look up today's daily note:", e))
  }
  const goTodayRef = useRef(goToday)
  useEffect(() => {
    goTodayRef.current = goToday
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (currentTarget(useTabs.getState())?.kind !== 'calendar') return
      if (isEditable(e.target) || isEditable(document.activeElement)) return
      // A modal (the peek, settings, a dialog or popover) has the keyboard.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if (ARROWS.has(e.key)) {
        if (e.shiftKey) return
        e.preventDefault()
        useCalendar.getState().step(e.key as StepKey)
        return
      }
      const key = e.key.toLowerCase()
      if (key === TODAY_KEY) {
        e.preventDefault()
        goTodayRef.current(e.shiftKey)
      } else if (!e.shiftKey && VIEW_KEYS[key]) {
        e.preventDefault()
        useCalendar.getState().setView(VIEW_KEYS[key])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const title =
    view === 'day' ? null : view === 'week' ? `Week ${weekNumber(anchor, weekStart)}` : formatMonthTitle(anchor)
  const sidebarTip = rightPanelOpen ? HIDE_SIDEBAR : SHOW_SIDEBAR

  return (
    <div className="grid h-[72px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-5">
      <div className="min-w-0 truncate text-[17px] font-semibold text-fg" data-testid="calendar-period-title">
        {title}
      </div>

      <div role="group" aria-label="Calendar view" className="flex items-center rounded-xl border border-line p-1">
        {VIEW_TABS.map((t) => (
          <button
            key={t.view}
            type="button"
            title={t.tooltip}
            aria-pressed={view === t.view}
            onClick={() => setView(t.view)}
            className={cn(
              'h-9 rounded-lg px-4 text-[16px] font-medium',
              view === t.view ? 'bg-hover-2 text-fg' : 'text-fg hover:bg-hover',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center rounded-xl border border-line p-1">
          <button
            type="button"
            aria-label={PREVIOUS_TIP}
            title={PREVIOUS_TIP}
            onClick={previous}
            className="flex size-8 items-center justify-center rounded-lg text-fg hover:bg-hover"
          >
            <Icon name="ph-caret-left" size={16} />
          </button>
          <button
            type="button"
            title={TODAY_TIP}
            onClick={(e) => goToday(e.shiftKey)}
            className={cn('h-8 rounded-lg px-3 text-[16px] text-fg hover:bg-hover', anchor === today ? 'font-semibold' : 'font-normal')}
          >
            Today
          </button>
          <button
            type="button"
            aria-label={NEXT_TIP}
            title={NEXT_TIP}
            onClick={next}
            className="flex size-8 items-center justify-center rounded-lg text-fg hover:bg-hover"
          >
            <Icon name="ph-caret-right" size={16} />
          </button>
        </div>
        <button
          type="button"
          aria-label={sidebarTip}
          title={sidebarTip}
          aria-pressed={rightPanelOpen}
          onClick={onToggleRightPanel}
          className={cn(
            'flex size-10 items-center justify-center rounded-xl border border-line text-fg hover:bg-hover',
            rightPanelOpen && 'bg-hover',
          )}
        >
          <Icon name="ph-calendar-blank" size={18} />
        </button>
      </div>
    </div>
  )
}
