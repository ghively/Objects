// M12: the formula language's functions as the formula editor lists them (the spec's function
// table), and the property names a formula can refer to with `prop("…")`. Descriptions are our
// strings.
import type { PropertyDef, PropertyType } from '@/api/types'

export interface FormulaFunction {
  name: string
  /** How it is called, as shown in the list. */
  signature: string
  /** One line on what it does (our string). */
  description: string
}

export const FORMULA_FUNCTIONS: readonly FormulaFunction[] = [
  { name: 'if', signature: 'if(condition, then, else)', description: 'One value when the condition is true, another when it is false.' },
  { name: 'ifs', signature: 'ifs(c1, v1, c2, v2, …, else)', description: 'The value after the first true condition, else the last value.' },
  { name: 'empty', signature: 'empty(x)', description: 'True when the value is empty.' },
  { name: 'length', signature: 'length(textOrList)', description: 'The number of characters in a text or items in a list.' },
  { name: 'contains', signature: 'contains(textOrList, x)', description: 'True when the text or list contains the value.' },
  { name: 'concat', signature: 'concat(a, b, …)', description: 'Joins texts, or lists, into one.' },
  { name: 'join', signature: 'join(list, separator)', description: 'Joins a list into one text with a separator.' },
  { name: 'lower', signature: 'lower(text)', description: 'The text in lower case.' },
  { name: 'upper', signature: 'upper(text)', description: 'The text in upper case.' },
  { name: 'trim', signature: 'trim(text)', description: 'The text without leading and trailing spaces.' },
  { name: 'replace', signature: 'replace(text, find, with)', description: 'Replaces every match of a plain text.' },
  { name: 'round', signature: 'round(number, digits?)', description: 'Rounds to the given number of decimals (0 when left out).' },
  { name: 'floor', signature: 'floor(number)', description: 'Rounds down to a whole number.' },
  { name: 'ceil', signature: 'ceil(number)', description: 'Rounds up to a whole number.' },
  { name: 'abs', signature: 'abs(number)', description: 'The number without its sign.' },
  { name: 'sqrt', signature: 'sqrt(number)', description: 'The square root.' },
  { name: 'min', signature: 'min(a, b, …)', description: 'The smallest of the numbers.' },
  { name: 'max', signature: 'max(a, b, …)', description: 'The largest of the numbers.' },
  { name: 'sum', signature: 'sum(a, b, …)', description: 'The numbers added up.' },
  { name: 'toNumber', signature: 'toNumber(x)', description: 'The value as a number.' },
  { name: 'format', signature: 'format(x)', description: 'The value as text.' },
  { name: 'now', signature: 'now()', description: 'The current date and time.' },
  { name: 'today', signature: 'today()', description: "Today's date." },
  { name: 'dateAdd', signature: 'dateAdd(date, n, unit)', description: 'The date plus n units.' },
  { name: 'dateSubtract', signature: 'dateSubtract(date, n, unit)', description: 'The date minus n units.' },
  { name: 'dateBetween', signature: 'dateBetween(a, b, unit)', description: 'The whole units from b to a (a − b).' },
  { name: 'formatDate', signature: 'formatDate(date, pattern)', description: 'The date as text, with YYYY MM DD HH mm.' },
  { name: 'year', signature: 'year(date)', description: "The date's year." },
  { name: 'month', signature: 'month(date)', description: "The date's month (1–12)." },
  { name: 'day', signature: 'day(date)', description: "The date's day of the month." },
  { name: 'first', signature: 'first(list)', description: 'The first item of a list.' },
  { name: 'last', signature: 'last(list)', description: 'The last item of a list.' },
]

export const FORMULA_FUNCTION_NAMES: ReadonlySet<string> = new Set(FORMULA_FUNCTIONS.map((f) => f.name))

/** The system names `prop("…")` always knows, in the spec's order. */
export const SYSTEM_PROP_NAMES: readonly string[] = ['Title', 'Description', 'Tags', 'Created at', 'Last updated', 'Aliases']

// The system kinds behind those names (listed by their system name, not the definition's).
const SYSTEM_KINDS = new Set<PropertyType>([
  'entity_title',
  'entity_description',
  'entity_tags',
  'entity_createdAt',
  'entity_lastUpdated',
  'entity_aliases',
])

// The kinds whose values a formula can read (spec, "Property values in formulas").
const VALUE_KINDS = new Set<PropertyType>([
  'text',
  'url',
  'number',
  'boolean',
  'datetime',
  'datetimeSimple',
  'entity',
  'label',
  'color',
  'formula',
  'rollup',
  'uniqueId',
  'email',
  'phone',
  'files',
])

/**
 * The names the property list offers: the system names, then the type's own properties that a
 * formula can read, in definition order, without `selfId` (a formula can't use itself).
 */
export function formulaPropertyNames(defs: readonly PropertyDef[], selfId: string): string[] {
  const names = [...SYSTEM_PROP_NAMES]
  const seen = new Set(names.map((n) => n.toLowerCase()))
  for (const d of defs) {
    if (d.id === selfId || SYSTEM_KINDS.has(d.type) || !VALUE_KINDS.has(d.type)) continue
    if (seen.has(d.name.toLowerCase())) continue
    seen.add(d.name.toLowerCase())
    names.push(d.name)
  }
  return names
}

/** `prop("Name")`, with `"` and `\` escaped. */
export function propCall(name: string): string {
  return `prop("${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
}
