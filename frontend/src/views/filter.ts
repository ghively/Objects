// The filter engine: Object's operators per property kind, and pure matchers over rows.
// Nested AND/OR groups; an empty group passes; an invalid filter is ignored.
import type {
  Collection,
  DateValue,
  EntityRef,
  Filter,
  FilterGroup,
  PropertyDef,
  PropertyType,
  Row,
  TypeDef,
} from '@/api/types'
import { parseRemind } from '@/tasks/remind'
import { parseRepeat } from '@/tasks/repeat'
import { dateSpan, endOfDay, parseDay, resolveRelative, startOfDay } from './dates'

export interface FilterOption {
  key: string
  label: string
}

export interface FilterCtx {
  types: TypeDef[]
  collections: Collection[]
  /** Tag object id → title (tag values are titles). */
  tagIdsToTitles: Record<string, string>
  now: Date
  /** Object id → path, to compare entity filters' object ids with the resolved links. */
  pathsById?: Record<string, string>
  /** The types the view shows: a key two types share resolves against these first. */
  viewTypeIds?: string[]
}

const o = (key: string, label: string): FilterOption => ({ key, label })

const EMPTY = [o('isEmpty', 'is empty'), o('isNotEmpty', 'is not empty')]
const TEXT: FilterOption[] = [
  ...EMPTY,
  o('contains', 'includes'),
  o('notContains', 'does not include'),
  o('is', 'is'),
  o('isNot', 'is not'),
  o('startsWith', 'starts with'),
  o('endsWith', 'ends with'),
]
const NUMBER: FilterOption[] = [
  o('equal', '='),
  o('notEqual', '≠'),
  o('greaterEqual', '≥'),
  o('greater', '>'),
  o('smallerEqual', '≤'),
  o('smaller', '<'),
]
const BOOLEAN: FilterOption[] = [o('isChecked', 'is selected'), o('isNotChecked', 'is not selected')]
const MANY: FilterOption[] = [...EMPTY, o('contains', 'includes'), o('notContains', 'does not include')]
const DATE: FilterOption[] = [
  o('isNotEmpty', 'is not empty'),
  o('isEmpty', 'is empty'),
  o('startIsNotEmpty', 'start is not empty'),
  o('endIsEmpty', 'end is empty'),
  o('endIsNotEmpty', 'end is not empty'),
  o('is', 'is'),
  o('isBefore', 'is before'),
  o('isAfter', 'is after'),
  o('isOnOrBefore', 'is on or before'),
  o('isOnOrAfter', 'is on or after'),
  o('startIs', 'starts'),
  o('startIsBefore', 'starts before'),
  o('startIsAfter', 'starts after'),
  o('startIsOnOrBefore', 'starts on or before'),
  o('startIsOnOrAfter', 'starts on or after'),
  o('endIs', 'ends on'),
  o('endIsBefore', 'ends before'),
  o('endIsAfter', 'ends after'),
  o('endIsOnOrBefore', 'ends on or before'),
  o('endIsOnOrAfter', 'ends on or after'),
]
// The Task date's own operators (`convolution.filter.options.dateTime.*`): offered only on a date
// that supports reminders, which is the Task `date` alone. They need no reference value.
export const TASK_DATE_OPTIONS: FilterOption[] = [
  o('isRecurring', 'is recurring'),
  o('isNotRecurring', 'is not recurring'),
  o('hasReminder', 'has reminder'),
  o('hasNoReminder', 'has no reminder'),
]
const TASK_DATE_KEYS = new Set(TASK_DATE_OPTIONS.map((x) => x.key))
const RANGE_ONLY = new Set(DATE.map((x) => x.key).filter((k) => /^(start|end)/.test(k)))
const SIMPLE_DATE = DATE.filter((x) => !RANGE_ONLY.has(x.key))
const BLOCKS: FilterOption[] = [o('isNotEmpty', 'is not empty'), o('isEmpty', 'is empty')]

