// M13 contract stub: the calendar layout. Lane fills this file (see
// docs/superpowers/plans/2026-11-05-m13-view-layouts.md). It draws `props.flat` (every row that
// survives the view's filters and sorts; the view doesn't page these layouts) and keeps its
// settings in `state.viewDefinition.calendarConfig`.
import type { TypeDef, ViewState } from '@/api/types'
import type { LayoutProps } from '../DataView'

export function CalendarLayout(props: LayoutProps) {
  return <div data-testid="calendar-layout">{props.flat.length}</div>
}

export interface CalendarSettingsProps {
  types: TypeDef[]
  state: ViewState
  onState(next: ViewState): void
}

/** The layout's page in "Customize view". */
export function CalendarSettings(_props: CalendarSettingsProps) {
  return <div data-testid="calendar-settings" />
}
