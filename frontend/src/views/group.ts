// Group-by: Capacities' group options per property kind, the groups a set of rows falls into,
// and the update that moves a row into a group (kanban drag). Pure functions over rows.
import type {
  DataViewDefinition,
  DateValue,
  EntityRef,
  GroupBy,
  GroupByEntry,
  GroupSortOption,
  Icon,
  PropertyDef,
  PropertyType,
  Row,
  StatusCategory,
  TypeDef,
} from '@/api/types'
import { formatNumber } from '@/properties/format'
import { STATUS_CATEGORIES, optionCategory } from '@/tasks/statusCategory'
import { wallClock } from '@/lib/zonedTime'
import { dateSpan } from './dates'
import { defIn, displayTitle, findDef, rowValue, typeMap, type FilterCtx } from './filter'

export interface GroupOption {
  key: string
  label: string
}

const o = (key: string, label: string): GroupOption => ({ key, label })

const DATE_KINDS = new Set<PropertyType>(['datetime', 'datetimeSimple', 'entity_lastUpdated', 'entity_createdAt'])
const NOT_GROUPABLE = new Set<PropertyType>(['blocks', 'simpleTableBlock'])

/** Group-by option of a status label: one group per status category ("By category" is our string). */
export const STATUS_CATEGORY_OPTION = 'statusCategory'
/** Group-by option of a date: the Tasks "Scheduled" buckets. */
export const SCHEDULED_OPTION = 'scheduled'

const isStatusLabel = (def?: Pick<PropertyDef, 'type' | 'options'>) => def?.type === 'label' && !!def.options?.isStatus

/**
 * The "group by" options a kind offers; the first is the default. `def` adds what depends on the
 * definition (a status label also groups by category).
 */
export function GROUP_OPTIONS(kind: PropertyType, def?: Partial<Pick<PropertyDef, 'key'>> & Pick<PropertyDef, 'options'>): GroupOption[] {
  if (kind === 'label' && def?.options?.isStatus) return [o('default', 'default'), o(STATUS_CATEGORY_OPTION, 'By category')]
  if (kind === 'textBlock') return [o('default', 'By Text'), o('entity', 'By Linked Objects')]
  if (kind === 'number') return [o('default', 'By Exact Value'), o('range', 'By Range')]
  if (DATE_KINDS.has(kind)) {
    return [
      o('hour', 'By Hour'),
      o('day', 'By Day'),
      o('week', 'By Week'),
      o('month', 'By Month'),
      o('year', 'By Year'),
      o('relative', 'Relative'),
      o(SCHEDULED_OPTION, 'Scheduled'),
    ]
  }
  return [o('default', 'default')]
}

/** Whether a kind can be grouped by at all. */
export const isGroupable = (kind: PropertyType): boolean => !NOT_GROUPABLE.has(kind)

/** How groups can be ordered; the first option is the default. `manual` is ours (Capacities sets it implicitly). */
export function GROUP_SORT_OPTIONS(kind: PropertyType): { key: GroupSortOption; label: string }[] {
  const head: { key: GroupSortOption; label: string }[] =
    kind === 'label'
      ? [
          { key: 'default', label: 'Order' },
          { key: 'defaultDescending', label: 'Order inverse' },
        ]
      : [{ key: 'default', label: 'default' }]
  const out: { key: GroupSortOption; label: string }[] = [
    ...head,
    { key: 'ascending', label: 'ascending' },
    { key: 'descending', label: 'descending' },
  ]
  if (kind === 'entity' || kind === 'entity_backlinks') {
    out.push({ key: 'createdAscending', label: 'Created oldest first' }, { key: 'createdDescending', label: 'Created newest first' })
  }
  out.push(
    { key: 'sizeAscending', label: 'smallest first' },
    { key: 'sizeDescending', label: 'largest first' },
    { key: 'manual', label: 'Manual' },
  )
  return out
}

export interface Group {
  id: string
  label: string
  rows: Row[]
  color?: string | null
  icon?: Icon | null
  isOther?: boolean
}

