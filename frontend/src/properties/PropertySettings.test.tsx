import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PropertyDef, TypeDef } from '@/api/types'
import { propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConfirmRequiredError } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { PropertyMenu } from './PropertyMenu'
import { PropertySettings } from './PropertySettings'

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const NOTE = propertyDef({ id: 'p-note', key: 'note', name: 'Note', type: 'text' })
const DUE = propertyDef({ id: 'p-due', key: 'due', name: 'Due', type: 'datetime' })
const OWNER = propertyDef({
  id: 'p-owner',
  key: 'owner',
  name: 'Owner',
  type: 'entity',
  options: { isArray: true, allowedTypes: ['person'], hasFixedSet: false, fixedSet: [] },
})
const LEAD = propertyDef({
  id: 'p-lead',
  key: 'lead',
  name: 'Lead',
  type: 'entity',
  options: { isArray: false, allowedTypes: ['person'], hasFixedSet: false, fixedSet: [] },
})
const PERSON = typeDef({ id: 'person', name: 'Person', pluralName: 'People', revision: 'rp' })
const PROJECT = typeDef({
  id: 'project',
  name: 'Project',
  revision: 'r1',
  propertyDefinitions: [TITLE, NOTE, DUE, OWNER, LEAD],
})

function savedType(call = 0): TypeDef {
  return vi.mocked(api.saveType).mock.calls[call][0]
}
function savedDef(id: string, call = 0): PropertyDef | undefined {
  return savedType(call).propertyDefinitions.find((d) => d.id === id)
}

function open(propertyId: string, onOpenProperty = vi.fn()) {
  render(
    <PropertySettings typeId="project" propertyId={propertyId} open onOpenChange={vi.fn()} onOpenProperty={onOpenProperty} />,
  )
  return onOpenProperty
}

beforeEach(() => {
  vi.mocked(api.saveType).mockReset()
  vi.mocked(api.changePropertyKind).mockReset()
  resetLinkIndex()
  useLinkIndex.setState({ types: [PROJECT, PERSON], objects: [], loaded: true })
})