/** Every operator per kind, in the reference's order with its labels. */
export const FILTER_OPTIONS: Record<PropertyType, FilterOption[]> = {
  text: TEXT,
  url: TEXT,
  color: TEXT,
  textBlock: TEXT,
  entity_title: TEXT,
  entity_description: TEXT,
  number: NUMBER,
  boolean: BOOLEAN,
  label: MANY,
  entity: MANY,
  entity_tags: MANY,
  entity_aliases: [o('contains', 'includes'), o('notContains', 'does not include'), ...EMPTY],
  entity_type: [o('contains', 'is'), o('notContains', 'is not')],
  entity_icon: [...EMPTY, o('is', 'is'), o('isNot', 'is not')],
  entity_collections: [o('contains', 'includes')],
  entity_backlinks: [o('contains', 'includes')],
  datetime: DATE,
  datetimeSimple: SIMPLE_DATE,
  entity_createdAt: SIMPLE_DATE,
  entity_lastUpdated: SIMPLE_DATE,
  blocks: BLOCKS,
  simpleTableBlock: BLOCKS,
  coverImage: BLOCKS,
}

/** The operators a property offers: the start/end ones only when its dates may have an end. */
export function filterOptionsFor(def: Pick<PropertyDef, 'type' | 'options'>): FilterOption[] {
  let all = FILTER_OPTIONS[def.type] ?? []
  if (def.type === 'datetime' && def.options?.constraints?.endTimeSettings === 'notAllowed') {
    all = all.filter((x) => !RANGE_ONLY.has(x.key))
  }
  if ((def.type === 'datetime' || def.type === 'datetimeSimple') && def.options?.constraints?.supportsReminders) {
    all = [...all, ...TASK_DATE_OPTIONS]
  }
  return all
}

/** System ids that every type has, whether or not its definitions list them. */
const BUILTIN_KINDS: Record<string, PropertyType> = {
  title: 'entity_title',
  description: 'entity_description',
  tags: 'entity_tags',
  icon: 'entity_icon',
  aliases: 'entity_aliases',
  type: 'entity_type',
  collections: 'entity_collections',
  createdAt: 'entity_createdAt',
  lastUpdated: 'entity_lastUpdated',
  backlinks: 'entity_backlinks',
}

/** The untitled fallback the UI shows for an empty title. */
export const UNTITLED = 'Untitled'
export const displayTitle = (row: Row): string => (row.summary.title?.trim() ? row.summary.title : UNTITLED)

/** A row's value for a property id: system ids read the summary, the rest the decoded values. */
export function rowValue(row: Row, propertyId: string): unknown {
  const s = row.summary
  switch (propertyId) {
    case 'title':
      return s.title
    case 'type':
      return s.type
    case 'collections':
      return s.collections ?? []
    case 'tags':
      return s.tags ?? []
    case 'description':
      return s.description
    case 'aliases':
      return s.aliases ?? []
    case 'icon':
      return s.icon
    case 'createdAt':
      return s.createdAt
    case 'lastUpdated':
      return s.lastUpdated
    case 'color':
      return s.color
    case 'coverImage':
      return s.coverImage
    case 'backlinks':
      // The live backlinks (`EntityRef[]`), sent under the type's backlinks definition's key.
      return row.values.backlinks
    default:
      return row.values[propertyId]
  }
}

function typeMap(types: TypeDef[]): Record<string, TypeDef> {
  return Object.fromEntries(types.map((t) => [t.id, t]))
}

type DefLike = Pick<PropertyDef, 'type' | 'options'>

function defIn(type: TypeDef | undefined, propertyId: string): DefLike | undefined {
  if (!type) return undefined
  const d = type.propertyDefinitions.find((p) => p.key === propertyId || p.id === propertyId)
  if (d) return d
  const kind = BUILTIN_KINDS[propertyId]
  return kind ? { type: kind, options: {} } : undefined
}

/**
 * The definition a filter or sort reads for `propertyId`, in `typeId`'s type or, without one, the
 * first of the view's types (`prefer`) that has it, else any type.
 */
