// The chart layout's body: the chart in an exportable frame, its legend, the export button, and the
// rows of the picked bar, point or slice with "Show as table".
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { LayoutProps } from '../../DataView'
import { ListLayout } from '../ListLayout'
import { useWidth } from '../shared'
import { BarChart } from './BarChart'
import { buildChartData, chartConfigOf, numberValue, tableStateFor } from './chartData'
import { DonutChart } from './DonutChart'
import {
  CHART_EXPORT_FAILED,
  EXPORT_PNG,
  EXPORT_SVG,
  exportChart,
  registerChartFrame,
  type ChartExportDeps,
  type ChartExportFormat,
} from './exportChart'
import { Legend, type LegendItem } from './Legend'
import { LineChart } from './LineChart'
import type { ChartHit } from './marks'

/** The chart's height in px (our choice; horizontal bars grow to fit their rows). */
export const CHART_HEIGHT = 300
/** Width used before the frame is measured (and in tests). */
const FALLBACK_WIDTH = 640
/** The picked group lists this many rows, then "Show all" (our choice). */
export const DRILL_PAGE = 100

/** Our strings. */
export const SHOW_AS_TABLE = 'Show as table'
export const NOT_A_FILTER = 'This group can’t be expressed as a filter, so it can’t be shown as a table.'
export const NOTHING_TO_CHART = 'Nothing to chart.'

interface Picked {
  categoryId: string
  seriesId: string | null
}

export function ChartView(props: LayoutProps & { exportDeps?: ChartExportDeps; name?: string | null }) {
  const { flat, state, viewTypes, ctx } = props
  const config = useMemo(() => chartConfigOf(state.viewDefinition), [state.viewDefinition])
  const isNumber = config.kind === 'number'
  const data = useMemo(() => (isNumber ? null : buildChartData(flat, config, viewTypes, ctx)), [isNumber, flat, config, viewTypes, ctx])
  const single = useMemo(() => (isNumber ? numberValue(flat, config, viewTypes, ctx) : null), [isNumber, flat, config, viewTypes, ctx])
  const [frameRef, measured] = useWidth()
  const width = measured || FALLBACK_WIDTH
  const [picked, setPicked] = useState<Picked | null>(null)
  const [all, setAll] = useState(false)
  const [failed, setFailed] = useState(false)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    const key = state.viewDefinition
    registerChartFrame(key, frameRef.current, props.name ?? null)
    return () => registerChartFrame(key, null, null)
  }, [state.viewDefinition, frameRef, props.name])

  // The pick by ids, so it survives a reload of the rows; gone when its group is.
  const hit = useMemo<ChartHit | null>(() => {
    if (!picked || !data) return null
    const category = data.categories.findIndex((c) => c.id === picked.categoryId)
    if (category < 0) return null
    if (picked.seriesId === null) return { category, series: null }
    const series = data.series.findIndex((s) => s.id === picked.seriesId)
    return series < 0 ? null : { category, series }
  }, [picked, data])

  const onSelect = (h: ChartHit) => {
    if (!data) return
    const next = { categoryId: data.categories[h.category].id, seriesId: h.series === null ? null : data.series[h.series].id }
    setAll(false)
    setPicked((p) => (p && p.categoryId === next.categoryId && p.seriesId === next.seriesId ? null : next))
  }

  const doExport = async (format: ChartExportFormat) => {
    if (!frameRef.current) return
    setFailed(!(await exportChart(frameRef.current, format, props.name, props.exportDeps)))
  }

  const legend: LegendItem[] = !data || !config.showLegend
    ? []
    : data.kind === 'donut'
      ? data.categories.filter((c) => (c.values[0] ?? 0) > 0).map((c) => ({ id: c.id, label: c.label, color: c.color }))
      : data.split
        ? data.series
        : []

  const draw = () => {
    if (single) {
      return (
        <div className="flex flex-col items-center justify-center gap-1 py-10" style={{ minHeight: CHART_HEIGHT / 2 }} data-chart-kind="number">
          <div className="text-[44px] leading-none font-semibold text-fg" data-testid="chart-number">
            {single.display}
          </div>
          <div className="text-[13px] text-fg-muted">{single.label}</div>
        </div>
      )
    }
    if (!data || data.categories.length === 0) {
      return (
        <p className="py-10 text-center text-[14px] text-fg-muted" data-testid="chart-empty">
          {NOTHING_TO_CHART}
        </p>
      )
    }
    const p = { data, width, height: CHART_HEIGHT, showValues: config.showValues, selected: hit, onSelect }
    switch (data.kind) {
      case 'horizontalBar':
        return <BarChart {...p} horizontal />
      case 'line':
        return <LineChart {...p} />
      case 'donut':
        return <DonutChart {...p} />
      default:
        return <BarChart {...p} />
    }
  }

  return (
    <div data-testid="chart-layout" className="flex min-w-0 flex-col gap-2">
      <div ref={frameRef} data-chart-frame className="relative min-w-0 overflow-hidden rounded-md bg-app py-2">
        <div data-chart-export-skip className="absolute top-1 right-1 z-10">
          <Popover open={menu} onOpenChange={setMenu}>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Export chart" title="Export chart" className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg">
                <Icon name="ph-download-simple" size={14} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" role="menu" aria-label="Export chart" className="w-auto min-w-36 border-line bg-raised p-1">
              {(['png', 'svg'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false)
                    void doExport(f)
                  }}
                  className="flex h-8 w-full items-center rounded-md px-2 text-left text-[14px] hover:bg-hover"
                >
                  {f === 'png' ? EXPORT_PNG : EXPORT_SVG}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
        {draw()}
        <Legend items={legend} />
      </div>
      {failed && (
        <p role="alert" className="px-2 text-[13px] text-danger">
          {CHART_EXPORT_FAILED}
        </p>
      )}
      {data && hit && <Drill props={props} data={data} hit={hit} all={all} onAll={() => setAll(true)} onClose={() => setPicked(null)} />}
    </div>
  )
}

