// M13 contract stub: the chart layout. Lane fills this file (see
// docs/superpowers/plans/2026-11-05-m13-view-layouts.md). It draws `props.flat` (every row that
// survives the view's filters and sorts; the view doesn't page these layouts) and keeps its
// settings in `state.viewDefinition.chartConfig`.
import type { TypeDef, ViewState } from '@/api/types'
import type { LayoutProps } from '../DataView'

export function ChartLayout(props: LayoutProps) {
  return <div data-testid="chart-layout">{props.flat.length}</div>
}

export interface ChartSettingsProps {
  types: TypeDef[]
  state: ViewState
  onState(next: ViewState): void
}

/** The layout's page in "Customize view". */
export function ChartSettings(_props: ChartSettingsProps) {
  return <div data-testid="chart-settings" />
}