export function findDef(types: TypeDef[], propertyId: string, typeId?: string, prefer?: string[]): DefLike | undefined {
  if (typeId) return defIn(types.find((x) => x.id === typeId), propertyId)
  const ordered = prefer?.length ? [...types.filter((t) => prefer.includes(t.id)), ...types.filter((t) => !prefer.includes(t.id))] : types
  for (const t of ordered) {
    const d = defIn(t, propertyId)
    if (d) return d
  }
  const kind = BUILTIN_KINDS[propertyId]
  return kind ? { type: kind, options: {} } : undefined
}

/**
 * Operators a saved filter may hold beyond the ones offered: the backlinks filter offers only
 * "includes", but a saved "does not include" is evaluated rather than ignored.
 */
const ACCEPTED_EXTRA: Partial<Record<PropertyType, string[]>> = { entity_backlinks: ['notContains'] }

/** Whether the filter names a property and an operator that still exist; an invalid one is ignored. */
export function filterIsValid(filter: Filter, typesById: Record<string, TypeDef>, viewTypeIds?: string[]): boolean {
  if (filter.structureId && !typesById[filter.structureId]) return false
  const def = findDef(Object.values(typesById), filter.propertyId, filter.structureId, viewTypeIds)
  if (!def) return false
  return filterOptionsFor(def).some((x) => x.key === filter.option) || !!ACCEPTED_EXTRA[def.type]?.includes(filter.option)
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')
const blank = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

function textValue(kind: PropertyType, v: unknown): string {
  const s = asString(v)
  return kind === 'textBlock' ? (s.split(/\n\s*\n/)[0] ?? '') : s
}

function matchText(kind: PropertyType, value: unknown, f: Filter, title?: string): boolean {
  const text = title ?? textValue(kind, value)
  if (f.option === 'isEmpty') return text.trim() === ''
  if (f.option === 'isNotEmpty') return text.trim() !== ''
  const ref = typeof f.referenceValue === 'string' ? f.referenceValue : ''
  if (ref === '') return true
  const a = text.toLowerCase()
  const b = ref.toLowerCase()
  switch (f.option) {
    case 'contains':
      return a.includes(b)
    case 'notContains':
      return !a.includes(b)
    case 'is':
      return a === b
    case 'isNot':
      return a !== b
    case 'startsWith':
      return a.startsWith(b)
    case 'endsWith':
      return a.endsWith(b)
  }
  return true
}

function matchNumber(value: unknown, f: Filter): boolean {
  const n = typeof value === 'number' && !Number.isNaN(value) ? value : undefined
  const ref = typeof f.referenceValue === 'number' ? f.referenceValue : undefined
  if (n === undefined) return f.option === 'notEqual'
  if (ref === undefined) return false
  switch (f.option) {
    case 'equal':
      return n === ref
    case 'notEqual':
      return n !== ref
    case 'greaterEqual':
      return n >= ref
    case 'greater':
      return n > ref
    case 'smallerEqual':
      return n <= ref
    case 'smaller':
      return n < ref
  }
  return true
}

/** Includes (any of the reference) / does not include (none); an empty reference passes. */
function matchSet(have: string[], want: string[], f: Filter): boolean {
  if (f.option === 'isEmpty') return have.length === 0
  if (f.option === 'isNotEmpty') return have.length > 0
  if (want.length === 0) return true
  const hit = want.some((w) => have.includes(w))
  return f.option === 'notContains' ? !hit : hit
}

const refIds = (f: Filter): string[] =>
  Array.isArray(f.referenceValue) ? f.referenceValue.filter((x): x is string => typeof x === 'string') : []

function entityPaths(row: Row, propertyId: string): string[] {
  const links = row.links[propertyId]
  if (links) return links.filter((p): p is string => !!p)
  const v = row.values[propertyId]
  return Array.isArray(v) ? (v as EntityRef[]).map((r) => r?.path).filter((p): p is string => !!p) : []
}

function entityCount(row: Row, propertyId: string): number {
  const v = row.values[propertyId]
  if (Array.isArray(v)) return v.length
  return (row.links[propertyId] ?? []).length
}

function collectionIds(row: Row, collections: Collection[]): string[] {
  const out: string[] = []
  for (const name of row.summary.collections ?? []) {
    const n = name.toLowerCase()
    const c =
      collections.find((x) => x.name.toLowerCase() === n) ??
      collections.find((x) => (x.formerNames ?? []).some((f) => f.toLowerCase() === n))
    if (c && !out.includes(c.id)) out.push(c.id)
  }
  return out
}

function matchDate(value: DateValue | null | undefined, f: Filter, now: Date): boolean {
  const span = dateSpan(value)
  const opt = f.option
  if (opt === 'isEmpty') return !span
  if (opt === 'isNotEmpty') return !!span
  if (!span) return false
  if (opt === 'startIsNotEmpty') return true
  if (opt === 'endIsEmpty') return !span.end
  if (opt === 'endIsNotEmpty') return !!span.end
  // The comparison is by day: the reference's range (a day, a week, a month, a year) against the value's days.
  const ref = f.referenceValue as { relative?: string; exactDate?: string } | undefined
  let range: { start: Date; end: Date } | null = null
  if (ref && typeof ref === 'object' && !Array.isArray(ref)) {
    if (ref.relative) range = resolveRelative(ref.relative as never, now)
    else if (ref.exactDate) {
      const d = parseDay(ref.exactDate)
      if (d) range = { start: startOfDay(d), end: endOfDay(d) }
    }
  }
  if (!range) return false
  const vStart = startOfDay(span.start).getTime()
  const vEnd = endOfDay(span.end ?? span.start).getTime()
  const rs = range.start.getTime()
  const re = range.end.getTime()
  const point = /^start/.test(opt) ? vStart : vEnd
  switch (opt) {
    case 'is':
      return vStart <= re && vEnd >= rs
    case 'isBefore':
      return vEnd < rs
    case 'isAfter':
      return vStart > re
    case 'isOnOrBefore':
      return vEnd <= re
    case 'isOnOrAfter':
      return vStart >= rs
    case 'startIs':
    case 'endIs':
      return point >= rs && point <= re
    case 'startIsBefore':
    case 'endIsBefore':
      return point < rs
    case 'startIsAfter':
    case 'endIsAfter':
      return point > re
    case 'startIsOnOrBefore':
    case 'endIsOnOrBefore':
      return point <= re
    case 'startIsOnOrAfter':
    case 'endIsOnOrAfter':
      return point >= rs
  }
  return false
}

function dateOf(row: Row, propertyId: string): DateValue | null {
  const v = rowValue(row, propertyId)
  if (typeof v === 'string') return v ? { start: v, resolution: 'time' } : null
  return (v as DateValue | null | undefined) ?? null
}

/**
 * The Task date operators, read from the row's `repeat`/`remind` texts beside the date: a repeat
 * counts only when it parses and the date is set; a reminder only when it also fits the date's
 * resolution (as the server ignores the rest).
 */
function matchTaskDate(row: Row, f: Filter, has: boolean): boolean {
  const date = has ? dateOf(row, f.propertyId) : null
  const recurring = !!date && parseRepeat(row.values.repeat) !== null
  const reminder = !!date && parseRemind(row.values.remind, date.resolution) !== null
  switch (f.option) {
    case 'isRecurring':
      return recurring
    case 'isNotRecurring':
      return !recurring
    case 'hasReminder':
      return reminder
    default:
      return !reminder
  }
}

/** Whether a row passes one filter. An invalid filter passes; so does a row of another type than `structureId`. */
export function matchFilter(row: Row, f: Filter, ctx: FilterCtx): boolean {
  const byId = typeMap(ctx.types)
  if (!filterIsValid(f, byId, ctx.viewTypeIds)) return true
  if (f.structureId && row.summary.type !== f.structureId) return true
  const own = defIn(byId[row.summary.type], f.propertyId)
  const def = own ?? findDef(ctx.types, f.propertyId, f.structureId, ctx.viewTypeIds)
  if (!def) return true
  const kind = def.type
  const has = !!own
  const value = has ? rowValue(row, f.propertyId) : undefined
  switch (kind) {
    case 'entity_title':
      return matchText(kind, undefined, f, displayTitle(row))
    case 'text':
    case 'url':
    case 'color':
    case 'textBlock':
    case 'entity_description':
      return matchText(kind, value, f)
    case 'number':
      return matchNumber(value, f)
    case 'boolean':
      return f.option === 'isChecked' ? value === true : value !== true
    case 'label': {
      const set = def.options.set ?? []
      const have = Array.isArray(value) ? (value as string[]) : []
      const want = refIds(f)
        .map((id) => set.find((s) => s.id === id)?.text)
        .filter((t): t is string => !!t)
      return matchSet(have, want, f)
    }
    case 'entity':
    case 'entity_backlinks': {
      if (f.option === 'isEmpty') return !has || entityCount(row, f.propertyId) === 0
      if (f.option === 'isNotEmpty') return has && entityCount(row, f.propertyId) > 0
      const paths = has ? entityPaths(row, f.propertyId) : []
      const want = refIds(f)
        .map((id) => ctx.pathsById?.[id])
        .filter((p): p is string => !!p)
      return matchSet(paths, want, f)
    }
    case 'entity_tags': {
      const want = refIds(f)
        .map((id) => ctx.tagIdsToTitles[id])
        .filter((t): t is string => !!t)
      return matchSet(row.summary.tags ?? [], want, f)
    }
    case 'entity_collections':
      return matchSet(collectionIds(row, ctx.collections), refIds(f), f)
    case 'entity_type':
      return matchSet([row.summary.type], refIds(f), f)
    case 'entity_aliases': {
      const have = row.summary.aliases ?? []
      if (f.option === 'isEmpty') return have.length === 0
      if (f.option === 'isNotEmpty') return have.length > 0
      const ref = typeof f.referenceValue === 'string' ? f.referenceValue.toLowerCase() : ''
      if (ref === '') return true
      const hit = have.some((a) => a.toLowerCase().includes(ref))
      return f.option === 'notContains' ? !hit : hit
    }
    case 'entity_icon': {
      const icon = row.summary.icon
      if (f.option === 'isEmpty') return blank(icon)
      if (f.option === 'isNotEmpty') return !blank(icon)
      const ref = typeof f.referenceValue === 'string' ? f.referenceValue : ''
      return f.option === 'isNot' ? icon !== ref : icon === ref
    }
    case 'datetime':
    case 'datetimeSimple':
    case 'entity_createdAt':
    case 'entity_lastUpdated':
      if (TASK_DATE_KEYS.has(f.option)) return matchTaskDate(row, f, has)
      return matchDate(has ? dateOf(row, f.propertyId) : null, f, ctx.now)
    default:
      return f.option === 'isEmpty' ? blank(value) : !blank(value)
  }
}

function isEffective(el: Filter | FilterGroup, byId: Record<string, TypeDef>, viewTypeIds?: string[]): boolean {
  if (el.type === 'filter') return filterIsValid(el, byId, viewTypeIds)
  return el.elements.some((e) => isEffective(e, byId, viewTypeIds))
}

/** Whether a row passes a group. Invalid filters and groups without any are skipped; none left passes. */
export function matchGroup(row: Row, group: FilterGroup, ctx: FilterCtx): boolean {
  const byId = typeMap(ctx.types)
  const els = group.elements.filter((e) => isEffective(e, byId, ctx.viewTypeIds))
  if (els.length === 0) return true
  const test = (e: Filter | FilterGroup) => (e.type === 'filter' ? matchFilter(row, e, ctx) : matchGroup(row, e, ctx))
  return group.operator === 'or' ? els.some(test) : els.every(test)
}

export function applyFilters(rows: Row[], group: FilterGroup | null | undefined, ctx: FilterCtx): Row[] {
  if (!group || group.elements.length === 0) return rows
  return rows.filter((r) => matchGroup(r, group, ctx))
}
