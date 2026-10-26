import { Fragment, useState, type ReactNode } from 'react'
import type {
  DateValue,
  EntityRef,
  Icon as IconValue,
  ObjectSummary,
  PropertyDef,
  PropertyType,
  TypeDef,
} from '@/api/types'
import { Icon, IconOrEmoji, isIconifyId } from '@/components/Icon'
import { cellForDef } from '@/properties/cellFor'
import { propertyIsEmpty } from '@/properties/format'
import { kindIcon } from '@/properties/kinds'

/** Frontmatter keys shown elsewhere (header, metadata) or kept by the app, never as extra properties. */
const CORE_KEYS = new Set([
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
])

function isEmpty(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)
  )
}

export function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(formatValue).join(', ')
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function guessKind(v: unknown): PropertyType {
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'string' && /^https?:\/\//.test(v)) return 'url'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return 'datetime'
  return 'text'
}

/** The type's properties, or (for a type without definitions) the object's extra frontmatter keys. */
export function propertyRows(type: TypeDef | undefined, frontmatter: Record<string, unknown>): PropertyDef[] {
  const defs = type?.propertyDefinitions ?? []
  if (defs.length) return defs
  return Object.keys(frontmatter)
    .filter((k) => !CORE_KEYS.has(k))
    .map(
      (k): PropertyDef => ({
        id: k,
        key: k,
        name: k,
        type: guessKind(frontmatter[k]),
        description: '',
        icon: null,
        visibility: 'alwaysShow',
        options: { isArray: Array.isArray(frontmatter[k]) },
      }),
    )
}

/** Frontmatter keys that no property of the type describes ("External properties"). */
export function externalKeys(type: TypeDef | undefined, frontmatter: Record<string, unknown>): string[] {
  const defs = type?.propertyDefinitions ?? []
  if (!defs.length) return []
  const known = new Set(defs.map((d) => d.key))
  return Object.keys(frontmatter).filter((k) => !known.has(k) && !CORE_KEYS.has(k))
}

// -- frontmatter → API value ---------------------------------------------------------------

function asList(raw: unknown): unknown[] {
  if (raw === null || raw === undefined) return []
  return Array.isArray(raw) ? raw : [raw]
}

function scalarText(raw: unknown): string | null {
  if (raw === null || raw === undefined || typeof raw === 'object') return null
  const s = String(raw)
  return s.trim() ? s : null
}

/** `[[Title]]`, `[[Title|alias]]` or a bare title → `Title`. */
export function linkTarget(raw: unknown): string | null {
  const s = scalarText(raw)
  if (!s) return null
  const m = /^\s*\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]\s*$/.exec(s)
  return (m ? m[1] : s).trim() || null
}

/** An object's icon from its `icon` and `iconColor` lines. */
export function decodeIcon(raw: unknown, color?: unknown): IconValue | null {
  if (raw && typeof raw === 'object' && 'val' in (raw as object)) return raw as IconValue
  const val = scalarText(raw)?.trim()
  if (!val) return null
  const icon: IconValue = { type: isIconifyId(val) ? 'iconify' : 'emoji', val }
  if (icon.type === 'iconify' && typeof color === 'string' && color.trim()) icon.color = color.trim()
  return icon
}

const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z$/

function decodePoint(text: string, dayPref: boolean): { iso: string; day: boolean } | null {
  const t = text.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { iso: t, day: true }
  const midnight = MIDNIGHT.exec(t)
  if (dayPref && midnight) return { iso: midnight[1], day: true }
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : { iso: d.toISOString(), day: false }
}

/** A date line (`2026-10-30`, a timestamp, or `start -> end`) as a `DateValue`. */
export function decodeDate(def: PropertyDef, raw: unknown): DateValue | null {
  if (raw && typeof raw === 'object' && 'start' in (raw as object)) return raw as DateValue
  const text = scalarText(raw)
  if (!text) return null
  const c = def.options.constraints
  const dayPref = c?.resolutionConstraint === 'day' || c?.resolutionPreference === 'day'
  const [a, b] = text.split(/\s+->\s+/)
  const start = decodePoint(a, dayPref)
  if (!start) return null
  const end = b !== undefined ? decodePoint(b, dayPref) : null
  const resolution = start.day && (!end || end.day) ? 'day' : 'time'
  const v: DateValue = { start: start.iso, resolution }
  if (end) v.end = end.iso
  return v
}

/** The value a property's cell shows, decoded from the raw frontmatter as the API's value forms. */
export function cellValue(
  def: PropertyDef,
  frontmatter: Record<string, unknown>,
  links: Record<string, (string | null)[]> = {},
  summary?: ObjectSummary,
): unknown {
  const raw = frontmatter[def.key]
  switch (def.type) {
    case 'entity_type':
      return summary?.type ?? scalarText(raw)
    case 'entity_icon':
      return decodeIcon(raw, frontmatter.iconColor)
    case 'entity_backlinks':
      return null
    case 'number': {
      if (typeof raw === 'number') return raw
      const s = scalarText(raw)
      const n = s === null ? NaN : Number(s)
      return Number.isNaN(n) ? null : n
    }
    case 'boolean':
      return raw === true || (typeof raw === 'string' && ['true', 'yes', 'on', '1'].includes(raw.trim().toLowerCase()))
    case 'datetime':
    case 'datetimeSimple':
      return decodeDate(def, raw)
    case 'label':
    case 'entity_tags':
    case 'entity_aliases':
    case 'entity_collections':
      return asList(raw)
        .map(scalarText)
        .filter((t): t is string => !!t)
        .map((t) => t.trim())
    case 'entity': {
      const paths = links[def.key] ?? []
      const refs: EntityRef[] = []
      asList(raw).forEach((item, i) => {
        const target = linkTarget(item)
        if (target) refs.push({ target, path: paths[i] ?? null })
      })
      return refs
    }
    default:
      if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
      return scalarText(raw)
  }
}

