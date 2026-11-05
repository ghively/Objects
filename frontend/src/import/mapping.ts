// The import dialog's mapping state: the user's overrides on top of a preview, and what is sent.
// The dialog keeps its own `ImportMapping` while the user edits: it starts from how the first
// preview made types (`seedMapping`) and holds only what the user changed; every other value is the
// latest preview's (`effectiveType`, `effectiveProperty`), so a new target shows the server's own
// matches. Every request sends a cleaned copy.
import type {
  ImportKind,
  ImportMapping,
  ImportPlannedProperty,
  ImportPlannedType,
  ImportPropertyOverride,
  ImportTypeOverride,
  TypeDef,
} from '@/api/types'

export type ImportTargetKind = 'newSpace' | 'currentSpace'

/** Our choice: an explicit "A new type" with the open space as target (see `cleanMapping`). */
export const NEW_TYPE = ''

export function emptyMapping(): ImportMapping {
  return { typeSource: 'folder', typeKey: null, types: {}, properties: {} }
}

/**
 * The dialog's mapping after the first preview: how that preview made types, and no overrides.
 * The preview's effective mapping fills in every name, kind and "Multiple values"; sending those back
 * would pin the new-space guesses (a "Page (2)" next to the new space's own Page) after the target
 * changes, and an old "Multiple values" after the kind changes (review finding 4).
 */
export function seedMapping(served: ImportMapping): ImportMapping {
  return { typeSource: served.typeSource, typeKey: served.typeKey, types: {}, properties: {} }
}

/** A copy of `m` with `typeKey`'s override merged with `patch`. */
export function withTypeOverride(m: ImportMapping, typeKey: string, patch: ImportTypeOverride): ImportMapping {
  return { ...m, types: { ...m.types, [typeKey]: { ...m.types[typeKey], ...patch } } }
}

/** A copy of `m` with property `propKey` of type `typeKey` merged with `patch`. */
export function withPropertyOverride(
  m: ImportMapping,
  typeKey: string,
  propKey: string,
  patch: ImportPropertyOverride,
): ImportMapping {
  const props = m.properties[typeKey] ?? {}
  return {
    ...m,
    properties: { ...m.properties, [typeKey]: { ...props, [propKey]: { ...props[propKey], ...patch } } },
  }
}

/**
 * A new kind for a property. A "Multiple values" the user set stays while the new kind takes it,
 * and goes with a kind that doesn't (the server's default applies when the user never set it).
 */
export function withPropertyKind(m: ImportMapping, typeKey: string, propKey: string, kind: ImportKind): ImportMapping {
  const patch: ImportPropertyOverride = { kind }
  if (!kindTakesArray(kind)) patch.isArray = undefined
  return withPropertyOverride(m, typeKey, propKey, patch)
}

/**
 * Whether imported Markdown notes can go into an existing type ("Add to"): custom types and the
 * basic Page and Task types. Tag, DailyNote, Whiteboard and the media types (Image, File, Audio,
 * Video, Weblink…) hold other things, and a type whose file can't be read takes nothing (review
 * finding 5; the server refuses them too).
 */
export function canReceiveImport(t: Pick<TypeDef, 'basic' | 'name' | 'readOnlyReason'>): boolean {
  if (t.readOnlyReason) return false
  if (!t.basic) return true
  const name = t.name.replace(/\s+/g, '').toLowerCase()
  return name === 'page' || name === 'task'
}

/**
 * The path as typed or pasted, without surrounding spaces and the quotes Windows Explorer's
 * "Copy as path" puts around it (review O4).
 */
export function cleanSourcePath(raw: string): string {
  let p = raw.trim()
  while (p.length >= 2 && (p[0] === '"' || p[0] === "'") && p[p.length - 1] === p[0]) p = p.slice(1, -1).trim()
  return p
}

/**
 * A new way of making types: the planned types change, so every type and property override is
 * dropped (the server refuses keys it doesn't know).
 */
export function withTypeSource(m: ImportMapping, typeSource: ImportMapping['typeSource'], typeKey: string | null): ImportMapping {
  return { typeSource, typeKey: typeSource === 'key' ? typeKey : m.typeKey, types: {}, properties: {} }
}

function trimmedOrNull(s: string | null | undefined): string | null {
  const t = s?.trim()
  return t ? t : null
}

/**
 * What is sent: names trimmed (an empty name falls back to the planned one, our choice), `false`
 * and `null` left out, empty overrides dropped, and `existingTypeId` only for the open space.
 * An explicit "A new type" is sent as `existingTypeId: ""` so a same-named existing type isn't
 * picked by default.
 */
export function cleanMapping(m: ImportMapping, target: ImportTargetKind): ImportMapping {
  const types: Record<string, ImportTypeOverride> = {}
  for (const [key, o] of Object.entries(m.types)) {
    const out: ImportTypeOverride = {}
    const name = trimmedOrNull(o.name)
    const pluralName = trimmedOrNull(o.pluralName)
    if (name) out.name = name
    if (pluralName) out.pluralName = pluralName
    if (o.skip) out.skip = true
    if (target === 'currentSpace' && o.existingTypeId != null) out.existingTypeId = o.existingTypeId
    if (Object.keys(out).length > 0) types[key] = out
  }
  const properties: Record<string, Record<string, ImportPropertyOverride>> = {}
  for (const [typeKey, props] of Object.entries(m.properties)) {
    const outProps: Record<string, ImportPropertyOverride> = {}
    for (const [propKey, o] of Object.entries(props)) {
      const out: ImportPropertyOverride = {}
      const name = trimmedOrNull(o.name)
      if (o.kind) out.kind = o.kind
      if (o.isArray != null) out.isArray = o.isArray
      if (name) out.name = name
      if (o.skip) out.skip = true
      if (Object.keys(out).length > 0) outProps[propKey] = out
    }
    if (Object.keys(outProps).length > 0) properties[typeKey] = outProps
  }
  return { typeSource: m.typeSource, typeKey: m.typeSource === 'key' ? m.typeKey : null, types, properties }
}

/** A type as the user sees it: the preview's planned values under the user's overrides. */
export interface EffectiveType {
  name: string
  pluralName: string
  skip: boolean
  existingTypeId: string
}

export function effectiveType(t: ImportPlannedType, m: ImportMapping): EffectiveType {
  const o = m.types[t.key] ?? {}
  return {
    name: o.name ?? t.name,
    pluralName: o.pluralName ?? t.pluralName,
    skip: o.skip ?? t.skip,
    existingTypeId: o.existingTypeId ?? t.existingTypeId ?? NEW_TYPE,
  }
}

export function effectiveProperty(typeKey: string, p: ImportPlannedProperty, m: ImportMapping) {
  const o = m.properties[typeKey]?.[p.key] ?? {}
  return {
    name: o.name ?? p.name,
    kind: o.kind ?? p.kind,
    isArray: o.isArray ?? p.isArray,
    skip: o.skip ?? p.skip,
  }
}

/** Whether a kind takes "Multiple values". */
export function kindTakesArray(kind: string): boolean {
  return kind === 'label' || kind === 'entity'
}

/** "1.2 MB" style size (1024-based, as the media block shows file sizes). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
