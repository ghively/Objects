// M32, item 11: "has properties of its own" is read from the type's definition, not its id.
import { describe, expect, test } from 'vitest'
import type { PropertyDef, PropertyType } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'
import { isSystemProperty, typeHasOwnProperties } from './ownProperties'

const def = (key: string, type: PropertyType): PropertyDef => propertyDef({ id: key, key, name: key, type })

/** The system rows every type is saved with. */
const SYSTEM = [
  def('title', 'entity_title'),
  def('collections', 'entity_collections'),
  def('description', 'entity_description'),
  def('createdAt', 'entity_createdAt'),
  def('lastUpdated', 'entity_lastUpdated'),
  def('tags', 'entity_tags'),
  def('icon', 'entity_icon'),
  def('aliases', 'entity_aliases'),
]

describe('typeHasOwnProperties', () => {
  test('the built-in Note: only system rows, so none of its own', () => {
    expect(typeHasOwnProperties(typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', basic: true, propertyDefinitions: SYSTEM }))).toBe(false)
  })

  test('the optional system rows (Type, Backlinks, Cover image, Color) are system rows too', () => {
    const extra = [def('type', 'entity_type'), def('backlinks', 'entity_backlinks'), def('coverImage', 'coverImage'), def('color', 'color')]
    for (const d of extra) expect(isSystemProperty(d)).toBe(true)
    expect(typeHasOwnProperties(typeDef({ id: 'tag', name: 'Tag', pluralName: 'Tags', propertyDefinitions: [...SYSTEM, ...extra] }))).toBe(false)
    // A colour property the user added under another key is theirs.
    expect(isSystemProperty(def('accent', 'color'))).toBe(false)
  })

  test("a Daily note's Date and Reviewed show in its header: none of its own", () => {
    const daily = typeDef({
      id: 'dailynote',
      name: 'DailyNote',
      pluralName: 'DailyNotes',
      basic: true,
      propertyDefinitions: [...SYSTEM, def('date', 'datetime'), def('reviewed', 'boolean')],
    })
    expect(typeHasOwnProperties(daily)).toBe(false)
    // A property the user adds to it is one of its own.
    expect(typeHasOwnProperties({ ...daily, propertyDefinitions: [...daily.propertyDefinitions, def('mood', 'label')] })).toBe(true)
  })

  test('any other property makes it a type with properties, whatever its id or name', () => {
    expect(typeHasOwnProperties(typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', propertyDefinitions: [...SYSTEM, def('status', 'text')] }))).toBe(true)
    expect(typeHasOwnProperties(typeDef({ id: 'meeting', name: 'Meeting', pluralName: 'Meetings', propertyDefinitions: [...SYSTEM, def('date', 'datetime')] }))).toBe(true)
    // A renamed type with nothing of its own is still a plain note type.
    expect(typeHasOwnProperties(typeDef({ id: 'page', name: 'Jotting', pluralName: 'Jottings', propertyDefinitions: SYSTEM }))).toBe(false)
  })

  test('a computed other side is a row of its own; an unknown type has none', () => {
    const page = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', propertyDefinitions: SYSTEM })
    expect(typeHasOwnProperties({ ...page, counterparts: [def('documentedIn', 'entity')] })).toBe(true)
    expect(typeHasOwnProperties(undefined)).toBe(false)
  })
})
