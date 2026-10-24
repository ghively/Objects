// TS mirrors of the back end's JSON: the M2 API contract
// (docs/superpowers/plans/2026-10-23-m2-types-properties.md, "API contract").
// Field names match the Python side exactly.

/** Every property kind, including the system kinds (`entity_*`). */
export type PropertyType =
  | 'text'
  | 'textBlock'
  | 'simpleTableBlock'
  | 'number'
  | 'boolean'
  | 'url'
  | 'datetime'
  | 'datetimeSimple'
  | 'entity'
  | 'label'
  | 'blocks'
  | 'coverImage'
  | 'color'
  | 'entity_title'
  | 'entity_icon'
  | 'entity_description'
  | 'entity_aliases'
  | 'entity_tags'
  | 'entity_type'
  | 'entity_collections'
  | 'entity_createdAt'
  | 'entity_lastUpdated'
  | 'entity_backlinks'

/** @deprecated M1 name; use `PropertyType`. */
export type PropertyKind = PropertyType

export const PROPERTY_TYPES: readonly PropertyType[] = [
  'text',
  'textBlock',
  'simpleTableBlock',
  'number',
  'boolean',
  'url',
  'datetime',
  'datetimeSimple',
  'entity',
  'label',
  'blocks',
  'coverImage',
  'color',
  'entity_title',
  'entity_icon',
  'entity_description',
  'entity_aliases',
  'entity_tags',
  'entity_type',
  'entity_collections',
  'entity_createdAt',
  'entity_lastUpdated',
  'entity_backlinks',
]

/**
 * The kinds a property can be changed to (Capacities' "Change property type"). Changing the kind
 * creates a new property and keeps the old one (Task 6). A kind is never listed as its own target.
 */
export const KIND_TRANSFORMS: Readonly<Record<PropertyType, readonly PropertyType[]>> = {
  text: ['textBlock', 'url', 'number', 'boolean', 'label'],
  textBlock: ['text', 'url', 'number', 'boolean', 'label'],
  url: ['text', 'textBlock'],
  number: ['text', 'textBlock', 'label'],
  boolean: ['text', 'textBlock'],
  label: ['text', 'textBlock'],
  entity: ['label', 'text', 'textBlock'],
  datetime: ['datetimeSimple', 'text', 'textBlock'],
  datetimeSimple: ['datetime', 'text', 'textBlock'],
  simpleTableBlock: [],
  blocks: [],
  coverImage: [],
  color: [],
  entity_title: [],
  entity_icon: [],
  entity_description: [],
  entity_aliases: [],
  entity_tags: [],
  entity_type: [],
  entity_collections: [],
  entity_createdAt: [],
  entity_lastUpdated: [],
  entity_backlinks: [],
}

/** An icon: an emoji, or any Iconify id (`ph-…`, `vscode-icons-…`) with an optional theme colour. */
export interface Icon {
  type: 'emoji' | 'iconify'
  val: string
  color?: string | null
}

export type Visibility = 'alwaysShow' | 'hideWhenEmpty' | 'hidden'

export type NumberFormatType = 'number' | 'currency' | 'percentage' | 'progress'

export interface NumberFormat {
  type: NumberFormatType
  options: {
    currency?: string
    decimals?: { min?: number; max?: number }
    progress?: { steps: number; color: string }
    separators?: { isGroupingThousands?: boolean; isRadixComma?: boolean }
  }
}

export type Resolution = 'day' | 'time'

export interface DateConstraints {
  resolutionConstraint?: Resolution | null
  resolutionPreference?: Resolution | null
  endTimeSettings?: 'required' | 'notAllowed' | null
  endTimePreference?: boolean | null
  /** ISO timestamp. */
  startTimeDefault?: string | null
  /** ISO timestamp. */
  endTimeDefault?: string | null
  hideDeleteOption?: boolean
}

export type StatusCategory = 'not-started' | 'in-progress' | 'blocked' | 'done'

export interface LabelOption {
  id: string
  /** At most 100 characters. */
  text: string
  color: string | null
  icon: Icon | null
  statusCategory?: StatusCategory
}

/**
 * A property's kind-specific options. Each kind reads only its own fields:
 * number → `numberFormat`; datetime* → `constraints`, `hideCalendarEvents`;
 * entity → `isArray` (default true), `allowedTypes`, `hasFixedSet`, `fixedSet`, `propertySyncing`;
 * label → `isArray` (default false), `set`, `isStatus`. Unknown keys are kept.
 */
export interface PropertyOptions {
  numberFormat?: NumberFormat
  constraints?: DateConstraints
  hideCalendarEvents?: boolean
  supportsReminders?: boolean
  isArray?: boolean
  allowedTypes?: string[]
  hasFixedSet?: boolean
  fixedSet?: string[]
  propertySyncing?: { propertyIds: string[] }
  set?: LabelOption[]
  isStatus?: boolean
  [extra: string]: unknown
}

