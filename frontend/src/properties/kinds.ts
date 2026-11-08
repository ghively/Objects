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
  text: { name: 'Text', description: 'Unformatted text', icon: 'ph-text-align-left' },
  textBlock: {
    name: 'Text',
    description: 'One paragraph, with formatting and links.',
    icon: 'ph-text-align-left',
  },
  simpleTableBlock: { name: 'Table', description: '', icon: 'ph-table' },
  number: { name: 'Number', description: 'A number you can format in several ways', icon: 'ph-hash' },
  boolean: { name: 'Checkbox', description: 'A yes-or-no tick box', icon: 'ph-check-square' },
  url: { name: 'URL', description: 'A web address', icon: 'ph-link' },
  // Both read "Date time"; only `datetime` is ever created.
  datetime: { name: 'Date time', description: 'A date, with an optional time', icon: 'ph-calendar' },
  datetimeSimple: { name: 'Date time', description: '', icon: 'ph-calendar-blank' },
  entity: { name: 'Object', description: 'Points to one or more objects', icon: 'ph-file-text' },
  label: {
    name: 'Label',
    description: 'Pick one or more options from a list you define.',
    icon: 'ph-caret-circle-down',
  },
  blocks: {
    name: 'Content',
    description: 'The body of an object, where you write notes with formatting and links.',
    icon: 'ph-list-dashes',
  },
  coverImage: { name: 'Cover Image', description: 'One picture shown at the top of the object.', icon: 'ph-image' },
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
    description: 'The name of the object, shown wherever it appears',
    icon: 'ph-text-t',
  },
  entity_icon: { name: 'Icon', description: 'An emoji or icon shown beside the title', icon: 'ph-smiley' },
  entity_description: {
    name: 'Description',
    description: 'A short summary of what the object is about',
    icon: 'ph-info',
  },
  entity_aliases: { name: 'Aliases', description: 'Other names the object goes by', icon: 'ph-cards' },
  entity_tags: { name: 'Tags', description: 'Tags attached to the object', icon: 'ph-tag' },
  entity_type: { name: 'Object type', description: 'What kind of object this is', icon: 'ph-notebook' },
  entity_collections: {
    name: 'Collections',
    description: 'The collections this object belongs to',
    icon: 'ph-cards-three',
  },
  entity_createdAt: { name: 'Created at', description: 'When the object was made', icon: 'ph-calendar-blank' },
  entity_lastUpdated: {
    name: 'Last updated',
    description: 'When the object last changed',
    icon: 'ph-clock-clockwise',
  },
  entity_backlinks: { name: 'Context', description: 'Where other objects mention this one', icon: 'ph-line-segment' },
  // M14 (our strings): a button that runs an automation on its object.
  button: { name: 'Button', description: 'Run an automation on this object with one click', icon: 'ph-cursor-click' },
  // M22 (our strings): Steps and Floor items come only from "Add work fields"; List is addable.
  steps: {
    name: 'Steps',
    description: 'An ordered list of questions, things to do, approvals and agent work.',
    icon: 'ph-list-checks',
  },
  textList: { name: 'List', description: 'A list of short texts.', icon: 'ph-list-bullets' },
  floorItems: { name: 'Floor items', description: 'Things to look at or collect on the floor.', icon: 'ph-clipboard-text' },
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

// The Add Property menu order list. `type_tag_single` and `property_tag` are in it,
// but no item is built for them.
const MENU_ORDER = [
  'property_textBlock',
  'property_blocks',
  'property_entity_tags',
  'property_label',
  'type_tag_single',
  'type_tag_multi',
  'property_boolean',
  'property_tag',
  'property_datetime',
  'property_number',
  'property_entity_title',
  'property_entity_description',
  'type_image_single',
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
  // M14: after the catalogued items (our choice).
  'property_button',
  // M22: List, after Button (our choice). Steps and Floor items are not in the menu.
  'property_textList',
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
  'button',
  'textList',
]

function buildItems(): AddPropertyItem[] {
  const items: AddPropertyItem[] = [
    {
      key: 'type_tag_multi',
      action: 'objectSelect',
      type: 'entity',
      name: 'Object Select',
      description: 'Points to objects of one chosen type.',
      icon: 'ph-link',
    },
    {
      key: 'type_image_single',
      action: 'coverImage',
      type: 'coverImage',
      name: 'Cover Image',
      description: 'One picture shown at the top of the object.',
      icon: 'ph-image',
    },
    ...ADDABLE_KINDS.map(
      (type): AddPropertyItem => ({ key: `property_${type}`, action: 'property', type, ...KIND_META[type] }),
    ),
  ]
  const rank = (i: AddPropertyItem) => (MENU_ORDER as readonly string[]).indexOf(i.key)
  return items.filter((i) => rank(i) >= 0).sort((a, b) => rank(a) - rank(b))
}

/** The Add Property menu's items, in order: the 15 catalogued ones, then M12's six, then M14's Button, then M22's List. */
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
