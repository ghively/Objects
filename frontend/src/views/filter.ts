// The filter engine: the operators per property kind, and pure matchers over rows.
// Nested AND/OR groups; an empty group passes; an invalid filter is ignored. A filter group is
// compiled once per pass (`applyFilters`): the type map, each filter's validity and definitions,
// a date filter's reference range and the day of every instant are computed once, not per row.
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
import { COMPUTED_KINDS } from '@/api/types'
import {
  asComputed,
  computedDate,
  computedDateResolution,
  computedIsEmpty,
  computedList,
  computedNumber,
  computedText,
} from '@/properties/computed'
import { parseRemind } from '@/tasks/remind'
import { parseRepeat } from '@/tasks/repeat'
import { dayRange, dayReader, daySpan, endOfDay, parseDay, resolveRelative, startOfDay, type DayRange } from './dates'

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
  /** Object path → title, for relations (groups and sorts read the linked object's title). */
  entityTitles?: Record<string, string>
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
// The Task date's own operators: offered only on a date
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
/** M12: the date comparisons a formula or rollup offers (by day, as a date property's). */
const DATE_COMPARE = DATE.filter((x) => ['isBefore', 'isAfter', 'isOnOrBefore', 'isOnOrAfter'].includes(x.key))
/**
 * M12: a formula's or rollup's operators. Its result type is known only per row, so it offers the
 * text operators (empty and not empty first), the number and date comparisons and the checkbox
 * ones; each is evaluated against the row's value by its `type` (`matchComputed`).
 */
const COMPUTED: FilterOption[] = [...TEXT, ...NUMBER, ...DATE_COMPARE, ...BOOLEAN]
const NUMBER_KEYS = new Set(NUMBER.map((x) => x.key))
const DATE_COMPARE_KEYS = new Set(DATE_COMPARE.map((x) => x.key))
const NO_OPERAND = new Set(['isEmpty', 'isNotEmpty', 'isChecked', 'isNotChecked'])

/**
 * M12: what a formula or rollup filter's operator compares against: a number, a date reference
 * (`{relative}` / `{exactDate}`), a text, or nothing. The filter editor shows the value editor of
 * that kind and drops a reference of another kind when the operator changes.
 */
export function computedOperand(option: string): 'text' | 'number' | 'date' | 'none' {
  if (NO_OPERAND.has(option)) return 'none'
  if (NUMBER_KEYS.has(option)) return 'number'
  if (DATE_COMPARE_KEYS.has(option)) return 'date'
  return 'text'
}

/** Every operator per kind, in menu order with its labels. */
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
  // M14: a button holds no value, so it can't be filtered.
  button: [],
  // M12
  formula: COMPUTED,
  rollup: COMPUTED,
  uniqueId: TEXT,
  email: TEXT,
  phone: TEXT,
  files: EMPTY,
  // M22: a list matches as Aliases do; steps and floor items are only empty or not.
  textList: [o('contains', 'includes'), o('notContains', 'does not include'), ...EMPTY],
  steps: EMPTY,
  floorItems: EMPTY,
}

/**
 * The filter with operator `option` (the filter editor's operator menu). M12: a formula's or
 * rollup's operators compare against different kinds of value (text, a number, a date), so a
 * reference of another kind is dropped.
 */
