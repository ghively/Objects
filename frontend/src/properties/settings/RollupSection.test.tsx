import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PropertyDef, PropertyOptions, TypeDef } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { PropertySettings } from '../PropertySettings'
import { ROLLUP_CALC_LABELS, rollupCalcsFor } from './rollup'
import { ROLLUP_TEXT } from './texts'

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
// Task: the related type.
const ESTIMATE = propertyDef({ id: 'p-est', key: 'estimate', name: 'Estimate', type: 'number' })
const DUE = propertyDef({ id: 'p-due', key: 'due', name: 'Due', type: 'datetime' })
const NOTE = propertyDef({ id: 'p-note', key: 'note', name: 'Note', type: 'text' })
const BODY = propertyDef({ id: 'p-body', key: 'body', name: 'Body', type: 'blocks' })
const SUBTOTAL = propertyDef({ id: 'p-sub', key: 'sub', name: 'Subtotal', type: 'rollup', options: {} })
const SCORE = propertyDef({ id: 'p-score', key: 'score', name: 'Score', type: 'formula', options: { expression: '1' } })
const TASK = typeDef({
  id: 'task',
  name: 'Task',
  revision: 'rt',
  propertyDefinitions: [TITLE, ESTIMATE, DUE, NOTE, BODY, SUBTOTAL, SCORE],
})
// Person: another type, only reached when the relation allows any type.
const AGE = propertyDef({ id: 'p-age', key: 'age', name: 'Age', type: 'number' })
const PERSON = typeDef({ id: 'person', name: 'Person', revision: 'rp', propertyDefinitions: [TITLE, AGE] })

const TASKS = propertyDef({
  id: 'p-tasks',
  key: 'tasks',
  name: 'Tasks',
  type: 'entity',
  options: { isArray: true, allowedTypes: ['task'], hasFixedSet: false, fixedSet: [] },
})
const ANY = propertyDef({
  id: 'p-any',
  key: 'any',
  name: 'Anything',
  type: 'entity',
  options: { isArray: true, allowedTypes: [], hasFixedSet: false, fixedSet: [] },
})

function project(rollup: PropertyOptions, defs: PropertyDef[] = [TITLE, TASKS, ANY]): TypeDef {
  const ROLL = propertyDef({ id: 'p-roll', key: 'roll', name: 'Roll', type: 'rollup', options: rollup })
  return typeDef({ id: 'project', name: 'Project', revision: 'r1', propertyDefinitions: [...defs, ROLL] })
}

function savedRollup(call = 0): PropertyOptions | undefined {
  const t: TypeDef = vi.mocked(api.saveType).mock.calls[call][0]
  return t.propertyDefinitions.find((d) => d.id === 'p-roll')?.options
}

