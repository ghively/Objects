import { describe, expect, it } from 'vitest'
import { PROPERTY_TYPES, type PropertyType } from '@/api/types'
import { propertyDef } from '@/test/mockApi'
import { cellFor, cellForDef } from './cellFor'
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
import { BacklinksCell, CollectionsCell, SystemFieldCell } from './cells/SystemFieldCell'
import { TagsCell } from './cells/TagsCell'
import { AliasesCell } from './cells/AliasesCell'
import { TextCell } from './cells/TextCell'
import { TypeChipCell } from './cells/TypeChipCell'
import { UrlCell } from './cells/UrlCell'
import { EmailCell } from './cells/EmailCell'
import { FilesCell } from './cells/FilesCell'
import { FormulaCell } from './cells/FormulaCell'
import { IdCell } from './cells/IdCell'
import { PhoneCell } from './cells/PhoneCell'
import { RollupCell } from './cells/RollupCell'

describe('cellFor', () => {
  it('test cellFor covers every PropertyType', () => {
    for (const t of PROPERTY_TYPES) {
      if (t === 'entity_title') expect(cellFor(t)).toBeNull()
      else expect(cellFor(t), t).toBeTypeOf('function')
    }
    const expected: Partial<Record<PropertyType, unknown>> = {
      text: TextCell,
      url: UrlCell,
      number: NumberCell,
      boolean: CheckboxCell,
      datetime: DateCell,
      datetimeSimple: DateCell,
      label: LabelCell,
      entity: RelationCell,
      entity_tags: TagsCell,
      entity_aliases: AliasesCell,
      entity_icon: IconCell,
      entity_description: DescriptionCell,
      coverImage: CoverImageCell,
      color: ColorCell,
      entity_createdAt: ReadOnlyDateCell,
      entity_lastUpdated: ReadOnlyDateCell,
      entity_type: TypeChipCell,
      entity_collections: CollectionsCell,
      entity_backlinks: BacklinksCell,
      formula: FormulaCell,
      rollup: RollupCell,
      uniqueId: IdCell,
      email: EmailCell,
      phone: PhoneCell,
      files: FilesCell,
    }
    for (const [t, cell] of Object.entries(expected)) expect(cellFor(t as PropertyType), t).toBe(cell)
  })

  it('basic media fields are read-only system field cells', () => {
    expect(cellForDef(propertyDef({ id: 'mimeType', key: 'mimeType', type: 'text' }))).toBe(SystemFieldCell)
    expect(cellForDef(propertyDef({ id: 'fileSize', key: 'fileSize', type: 'number' }))).toBe(SystemFieldCell)
    // A user property that happens to use the same kind keeps its editable cell.
    expect(cellForDef(propertyDef({ id: 'p1', key: 'source', type: 'text' }))).toBe(TextCell)
    expect(cellForDef(propertyDef({ id: 'p2', key: 'notes', type: 'text' }))).toBe(TextCell)
  })
})
