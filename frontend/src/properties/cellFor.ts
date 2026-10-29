// One cell component per property kind. The property panel renders `cellForDef(def)` with the
// value from the object's frontmatter and the extras below.
import type { ComponentType } from 'react'
import type { PropertyDef, PropertyType } from '@/api/types'
import { AliasesCell } from './cells/AliasesCell'
import { BlocksCell } from './cells/BlocksCell'
import { CheckboxCell } from './cells/CheckboxCell'
import { ColorCell } from './cells/ColorCell'
import { CoverImageCell } from './cells/CoverImageCell'
import { DateCell } from './cells/DateCell'
import { DescriptionCell } from './cells/DescriptionCell'
import { IconCell } from './cells/IconCell'
import { LabelCell } from './cells/LabelCell'
import { NumberCell } from './cells/NumberCell'
import { ReadOnlyDateCell } from './cells/ReadOnlyDateCell'
import { RelationCell } from './cells/RelationCell'
import { SimpleTableCell } from './cells/SimpleTableCell'
import { BacklinksCell, CollectionsCell, SystemFieldCell } from './cells/SystemFieldCell'
import { TagsCell } from './cells/TagsCell'
import { TextBlockCell } from './cells/TextBlockCell'
import { TextCell } from './cells/TextCell'
import { TypeChipCell } from './cells/TypeChipCell'
import type { CellProps } from './cells/types'
import { UrlCell } from './cells/UrlCell'

/** What some cells take besides `CellProps`; every cell ignores the extras it doesn't use. */
export interface CellExtras {
  /** LabelCell: saves an edited option set (the type) before the value is applied. */
  onDefChange?(next: PropertyDef): void | Promise<void>
  /** TagsCell: opens a tag's page. */
  onOpenTag?(name: string): void
  /** RelationCell: opens a linked object. */
  onOpenObject?(path: string): void
  /** TypeChipCell: opens "Change type". */
  onChangeType?(): void
  /** LabelCell and RelationCell: open the property's settings from their menu. */
  onOpenSettings?(): void
  /** CollectionsCell: the object's type id (the picker lists collections that hold it). */
  typeId?: string
  /** The object's raw frontmatter, for a cell that reads a sibling key (the Task date reads `repeat`, `remind`). */
  frontmatter?: Record<string, unknown>
  /**
   * Write several keys in one `updateProperties` call (`remove` deletes keys). Only the property
   * panel provides it; table cells don't, so they write their own key only.
   */
  onChangeMany?(updates: Record<string, unknown>, remove?: string[]): void
  /**
   * M8: set (or clear with `null`) the reminder of date property `key` through
   * `PUT /api/tasks/reminder`. Only the property panel provides it, like `onChangeMany`.
   */
  onSetReminder?(key: string, remind: string | null): void
  /** BlocksCell and TextBlockCell: the owning object's path (the editor's token menu and block references). */
  path?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each cell takes its own value type
export type CellComponent = ComponentType<CellProps<any> & CellExtras>

const CELLS: Readonly<Record<PropertyType, CellComponent | null>> = {
  text: TextCell,
  textBlock: TextBlockCell,
  url: UrlCell,
  number: NumberCell,
  boolean: CheckboxCell,
  datetime: DateCell,
  datetimeSimple: DateCell,
  blocks: BlocksCell,
  simpleTableBlock: SimpleTableCell,
  label: LabelCell as CellComponent,
  entity: RelationCell as CellComponent,
  entity_tags: TagsCell as CellComponent,
  entity_aliases: AliasesCell,
  entity_icon: IconCell,
  entity_description: DescriptionCell,
  coverImage: CoverImageCell,
  color: ColorCell,
  entity_createdAt: ReadOnlyDateCell,
  entity_lastUpdated: ReadOnlyDateCell,
  entity_type: TypeChipCell as CellComponent,
  entity_collections: CollectionsCell,
  entity_backlinks: BacklinksCell,
  // The header edits the title.
  entity_title: null,
}

/** The cell for a property kind; `null` for `entity_title`, which the header edits. */
export function cellFor(type: PropertyType): CellComponent | null {
  return CELLS[type] ?? null
}

/** Capacities' basic media fields: system definitions (id equals key) shown read-only. */
export const MEDIA_FIELD_KEYS: ReadonlySet<string> = new Set([
  'url',
  'domain',
  'iframeUrl',
  'previewImage',
  'mimeType',
  'fileSize',
  'width',
  'height',
  'source',
])

/** The cell for a definition: as `cellFor`, except basic media fields are read-only text. */
export function cellForDef(def: PropertyDef): CellComponent | null {
  if (def.id === def.key && MEDIA_FIELD_KEYS.has(def.key) && !def.type.startsWith('entity_')) return SystemFieldCell
  return cellFor(def.type)
}