describe('PropertySettings', () => {
  test('test PropertySettings delete requires typing "delete"', async () => {
    const user = userEvent.setup()
    open('p-note')
    expect(screen.getByText('Property settings')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Delete property' })
    expect(button).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Type "delete" to confirm' }), 'delet')
    expect(button).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Type "delete" to confirm' }), 'e')
    expect(button).toBeEnabled()
    await user.click(button)
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef('p-note')).toBeUndefined()
    expect(vi.mocked(api.saveType).mock.calls[0][1]).toEqual({ baseRevision: 'r1', confirm: true })
  })

  test('a formula or rollup is deleted without typing "delete"', async () => {
    const user = userEvent.setup()
    const formula = propertyDef({ id: 'p-f', key: 'f', name: 'F', type: 'formula', options: { expression: '1' } })
    useLinkIndex.setState({ types: [{ ...PROJECT, propertyDefinitions: [...PROJECT.propertyDefinitions, formula] }, PERSON] })
    open('p-f')
    expect(screen.queryByRole('textbox', { name: 'Type "delete" to confirm' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete property' }))
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef('p-f')).toBeUndefined()
  })

  test('test relation Apply changes sends confirm after the 428 dialog', async () => {
    const user = userEvent.setup()
    vi.mocked(api.saveType)
      .mockRejectedValueOnce(new ConfirmRequiredError('Links that break the rules will be removed.', 3))
      .mockImplementation(async (t) => ({ type: { ...t, revision: 'r2' }, rewritten: [], skipped: [] }))
    open('p-owner')
    expect(screen.getByText('Linked type')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Single' }))
    // Relation rule changes wait for "Apply changes".
    expect(api.saveType).not.toHaveBeenCalled()
    expect(screen.getByText(/Links that no longer fit the rules above/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(await screen.findByText('3 notes will change.')).toBeInTheDocument()
    expect(screen.getByText('Links that break the rules will be removed.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.saveType).mock.calls[0][1]).toEqual({ baseRevision: 'r1' })
    expect(vi.mocked(api.saveType).mock.calls[1][1]).toEqual({ baseRevision: 'r1', confirm: true })
    expect(savedDef('p-owner', 1)?.options.isArray).toBe(false)
  })

  test('test two-way linking shows multiSelectOnly info for a single-select relation', () => {
    open('p-lead')
    expect(screen.getByText('Two-way linking')).toBeInTheDocument()
    expect(screen.getByText(/Syncing needs multi-select properties/)).toBeInTheDocument()
  })

  describe('two-way linking of a single-sided pair (sub-items)', () => {
    const PARENT = propertyDef({
      id: 'p-parent',
      key: 'parent',
      name: 'Parent item',
      type: 'entity',
      options: { isArray: false, allowedTypes: ['task'], hasFixedSet: false, fixedSet: [], propertySyncing: { propertyIds: ['p-children'] } },
    })
    const CHILDREN = propertyDef({
      id: 'p-children',
      key: 'children',
      name: 'Sub-items',
      type: 'entity',
      options: { isArray: true, allowedTypes: ['task'], hasFixedSet: false, fixedSet: [], propertySyncing: { propertyIds: ['p-parent'] } },
    })
    const TASK = typeDef({ id: 'task', name: 'Task', pluralName: 'Tasks', revision: 't1', propertyDefinitions: [TITLE, PARENT, CHILDREN] })
    const openTask = (propertyId: string) => {
      useLinkIndex.setState({ types: [TASK], objects: [], loaded: true })
      render(<PropertySettings typeId="task" propertyId={propertyId} open onOpenChange={vi.fn()} onOpenProperty={vi.fn()} />)
    }

    test('"Parent item" shows its synced partner, not the multi-select notice', () => {
      openTask('p-parent')
      expect(screen.queryByText(/Syncing needs multi-select properties/)).toBeNull()
      expect(screen.getByRole('button', { name: 'Sub-items', pressed: true })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'No Property', pressed: false })).toBeInTheDocument()
    })

    test('"Sub-items" shows its single partner as the synced property', async () => {
      const user = userEvent.setup()
      openTask('p-children')
      expect(screen.getByRole('button', { name: 'Parent item', pressed: true })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'No Property' }))
      expect(api.setPropertySync).toHaveBeenCalledWith('task', 'p-children', null, 't1', undefined)
    })
  })

  test('two-way linking offers to create a property in the linked type', async () => {
    const user = userEvent.setup()
    open('p-owner')
    await user.click(screen.getByRole('button', { name: 'Create property "Project" for "People"' }))
    expect(api.setPropertySync).toHaveBeenCalledWith('project', 'p-owner', null, 'r1', 'Project')
  })

  test('test change property type calls changeKind and keeps the old property listed', async () => {
    const user = userEvent.setup()
    const NEW = propertyDef({ id: 'p-new', key: 'note_', name: 'Note', type: 'number' })
    vi.mocked(api.changePropertyKind).mockResolvedValue({
      type: { ...PROJECT, revision: 'r2', propertyDefinitions: [...PROJECT.propertyDefinitions, NEW] },
      newPropertyId: 'p-new',
      rewritten: [],
      skipped: [],
      lossy: 0,
    })
    const onOpenProperty = open('p-note')
    expect(screen.getByText(/makes a new property of the chosen kind/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /^Number/ }))
    const change = screen.getByRole('button', { name: 'Change type' })
    expect(change).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'I know some values may be lost.' }))
    await user.click(change)
    await waitFor(() => expect(onOpenProperty).toHaveBeenCalledWith('p-new'))
    expect(api.changePropertyKind).toHaveBeenCalledWith('project', 'p-note', 'number', 'r1')
    const ids = useLinkIndex.getState().types.find((t) => t.id === 'project')!.propertyDefinitions.map((d) => d.id)
    expect(ids).toContain('p-note')
    expect(ids).toContain('p-new')
  })

  test('a kind without transformations says so', () => {
    useLinkIndex.setState({
      types: [{ ...PROJECT, propertyDefinitions: [propertyDef({ id: 'p-b', key: 'notes', type: 'blocks' })] }],
    })
    open('p-b')
    expect(screen.getByText(/This property type cannot be changed/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Type "delete-all-content" to confirm' })).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('This type has no other content property.')
    expect(screen.getByText(/and it cannot be undone\./)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveAttribute(
      'placeholder',
      'What is this property for?',
    )
  })

  test('a content property among several gets the general warning', () => {
    useLinkIndex.setState({
      types: [
        {
          ...PROJECT,
          propertyDefinitions: [
            propertyDef({ id: 'p-b', key: 'notes', type: 'blocks' }),
            propertyDef({ id: 'p-c', key: 'more', type: 'blocks' }),
          ],
        },
      ],
    })
    open('p-b')
    expect(screen.getByRole('note')).toHaveTextContent('A content property usually holds the body of a note;')
  })

  test('test date Default Custom writes startTimeDefault', async () => {
    const user = userEvent.setup()
    open('p-due')
    expect(screen.getByText('Time')).toBeInTheDocument()
    expect(screen.getByText('Range')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Custom' }))
    await waitFor(() => expect(api.saveType).toHaveBeenCalled())
    const c = savedDef('p-due')?.options.constraints
    expect(typeof c?.startTimeDefault).toBe('string')
    expect(Number.isNaN(Date.parse(c!.startTimeDefault!))).toBe(false)
  })

  test('date Time Required writes resolutionConstraint time', async () => {
    const user = userEvent.setup()
    open('p-due')
    await user.click(screen.getByRole('button', { name: 'Time: Required' }))
    await waitFor(() => expect(api.saveType).toHaveBeenCalled())
    expect(savedDef('p-due')?.options.constraints?.resolutionConstraint).toBe('time')
  })
})

describe('PropertyMenu', () => {
  test('test Visibility menu not offered for title', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const { unmount } = render(
      <PropertyMenu type={PROJECT} def={TITLE} onSave={onSave} onEditProperty={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.queryByText('Visibility')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Property' })).toBeInTheDocument()
    unmount()

    render(<PropertyMenu type={PROJECT} def={NOTE} onSave={onSave} onEditProperty={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Visibility')).toBeInTheDocument()
    expect(screen.queryByText('Format')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide When Empty' }))
    const next: TypeDef = onSave.mock.calls[0][0]
    expect(next.propertyDefinitions.find((d) => d.id === 'p-note')?.visibility).toBe('hideWhenEmpty')
  })

  test('PropertyMenu: Enter commits the name and a later Escape keeps it', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<PropertyMenu type={PROJECT} def={NOTE} onSave={onSave} onEditProperty={vi.fn()} onDelete={vi.fn()} />)
    const name = screen.getByRole('textbox', { name: 'Property name' })
    await user.clear(name)
    await user.type(name, 'Remark{Enter}')
    expect((onSave.mock.calls[0][0] as TypeDef).propertyDefinitions.find((d) => d.id === 'p-note')?.name).toBe('Remark')
    // The type's save has not come back yet (def.name is still "Note"): Escape must not revert.
    name.focus()
    await user.keyboard('{Escape}')
    expect(name).toHaveValue('Remark')
    // An uncommitted edit still goes back to the committed name.
    await user.type(name, 's')
    await user.keyboard('{Escape}')
    expect(name).toHaveValue('Remark')
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  test('Property settings: Enter commits the name, so Escape (closing the dialog) keeps it', async () => {
    const user = userEvent.setup()
    vi.mocked(api.saveType).mockImplementation(async (t: TypeDef) => ({ type: { ...t, revision: 'r2' }, rewritten: [], skipped: [] }))
    const onOpenChange = vi.fn()
    render(<PropertySettings typeId="project" propertyId="p-note" open onOpenChange={onOpenChange} onOpenProperty={vi.fn()} />)
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Remark{Enter}')
    await waitFor(() => expect(api.saveType).toHaveBeenCalledTimes(1))
    expect(savedDef('p-note')?.name).toBe('Remark')
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(api.saveType).toHaveBeenCalledTimes(1)
  })

  test('the name saves on blur and number properties offer Format', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const NUM = propertyDef({ id: 'p-n', key: 'n', name: 'Amount', type: 'number' })
    const t = { ...PROJECT, propertyDefinitions: [NUM] }
    render(<PropertyMenu type={t} def={NUM} onSave={onSave} onEditProperty={vi.fn()} onDelete={vi.fn()} />)
    const name = screen.getByRole('textbox', { name: 'Property name' })
    await user.clear(name)
    await user.type(name, 'Budget')
    expect(onSave).not.toHaveBeenCalled()
    await user.tab()
    expect((onSave.mock.calls[0][0] as TypeDef).propertyDefinitions[0].name).toBe('Budget')
    await user.click(screen.getByRole('button', { name: 'Format' }))
    expect(screen.getByPlaceholderText('Choose a format')).toBeInTheDocument()
    expect(screen.getByText('Standard')).toBeInTheDocument()
    expect(screen.getByText('Currencies')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Euro/ }))
    const fmt = (onSave.mock.calls[1][0] as TypeDef).propertyDefinitions[0].options.numberFormat
    expect(fmt).toMatchObject({ type: 'currency', options: { currency: 'EUR', decimals: { min: 2, max: 2 } } })
  })
})
