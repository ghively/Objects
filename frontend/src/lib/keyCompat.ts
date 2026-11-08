/**
 * Older key names in view JSON the frontend reads itself, read as today's.
 *
 * The backend renames older keys in every definition file and request body
 * (`backend/objectapp/keycompat.py`). The one view JSON that reaches the frontend
 * without passing through it is a data view embed's `localDataViewInfo` block
 * option, which sits in the note's `.md`: `parseLocalView` passes it through
 * `upgradeKeys`. Nothing is written back; the option gets today's names the next
 * time the embed's view changes.
 *
 * This module (and its test) is the only place the older names appear. As on the
 * backend, a key is renamed only when its value has the field's shape and today's
 * key isn't there too.
 */

type Shape = 'string' | 'list' | 'bool' | 'object'

const OLD_KEYS: Record<string, [string, Shape]> = {
  structureId: ['typeId', 'string'],
  structureIds: ['typeIds', 'list'],
  structures: ['types', 'list'],
  excludeStructureIds: ['excludeTypeIds', 'list'],
  filterStructureIds: ['filterTypeIds', 'list'],
  hideStructureSettings: ['hideTypeSettings', 'bool'],
  structureViews: ['typeViews', 'object'],
}

function hasShape(v: unknown, shape: Shape): boolean {
  switch (shape) {
    case 'string':
      return typeof v === 'string' || v === null
    case 'list':
      return Array.isArray(v)
    case 'bool':
      return typeof v === 'boolean'
    case 'object':
      return !!v && typeof v === 'object' && !Array.isArray(v)
  }
}

function renameIn(o: Record<string, unknown>): Record<string, unknown> {
  if (!Object.keys(o).some((k) => Object.hasOwn(OLD_KEYS, k))) return o
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    const spec = Object.hasOwn(OLD_KEYS, k) ? OLD_KEYS[k] : undefined
    if (spec && hasShape(v, spec[1])) {
      if (!Object.hasOwn(o, spec[0])) out[spec[0]] = v
    } else {
      out[k] = v
    }
  }
  return out
}

/** `value` with older keys renamed to today's at every depth (a new value; `value` is untouched). */
export function upgradeKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => upgradeKeys(v)) as T
  if (value && typeof value === 'object') {
    const o = renameIn(value as Record<string, unknown>)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) out[k] = upgradeKeys(v)
    return out as T
  }
  return value
}
