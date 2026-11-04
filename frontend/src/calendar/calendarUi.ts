// `ui.calendar`: the week start, the sidebar switch (M7) and `daily` (the Day view's section flags
// and section views), saved to `ui.json`. `PUT /api/ui` replaces top-level keys, so every save
// sends the whole `calendar` object. Edits are optimistic and saved in order with the latest `baseRevision`; on a 409 the fresh
// state is fetched and the same edit is re-applied to it once (never a blind overwrite).
import { api, ConflictError } from '@/api/client'
import type { CalendarUi, UiState } from '@/api/types'
import { showToast } from '@/editor/media/upload'
import { enqueueUiSave, pendingUiSaves, reloadUi, useUiStore } from '@/shell/usePinned'

export type CalendarDaily = CalendarUi['daily']

/** The toast after a `ui.json` save of the calendar settings failed ("Could not save …"). */
export const CALENDAR_SAVE_FAILED = 'Could not save the calendar settings'

const EMPTY_DAILY: CalendarDaily = {}

function calendarOf(ui: UiState | undefined | null): CalendarUi {
  const c = ui?.calendar
  const weekStart = c?.weekStart === 'monday' ? 'monday' : 'sunday'
  const daily = c?.daily && typeof c.daily === 'object' ? c.daily : EMPTY_DAILY
  const out: CalendarUi = { weekStart, daily }
  if (typeof c?.hideCalendarSidebar === 'boolean') out.hideCalendarSidebar = c.hideCalendarSidebar
  return out
}

type CalendarEdit = (cal: CalendarUi) => CalendarUi

/** The saved `ui.calendar.daily` (an empty object until `ui.json` loads or when it has none). */
export function useCalendarDaily(): CalendarDaily {
  return useUiStore((s) => s.ui.calendar?.daily) ?? EMPTY_DAILY
}

async function save(edit: CalendarEdit): Promise<void> {
  const base = useUiStore.getState()
  const next = edit(calendarOf(base.ui))
  try {
    const res = await api.patchUi({ calendar: next }, { baseRevision: base.revision })
    useUiStore.setState({ revision: res?.revision ?? useUiStore.getState().revision })
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e
    const fresh = await api.ui()
    const again = edit(calendarOf(fresh?.ui))
    const res = await api.patchUi({ calendar: again }, { baseRevision: fresh?.revision ?? '' })
    // Another writer's unsaved edits are in the local ui, not in `fresh`: keep them.
    const rest = pendingUiSaves() === 1 && fresh?.ui ? fresh.ui : useUiStore.getState().ui
    const ui = { ...rest, calendar: again }
    useUiStore.setState({ ui, revision: res?.revision ?? fresh?.revision ?? '' })
  }
}

/** Apply `edit` to `ui.calendar` now and save it after the edits before it; a failure says so and reloads. */
async function enqueue(edit: CalendarEdit): Promise<void> {
  const cur = useUiStore.getState().ui
  useUiStore.setState({ ui: { ...cur, calendar: edit(calendarOf(cur)) } })
  const saved = await enqueueUiSave(() =>
    save(edit).then(
      () => true,
      (e: unknown) => {
        console.warn('Could not save the calendar settings:', e)
        return false
      },
    ),
  )
  if (!saved) {
    showToast(CALENDAR_SAVE_FAILED)
    await reloadUi()
  }
}

/** Merge `patch` into `ui.calendar.daily` now and save it after the edits before it. */
export function saveCalendarDaily(patch: Partial<CalendarDaily>): Promise<void> {
  return enqueue((cal) => ({ ...cal, daily: { ...cal.daily, ...patch } }))
}

/** Set `ui.calendar.weekStart` and/or `hideCalendarSidebar`, keeping the rest of `calendar`. */
export function saveCalendarUi(patch: Partial<Pick<CalendarUi, 'weekStart' | 'hideCalendarSidebar'>>): Promise<void> {
  return enqueue((cal) => ({ ...cal, ...patch }))
}

/** Whether the calendar sidebar is open (`ui.calendar.hideCalendarSidebar` absent or false). */
export function useCalendarSidebarOpen(): boolean {
  return useUiStore((s) => s.ui.calendar?.hideCalendarSidebar) !== true
}

/**
 * Show or hide the calendar sidebar ("Toggle calendar sidebar"), saved to `ui.json`. Here, not in
 * `CalendarPage`, so the shell's shortcut needs none of the calendar page's code at start.
 */
export function toggleCalendarSidebar(): Promise<void> {
  const hidden = useUiStore.getState().ui.calendar?.hideCalendarSidebar === true
  return saveCalendarUi({ hideCalendarSidebar: !hidden })
}