function Drill({
  props,
  data,
  hit,
  all,
  onAll,
  onClose,
}: {
  props: LayoutProps
  data: NonNullable<ReturnType<typeof buildChartData>>
  hit: ChartHit
  all: boolean
  onAll(): void
  onClose(): void
}) {
  const c = data.categories[hit.category]
  const rows = hit.series === null ? (data.split ? c.group.rows : c.seriesRows[0]) : c.seriesRows[hit.series]
  const title = hit.series !== null && data.split ? `${c.label} · ${data.series[hit.series].label}` : c.label
  const table = tableStateFor(props.state, data, c, data.split ? hit.series : null, props.ctx)
  const shown = all ? rows : rows.slice(0, DRILL_PAGE)
  return (
    <section data-testid="chart-drill" aria-label={title} className="flex flex-col border-t border-line pt-2">
      <div className="flex min-w-0 items-center gap-2 px-2 pb-1">
        <span className="min-w-0 truncate text-[14px] font-medium">{title}</span>
        <span className="text-[13px] text-fg-muted">{rows.length}</span>
        <span className="flex-1" />
        {table ? (
          <button type="button" onClick={() => props.onState(table)} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-hover">
            <Icon name="ph-table" size={14} />
            {SHOW_AS_TABLE}
          </button>
        ) : (
          <span className="text-[12px] text-fg-muted" data-testid="chart-not-filter">
            {NOT_A_FILTER}
          </span>
        )}
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg">
          <Icon name="ph-x" size={14} />
        </button>
      </div>
      <ListLayout rows={shown} typesById={props.typesById} multiType={props.multiType} onOpen={props.onOpen} rowExtras={props.rowExtras} isSelected={props.isSelected} />
      {shown.length < rows.length && (
        <button type="button" onClick={onAll} className="mx-2 my-1 self-start rounded-md px-2 py-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg">
          Show all ({rows.length})
        </button>
      )}
    </section>
  )
}