// -- panel ---------------------------------------------------------------------------------

export interface PropertyPanelProps {
  type?: TypeDef
  frontmatter: Record<string, unknown>
  /** Each entity value resolved from this file (`GET /api/object`'s `links`). */
  links?: Record<string, (string | null)[]>
  summary?: ObjectSummary
  readOnly?: boolean
  /** A cell committed `value` for the frontmatter `key`. */
  onChange?(key: string, value: unknown): void
  /** Save the type (a label option set changed); awaited before the cell's value is applied. */
  onTypeChange?(next: TypeDef): Promise<unknown> | void
  onOpenTag?(name: string): void
  onOpenObject?(path: string): void
  onChangeType?(): void
}

function Row({ label, icon, children }: { label: string; icon: IconValue | string; children: ReactNode }) {
  return (
    <div className="px-1" data-property-row={label}>
      <div className="flex items-center gap-2 text-[15px] font-medium">
        <IconOrEmoji icon={icon} size={15} fallback="ph-note-blank" />
        <span>{label}</span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  )
}

/** Left-side property list: one editable cell per property of the object's type. */
export function PropertyPanel({
  type,
  frontmatter,
  links,
  summary,
  readOnly,
  onChange,
  onTypeChange,
  onOpenTag,
  onOpenObject,
  onChangeType,
}: PropertyPanelProps) {
  const [showHidden, setShowHidden] = useState(false)
  const typed = (type?.propertyDefinitions.length ?? 0) > 0
  const rows = propertyRows(type, frontmatter).filter((d) => d.type !== 'entity_title')
  const visible: PropertyDef[] = []
  const hidden: PropertyDef[] = []
  for (const d of rows) {
    if (d.visibility === 'hidden') hidden.push(d)
    else if (d.visibility === 'hideWhenEmpty' && propertyIsEmpty(d, cellValue(d, frontmatter, links, summary))) continue
    else visible.push(d)
  }
  const external = externalKeys(type, frontmatter)

  const onDefChange = async (next: PropertyDef) => {
    if (!type || !onTypeChange) return
    await onTypeChange({
      ...type,
      propertyDefinitions: type.propertyDefinitions.map((d) => (d.id === next.id ? next : d)),
    })
  }

  const renderRow = (def: PropertyDef) => {
    const Cell = cellForDef(def)
    const value = cellValue(def, frontmatter, links, summary)
    // Without a type definition (M1 inference) the row is a plain read-only value.
    const ro = !!readOnly || !typed || !onChange
    return (
      <Row label={def.name} icon={def.icon ?? kindIcon(def.type)}>
        {Cell ? (
          <Cell
            def={def}
            value={value}
            readOnly={ro}
            onChange={(next: unknown) => onChange?.(def.key, next)}
            onDefChange={onDefChange}
            onOpenTag={onOpenTag}
            onOpenObject={onOpenObject}
            onChangeType={onChangeType}
          />
        ) : null}
      </Row>
    )
  }

  return (
    <aside
      aria-label="Properties"
      className="group/panel w-[370px] shrink-0 overflow-auto border-r border-line bg-panel px-6 pt-8 pb-6 text-fg"
    >
      {visible.map((def, i) => (
        <Fragment key={def.id}>
          {i > 0 && <hr className="my-3 border-line" />}
          {renderRow(def)}
        </Fragment>
      ))}
      {hidden.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((v) => !v)}
            className="flex items-center gap-1.5 px-1 text-[14px] text-fg-muted hover:text-fg"
          >
            <Icon name={showHidden ? 'ph-caret-down' : 'ph-caret-right'} size={12} />
            {`Hidden (${hidden.length})`}
          </button>
          {showHidden &&
            hidden.map((def) => (
              <Fragment key={def.id}>
                <hr className="my-3 border-line" />
                {renderRow(def)}
              </Fragment>
            ))}
        </div>
      )}
      {external.length > 0 && (
        <section aria-label="External properties" className="mt-6">
          <h3 className="px-1 text-[13px] font-semibold text-fg-muted">External properties</h3>
          {external.map((k) => {
            const v = frontmatter[k]
            return (
              <div key={k} className="mt-3 px-1">
                <div className="text-[15px] font-medium">{k}</div>
                <p className="mt-1 text-[15px] break-words whitespace-pre-wrap text-fg-muted">
                  {isEmpty(v) ? 'Empty' : formatValue(v)}
                </p>
              </div>
            )
          })}
        </section>
      )}
      <button
        type="button"
        disabled
        title="Adding properties arrives with property editing"
        className="mt-5 flex items-center gap-2 px-1 text-[15px] text-fg-muted opacity-15 transition-opacity group-hover/panel:opacity-100"
      >
        <Icon name="ph-plus" size={14} />
        Add Property
      </button>
    </aside>
  )
}
