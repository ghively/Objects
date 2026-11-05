// Customize view > Chart: the chart's kind, axes, split, sort, display switches and export.
// Every label here is our string.
import { useState, type ReactNode } from 'react'
import type { ChartKind, ChartSort, ChartViewConfig, TypeDef, ViewState } from '@/api/types'
import { Icon } from '@/components/Icon'
import { CALC_LABELS } from '../../calc'
import { MenuSelect, propertyOptions, type MenuOption } from '../../MenuSelect'
import {
  DATE_KINDS,
  axisChoices,
  chartConfigOf,
  defaultYCalc,
  resolveSplit,
  resolveX,
  resolveY,
  valueChoices,
  withChartConfig,
  yCalcKinds,
} from './chartData'
import {
  CHART_EXPORT_FAILED,
  CHART_NOT_SHOWN,
  EXPORT_PNG,
  EXPORT_SVG,
  chartFrameFor,
  exportChart,
  type ChartExportDeps,
  type ChartExportFormat,
} from './exportChart'

export const CHART_KINDS: { value: ChartKind; label: string; icon: string }[] = [
  { value: 'bar', label: 'Bar', icon: 'ph-chart-bar' },
  { value: 'horizontalBar', label: 'Horizontal bar', icon: 'ph-chart-bar-horizontal' },
  { value: 'line', label: 'Line', icon: 'ph-chart-line' },
  { value: 'donut', label: 'Donut', icon: 'ph-chart-donut' },
  { value: 'number', label: 'Number', icon: 'ph-hash' },
]

const BUCKETS: { value: ChartViewConfig['xDateBucket']; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
]

const SORTS: { value: ChartSort; label: string }[] = [
  { value: 'xAscending', label: 'X axis, ascending' },
  { value: 'xDescending', label: 'X axis, descending' },
  { value: 'yAscending', label: 'Y axis, ascending' },
  { value: 'yDescending', label: 'Y axis, descending' },
]

const COUNT = '__count'
const NONE = '__none'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center justify-between gap-3 px-2 text-[14px]">
      <span className="shrink-0">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex h-8 items-center justify-between gap-2 px-2 text-[14px]">
      {label}
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export interface ChartSettingsPageProps {
  types: TypeDef[]
  state: ViewState
  onState(next: ViewState): void
  exportDeps?: ChartExportDeps
}

export function ChartSettingsPage({ types, state, onState, exportDeps }: ChartSettingsPageProps) {
  const config = chartConfigOf(state.viewDefinition)
  const set = (patch: Partial<ChartViewConfig>) => onState(withChartConfig(state, patch))
  const [message, setMessage] = useState<string | null>(null)

  const axes = axisChoices(types)
  const x = resolveX(config, types)
  const split = resolveSplit(config, types)
  const y = resolveY(config, types)
  const values = valueChoices(types)
  const isNumber = config.kind === 'number'
  const splits = config.kind !== 'donut' && !isNumber

  const kindOptions: MenuOption[] = CHART_KINDS.map((k) => ({ value: k.value, label: k.label, icon: k.icon }))
  const yOptions: MenuOption[] = [{ value: COUNT, label: 'Count of objects', icon: 'ph-hash' }, ...propertyOptions(values)]
  const calcOptions: MenuOption[] = y ? yCalcKinds(y.kind).map((k) => ({ value: k, label: CALC_LABELS.full[k] ?? k })) : []
  const splitOptions: MenuOption[] = [{ value: NONE, label: 'None' }, ...propertyOptions(axes.filter((c) => c.key !== x.key))]

  const doExport = async (format: ChartExportFormat) => {
    const frame = chartFrameFor(state.viewDefinition)
    if (!frame) {
      setMessage(CHART_NOT_SHOWN)
      return
    }
    setMessage((await exportChart(frame.el, format, frame.name, exportDeps)) ? null : CHART_EXPORT_FAILED)
  }

  return (
    <div className="flex flex-col" data-testid="chart-settings">
      <Field label="Chart type">
        <MenuSelect label="Chart type" value={config.kind} options={kindOptions} onChange={(v) => set({ kind: v as ChartKind })} />
      </Field>
      {!isNumber && (
        <>
          <Field label="X axis">
            <MenuSelect label="X axis" value={x.key} options={propertyOptions(axes)} onChange={(v) => set({ xProperty: v, splitBy: v === config.splitBy ? null : config.splitBy })} />
          </Field>
          {DATE_KINDS.has(x.kind) && (
            <Field label="Group dates by">
              <MenuSelect
                label="Group dates by"
                value={config.xDateBucket}
                options={BUCKETS}
                onChange={(v) => set({ xDateBucket: v as ChartViewConfig['xDateBucket'] })}
              />
            </Field>
          )}
        </>
      )}
      <Field label={isNumber ? 'Value' : 'Y axis'}>
        <MenuSelect
          label={isNumber ? 'Value' : 'Y axis'}
          value={y ? y.key : COUNT}
          options={yOptions}
          onChange={(v) => {
            if (v === COUNT) return set({ yCalc: 'countAll', yProperty: null })
            const c = values.find((p) => p.key === v)
            if (c) set({ yProperty: v, yCalc: defaultYCalc(c.kind) })
          }}
        />
      </Field>
      {y && (
        <Field label="Calculation">
          <MenuSelect label="Calculation" value={config.yCalc} options={calcOptions} onChange={(v) => set({ yCalc: v })} />
        </Field>
      )}
      {splits && (
        <Field label="Split by">
          <MenuSelect label="Split by" value={split ? split.key : NONE} options={splitOptions} onChange={(v) => set({ splitBy: v === NONE ? null : v })} />
        </Field>
      )}
      {!isNumber && (
        <Field label="Sort">
          <MenuSelect label="Sort" value={config.sort} options={SORTS} onChange={(v) => set({ sort: v as ChartSort })} />
        </Field>
      )}
      {config.kind === 'line' && <Switch label="Cumulative" checked={config.cumulative} onChange={(v) => set({ cumulative: v })} />}
      {!isNumber && (
        <>
          <Switch label="Hide empty groups" checked={config.hideEmptyGroups} onChange={(v) => set({ hideEmptyGroups: v })} />
          <Switch label="Show legend" checked={config.showLegend} onChange={(v) => set({ showLegend: v })} />
          <Switch label="Show values" checked={config.showValues} onChange={(v) => set({ showValues: v })} />
        </>
      )}
      <div className="mt-1 flex gap-1 border-t border-line pt-1">
        {(['png', 'svg'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => void doExport(f)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[13px] hover:bg-hover"
          >
            <Icon name="ph-download-simple" size={13} />
            {f === 'png' ? EXPORT_PNG : EXPORT_SVG}
          </button>
        ))}
      </div>
      {message && (
        <p role="alert" className="px-2 py-1 text-[13px] text-fg-muted">
          {message}
        </p>
      )}
    </div>
  )
}