export interface GroupCtx extends FilterCtx {
  /** Object path → title, for entity groups. */
  entityTitles?: Record<string, string>
  /** Object path → created-at ISO string, for the "Created oldest/newest first" order. */
  entityCreated?: Record<string, string>
}

type Config = DataViewDefinition['groupByConfig']

export const OTHER_ID = 'other'
const TEXT_MAX = 500

const DATE_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  earlier: 'Earlier',
  lastWeek: 'Last week',
  thisWeek: 'This week',
  theDayBeforeYesterday: 'The day before yesterday',
  yesterday: 'Yesterday',
  today: 'Today',
  tomorrow: 'Tomorrow',
  theDayAfterTomorrow: 'The day after tomorrow',
  nextWeek: 'Next week',
  later: 'Later', // our string: nothing in Capacities names dates beyond next week
}
// The Tasks "Scheduled" buckets in order; rows without a date fall into "No date" (Other), last.
const SCHEDULED_ORDER = ['overdue', 'today', 'tomorrow', 'thisWeek', 'nextWeek', 'later']
const NO_DATE = 'No date' // our string: Capacities names no bucket for undated tasks
const RELATIVE_ORDER = [
  'earlier',
  'lastWeek',
  'thisWeek',
  'theDayBeforeYesterday',
  'yesterday',
  'today',
  'tomorrow',
  'theDayAfterTomorrow',
  'nextWeek',
  'later',
]

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const dayId = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DAY_MS = 86400000
// On wall-clock carriers (`lib/zonedTime` `wallClock`): the time-zone setting's days.
const localDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const daysBetween = (a: Date, b: Date) => Math.round((localDay(b).getTime() - localDay(a).getTime()) / DAY_MS)
const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3))

interface Bucket {
  id: string
  label: string
  /** Orders buckets chronologically or numerically. */
  sort: number | string
}

