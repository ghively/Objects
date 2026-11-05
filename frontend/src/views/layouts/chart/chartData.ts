// The chart layout's data: its settings with their defaults, the X axis (the group-by code over
// the view's rows), the Y values (the column calculations), the split into series, sorting,
// cumulative lines, and the filter that stands for one bar ("Show as table"). Pure functions.
import type {
  CalcKind,
  ChartKind,
  ChartSort,
  ChartViewConfig,
  DataViewDefinition,
  Filter,
  FilterGroup,
  GroupByEntry,
  PropertyDef,
  PropertyType,
  Row,
  TypeDef,
  ViewState,
} from '@/api/types'
import { formatNumber } from '@/properties/format'
import { lineColor, type ThemeColor } from '@/theme/palette'
import { CALC_KINDS, CALC_LABELS, calculate } from '../../calc'
import { filterOptionsFor, findDef } from '../../filter'
import { groupRows, isGroupable, type Group, type GroupCtx } from '../../group'
import { propertyChoices, type PropChoice } from '../../properties'

/** The settings a view without `chartConfig` uses (the contract's defaults). */
export const DEFAULT_CHART_CONFIG: ChartViewConfig = {
  kind: 'bar',
  xProperty: null,
  xDateBucket: 'month',
  yCalc: 'countAll',
  yProperty: null,
  splitBy: null,
  cumulative: false,
  sort: 'xAscending',
  hideEmptyGroups: true,
  showLegend: true,
  showValues: false,
}

/** The view's chart settings: the saved ones over the defaults. */
export function chartConfigOf(def: DataViewDefinition): ChartViewConfig {
  return { ...DEFAULT_CHART_CONFIG, ...def.chartConfig }
}

/** The state with `patch` applied to the chart settings (stored whole, so the file is explicit). */
export function withChartConfig(state: ViewState, patch: Partial<ChartViewConfig>): ViewState {
  return {
    ...state,
    viewDefinition: { ...state.viewDefinition, chartConfig: { ...chartConfigOf(state.viewDefinition), ...patch } },
  }
}

export const DATE_KINDS = new Set<PropertyType>(['datetime', 'datetimeSimple', 'entity_createdAt', 'entity_lastUpdated'])
/** Kinds a chart can't group by usefully (no value to group on). Our choice. */
const NOT_CHARTABLE = new Set<PropertyType>(['entity_icon', 'coverImage'])
/** Calculations whose result is a date (not a height): not offered for the Y axis. Our choice. */
const DATE_CALCS = new Set<CalcKind>(['earliestDate', 'latestDate', 'dateRange'])
const PERCENT_CALCS = new Set<CalcKind>(['percentEmpty', 'percentNotEmpty', 'percentChecked', 'percentUnchecked'])
/** Calculations whose results add up across groups (a stack's total means something). */
const ADDITIVE_CALCS = new Set<CalcKind>(['countAll', 'countValues', 'countEmpty', 'countNotEmpty', 'checked', 'unchecked', 'sum'])

const COUNT_CALCS = new Set<CalcKind>(['countAll', 'countValues', 'countUnique', 'countEmpty', 'countNotEmpty', 'checked', 'unchecked'])

const TYPE_CHOICE: PropChoice = { key: 'type', name: 'Type', kind: 'entity_type', def: { type: 'entity_type', options: {} } }

/** The properties a chart's X axis or split can group by: the view's, plus "Type". */
export function axisChoices(viewTypes: TypeDef[]): PropChoice[] {
  const out = propertyChoices(viewTypes).filter((c) => isGroupable(c.kind) && !NOT_CHARTABLE.has(c.kind))
  return out.some((c) => c.key === 'type') ? out : [...out, TYPE_CHOICE]
}

/** The properties the Y axis can calculate on (those with a calculation besides the count). */
export function valueChoices(viewTypes: TypeDef[]): PropChoice[] {
  return propertyChoices(viewTypes).filter((c) => yCalcKinds(c.kind).length > 0)
}

/** The Y calculations a property kind offers (not the count of all, not the date results). */
export function yCalcKinds(kind: PropertyType): CalcKind[] {
  return CALC_KINDS(kind).filter((k) => k !== 'countAll' && !DATE_CALCS.has(k))
}

