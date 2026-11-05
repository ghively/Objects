// What each property kind is called, how it's described and which icon it shows, and the items of
// the "Add Property" menu. Names and descriptions are the kinds' labels;
// icons are the default property icons.
import type { PropertyType, TypeDef } from '@/api/types'

export interface KindMeta {
  name: string
  description: string
  /** An Iconify id. */
  icon: string
}

export const KIND_META: Readonly<Record<PropertyType, KindMeta>> = {
  text: { name: 'Text', description: 'Simple plain text', icon: 'ph-text-align-left' },
  textBlock: {
    name: 'Text',
    description: 'A single paragraph that allows formatting and linking.',
    icon: 'ph-text-align-left',
  },
  simpleTableBlock: { name: 'Table', description: '', icon: 'ph-table' },
  number: { name: 'Number', description: 'A number with various formatting options', icon: 'ph-hash' },
  boolean: { name: 'Checkbox', description: 'True or false value', icon: 'ph-check-square' },
  url: { name: 'URL', description: 'A plain web url', icon: 'ph-link' },
  // Both read "Date time"; only `datetime` is ever created.
  datetime: { name: 'Date time', description: 'Time and date together', icon: 'ph-calendar' },
  datetimeSimple: { name: 'Date time', description: '', icon: 'ph-calendar-blank' },
  entity: { name: 'Object', description: 'Link to other objects', icon: 'ph-file-text' },
  label: {
    name: 'Label',
    description: 'A simple label to categorize an object. Can be single or multi-select.',
    icon: 'ph-caret-circle-down',
  },
  blocks: {
    name: 'Content',
    description: 'The main notes area of an object — rich text with formatting and linking.',
    icon: 'ph-list-dashes',
  },
  coverImage: { name: 'Cover Image', description: 'A single select image property.', icon: 'ph-image' },
  color: { name: 'Color', description: '', icon: 'ph-palette' },
  // M12: our kinds, names and descriptions (our strings)
  formula: { name: 'Formula', description: 'A value calculated from other properties.', icon: 'ph-function' },
  rollup: {
    name: 'Rollup',
    description: 'Shows or calculates a property of related objects.',
    icon: 'ph-stack',
  },
  uniqueId: { name: 'ID', description: 'A number given to each new object, with an optional prefix.', icon: 'ph-hash-straight' },
  email: { name: 'Email', description: 'An email address.', icon: 'ph-at' },
  phone: { name: 'Phone', description: 'A phone number.', icon: 'ph-phone' },
  files: { name: 'Files', description: 'Attached files.', icon: 'ph-paperclip' },
  entity_title: {
    name: 'Title',
    description: 'The title serves as the main identifier for any entry',
    icon: 'ph-text-t',
  },
  entity_icon: { name: 'Icon', description: 'A quick visual identifier', icon: 'ph-smiley' },
  entity_description: {
    name: 'Description',
    description: 'Additional information to further describe an item',
    icon: 'ph-info',
  },
  entity_aliases: { name: 'Aliases', description: 'Additional names for this content', icon: 'ph-cards' },
  entity_tags: { name: 'Tags', description: 'General tags of this content', icon: 'ph-tag' },
  entity_type: { name: 'Object type', description: 'The type of this content', icon: 'ph-notebook' },
  entity_collections: {
    name: 'Collections',
    description: 'Collections this content is included in',
    icon: 'ph-cards-three',
  },
  entity_createdAt: { name: 'Created at', description: 'Date and time of creation', icon: 'ph-calendar-blank' },
  entity_lastUpdated: {
    name: 'Last updated',
    description: 'Date and time of last edit',
    icon: 'ph-clock-clockwise',
  },
  entity_backlinks: { name: 'Context', description: 'Objects linking to this one', icon: 'ph-line-segment' },
}

/** The icon of a kind, with a fallback for kinds the API may add later. */
export function kindIcon(type: string): string {
  return KIND_META[type as PropertyType]?.icon ?? 'ph-note-blank'
}

/**
 * What picking an Add Property item does:
 * - `property`: adds a property of `type` (system kinds add the system property);
 * - `objectSelect`: opens "Search Object Types" (`objectSelectTypes`); picking a type adds a
 *   multi-select `entity` property bound to it;
 * - `coverImage`: adds the `coverImage` system property.
 */
export type AddPropertyAction = 'property' | 'objectSelect' | 'coverImage'

export interface AddPropertyItem {
  /** The menu key, which fixes the order. */
  key: string
  action: AddPropertyAction
  type: PropertyType
  name: string
  description: string
  icon: string
}

// The Add Property menu order list. `structure_RootTag_single` and `property_tag` are in it,
// but no item is built for them.
const MENU_ORDER = [
  'property_textBlock',
  'property_blocks',
  'property_entity_tags',
  'property_label',
  'structure_RootTag_single',
  'structure_RootTag_multi',
  'property_boolean',
  'property_tag',
  'property_datetime',
  'property_number',
  'property_entity_title',
  'property_entity_description',
  'structure_MediaImage_single',
  'property_entity_icon',
  'property_entity_createdAt',
  'property_entity_lastUpdated',
  'property_entity_aliases',
  // M12: our kinds, after the catalogued items
  'property_formula',
  'property_rollup',
  'property_uniqueId',
  'property_email',
  'property_phone',
  'property_files',
] as const

// The property kinds that become menu items; `text`, `url`, `simpleTableBlock` and
// `datetimeSimple` can't be added (they come from migration, inference and kind changes).
const ADDABLE_KINDS: readonly PropertyType[] = [
  'textBlock',
  'blocks',
  'entity_tags',
  'label',
  'boolean',
  'datetime',
  'number',
  'entity_title',
  'entity_description',
  'entity_icon',
  'entity_createdAt',
  'entity_lastUpdated',
  'entity_aliases',
  'formula',
  'rollup',
  'uniqueId',
  'email',
  'phone',
  'files',
]

function buildItems(): AddPropertyItem[] {
  const items: AddPropertyItem[] = [
    {
      key: 'structure_RootTag_multi',
      action: 'objectSelect',
      type: 'entity',
      name: 'Object Select',
      description: 'Link to objects of a specific type.',
      icon: 'ph-link',
    },
    {
      key: 'structure_MediaImage_single',
      action: 'coverImage',
      type: 'coverImage',
      name: 'Cover Image',
      description: 'A single select image property.',
      icon: 'ph-image',
    },
    ...ADDABLE_KINDS.map(
      (type): AddPropertyItem => ({ key: `property_${type}`, action: 'property', type, ...KIND_META[type] }),
    ),
  ]
  const rank = (i: AddPropertyItem) => (MENU_ORDER as readonly string[]).indexOf(i.key)
  return items.filter((i) => rank(i) >= 0).sort((a, b) => rank(a) - rank(b))
}

/** The Add Property menu's items, in order: the 15 catalogued ones, then M12's six. */
export const ADD_PROPERTY_ITEMS: readonly AddPropertyItem[] = buildItems()

// Basic types that can't be relation targets.
const NOT_RELATION_TARGETS = new Set(['task', 'dailynote'])

/**
 * The types "Object Select" lists ("Search Object Types"): Page, Tag, the media types the space
 * has, and custom types; never Task or DailyNote.
 */
export function objectSelectTypes(types: readonly TypeDef[]): TypeDef[] {
  return types.filter((t) => !NOT_RELATION_TARGETS.has(t.name.replace(/\s+/g, '').toLowerCase()))
}
