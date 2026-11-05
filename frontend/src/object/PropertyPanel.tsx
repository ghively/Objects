import { Fragment, memo, useMemo, useRef, useState, type ReactNode } from 'react'
import { COMPUTED_KINDS } from '@/api/types'
import type {
  ComputedValue,
  DateValue,
  EntityRef,
  Icon as IconValue,
  ObjectSummary,
  PropertyDef,
  PropertyType,
  TypeDef,
} from '@/api/types'
import { Icon, IconOrEmoji, isIconifyId } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLinkIndex } from '@/links/linkIndex'
import { AddPropertyMenu, BASIC_TYPE_INFO } from '@/properties/AddPropertyMenu'
import { cellForDef, FRONTMATTER_KINDS } from '@/properties/cellFor'
import { propertyIsEmpty } from '@/properties/format'
import { kindIcon } from '@/properties/kinds'
import { PropertyMenu } from '@/properties/PropertyMenu'
import { DeletePropertySection, PropertySettings } from '@/properties/PropertySettings'
import { useSettings } from '@/settings/useSettings'
import { LAYOUT_KEYS, removeProperty } from '@/properties/typeEdits'
import type { TypeEditor } from './useTypeEditor'

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
  ...LAYOUT_KEYS,
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
  /** M5: the objects linking to this one (`GET /api/object`'s `backlinks`). */
  backlinks?: EntityRef[],
  /** M12: the object's formula and rollup values (`GET /api/object`'s `computed`), never in frontmatter. */
  computed?: Record<string, ComputedValue>,
): unknown {
  if (COMPUTED_KINDS.has(def.type)) return computed?.[def.key] ?? null
  const raw = frontmatter[def.key]
  switch (def.type) {
    case 'entity_type':
      return summary?.type ?? scalarText(raw)
    case 'entity_icon':
      return decodeIcon(raw, frontmatter.iconColor)
    case 'entity_backlinks':
      return backlinks ?? null
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
    case 'files':
      // `[[Attachments/a.pdf]]` items → the space-relative paths the API sends.
      return asList(raw)
        .map(linkTarget)
        .filter((t): t is string => !!t)
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
  /** M5: the objects linking to this one, shown by the backlinks property. */
  backlinks?: EntityRef[]
  /** M12: formula and rollup values by property key (`ObjectDetail.computed`). */
  computed?: Record<string, ComputedValue>
  readOnly?: boolean
  /** A cell committed `value` for the frontmatter `key`. */
  onChange?(key: string, value: unknown): void
  /** A cell committed several keys at once (one write; `remove` deletes keys). Passed to every cell. */
  onChangeMany?(updates: Record<string, unknown>, remove?: string[]): void
  /** M8: a date property's reminder (`PUT /api/tasks/reminder`). */
  onSetReminder?(key: string, remind: string | null): void
  /** Save the type (a label option set changed); awaited before the cell's value is applied. */
  onTypeChange?(next: TypeDef): Promise<unknown> | void
  onOpenTag?(name: string): void
  onOpenObject?(path: string): void
  onChangeType?(): void
  /** The type editor ObjectView saves through; property settings use it for 428s and kind changes. */
  typeEditor?: TypeEditor
  /** Where the page layout puts the panel: the left side panel (Standard), a card, a column or an infobox. */
  variant?: 'side' | 'card' | 'column' | 'infobox'
}

const PANEL_CLASS: Record<NonNullable<PropertyPanelProps['variant']>, string> = {
  side: 'w-[370px] shrink-0 overflow-auto border-r border-line bg-panel px-6 pt-8 pb-6',
  card: 'mb-8 rounded-xl border border-line bg-raised px-5 py-5',
  column: 'w-full',
  infobox: 'w-[var(--infobox-width)] shrink-0 self-start rounded-xl border border-line bg-raised px-4 py-5',
}

function Row({
  label,
  icon,
  menu,
  children,
}: {
  label: string
  icon: IconValue | string
  /** The PropertyMenu for this row; without one the label is plain text. */
  menu?: { open: boolean; onOpenChange(open: boolean): void; content: ReactNode }
  children: ReactNode
}) {
  // "Hide object type settings outside of settings": the label stays, its menu goes.
  const hideMenu = useSettings((s) => s.settings.hideStructureSettings)
  const heading = (
    <>
      <IconOrEmoji icon={icon} size={15} fallback="ph-note-blank" />
      <span>{label}</span>
    </>
  )
  return (
    <div className="px-1" data-property-row={label}>
      {menu && !hideMenu ? (
        <Popover open={menu.open} onOpenChange={menu.onOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${label} property menu`}
              className="-mx-1 flex items-center gap-2 rounded px-1 text-[15px] font-medium hover:bg-hover"
            >
              {heading}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-1.5 text-fg">
            {menu.content}
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex items-center gap-2 text-[15px] font-medium">{heading}</div>
      )}
      <div className="mt-2">{children}</div>
    </div>
  )
}

/** The handlers every property row gets from the panel (stable across renders). */
interface RowHandlers {
  onChange(key: string, value: unknown): void
  onChangeMany?(updates: Record<string, unknown>, remove?: string[]): void
  onSetReminder?(key: string, remind: string | null): void
  onDefChange(next: PropertyDef): Promise<unknown>
  onTypeChange(next: TypeDef): Promise<unknown> | void
  onOpenTag?(name: string): void
  onOpenObject?(path: string): void
  onChangeType?(): void
  setMenuFor(id: string | null): void
  setSettingsFor(id: string | null): void
  /** "Delete property": a formula or rollup goes straight away, others ask to type `delete`. */
  deleteProperty(def: PropertyDef): void
}

interface PropertyRowProps {
  def: PropertyDef
  value: unknown
  readOnly: boolean
  frontmatter?: Record<string, unknown>
  /** The type, when its definitions can be edited here (the row's PropertyMenu and settings). */
  type?: TypeDef
  menuOpen: boolean
  typeId?: string
  path?: string
  handlers: RowHandlers
}

/** Equal JSON-like values (a cell's value is rebuilt from the frontmatter on every render). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** One property's label and cell: re-renders only when its own definition, value or state changes. */
const PropertyRow = memo(
  function PropertyRow({ def, value, readOnly, frontmatter, type, menuOpen, typeId, path, handlers: h }: PropertyRowProps) {
    const Cell = cellForDef(def)
    const menu = type
      ? {
          open: menuOpen,
          onOpenChange: (o: boolean) => h.setMenuFor(o ? def.id : null),
          content: (
            <PropertyMenu
              type={type}
              def={def}
              onSave={(next) => h.onTypeChange(next)}
              onEditProperty={() => {
                h.setMenuFor(null)
                h.setSettingsFor(def.id)
              }}
              onDelete={() => {
                h.setMenuFor(null)
                h.deleteProperty(def)
              }}
            />
          ),
        }
      : undefined
    return (
      <Row label={def.name} icon={def.icon ?? kindIcon(def.type)} menu={menu}>
        {Cell ? (
          <Cell
            def={def}
            value={value}
            readOnly={readOnly}
            onChange={(next: unknown) => h.onChange(def.key, next)}
            frontmatter={frontmatter}
            onChangeMany={readOnly ? undefined : h.onChangeMany}
            onSetReminder={readOnly ? undefined : h.onSetReminder}
            onDefChange={h.onDefChange}
            onOpenTag={h.onOpenTag}
            onOpenObject={h.onOpenObject}
            onChangeType={h.onChangeType}
            typeId={typeId}
            path={path}
            onOpenSettings={type ? () => h.setSettingsFor(def.id) : undefined}
          />
        ) : null}
      </Row>
    )
  },
  (a, b) =>
    a.def === b.def &&
    sameValue(a.value, b.value) &&
    a.readOnly === b.readOnly &&
    // Only the kinds whose cell reads sibling keys re-render for another key's change.
    (!FRONTMATTER_KINDS.has(a.def.type) || sameValue(a.frontmatter, b.frontmatter)) &&
    a.type === b.type &&
    a.menuOpen === b.menuOpen &&
    a.typeId === b.typeId &&
    a.path === b.path &&
    a.handlers === b.handlers,
)

/** Left-side property list: one editable cell per property of the object's type. */
export function PropertyPanel({
  type,
  frontmatter,
  links,
  summary,
  backlinks,
  computed,
  readOnly,
  onChange,
  onChangeMany,
  onSetReminder,
  onTypeChange,
  onOpenTag,
  onOpenObject,
  onChangeType,
  typeEditor,
  variant = 'side',
}: PropertyPanelProps) {
  const [showHidden, setShowHidden] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [deleteFor, setDeleteFor] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const allTypes = useLinkIndex((s) => s.types)
  // Property definitions are edited through the type, whatever the object's own read-only state.
  const canEditType = !!type && !!onTypeChange && !type.readOnlyReason
  const deleting = deleteFor ? type?.propertyDefinitions.find((d) => d.id === deleteFor) : undefined
  const typed = (type?.propertyDefinitions.length ?? 0) > 0
  const rows = propertyRows(type, frontmatter).filter((d) => d.type !== 'entity_title')
  const visible: PropertyDef[] = []
  const hidden: PropertyDef[] = []
  for (const d of rows) {
    if (d.visibility === 'hidden') hidden.push(d)
    else if (d.visibility === 'hideWhenEmpty' && propertyIsEmpty(d, cellValue(d, frontmatter, links, summary, backlinks, computed))) continue
    else visible.push(d)
  }
  const external = externalKeys(type, frontmatter)

  // The handlers rows get are stable (they read the newest props through `latest`), so a value
  // change re-renders only its own row, whatever handlers the parent passes per render.
  const latest = useRef({ type, onChange, onChangeMany, onSetReminder, onTypeChange, onOpenTag, onOpenObject, onChangeType, typeEditor })
  latest.current = { type, onChange, onChangeMany, onSetReminder, onTypeChange, onOpenTag, onOpenObject, onChangeType, typeEditor }
  const has = { onChangeMany: !!onChangeMany, onSetReminder: !!onSetReminder, onOpenTag: !!onOpenTag, onOpenObject: !!onOpenObject, onChangeType: !!onChangeType }
  const handlers = useMemo<RowHandlers>(
    () => ({
      onChange: (key, next) => latest.current.onChange?.(key, next),
      onChangeMany: has.onChangeMany ? (u, r) => latest.current.onChangeMany?.(u, r) : undefined,
      onSetReminder: has.onSetReminder ? (key, remind) => latest.current.onSetReminder?.(key, remind) : undefined,
      // Resolves the save's result (null when it failed), so a new label is applied only once saved.
      onDefChange: async (next) => {
        const { type: t, onTypeChange: save } = latest.current
        if (!t || !save) return null
        return save({ ...t, propertyDefinitions: t.propertyDefinitions.map((d) => (d.id === next.id ? next : d)) })
      },
      onTypeChange: (next) => latest.current.onTypeChange?.(next),
      onOpenTag: has.onOpenTag ? (name) => latest.current.onOpenTag?.(name) : undefined,
      onOpenObject: has.onOpenObject ? (path) => latest.current.onOpenObject?.(path) : undefined,
      onChangeType: has.onChangeType ? () => latest.current.onChangeType?.() : undefined,
      setMenuFor,
      setSettingsFor,
      deleteProperty: (def) => {
        const { type: t, typeEditor: ed, onTypeChange: save } = latest.current
        // A formula or rollup holds no values in the files (the server deletes it without a
        // confirmation): no typed confirmation either.
        if (!t || !COMPUTED_KINDS.has(def.type)) return setDeleteFor(def.id)
        const next = removeProperty(t, def.id)
        if (ed) void ed.save(next, { confirm: true })
        else void save?.(next)
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only whether each handler is given matters
    [has.onChangeMany, has.onSetReminder, has.onOpenTag, has.onOpenObject, has.onChangeType],
  )

  // Without a type definition (M1 inference) the row is a plain read-only value.
  const ro = !!readOnly || !typed || !onChange
  const editDefs = canEditType && typed && !!type
  const renderRow = (def: PropertyDef) => (
    <PropertyRow
      def={def}
      value={cellValue(def, frontmatter, links, summary, backlinks, computed)}
      readOnly={ro}
      frontmatter={frontmatter}
      type={editDefs ? type : undefined}
      menuOpen={menuFor === def.id}
      typeId={type?.id ?? summary?.type}
      path={summary?.path}
      handlers={handlers}
    />
  )

  return (
    <aside
      aria-label="Properties"
      data-panel-variant={variant}
      className={`group/panel text-fg ${PANEL_CLASS[variant]}`}
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
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-structure-setting=""
            disabled={!canEditType || !!type?.basic}
            title={type?.basic ? BASIC_TYPE_INFO : undefined}
            className="mt-5 flex items-center gap-2 px-1 text-[15px] text-fg-muted opacity-15 transition-opacity group-hover/panel:opacity-100 hover:text-fg disabled:hover:text-fg-muted"
          >
            <Icon name="ph-plus" size={14} />
            Add Property
          </button>
        </PopoverTrigger>
        {type && (
          <PopoverContent align="start" className="w-auto border-line bg-raised p-1.5 text-fg">
            <AddPropertyMenu
              type={type}
              types={allTypes}
              onSave={(next) => onTypeChange?.(next)}
              onClose={() => setAddOpen(false)}
            />
          </PopoverContent>
        )}
      </Popover>
      {type && settingsFor && (
        <PropertySettings
          typeId={type.id}
          propertyId={settingsFor}
          open
          onOpenChange={(o) => !o && setSettingsFor(null)}
          onOpenProperty={setSettingsFor}
          editor={typeEditor}
          objectPath={summary?.path}
        />
      )}
      {type && deleting && (
        <Dialog open onOpenChange={(o) => !o && setDeleteFor(null)}>
          <DialogContent className="border-line bg-raised-2 text-fg">
            <DialogHeader>
              <DialogTitle className="text-[17px]">{`Delete "${deleting.name}"?`}</DialogTitle>
              <DialogDescription className="text-[13px] text-fg-muted">
                The property and its values are removed from every object of this type.
              </DialogDescription>
            </DialogHeader>
            <DeletePropertySection
              def={deleting}
              onDelete={() => {
                setDeleteFor(null)
                const next = removeProperty(type, deleting.id)
                // The user typed the confirmation word, so no second (428) confirmation.
                if (typeEditor) void typeEditor.save(next, { confirm: true })
                else void onTypeChange?.(next)
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </aside>
  )
}
