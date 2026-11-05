// M13 contract stub: the timeline layout. Lane fills this file (see
// docs/superpowers/plans/2026-11-05-m13-view-layouts.md). It draws `props.flat` (every row that
// survives the view's filters and sorts; the view doesn't page these layouts) and keeps its
// settings in `state.viewDefinition.timelineConfig`.
import type { TypeDef, ViewState } from '@/api/types'
import type { LayoutProps } from '../DataView'

export function TimelineLayout(props: LayoutProps) {
  return <div data-testid="timeline-layout">{props.flat.length}</div>
}

export interface TimelineSettingsProps {
  types: TypeDef[]
  state: ViewState
  onState(next: ViewState): void
}

/** The layout's page in "Customize view". */
export function TimelineSettings(_props: TimelineSettingsProps) {
  return <div data-testid="timeline-settings" />
}