export function withOperator(filter: Filter, option: string, kind: PropertyType): Filter {
  const next = { ...filter, option }
  if (COMPUTED_KINDS.has(kind) && computedOperand(filter.option) !== computedOperand(option)) delete next.referenceValue
  return next
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
  // M25: import provenance, read from the row's values.
  importedFrom: 'text',
  importBatch: 'text',
  sourceModified: 'text',
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

export function typeMap(types: TypeDef[]): Record<string, TypeDef> {
  return Object.fromEntries(types.map((t) => [t.id, t]))
}

type DefLike = Pick<PropertyDef, 'type' | 'options'>

/** The definition `type` itself has for `propertyId` (system ids count), or none. */
export function defIn(type: TypeDef | undefined, propertyId: string): DefLike | undefined {
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
  if (filter.typeId && !typesById[filter.typeId]) return false
  const def = findDef(Object.values(typesById), filter.propertyId, filter.typeId, viewTypeIds)
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
  const ref = typeof f.referenceValue === 'number' && !Number.isNaN(f.referenceValue) ? f.referenceValue : undefined
  // A filter with no value yet is inactive, as an empty text filter is.
  if (ref === undefined) return true
  if (n === undefined) return f.option === 'notEqual'
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

/** A date filter's reference as days: a relative range (a day, a week, a month, a year) or an exact date; null without one. */
function referenceRange(f: Filter, now: Date): DayRange | null {
  const ref = f.referenceValue as { relative?: string; exactDate?: string } | undefined
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null
  if (ref.relative) return dayRange(resolveRelative(ref.relative as never, now))
  if (ref.exactDate) {
    const d = parseDay(ref.exactDate)
    return d ? dayRange({ start: startOfDay(d), end: endOfDay(d) }) : null
  }
  return null
}

/** Compares by day (`YYYY-MM-DD` strings order as dates): the reference's range against the value's days. */
function matchDate(value: DateValue | null | undefined, f: Filter, range: DayRange | null, dayOf: (iso: string) => string | null): boolean {
  const span = daySpan(value, dayOf)
  const opt = f.option
  if (opt === 'isEmpty') return !span
  if (opt === 'isNotEmpty') return !!span
  if (!span) return false
  if (opt === 'startIsNotEmpty') return true
  if (opt === 'endIsEmpty') return !span.end
  if (opt === 'endIsNotEmpty') return !!span.end
  if (!range) return false
  const vStart = span.start
  const vEnd = span.end ?? span.start
  const rs = range.start
  const re = range.end
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

type Test = (row: Row) => boolean

/** What a filter pass computes once: the type map and the day of each instant it meets. */
interface Pass {
  byId: Record<string, TypeDef>
  dayOf: (iso: string) => string | null
}

const passFor = (ctx: FilterCtx): Pass => ({ byId: typeMap(ctx.types), dayOf: dayReader() })

/**
 * One filter as a test over rows, or null for an invalid one (skipped). The definition a row reads
 * is its own type's (looked up once per type), else the view's; a date reference resolves once.
 */
function compileFilter(f: Filter, ctx: FilterCtx, pass: Pass): Test | null {
  if (!filterIsValid(f, pass.byId, ctx.viewTypeIds)) return null
  const fallback = findDef(ctx.types, f.propertyId, f.typeId, ctx.viewTypeIds)
  const owns = new Map<string, DefLike | undefined>()
  let range: DayRange | null | undefined
  return (row) => {
    if (f.typeId && row.summary.type !== f.typeId) return true
    let own = owns.get(row.summary.type)
    if (own === undefined && !owns.has(row.summary.type)) {
      own = defIn(pass.byId[row.summary.type], f.propertyId)
      owns.set(row.summary.type, own)
    }
    const def = own ?? fallback
    if (!def) return true
    if (def.type === 'datetime' || def.type === 'datetimeSimple' || def.type === 'entity_createdAt' || def.type === 'entity_lastUpdated') {
      if (TASK_DATE_KEYS.has(f.option)) return matchTaskDate(row, f, !!own)
      if (range === undefined) range = referenceRange(f, ctx.now)
      return matchDate(own ? dateOf(row, f.propertyId) : null, f, range, pass.dayOf)
    }
    if (COMPUTED_KINDS.has(def.type)) {
      if (range === undefined) range = computedOperand(f.option) === 'date' ? referenceRange(f, ctx.now) : null
      return matchComputed(own ? rowValue(row, f.propertyId) : undefined, f, range, pass.dayOf)
    }
    return matchKind(row, f, def, !!own, ctx)
  }
}

/**
 * M12: a formula or rollup value against a filter, by the value's result type: empty and not
 * empty (an error counts as empty); the checkbox operators on a boolean; number comparisons on a
 * number and date comparisons on a date (another type never matches them, but passes "≠"); the
 * text operators on the value as text (a list's items joined, `is`/`is not` per item).
 */
function matchComputed(value: unknown, f: Filter, range: DayRange | null, dayOf: (iso: string) => string | null): boolean {
  switch (f.option) {
    case 'isEmpty':
      return computedIsEmpty(value)
    case 'isNotEmpty':
      return !computedIsEmpty(value)
    case 'isChecked':
    case 'isNotChecked': {
      const c = asComputed(value)
      const on = c?.type === 'boolean' && c.value === true
      return f.option === 'isChecked' ? on : !on
    }
  }
  switch (computedOperand(f.option)) {
    case 'number':
      return matchNumber(computedNumber(value), f)
    case 'date': {
      const iso = computedDate(value)
      return matchDate(iso ? { start: iso, resolution: computedDateResolution(iso) } : null, f, range, dayOf)
    }
  }
  const items = computedList(value)
  if (items && (f.option === 'is' || f.option === 'isNot')) {
    const ref = typeof f.referenceValue === 'string' ? f.referenceValue.toLowerCase() : ''
    if (ref === '') return true
    const hit = items.some((x) => x.toLowerCase() === ref)
    return f.option === 'is' ? hit : !hit
  }
  return matchText('text', computedText(value), f)
}

/** Whether a row passes one filter. An invalid filter passes; so does a row of another type than `typeId`. */
export function matchFilter(row: Row, f: Filter, ctx: FilterCtx): boolean {
  return compileFilter(f, ctx, passFor(ctx))?.(row) ?? true
}

/** The non-date kinds' matchers (`def` is the row's own definition when `has`, else the view's). */
function matchKind(row: Row, f: Filter, def: DefLike, has: boolean, ctx: FilterCtx): boolean {
  const kind = def.type
  const value = has ? rowValue(row, f.propertyId) : undefined
  switch (kind) {
    case 'entity_title':
      return matchText(kind, undefined, f, displayTitle(row))
    case 'text':
    case 'url':
    case 'color':
    case 'textBlock':
    case 'entity_description':
    case 'email':
    case 'phone':
      return matchText(kind, value, f)
    case 'uniqueId':
      // An ID without a prefix may come as a number.
      return matchText(kind, typeof value === 'number' ? String(value) : value, f)
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
    case 'textList': {
      // M22: as Aliases, on the row's value: a case-insensitive substring of any item.
      const have = Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
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
    default:
      return f.option === 'isEmpty' ? blank(value) : !blank(value)
  }
}

/** A group as a test over rows, or null when nothing in it is effective (such a group passes). */
function compileGroup(group: FilterGroup, ctx: FilterCtx, pass: Pass): Test | null {
  const tests: Test[] = []
  for (const e of group.elements) {
    const t = e.type === 'filter' ? compileFilter(e, ctx, pass) : compileGroup(e, ctx, pass)
    if (t) tests.push(t)
  }
  if (tests.length === 0) return null
  return group.operator === 'or' ? (row) => tests.some((t) => t(row)) : (row) => tests.every((t) => t(row))
}

/** Whether a row passes a group. Invalid filters and groups without any are skipped; none left passes. */
export function matchGroup(row: Row, group: FilterGroup, ctx: FilterCtx): boolean {
  return compileGroup(group, ctx, passFor(ctx))?.(row) ?? true
}

export function applyFilters(rows: Row[], group: FilterGroup | null | undefined, ctx: FilterCtx): Row[] {
  if (!group || group.elements.length === 0) return rows
  const test = compileGroup(group, ctx, passFor(ctx))
  return test ? rows.filter(test) : rows
}
