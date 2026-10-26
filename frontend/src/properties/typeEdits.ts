// Pure edits of a type definition: add, update, remove and move properties, and the number
// format helpers. Every function returns a new value and never mutates its input; the caller saves
// the result through `useTypeEditor`.
import {
  KIND_TRANSFORMS,
  type Icon,
  type NumberFormat,
  type PropertyDef,
  type PropertyOptions,
  type PropertyType,
  type TypeDef,
} from '@/api/types'
import { randomColor } from '@/theme/palette'
import { KIND_META } from './kinds'

/** Frontmatter keys a user property never gets (the plan's reserved keys). */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'template',
  'title',
  'icon',
  'iconColor',
  'description',
  'aliases',
  'tags',
  'collections',
  'createdAt',
  'lastUpdated',
  'coverImage',
  'color',
  // basic media fields
  'url',
  'domain',
  'iframeUrl',
  'previewImage',
  'mimeType',
  'fileSize',
  'width',
  'height',
  'source',
  // DailyNote
  'date',
  'reviewed',
])

/** System kinds and the key (which is also the id) of their system property. */
export const SYSTEM_KEYS: Readonly<Partial<Record<PropertyType, string>>> = {
  entity_title: 'title',
  entity_collections: 'collections',
  entity_description: 'description',
  entity_createdAt: 'createdAt',
  entity_lastUpdated: 'lastUpdated',
  entity_tags: 'tags',
  entity_icon: 'icon',
  entity_aliases: 'aliases',
  entity_type: 'type',
  entity_backlinks: 'backlinks',
  coverImage: 'coverImage',
  color: 'color',
}