/** The calculation a newly picked Y property starts with: a number's sum, else its count of values. Our choice. */
export function defaultYCalc(kind: PropertyType): CalcKind {
  const kinds = yCalcKinds(kind)
  if (kinds.includes('sum')) return 'sum'
  if (kinds.includes('countNotEmpty')) return 'countNotEmpty'
  return kinds[0] ?? 'countAll'
}

/** The X property: the saved one while the view still has it, else the first label property, else "Type". */
export function resolveX(config: ChartViewConfig, viewTypes: TypeDef[]): PropChoice {
  const choices = axisChoices(viewTypes)
  return (
    (config.xProperty ? choices.find((c) => c.key === config.xProperty) : undefined) ??
    choices.find((c) => c.kind === 'label') ??
    choices.find((c) => c.key === 'type') ??
    TYPE_CHOICE
  )
}

/** The split property, when set and still in the view (and the kind splits). */
export function resolveSplit(config: ChartViewConfig, viewTypes: TypeDef[]): PropChoice | null {
  if (!config.splitBy || config.kind === 'donut' || config.kind === 'number') return null
  return axisChoices(viewTypes).find((c) => c.key === config.splitBy) ?? null
}

/** The Y property, when the calculation needs one and the view still has it. */
export function resolveY(config: ChartViewConfig, viewTypes: TypeDef[]): PropChoice | null {
  if (config.yCalc === 'countAll' || !config.yProperty) return null
  const c = valueChoices(viewTypes).find((x) => x.key === config.yProperty)
  return c && yCalcKinds(c.kind).includes(config.yCalc) ? c : null
}

/** The group-by entry for an axis property: dates by the chosen bucket, the rest by value. */
export function entryFor(choice: PropChoice, bucket: ChartViewConfig['xDateBucket']): GroupByEntry {
  const entry: GroupByEntry = { propertyId: choice.key, option: DATE_KINDS.has(choice.kind) ? bucket : 'default' }
  if (choice.structureId) entry.structureId = choice.structureId
  return entry
}

// The palette for groups without a label colour: the theme's line colours, readable in light and
// dark (each theme defines `--line-*`). Gray is kept for "Other". Our choice of order.
const PALETTE: ThemeColor[] = ['blue', 'orange', 'teal', 'purple', 'rose', 'lime', 'amber', 'cyan', 'fuchsia', 'emerald', 'indigo', 'red']
export const paletteColor = (i: number): string => lineColor(PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length])
export const OTHER_COLOR = lineColor('gray')

export interface ChartSeries {
  id: string
  label: string
  color: string
  /** The split group (none for the single series of an unsplit chart). */
  group?: Group
}

export interface ChartCategory {
  id: string
  label: string
  color: string
  group: Group
  /** One value per series (cumulative when the line is). */
  values: number[]
  /** The rows of each series in this category. */
  seriesRows: Row[][]
  /** The sum of `values` (the stack's height). */
  total: number
}

export interface ChartData {
  kind: ChartKind
  categories: ChartCategory[]
  series: ChartSeries[]
  split: boolean
  /** Bars take their label colours from the X property. */
  colorByCategory: boolean
  /** The Y axis's name ("Count", "Sum (Estimate)"). */
  yLabel: string
  /** Stack totals add up. */
  additive: boolean
  /** The values are counts (whole-number ticks). */
  integer: boolean
  /** The values are percentages. */
  percent: boolean
  format(n: number): string
  x: PropChoice
  splitBy: PropChoice | null
  y: PropChoice | null
}

/** Rounds away float noise for display. */
const tidy = (n: number) => Number(n.toPrecision(12))

function valueFormatter(calc: CalcKind, y: PropChoice | null): (n: number) => string {
  if (PERCENT_CALCS.has(calc)) return (n) => `${tidy(Math.round(n * 10) / 10)}%`
  const fmt = y?.kind === 'number' && !calc.startsWith('count') ? (y.def as Partial<PropertyDef>).options?.numberFormat : undefined
  return (n) => formatNumber(tidy(n), fmt) || String(tidy(n))
}