function dateBucket(at: Date, option: string, now: Date): Bucket {
  switch (option) {
    case 'hour': {
      const id = `${dayId(at)}T${pad(at.getHours())}`
      const h = at.getHours()
      const period = `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
      return { id, label: `${SHORT_MONTHS[at.getMonth()]} ${at.getDate()}, ${at.getFullYear()}, ${period}`, sort: id }
    }
    case 'week': {
      const m = mondayOf(at)
      const e = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 6)
      const label = `${SHORT_MONTHS[m.getMonth()]} ${m.getDate()} – ${SHORT_MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`
      return { id: dayId(m), label, sort: dayId(m) }
    }
    case 'month': {
      const id = `${at.getFullYear()}-${pad(at.getMonth() + 1)}`
      return { id, label: `${MONTHS[at.getMonth()]} ${at.getFullYear()}`, sort: id }
    }
    case 'year':
      return { id: String(at.getFullYear()), label: String(at.getFullYear()), sort: pad(at.getFullYear(), 4) }
    case 'relative': {
      const d = daysBetween(now, at)
      let key: string
      if (d === 0) key = 'today'
      else if (d === -1) key = 'yesterday'
      else if (d === 1) key = 'tomorrow'
      else if (d === -2) key = 'theDayBeforeYesterday'
      else if (d === 2) key = 'theDayAfterTomorrow'
      else {
        const w = Math.round((mondayOf(at).getTime() - mondayOf(now).getTime()) / (7 * DAY_MS))
        key = w === 0 ? 'thisWeek' : w === -1 ? 'lastWeek' : w === 1 ? 'nextWeek' : w < 0 ? 'earlier' : 'later'
      }
      return { id: key, label: DATE_LABELS[key], sort: RELATIVE_ORDER.indexOf(key) }
    }
    case SCHEDULED_OPTION: {
      const d = daysBetween(now, at)
      let key: string
      if (d < 0) key = 'overdue'
      else if (d === 0) key = 'today'
      else if (d === 1) key = 'tomorrow'
      else {
        const w = Math.round((mondayOf(at).getTime() - mondayOf(now).getTime()) / (7 * DAY_MS))
        key = w === 0 ? 'thisWeek' : w === 1 ? 'nextWeek' : 'later'
      }
      return { id: key, label: DATE_LABELS[key], sort: SCHEDULED_ORDER.indexOf(key) }
    }
    default: {
      const id = dayId(at)
      return { id, label: `${SHORT_MONTHS[at.getMonth()]} ${at.getDate()}, ${at.getFullYear()}`, sort: id }
    }
  }
}

const categoryIndex = (c: StatusCategory) => STATUS_CATEGORIES.findIndex((x) => x.key === c)
const categoryLabel = (c: StatusCategory) => STATUS_CATEGORIES[categoryIndex(c)]?.label ?? c

const basename = (p: string) => p.replace(/\.md$/i, '').split('/').pop() ?? p

function dateOf(row: Row, propertyId: string): DateValue | null {
  const v = rowValue(row, propertyId)
  if (typeof v === 'string') return v ? { start: v, resolution: 'time' } : null
  return (v as DateValue | null | undefined) ?? null
}

/** A text group: the whole text is the id (and what a drop writes); only the label is cut. */
const textBucket = (s: string): Bucket[] => {
  const t = s.trim()
  return t ? [{ id: t, label: t.slice(0, TEXT_MAX), sort: t }] : []
}

/** The text a text group stands for: its id, which `textBucket` set to the whole text. */
const groupText = (group: Group) => (group.isOther ? '' : group.id)

/** What one `groupRows` call computes once and every row reads. */
interface Scratch {
  /** Tag title → tag object id (the inverse of `ctx.tagIdsToTitles`). */
  tagsByTitle: Map<string, string>
}

function scratchFor(ctx: GroupCtx): Scratch {
  const tagsByTitle = new Map<string, string>()
  for (const [id, title] of Object.entries(ctx.tagIdsToTitles)) tagsByTitle.set(title, id)
  return { tagsByTitle }
}

/** The groups a row belongs to for one entry; none means "Other". */
/** `null` drops the row from every group (a number outside its range). */
function rowBuckets(row: Row, entry: GroupByEntry, def: Pick<PropertyDef, 'type' | 'options'>, ctx: GroupCtx, scratch: Scratch): Bucket[] | null {
  const v = rowValue(row, entry.propertyId)
  switch (def.type) {
    case 'boolean':
      return [v === true ? { id: 'true', label: 'Checked', sort: 0 } : { id: 'false', label: 'Unchecked', sort: 1 }]
    case 'label': {
      const set = def.options.set ?? []
      if (entry.option === STATUS_CATEGORY_OPTION && isStatusLabel(def)) {
        // The first status names the category; no status or an unknown one is not started.
        const first = Array.isArray(v) ? (v as string[])[0] : undefined
        const opt = set.find((s) => s.text === first)
        const c = opt ? optionCategory(opt) : 'not-started'
        return [{ id: c, label: categoryLabel(c), sort: categoryIndex(c) }]
      }
      const out: Bucket[] = []
      for (const t of Array.isArray(v) ? (v as string[]) : []) {
        const i = set.findIndex((s) => s.text === t)
        if (i >= 0 && !out.some((b) => b.id === set[i].id)) out.push({ id: set[i].id, label: set[i].text, sort: i })
      }
      return out
    }
    case 'entity':
    case 'entity_backlinks': {
      // Backlinks group like a relation: one group per linking object.
      const refs = Array.isArray(v) ? (v as EntityRef[]) : []
      const out: Bucket[] = []
      refs.forEach((r, i) => {
        if (!r) return
        const path = r.path ?? row.links[entry.propertyId]?.[i] ?? null
        const label = (path && ctx.entityTitles?.[path]) || r.target || (path ? basename(path) : '')
        const id = path ?? `target:${r.target}`
        if (!out.some((b) => b.id === id)) out.push({ id, label, sort: label })
      })
      return out
    }
    case 'entity_tags':
      return (row.summary.tags ?? []).map((t) => ({ id: scratch.tagsByTitle.get(t) ?? t, label: t, sort: t }))
    case 'entity_collections': {
      const out: Bucket[] = []
      for (const name of row.summary.collections ?? []) {
        const n = name.toLowerCase()
        const c =
          ctx.collections.find((x) => x.name.toLowerCase() === n) ??
          ctx.collections.find((x) => (x.formerNames ?? []).some((f) => f.toLowerCase() === n))
        if (c && !out.some((b) => b.id === c.id)) out.push({ id: c.id, label: c.name, sort: c.name })
      }
      return out
    }
    case 'entity_type': {
      const t = ctx.types.find((x) => x.id === row.summary.type)
      return t ? [{ id: t.id, label: t.name, sort: t.name }] : []
    }
    case 'entity_aliases':
      return (row.summary.aliases ?? []).map((a) => ({ id: a, label: a, sort: a }))
    case 'number': {
      if (typeof v !== 'number' || Number.isNaN(v)) return []
      if (entry.option !== 'range') {
        return [{ id: String(v), label: formatNumber(v, def.options.numberFormat) || String(v), sort: v }]
      }
      const cfg = entry.numberRangeConfig ?? {}
      const step = cfg.step && cfg.step > 0 ? cfg.step : 1
      const min = cfg.min ?? 0
      if (v < min || (cfg.max !== undefined && v > cfg.max)) return null
      // Decimal steps (0.1) don't divide exactly in binary: round away the float noise first.
      const clean = (x: number) => Number(x.toPrecision(12))
      const q = clean((v - min) / step)
      let i = Math.floor(q)
      // The top of the range belongs to the last group.
      if (cfg.max !== undefined && v === cfg.max && i > 0 && q === i) i -= 1
      const lo = clean(min + i * step)
      const hi = clean(min + (i + 1) * step)
      return [{ id: `${lo}-${hi}`, label: `${lo}–${hi}`, sort: lo }]
    }
    case 'datetime':
    case 'datetimeSimple':
    case 'entity_createdAt':
    case 'entity_lastUpdated': {
      const span = dateSpan(dateOf(row, entry.propertyId))
      return span ? [dateBucket(wallClock(span.start), entry.option, wallClock(ctx.now))] : []
    }
    case 'entity_title':
      return textBucket(displayTitle(row))
    case 'textBlock': {
      const s = typeof v === 'string' ? v : ''
      if (entry.option === 'entity') {
        const out: Bucket[] = []
        for (const m of s.matchAll(/\[\[([^\]|#]+)/g)) {
          const t = m[1].trim()
          if (t && !out.some((b) => b.id === t)) out.push({ id: t, label: t, sort: t })
        }
        return out
      }
      return textBucket(s.split(/\n\s*\n/)[0] ?? '')
    }
    default:
      return textBucket(typeof v === 'string' ? v : '')
  }
}

/** Whether `row` groups under `def`: its type is the grouping's (if named) and defines the key as the same kind, or not at all. */
function sameKind(row: Row, entry: GroupByEntry, def: Pick<PropertyDef, 'type'>, type: TypeDef | undefined): boolean {
  if (entry.structureId && row.summary.type !== entry.structureId) return false
  const own = defIn(type, entry.propertyId)
  return !own || own.type === def.type
}

/** Whether a kanban drop may write `def`'s value on `row` (see `sameKind`): a row of a type with the key as another kind is refused. */
export function canDropRow(row: Row, entry: GroupByEntry, def: Pick<PropertyDef, 'type'>, types: TypeDef[]): boolean {
  return sameKind(row, entry, def, types.find((t) => t.id === row.summary.type))
}

const cmpSort = (a: number | string, b: number | string): number =>
  typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })

type Entry = Group & { sort: number | string; created: number }

/**
 * Split rows into groups by `groupBy`'s first entry. Returns the visible groups in order and the
 * hidden ones (hidden by their config, or unknown with `hideByDefault`).
 */
export function groupRows(
  rows: Row[],
  groupBy: GroupBy | null,
  config: Config | undefined,
  ctx: GroupCtx,
): { groups: Group[]; hidden: Group[] } {
  const entry = groupBy?.groups?.[0]
  const def = entry ? findDef(ctx.types, entry.propertyId, entry.structureId, ctx.viewTypeIds) : undefined
  if (!entry || !def) return { groups: [{ id: OTHER_ID, label: 'Objects', rows }], hidden: [] }
  const isStatus = isStatusLabel(def)
  const byCategory = isStatus && entry.option === STATUS_CATEGORY_OPTION

  const byId = new Map<string, Entry>()
  const otherLabel = DATE_KINDS.has(def.type) && entry.option === SCHEDULED_OPTION ? NO_DATE : 'Other'
  const other: Group = { id: OTHER_ID, label: otherLabel, rows: [], isOther: true }
  if (byCategory) {
    // The four categories are always the columns, in order.
    STATUS_CATEGORIES.forEach((c, i) => byId.set(c.key, { id: c.key, label: c.label, rows: [], sort: i, created: Infinity }))
  } else {
    // Every label option is a group, even with no rows, so a board keeps its columns.
    ;(def.type === 'label' ? (def.options.set ?? []) : []).forEach((opt, i) =>
      byId.set(opt.id, { id: opt.id, label: opt.text, rows: [], color: opt.color, icon: opt.icon, sort: i, created: Infinity }),
    )
  }
  if (def.type === 'boolean') {
    byId.set('true', { id: 'true', label: 'Checked', rows: [], sort: 0, created: Infinity })
    byId.set('false', { id: 'false', label: 'Unchecked', rows: [], sort: 1, created: Infinity })
  }
  const byType = typeMap(ctx.types)
  const scratch = scratchFor(ctx)
  for (const row of rows) {
    // A row of another type than the grouping's, or one whose type has the key as another kind
    // (text where the view's definition is a label), can't be bucketed: it sits in Other.
    const buckets = !sameKind(row, entry, def, byType[row.summary.type]) ? [] : rowBuckets(row, entry, def, ctx, scratch)
    if (!buckets) continue
    if (!buckets.length) {
      other.rows.push(row)
      continue
    }
    for (const b of buckets) {
      let g = byId.get(b.id)
      if (!g) {
        const created = def.type === 'entity' || def.type === 'entity_backlinks' ? Date.parse(ctx.entityCreated?.[b.id] ?? '') : NaN
        g = { id: b.id, label: b.label, rows: [], sort: b.sort, created: Number.isNaN(created) ? Infinity : created }
        if (def.type === 'entity_type') g.icon = ctx.types.find((x) => x.id === b.id)?.icon
        byId.set(b.id, g)
      }
      g.rows.push(row)
    }
  }

  const sortOption: GroupSortOption = groupBy?.sortOption ?? 'default'
  let list = [...byId.values()]
  if (config?.hideEmptyGroups) list = list.filter((g) => g.rows.length > 0)
  const manualPos = (id: string) => {
    const i = (config?.groups ?? []).findIndex((x) => x.id === id)
    return i < 0 ? Infinity : i
  }
  const cmp: Record<GroupSortOption, (a: Entry, b: Entry) => number> = {
    default: (a, b) => cmpSort(a.sort, b.sort),
    defaultDescending: (a, b) => -cmpSort(a.sort, b.sort),
    ascending: (a, b) => cmpSort(a.label, b.label),
    descending: (a, b) => -cmpSort(a.label, b.label),
    sizeAscending: (a, b) => a.rows.length - b.rows.length,
    sizeDescending: (a, b) => b.rows.length - a.rows.length,
    createdAscending: (a, b) => (a.created === b.created ? 0 : a.created < b.created ? -1 : 1),
    createdDescending: (a, b) => {
      const x = a.created === Infinity ? -Infinity : a.created
      const y = b.created === Infinity ? -Infinity : b.created
      return x === y ? 0 : x > y ? -1 : 1
    },
    manual: (a, b) => {
      const p = manualPos(a.id)
      const q = manualPos(b.id)
      return p === q ? 0 : p < q ? -1 : 1
    },
  }
  list = list.map((g, i) => ({ g, i })).sort((p, q) => cmp[sortOption](p.g, q.g) || p.i - q.i).map((x) => x.g)
  let ordered: Group[] = list.map(({ sort: _s, created: _c, ...g }) => g)

  // "Other" holds the rows with no value: last, or first for a status label. A manual order that
  // placed it keeps it there.
  if (other.rows.length) {
    const at = manualPos(OTHER_ID)
    if (sortOption === 'manual' && at !== Infinity) {
      const i = ordered.findIndex((g) => manualPos(g.id) > at)
      ordered.splice(i < 0 ? ordered.length : i, 0, other)
    } else ordered = isStatus ? [other, ...ordered] : [...ordered, other]
  }

  const groups: Group[] = []
  const hidden: Group[] = []
  for (const g of ordered) {
    const c = config?.groups?.find((x) => x.id === g.id)
    if (c ? c.isHidden : !!config?.hideByDefault) hidden.push(g)
    else groups.push(g)
  }
  return { groups, hidden }
}

/** A kanban drag: the row being moved and the column it left. */
export interface GroupMove {
  row: Row
  from?: Group | null
}

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** A multi-value list with the source column's item removed and `add` appended (once). */
function swapText(current: unknown, fromLabel: string | null, add: string, same: (a: string, b: string) => boolean): string[] {
  const items = (Array.isArray(current) ? (current as unknown[]) : []).filter(
    (x): x is string => typeof x === 'string' && !(fromLabel !== null && same(x, fromLabel)),
  )
  if (!items.some((x) => same(x, add))) items.push(add)
  return items
}

/**
 * The update that moves a row into `group`, or null where a drag can't (created, updated, type,
 * backlinks, number ranges and date periods). With `move`, a multi-value property keeps its other
 * values: the source column's value is removed and the target's added.
 */
export function valueForGroup(
  groupBy: GroupBy | GroupByEntry,
  group: Group,
  def: Pick<PropertyDef, 'type' | 'options'>,
  move?: GroupMove,
): { key: string; value: unknown } | null {
  const entry: GroupByEntry | undefined = 'groups' in groupBy ? groupBy.groups[0] : groupBy
  if (!entry) return null
  const key = entry.propertyId
  const current = move ? rowValue(move.row, key) : undefined
  const from = move?.from && !move.from.isOther ? move.from : null
  switch (def.type) {
    case 'entity_createdAt':
    case 'entity_lastUpdated':
    case 'entity_type':
    case 'entity_backlinks':
    case 'datetime':
    case 'datetimeSimple':
    case 'blocks':
    case 'simpleTableBlock':
      return null
    case 'number':
      return entry.option === 'range' ? null : { key, value: group.isOther ? null : Number(group.id) }
    case 'boolean':
      return { key, value: group.id === 'true' }
    case 'label':
      if (entry.option === STATUS_CATEGORY_OPTION && isStatusLabel(def)) {
        // A drop into a category writes that category's first status (none: no drop).
        const first = (def.options.set ?? []).find((s) => optionCategory(s) === group.id)
        return first ? { key, value: [first.text] } : null
      }
      if (move && def.options.isArray && !group.isOther) {
        return { key, value: swapText(current, from?.label ?? null, group.label, (a, b) => a === b) }
      }
      return { key, value: group.isOther ? [] : [group.label] }
    case 'entity_tags':
    case 'entity_collections':
    case 'entity_aliases':
      if (move && !group.isOther) return { key, value: swapText(current, from?.label ?? null, group.label, sameText) }
      return { key, value: group.isOther ? [] : [group.label] }
    case 'entity': {
      if (group.isOther) return { key, value: [] }
      const unresolved = group.id.startsWith('target:')
      const ref: EntityRef = { target: unresolved ? group.id.slice(7) : group.label, path: unresolved ? null : group.id }
      if (!move || def.options.isArray === false) return { key, value: [ref] }
      // Keep the other links; a link's group id is its resolved path, else its target.
      const links = move.row.links[key] ?? []
      const refs = Array.isArray(current) ? (current as (EntityRef | null)[]) : []
      const idOf = (r: EntityRef, i: number) => {
        const path = r.path ?? links[i] ?? null
        return path ?? `target:${r.target}`
      }
      const kept = refs.flatMap((r, i) => (r && idOf(r, i) !== from?.id ? [{ r, id: idOf(r, i) }] : []))
      const value = kept.map((x) => x.r)
      if (!kept.some((x) => x.id === group.id)) value.push(ref)
      return { key, value }
    }
    case 'textBlock':
      return entry.option === 'entity' ? null : { key, value: groupText(group) }
    default:
      return { key, value: groupText(group) }
  }
}
