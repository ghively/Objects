// The sort engine: stable, applied in order, with per-kind options and a fallback.
import type { DateValue, EntityRef, PropertyType, Row, Sort } from '@/api/types'
import { asComputed, computedDateResolution, computedIsEmpty, computedText } from '@/properties/computed'
import { fileName } from '@/properties/files'
import { dateSpan } from './dates'
import { displayTitle, findDef, rowValue, type FilterCtx } from './filter'

export interface SortOptionInfo {
  key: Sort['option']
  label: string
}

const DATE_KINDS = new Set<PropertyType>(['datetime', 'datetimeSimple', 'entity_createdAt', 'entity_lastUpdated'])

/** M22: steps and floor items are not sortable (a List sorts by its first item). */
const UNSORTABLE = new Set<PropertyType>(['entity_type', 'steps', 'floorItems'])

/** The sort options a kind offers; `entity_type`, `steps` and `floorItems` are not sortable. */
export function SORT_OPTIONS(kind: PropertyType): SortOptionInfo[] {
  if (UNSORTABLE.has(kind)) return []
  if (DATE_KINDS.has(kind)) {
    return [
      { key: 'ascending', label: 'Oldest first' },
      { key: 'descending', label: 'Newest first' },
      { key: 'ascendingExists', label: 'is empty first' },
      { key: 'descendingExists', label: 'is empty last' },
    ]
  }
  return [
    { key: 'ascending', label: 'ascending' },
    { key: 'descending', label: 'descending' },
  ]
}

type Key = { empty: true } | { empty: false; value: string | number; labelOrder?: number[] }
const EMPTY_KEY: Key = { empty: true }

const text = (s: string): Key => (s.trim() === '' ? EMPTY_KEY : { empty: false, value: s })

function sortKey(row: Row, sort: Sort, ctx: FilterCtx): Key {
  // A sort scoped to one type sees every other type's rows as empty.
  if (sort.typeId && row.summary.type !== sort.typeId) return EMPTY_KEY
  const def = findDef(ctx.types, sort.propertyId, row.summary.type) ?? findDef(ctx.types, sort.propertyId)
  if (!def) return EMPTY_KEY
  const v = rowValue(row, sort.propertyId)
  switch (def.type) {
    case 'entity_title':
      return text(displayTitle(row))
    case 'number':
      return typeof v === 'number' && !Number.isNaN(v) ? { empty: false, value: v } : EMPTY_KEY
    case 'boolean':
      return { empty: false, value: v === true ? 1 : 0 }
    case 'datetime':
    case 'datetimeSimple':
    case 'entity_createdAt':
    case 'entity_lastUpdated': {
      const dv: DateValue | null =
        typeof v === 'string' ? (v ? { start: v, resolution: 'time' } : null) : ((v as DateValue | null) ?? null)
      const span = dateSpan(dv)
      return span ? { empty: false, value: span.start.getTime() } : EMPTY_KEY
    }
    case 'label': {
      const set = def.options.set ?? []
      const order = (Array.isArray(v) ? (v as string[]) : []).map((t) => {
        const i = set.findIndex((s) => s.text === t)
        return i < 0 ? Number.MAX_SAFE_INTEGER : i
      })
      return order.length ? { empty: false, value: 0, labelOrder: order } : EMPTY_KEY
    }
    case 'entity': {
      // The linked object's title (as its group shows), else the link text.
      const first = Array.isArray(v) ? (v as EntityRef[])[0] : undefined
      const path = first ? (first.path ?? row.links[sort.propertyId]?.[0] ?? null) : null
      return text((path && ctx.entityTitles?.[path]) || first?.target || '')
    }
    case 'entity_tags':
      return text(row.summary.tags?.[0] ?? '')
    case 'entity_collections':
      return text(row.summary.collections?.[0] ?? '')
    case 'entity_aliases':
      return text(row.summary.aliases?.[0] ?? '')
    case 'formula':
    case 'rollup':
      return computedKey(v)
    case 'uniqueId':
      return idKey(v)
    case 'files':
      // A list: by its first file's name.
      return text(Array.isArray(v) && typeof v[0] === 'string' ? fileName(v[0]) : '')
    case 'textList':
      // M22: a List by its first item.
      return text(Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '')
    default:
      return typeof v === 'string' ? text(v) : EMPTY_KEY
  }
}