/** The Y axis's label (our strings): "Count", or the calculation and its property. */
export function yLabelOf(calc: CalcKind, y: PropChoice | null): string {
  if (calc === 'countAll' || !y) return 'Count'
  return `${CALC_LABELS.full[calc] ?? calc} (${y.name})`
}

/** One Y value over `rows`: the calculation's number (an empty result is 0). */
function valueOf(rows: Row[], calc: CalcKind, y: PropChoice | null, ctx: GroupCtx): number {
  if (calc === 'countAll' || !y) return rows.length
  const r = calculate(rows, y.key, calc, ctx, y.structureId)
  return typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : 0
}

/** The single number of the `number` kind. */
export function numberValue(rows: Row[], config: ChartViewConfig, viewTypes: TypeDef[], ctx: GroupCtx): { value: number; display: string; label: string } {
  const y = resolveY(config, viewTypes)
  const calc = y ? config.yCalc : 'countAll'
  const value = valueOf(rows, calc, y, ctx)
  return { value, display: valueFormatter(calc, y)(value), label: yLabelOf(calc, y) }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = MONTHS.map((m) => m.slice(0, 3))
const dayId = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** At most this many buckets are filled in between dates (our choice). */
const MAX_FILL = 1000

/** A date bucket id (as `group.ts` makes them) as its first day, or null. */
function bucketStart(id: string, bucket: ChartViewConfig['xDateBucket']): Date | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(id)
  if (!m) return null
  if (bucket === 'year') return new Date(+m[1], 0, 1)
  if (bucket === 'month') return m[2] ? new Date(+m[1], +m[2] - 1, 1) : null
  return m[2] && m[3] ? new Date(+m[1], +m[2] - 1, +m[3]) : null
}

