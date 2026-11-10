// M28: the key of a relation's computed other side, made from the name the user gives it
// ("Used by" → `usedBy`). The server checks the shape (`^[A-Za-z][A-Za-z0-9]{0,59}$`, not a
// system key); this picks one that passes and isn't a stored key on the target types.

/**
 * Keys an other side can never take. Mirrors the server's `_COUNTERPART_RESERVED` in
 * backend/objectapp/typemodel.py (`valid_counterpart`): `SYSTEM_KEYS` from
 * backend/objectapp/typedefs.py plus backlinks, title, type, tags, aliases and id. Keep the two in step.
 */
const RESERVED = new Set([
  // typedefs.SYSTEM_KEYS
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
  // M9 per-object layout and page view
  'wideLayoutMode',
  'wideCoverImage',
  'coverImageOffset',
  'defaultPageViewId',
  // the property-pane toggle
  'hideProperties',
  // M25 import provenance
  'importSource',
  // typemodel._COUNTERPART_RESERVED's own additions
  'backlinks',
])

const MAX = 60
/** Our choice: the key when the name has no Latin letter to make one from. */
const FALLBACK = 'otherSide'

/** A camel-case key for `name` that is not in `taken` (nor a system key): `runs`, `documentedIn2`. */
export function counterpartKey(name: string, taken: Set<string>): string {
  const words = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  let base = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
    .replace(/^[0-9]+/, '')
  if (!base) base = FALLBACK
  base = base[0].toLowerCase() + base.slice(1)
  const free = (k: string) => !taken.has(k) && !RESERVED.has(k)
  if (free(base.slice(0, MAX))) return base.slice(0, MAX)
  for (let n = 2; ; n++) {
    const suffix = String(n)
    const key = base.slice(0, MAX - suffix.length) + suffix
    if (free(key)) return key
  }
}