/** A system property (title, tags, cover image…): its id equals its key. */
export function isSystemKind(kind: PropertyType): boolean {
  return kind in SYSTEM_KEYS
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `prop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** `Total cost (EUR)` → `totalCostEur`. */
export function camelCase(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  return words
    .map((w, i) => {
      const lower = w.toLowerCase()
      return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
}

/**
 * A new frontmatter key for `name`: its camelCase, unique within the type and never reserved.
 * A collision appends `_`, then `_2`, `_3`… (as the export does).
 */
export function keyForName(type: TypeDef, name: string): string {
  let base = camelCase(name) || 'property'
  if (/^\d/.test(base)) base = `p${base}`
  const taken = new Set(type.propertyDefinitions.map((d) => d.key))
  const free = (k: string) => !taken.has(k) && !RESERVED_KEYS.has(k)
  if (free(base)) return base
  if (free(`${base}_`)) return `${base}_`
  for (let n = 2; ; n++) if (free(`${base}_${n}`)) return `${base}_${n}`
}

function defaultOptions(kind: PropertyType): PropertyOptions {
  switch (kind) {
    case 'entity':
      return { isArray: true, allowedTypes: [], hasFixedSet: false, fixedSet: [] }
    case 'label':
      return { isArray: false, set: [] }
    default:
      return {}
  }
}

export interface NewProperty {
  name: string
  icon?: Icon | null
  description?: string
  options?: PropertyOptions
}

/** The type with a new property of `kind` appended. */
export function addProperty(type: TypeDef, kind: PropertyType, p: NewProperty): TypeDef {
  const system = SYSTEM_KEYS[kind]
  const key = system ?? keyForName(type, p.name)
  const def: PropertyDef = {
    id: system ?? newId(),
    key,
    name: p.name.trim() || KIND_META[kind].name,
    type: kind,
    description: p.description ?? '',
    icon: p.icon === undefined ? { type: 'iconify', val: KIND_META[kind].icon } : p.icon,
    visibility: 'alwaysShow',
    options: { ...defaultOptions(kind), ...(p.options ?? {}) },
  }
  return { ...type, propertyDefinitions: [...type.propertyDefinitions, def] }
}

/** The type with property `id` patched (or replaced by `fn(def)`). */
export function updateProperty(
  type: TypeDef,
  id: string,
  patch: Partial<PropertyDef> | ((def: PropertyDef) => PropertyDef),
): TypeDef {
  return {
    ...type,
    propertyDefinitions: type.propertyDefinitions.map((d) =>
      d.id !== id ? d : typeof patch === 'function' ? patch(d) : { ...d, ...patch },
    ),
  }
}

/** The type without property `id`. */
export function removeProperty(type: TypeDef, id: string): TypeDef {
  return { ...type, propertyDefinitions: type.propertyDefinitions.filter((d) => d.id !== id) }
}

/** The type with property `id` moved to `toIndex`. */
export function moveProperty(type: TypeDef, id: string, toIndex: number): TypeDef {
  const defs = [...type.propertyDefinitions]
  const from = defs.findIndex((d) => d.id === id)
  if (from < 0) return type
  const [d] = defs.splice(from, 1)
  defs.splice(Math.max(0, Math.min(toIndex, defs.length)), 0, d)
  return { ...type, propertyDefinitions: defs }
}

export type NumberFormatChoice = 'none' | 'number' | 'progress' | 'percentage' | { currency: string }

function withFormat(def: PropertyDef, fmt: NumberFormat | undefined): PropertyDef {
  const options = { ...def.options }
  if (fmt) options.numberFormat = fmt
  else delete options.numberFormat
  return { ...def, options }
}

/**
 * Set the number format. A currency sets decimals to 2/2; Progress sets 10 steps and a random
 * colour; any other format drops the progress settings; `none` removes the format.
 */
export function setNumberFormat(def: PropertyDef, choice: NumberFormatChoice): PropertyDef {
  if (choice === 'none') return withFormat(def, undefined)
  const prev = def.options.numberFormat?.options ?? {}
  const rest: NumberFormat['options'] = {}
  if (prev.decimals) rest.decimals = prev.decimals
  if (prev.separators) rest.separators = prev.separators
  if (typeof choice === 'object') {
    return withFormat(def, {
      type: 'currency',
      options: { ...rest, currency: choice.currency, decimals: { min: 2, max: 2 } },
    })
  }
  if (choice === 'progress') {
    const progress = prev.progress ?? { steps: 10, color: randomColor() }
    return withFormat(def, { type: 'progress', options: { ...rest, progress } })
  }
  return withFormat(def, { type: choice, options: rest })
}

/** Set the number format's separators (creating a plain number format when there is none). */
export function setSeparators(
  def: PropertyDef,
  sep: { isGroupingThousands?: boolean; isRadixComma?: boolean },
): PropertyDef {
  const fmt = def.options.numberFormat ?? { type: 'number' as const, options: {} }
  return withFormat(def, {
    ...fmt,
    options: { ...fmt.options, separators: { ...(fmt.options.separators ?? {}), ...sep } },
  })
}

/** Enforce `n` decimals (min = max = n), or `null` to stop enforcing. */
export function setDecimals(def: PropertyDef, n: number | null): PropertyDef {
  const fmt = def.options.numberFormat ?? { type: 'number' as const, options: {} }
  const options = { ...fmt.options }
  if (n === null) delete options.decimals
  else {
    const d = Math.max(0, Math.min(5, Math.round(n)))
    options.decimals = { min: d, max: d }
  }
  return withFormat(def, { ...fmt, options })
}

/** Set the progress steps or colour (Progress format only). */
export function setProgress(def: PropertyDef, patch: { steps?: number; color?: string }): PropertyDef {
  const fmt = def.options.numberFormat
  if (!fmt) return def
  const progress = { ...(fmt.options.progress ?? { steps: 10, color: 'blue' }), ...patch }
  return withFormat(def, { ...fmt, options: { ...fmt.options, progress } })
}

/** The kinds "Change property type" offers for `kind`. */
export function allowedKindChanges(kind: PropertyType): readonly PropertyType[] {
  return KIND_TRANSFORMS[kind] ?? []
}