/**
 * M12: a formula or rollup value's key by its result type: numbers numerically, dates by date,
 * text (and a list's items, joined) case-insensitively, a boolean as checked after unchecked;
 * empty and errors sort with the empties.
 */
function computedKey(v: unknown): Key {
  const c = asComputed(v)
  if (!c || computedIsEmpty(c)) return EMPTY_KEY
  switch (c.type) {
    case 'number':
      return { empty: false, value: c.value as number }
    case 'boolean':
      return { empty: false, value: c.value === true ? 1 : 0 }
    case 'date': {
      const iso = c.value as string
      const span = dateSpan({ start: iso, resolution: computedDateResolution(iso) })
      return span ? { empty: false, value: span.start.getTime() } : EMPTY_KEY
    }
    default:
      return text(computedText(c))
  }
}

/** M12: an ID by its trailing number (`TASK-9` before `TASK-10`), else as text. */
function idKey(v: unknown): Key {
  if (typeof v === 'number' && Number.isFinite(v)) return { empty: false, value: v }
  if (typeof v !== 'string' || v.trim() === '') return EMPTY_KEY
  const m = /(\d+)\s*$/.exec(v)
  return m ? { empty: false, value: Number(m[1]) } : text(v)
}

type Filled = Extract<Key, { empty: false }>

function compareKeys(a: Filled, b: Filled): number {
  if (a.labelOrder || b.labelOrder) {
    const x = a.labelOrder ?? []
    const y = b.labelOrder ?? []
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) return 1
      if (y[i] === undefined) return -1
      if (x[i] !== y[i]) return x[i] - y[i]
    }
    return 0
  }
  if (typeof a.value === 'number' && typeof b.value === 'number') return a.value - b.value
  return String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: 'base' })
}

function createdMs(row: Row): number | null {
  const t = row.summary.createdAt ? Date.parse(row.summary.createdAt) : NaN
  return Number.isNaN(t) ? null : t
}

/**
 * Sort rows by `sorts` in order (stable), falling back to `createdAt` newest first. Empty values
 * go last; "is empty first" / "is empty last" order by emptiness only.
 */
export function applySorts(rows: Row[], sorts: Sort[], ctx: FilterCtx): Row[] {
  const active = sorts.filter((s) => {
    const kind = findDef(ctx.types, s.propertyId, s.typeId, ctx.viewTypeIds)?.type
    return !!kind && !UNSORTABLE.has(kind)
  })
  const keyed = rows.map((row, i) => ({ row, i, keys: active.map((s) => sortKey(row, s, ctx)) }))
  keyed.sort((p, q) => {
    for (let n = 0; n < active.length; n++) {
      const a = p.keys[n]
      const b = q.keys[n]
      const opt = active[n].option
      let c = 0
      if (opt === 'ascendingExists') c = Number(a.empty ? 0 : 1) - Number(b.empty ? 0 : 1)
      else if (opt === 'descendingExists') c = Number(a.empty ? 1 : 0) - Number(b.empty ? 1 : 0)
      else if (a.empty && b.empty) c = 0
      else if (a.empty) c = 1
      else if (b.empty) c = -1
      else {
        c = compareKeys(a as Filled, b as Filled)
        if (opt === 'descending') c = -c
      }
      if (c !== 0) return c
    }
    const ca = createdMs(p.row)
    const cb = createdMs(q.row)
    if (ca !== cb) {
      if (ca === null) return 1
      if (cb === null) return -1
      return cb - ca
    }
    return p.i - q.i
  })
  return keyed.map((k) => k.row)
}
