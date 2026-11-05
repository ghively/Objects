// M13: the chart layout. It draws `props.flat` (every row that survives the view's filters and
// sorts; the view doesn't page these layouts), grouped on the X axis by the group-by code and
// measured by the column calculations, and keeps its settings in
// `state.viewDefinition.chartConfig` (see docs/superpowers/plans/2026-11-05-m13-view-layouts.md).
// The pieces live in `./chart/`.
import type { TypeDef, ViewState } from '@/api/types'
import type { LayoutProps } from '../DataView'
import { ChartSettingsPage } from './chart/ChartSettingsPage'
import { ChartView } from './chart/ChartView'

export function ChartLayout(props: LayoutProps) {
  return <ChartView {...props} />
}

export interface ChartSettingsProps {
  types: TypeDef[]
  state: ViewState
  onState(next: ViewState): void
}

/** The layout's page in "Customize view". */
export function ChartSettings(props: ChartSettingsProps) {
  return <ChartSettingsPage {...props} />
}