/** The bucket after `d` and its id and label (the same as `group.ts`'s). */
function bucketAt(d: Date, bucket: ChartViewConfig['xDateBucket']): { id: string; label: string; next: Date } {
  switch (bucket) {
    case 'year':
      return { id: String(d.getFullYear()), label: String(d.getFullYear()), next: new Date(d.getFullYear() + 1, 0, 1) }
    case 'month':
      return {
        id: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
        label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        next: new Date(d.getFullYear(), d.getMonth() + 1, 1),
      }
    case 'week': {
      const e = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6)
      return {
        id: dayId(d),
        label: `${SHORT[d.getMonth()]} ${d.getDate()} – ${SHORT[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`,
        next: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7),
      }
    }
    default:
      return {
        id: dayId(d),
        label: `${SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
        next: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
      }
  }
}

/** The date groups with the empty buckets between the first and the last filled in (in order). */
export function fillDateGaps(groups: Group[], bucket: ChartViewConfig['xDateBucket']): Group[] {
  const dated = groups.filter((g) => !g.isOther && bucketStart(g.id, bucket))
  if (dated.length < 2) return groups
  const byId = new Map(dated.map((g) => [g.id, g]))
  const ids = [...byId.keys()].sort()
  const end = ids[ids.length - 1]
  const out: Group[] = []
  let at = bucketStart(ids[0], bucket)
  while (at && out.length <= MAX_FILL) {
    const b = bucketAt(at, bucket)
    out.push(byId.get(b.id) ?? { id: b.id, label: b.label, rows: [] })
    if (b.id >= end) break
    at = b.next
  }
  if (out.length > MAX_FILL) return groups
  return [...out, ...groups.filter((g) => !byId.has(g.id))]
}

const colorOfGroup = (g: Group, choice: PropChoice, i: number): string =>
  g.isOther ? OTHER_COLOR : choice.kind === 'label' ? lineColor(g.color) : paletteColor(i)

/** Orders the categories: by X (the group order) or by Y total; "Other" (no value) stays last. Our choice. */
function sortCategories(cats: ChartCategory[], sort: ChartSort): ChartCategory[] {
  const other = cats.filter((c) => c.group.isOther)
  const rest = cats.filter((c) => !c.group.isOther)
  let sorted: ChartCategory[]
  switch (sort) {
    case 'xDescending':
      sorted = [...rest].reverse()
      break
    case 'yAscending':
      sorted = rest.map((c, i) => ({ c, i })).sort((a, b) => a.c.total - b.c.total || a.i - b.i).map((x) => x.c)
      break
    case 'yDescending':
      sorted = rest.map((c, i) => ({ c, i })).sort((a, b) => b.c.total - a.c.total || a.i - b.i).map((x) => x.c)
      break
    default:
      sorted = rest
  }
  return [...sorted, ...other]
}

/** Everything the chart draws, from the view's rows. Memoise on (rows, config, viewTypes, ctx). */
export function buildChartData(rows: Row[], config: ChartViewConfig, viewTypes: TypeDef[], ctx: GroupCtx): ChartData {
  const x = resolveX(config, viewTypes)
  const splitBy = resolveSplit(config, viewTypes)
  const y = resolveY(config, viewTypes)
  const calc = y ? config.yCalc : 'countAll'
  const xEntry = entryFor(x, config.xDateBucket)
  let groups = groupRows(rows, { groups: [xEntry] }, { groups: [], hideEmptyGroups: config.hideEmptyGroups }, ctx).groups
  if (!config.hideEmptyGroups && DATE_KINDS.has(x.kind)) groups = fillDateGaps(groups, config.xDateBucket)

  let series: ChartSeries[]
  let members: Set<Row>[] | null = null
  if (splitBy) {
    const split = groupRows(rows, { groups: [entryFor(splitBy, config.xDateBucket)] }, { groups: [] }, ctx).groups.filter((g) => g.rows.length > 0)
    series = split.map((g, i) => ({ id: g.id, label: g.label, color: colorOfGroup(g, splitBy, i), group: g }))
    members = split.map((g) => new Set(g.rows))
  } else {
    series = [{ id: 'all', label: yLabelOf(calc, y), color: paletteColor(0) }]
  }

  let categories: ChartCategory[] = groups.map((g, i) => {
    const seriesRows = members ? members.map((m) => g.rows.filter((r) => m.has(r))) : [g.rows]
    const values = seriesRows.map((rs) => valueOf(rs, calc, y, ctx))
    return {
      id: g.id,
      label: g.label,
      color: colorOfGroup(g, x, i),
      group: g,
      values,
      seriesRows,
      total: values.reduce((a, b) => a + b, 0),
    }
  })
  categories = sortCategories(categories, config.sort)

  if (config.kind === 'line' && config.cumulative) {
    const run = series.map(() => 0)
    categories = categories.map((c) => {
      const values = c.values.map((v, s) => (run[s] += v))
      return { ...c, values, total: values.reduce((a, b) => a + b, 0) }
    })
  }

  return {
    kind: config.kind,
    categories,
    series,
    split: !!splitBy,
    colorByCategory: !splitBy && x.kind === 'label',
    yLabel: yLabelOf(calc, y),
    additive: ADDITIVE_CALCS.has(calc),
    integer: COUNT_CALCS.has(calc),
    percent: PERCENT_CALCS.has(calc),
    format: valueFormatter(calc, y),
    x,
    splitBy,
    y,
  }
}

// ---- "Show as table": the filter that stands for one group -----------------------------------

const base = (choice: PropChoice): Pick<Filter, 'type' | 'propertyId' | 'structureId'> =>
  choice.structureId ? { type: 'filter', propertyId: choice.key, structureId: choice.structureId } : { type: 'filter', propertyId: choice.key }

/** The first and last day (`YYYY-MM-DD`) of a date bucket. */
function bucketDays(id: string, bucket: ChartViewConfig['xDateBucket']): [string, string] | null {
  const start = bucketStart(id, bucket)
  if (!start) return null
  const next = bucketAt(start, bucket).next
  const last = new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1)
  return [dayId(start), dayId(last)]
}

/**
 * The filters that keep exactly one group's rows (combined with AND), or null when the group
 * can't be expressed as a filter: "Other" of a kind without an "is empty" operator, a relation
 * or tag that doesn't resolve to an object, aliases, and a number with no value.
 */
export function filtersForGroup(
  choice: PropChoice,
  group: Group,
  bucket: ChartViewConfig['xDateBucket'],
  ctx: GroupCtx,
): Filter[] | null {
  const def = findDef(ctx.types, choice.key, choice.structureId, ctx.viewTypeIds)
  if (!def) return null
  const f = base(choice)
  const one = (option: string, referenceValue?: Filter['referenceValue']): Filter[] =>
    referenceValue === undefined ? [{ ...f, option }] : [{ ...f, option, referenceValue }]
  const offers = (option: string) => filterOptionsFor(def).some((o) => o.key === option)
  const empty = () => (offers('isEmpty') ? one('isEmpty') : null)
  const out = ((): Filter[] | null => {
    switch (def.type) {
      case 'label':
        return group.isOther ? empty() : one('contains', [group.id])
      case 'boolean':
        return one(group.id === 'true' ? 'isChecked' : 'isNotChecked')
      case 'entity':
      case 'entity_backlinks': {
        if (group.isOther) return empty()
        if (group.id.startsWith('target:')) return null
        const id = Object.entries(ctx.pathsById ?? {}).find(([, p]) => p === group.id)?.[0]
        return id ? one('contains', [id]) : null
      }
      case 'entity_tags':
        if (group.isOther) return empty()
        return group.id.startsWith('tag:') ? null : one('contains', [group.id])
      case 'entity_collections':
      case 'entity_type':
        return group.isOther ? null : one('contains', [group.id])
      case 'number': {
        const n = Number(group.id)
        return group.isOther || !Number.isFinite(n) ? null : one('equal', n)
      }
      case 'datetime':
      case 'datetimeSimple':
      case 'entity_createdAt':
      case 'entity_lastUpdated': {
        if (group.isOther) return empty()
        const days = bucketDays(group.id, bucket)
        if (!days) return null
        const [from, to] = offers('startIsOnOrAfter') ? ['startIsOnOrAfter', 'startIsOnOrBefore'] : ['isOnOrAfter', 'isOnOrBefore']
        return [
          { ...f, option: from, referenceValue: { exactDate: days[0] } },
          { ...f, option: to, referenceValue: { exactDate: days[1] } },
        ]
      }
      case 'entity_title':
      case 'text':
      case 'url':
      case 'color':
      case 'textBlock':
      case 'entity_description':
        if (group.isOther) return def.type === 'entity_title' ? null : empty()
        return one('is', group.id.startsWith('text:') ? group.id.slice(5) : group.label)
      default:
        return null
    }
  })()
  if (!out) return null
  // A property only one of the view's types has: the group holds that type's rows only.
  return choice.structureId ? [{ type: 'filter', propertyId: 'type', option: 'contains', referenceValue: [choice.structureId] }, ...out] : out
}

/** The view's filters with `added` joined by AND (top level when it is already AND). */
export function addFilters(group: FilterGroup, added: Filter[]): FilterGroup {
  if (group.operator === 'and') return { ...group, elements: [...group.elements, ...added] }
  return { type: 'filterGroup', operator: 'and', elements: group.elements.length ? [group, ...added] : added }
}

/** The view turned into a table showing one category (and series): one state, or null when it can't be a filter. */
export function tableStateFor(state: ViewState, data: ChartData, category: ChartCategory, seriesIndex: number | null, ctx: GroupCtx): ViewState | null {
  const bucket = chartConfigOf(state.viewDefinition).xDateBucket
  const fx = filtersForGroup(data.x, category.group, bucket, ctx)
  if (!fx) return null
  let fs = fx
  const s = seriesIndex !== null ? data.series[seriesIndex] : undefined
  if (data.splitBy && s?.group) {
    const fsplit = filtersForGroup(data.splitBy, s.group, bucket, ctx)
    if (!fsplit) return null
    // Don't repeat the type filter both sides add.
    fs = [...fx, ...fsplit.filter((f) => !fx.some((g) => JSON.stringify(g) === JSON.stringify(f)))]
  }
  return {
    ...state,
    filterGroup: addFilters(state.filterGroup, fs),
    viewDefinition: { ...state.viewDefinition, dataViewLayout: 'table' },
  }
}
