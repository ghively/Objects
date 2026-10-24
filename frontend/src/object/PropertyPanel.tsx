import { Fragment } from 'react'
import type { PropertyDef, PropertyType, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'

/** Frontmatter keys shown elsewhere (header, metadata), not as properties. */
const CORE_KEYS = new Set(['id', 'type', 'title', 'icon', 'createdAt', 'lastUpdated', 'tags'])

// Temporary: Task 12's kind metadata replaces this map.
const KIND_ICON: Record<PropertyType, string> = {
  text: 'ph-text-t',
  textBlock: 'ph-text-align-left',
  simpleTableBlock: 'ph-table',
  number: 'ph-hash',
  boolean: 'ph-check-square',
  url: 'ph-link',
  datetime: 'ph-calendar-blank',
  datetimeSimple: 'ph-calendar-blank',
  label: 'ph-list',
  entity: 'ph-at',
  blocks: 'ph-text-align-left',
  coverImage: 'ph-image',
  color: 'ph-palette',
  entity_title: 'ph-text-t',
  entity_icon: 'ph-smiley',
  entity_description: 'ph-text-align-left',
  entity_aliases: 'ph-at',
  entity_tags: 'ph-hash',
  entity_type: 'ph-cube',
  entity_collections: 'ph-stack',
  entity_createdAt: 'ph-calendar-plus',
  entity_lastUpdated: 'ph-clock-clockwise',
  entity_backlinks: 'ph-arrow-bend-up-left',
}

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

export interface PropertyPanelProps {
  type?: TypeDef
  frontmatter: Record<string, unknown>
}

/** Left-side property list. Read-only in M1. */
export function PropertyPanel({ type, frontmatter }: PropertyPanelProps) {
  const rows = propertyRows(type, frontmatter)
  return (
    <aside
      aria-label="Properties"
      className="group/panel w-[370px] shrink-0 overflow-auto border-r border-line bg-panel px-6 pt-8 pb-6 text-fg"
    >
      {rows.map((p, i) => {
        const v = frontmatter[p.key]
        return (
          <Fragment key={p.id}>
            {i > 0 && <hr className="my-3 border-line" />}
            <div className="px-1">
              <div className="flex items-center gap-2 text-[15px] font-medium">
                <Icon name={KIND_ICON[p.type] ?? 'ph-text-t'} size={15} />
                <span>{p.name}</span>
              </div>
              {isEmpty(v) ? (
                <p className="mt-3 text-[15px] text-fg-muted">Empty</p>
              ) : (
                <p className="mt-3 text-[15px] break-words whitespace-pre-wrap">{formatValue(v)}</p>
              )}
            </div>
          </Fragment>
        )
      })}
      <button
        type="button"
        disabled
        title="Editing properties arrives in M2"
        className="mt-5 flex items-center gap-2 px-1 text-[15px] text-fg-muted opacity-15 transition-opacity group-hover/panel:opacity-100"
      >
        <Icon name="ph-plus" size={14} />
        Add Property
      </button>
    </aside>
  )
}