export interface PropertyDef {
  id: string
  /** The frontmatter key. Never changes; renaming changes `name` only. */
  key: string
  name: string
  type: PropertyType
  description: string
  icon: Icon | null
  visibility: Visibility
  isNotSearchable?: boolean
  options: PropertyOptions
  [extra: string]: unknown
}

export type ViewDesign = 'indexCard' | 'profile' | 'encyclopedia'
export type TypeFont = 'sans-serif' | 'serif' | 'monospace'

export interface TypeDef {
  schemaVersion: 2
  id: string
  name: string
  pluralName: string
  /** Fixed when the type is created; renaming never moves files. */
  folder: string
  formerNames: string[]
  icon: Icon
  color: string
  description: string
  /** A basic type (Page, Tag, Task, DailyNote, media types): its properties can't be edited. */
  basic: boolean
  propertyDefinitions: PropertyDef[]
  collectionsPropertyPosition: number
  viewDesign: ViewDesign | null
  font: TypeFont
  wideLayoutMode: boolean
  wideCoverImage: boolean
  cropCoverImage: boolean
  templates: { ids: string[]; defaultTemplateId: string | null }
  /** API only: set when the type file can't be read. */
  readOnlyReason: string | null
  /** API only: sha256 of the type file, `''` if unsaved. */
  revision: string
  [extra: string]: unknown
}

export interface ObjectSummary {
  path: string
  id: string | null
  type: string
  title: string
  /** `ph-…` (any Iconify id) or an emoji. */
  icon: string | null
  iconColor: string | null
  description: string | null
  aliases: string[]
  createdAt: string | null
  lastUpdated: string | null
  tags: string[]
  /** The template name when this file is a template. */
  template: string | null
  /** Tag objects: `bg-<c>`. */
  color: string | null
  coverImage: string | null
  readOnly: boolean
  /** Why the object opens read-only (absent or null when it can be saved). */
  readOnlyReason?: string | null
}

/** GET /api/space */
export interface SpaceInfo {
  name: string
  root: string
  types: TypeDef[]
}

/** GET /api/object?path= */
export interface ObjectDetail {
  summary: ObjectSummary
  frontmatter: Record<string, unknown>
  body: string
  version: string
  /** Each entity property's values resolved from this file (`null` when a link doesn't resolve). */
  links: Record<string, (string | null)[]>
}

/** PUT /api/object/body → 200 */
export interface SaveResult {
  version: string
}

/** A datetime value as the API reads and writes it. */
export interface DateValue {
  start: string
  end?: string | null
  resolution: Resolution
}

/** An entity value: read gives the resolved path; on write `path` wins and `target` is used verbatim when it's null. */
export interface EntityRef {
  target: string
  path: string | null
}

/** A file a cascading rewrite left alone (read-only, or it kept changing on disk). */
export interface SkippedFile {
  path: string
  reason: string
}

/** PUT /api/object/properties */
export interface UpdateResult {
  version: string
  frontmatter: Record<string, unknown>
  links: Record<string, (string | null)[]>
  synced: string[]
  skipped: SkippedFile[]
}

/** POST /api/object/rename and POST /api/object/change-type */
export interface RenameResult {
  path: string
  version: string
  relinked: string[]
  skipped: SkippedFile[]
}

export type ChangeTypeResult = RenameResult

/** GET /api/object/change-type → rows */
export interface MappingRow {
  fromKey: string
  toKey: string | null
  lossy: boolean
}

export interface CreatedFile {
  path: string
  version: string
}

export interface TrashItem {
  id: string
  kind: 'object' | 'type'
  originalPath: string
  title: string
  type: string
  deletedAt: string
  typeTrashId?: string | null
  objectCount?: number
}

export interface RestoreResult {
  paths: string[]
  typeIds: string[]
}

export interface SaveTypeResult {
  type: TypeDef
  rewritten: string[]
  skipped: SkippedFile[]
}

export interface ChangeKindResult extends SaveTypeResult {
  newPropertyId: string
  lossy: number
}

export interface SyncResult {
  types: TypeDef[]
  rewritten: string[]
  skipped: SkippedFile[]
}

export type ChangeKind = 'created' | 'changed' | 'deleted' | 'renamed' | 'types'

/** SSE event `change` on GET /api/events */
export interface ChangeEvent {
  kind: ChangeKind
  /** The file's path; for `renamed` the new path; for `types` the type id. */
  path: string
  version: string | null
  /** For a write made through the API: the writing window's `CLIENT_ID`. */
  origin?: string | null
  /** `renamed` only: the path before the move. */
  oldPath?: string | null
}