function open(rollup: PropertyOptions, defs?: PropertyDef[]) {
  useLinkIndex.setState({ types: [project(rollup, defs), TASK, PERSON], objects: [], loaded: true })
  render(<PropertySettings typeId="project" propertyId="p-roll" open onOpenChange={vi.fn()} />)
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement
const optionTexts = (name: string) => within(select(name)).getAllByRole('option').map((o) => o.textContent)

beforeEach(() => {
  vi.mocked(api.saveType).mockClear()
  resetLinkIndex()
})

describe('RollupSection', () => {
  test('choosing a relation saves it', async () => {
    const user = userEvent.setup()
    open({ relationId: '', targetId: '', calc: 'showOriginal' })
    expect(optionTexts(ROLLUP_TEXT.relation)).toEqual([ROLLUP_TEXT.chooseRelation, 'Tasks', 'Anything'])
    expect(select(ROLLUP_TEXT.property)).toBeDisabled()
    await user.selectOptions(select(ROLLUP_TEXT.relation), 'p-tasks')
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedRollup()).toEqual({ relationId: 'p-tasks', targetId: '', calc: 'showOriginal' })
  })

  test('the property list is Title and the linked type’s properties, without rollups or content', () => {
    open({ relationId: 'p-tasks', targetId: '', calc: 'showOriginal' })
    expect(optionTexts(ROLLUP_TEXT.property)).toEqual([ROLLUP_TEXT.chooseProperty, 'Title', 'Estimate', 'Due', 'Note', 'Score'])
  })

  test('a relation to any type lists every type’s properties', () => {
    open({ relationId: 'p-any', targetId: '', calc: 'showOriginal' })
    const names = optionTexts(ROLLUP_TEXT.property)
    expect(names).toContain('Estimate')
    expect(names).toContain('Age')
    expect(names).not.toContain('Subtotal')
  })

  test('a number property offers the number calculations', () => {
    open({ relationId: 'p-tasks', targetId: 'p-est', calc: 'sum' })
    const calcs = optionTexts(ROLLUP_TEXT.calculate)
    expect(calcs).toEqual(rollupCalcsFor('number').map((c) => ROLLUP_CALC_LABELS[c]))
    expect(calcs).toContain('Sum')
    expect(calcs).toContain('Show original')
    expect(calcs).toContain('Show unique')
    expect(calcs).not.toContain('Earliest date')
    expect(select(ROLLUP_TEXT.calculate).value).toBe('sum')
  })

  test('a date property offers the date calculations', () => {
    open({ relationId: 'p-tasks', targetId: 'p-due', calc: 'showOriginal' })
    const calcs = optionTexts(ROLLUP_TEXT.calculate)
    expect(calcs).toContain('Earliest date')
    expect(calcs).toContain('Date range')
    expect(calcs).not.toContain('Sum')
  })

  test('a text property offers only the show, count and percent calculations', () => {
    open({ relationId: 'p-tasks', targetId: 'p-note', calc: 'showOriginal' })
    expect(optionTexts(ROLLUP_TEXT.calculate)).toEqual([
      'Show original',
      'Show unique',
      'Count all',
      'Count values',
      'Count unique values',
      'Count empty',
      'Count not empty',
      'Percent empty',
      'Percent not empty',
    ])
  })

  test('picking a property the calculation doesn’t fit resets it to Show original', async () => {
    const user = userEvent.setup()
    open({ relationId: 'p-tasks', targetId: 'p-est', calc: 'sum' })
    await user.selectOptions(select(ROLLUP_TEXT.property), 'p-note')
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedRollup()).toMatchObject({ relationId: 'p-tasks', targetId: 'p-note', calc: 'showOriginal' })
  })

  test('changing the relation drops a property it does not offer', async () => {
    const user = userEvent.setup()
    open({ relationId: 'p-any', targetId: 'p-age', calc: 'average' })
    await user.selectOptions(select(ROLLUP_TEXT.relation), 'p-tasks')
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedRollup()).toMatchObject({ relationId: 'p-tasks', targetId: '', calc: 'showOriginal' })
  })

  test('choosing a calculation saves it; a number calculation shows the number format', async () => {
    const user = userEvent.setup()
    open({ relationId: 'p-tasks', targetId: 'p-est', calc: 'countAll' })
    expect(screen.queryByRole('region', { name: ROLLUP_TEXT.numberFormat })).toBeNull()
    await user.selectOptions(select(ROLLUP_TEXT.calculate), 'average')
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedRollup()).toMatchObject({ calc: 'average' })
    expect(await screen.findByRole('region', { name: ROLLUP_TEXT.numberFormat })).toBeInTheDocument()
  })

  test('the number format is saved with the rollup', async () => {
    const user = userEvent.setup()
    open({ relationId: 'p-tasks', targetId: 'p-est', calc: 'sum' })
    const section = screen.getByRole('region', { name: ROLLUP_TEXT.numberFormat })
    await user.click(within(section).getByRole('button', { name: 'Number format' }))
    await user.click(screen.getByRole('button', { name: 'Number' }))
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedRollup()).toMatchObject({ calc: 'sum', numberFormat: { type: 'number' } })
  })

  test('a type without relations says so', () => {
    open({ relationId: '', targetId: '', calc: 'showOriginal' }, [TITLE])
    expect(screen.getByText(ROLLUP_TEXT.noRelations)).toBeInTheDocument()
  })

  test('a rollup cannot change its property type', () => {
    open({ relationId: '', targetId: '', calc: 'showOriginal' })
    expect(screen.getByText('This property type cannot be changed.')).toBeInTheDocument()
  })
})
