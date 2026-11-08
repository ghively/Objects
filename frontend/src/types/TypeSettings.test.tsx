import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { TypeDef } from '@/api/types'
import { objectSummary, propertyDef, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { BASIC_TYPE_INFO } from '@/properties/AddPropertyMenu'
import { TypeSettings } from './TypeSettings'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const NOTE = propertyDef({ id: 'p-note', key: 'note', name: 'Note', type: 'text' })
const PROJECT = typeDef({
  id: 'project',
  name: 'Project',
  revision: 'r1',
  propertyDefinitions: [TITLE, NOTE],
  templates: { ids: ['t-a', 't-b'], defaultTemplateId: 't-a' },
})
const PAGE = typeDef({ id: 'page', name: 'Page', basic: true, revision: 'rp', propertyDefinitions: [TITLE] })

function savedType(call = 0): TypeDef {
  return mocked.saveType.mock.calls[call][0]
}

beforeEach(() => {
  resetLinkIndex()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockClear()
  useLinkIndex.setState({ types: [PROJECT, PAGE], objects: [], loaded: true })
  mocked.templates.mockImplementation(async (typeId: string) =>
    typeId === 'project'
      ? [
          objectSummary({ path: 'Templates/Projects/A.md', id: 't-a', type: 'project', template: 'Kickoff' }),
          objectSummary({ path: 'Templates/Projects/B.md', id: 't-b', type: 'project', template: 'Retro' }),
        ]
      : [],
  )
})

describe('TypeSettings', () => {
  test('test section headings render in order and no Calendar or Card view group', async () => {
    render(<TypeSettings typeId="project" />)
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav).toHaveTextContent('Object Types')
    expect(nav).toHaveTextContent('Project')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Properties', 'Templates', 'Work', 'Configuration', 'Delete Object Type'])
    // The basics come first, in order.
    const labels = ['Type icon', 'Name', 'Plural of name', 'Color', 'Description']
    const nodes = labels.map((l) => screen.getByLabelText(l))
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    const config = screen.getByRole('region', { name: 'Configuration' })
    expect(within(config).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Page',
      'Card view and linking',
    ])
    for (const l of ['Page layout', 'Font', 'Wide layout', 'Cover image mode', 'Display of cover image']) {
      expect(within(config).getAllByText(l).length).toBeGreaterThan(0)
    }
    expect(within(within(config).getByRole('region', { name: 'Page' })).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'Standard',
      'Index card',
      'Profile',
      'Encyclopedia',
    ])
    expect(within(config).getByRole('radio', { name: 'Standard' })).toHaveTextContent(
      'Neutral default focused on functionality.',
    )
    expect(
      within(config).getByText('Customize how objects of this type look and behave across pages, cards, and the calendar.'),
    ).toBeInTheDocument()
    expect(within(config).getByRole('option', { name: 'Sans Serif' })).toBeInTheDocument()
    // No Calendar settings group (M13's Calendar layout is only an option of the default list view).
    expect(screen.queryByRole('heading', { name: /Calendar/ })).not.toBeInTheDocument()
    expect(await screen.findByText('Kickoff')).toBeInTheDocument()
  })

  test('test editing Name saves type on blur with baseRevision', async () => {
    const user = userEvent.setup()
    render(<TypeSettings typeId="project" />)
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Venture')
    await user.tab()
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    expect(savedType().name).toBe('Venture')
    expect(savedType().id).toBe('project')
    expect(mocked.saveType.mock.calls[0][1]).toEqual({ baseRevision: 'r1' })
    // The saved type (and its revision) is adopted.
    await waitFor(() => expect(useLinkIndex.getState().types.find((t) => t.id === 'project')?.revision).toBe('r1+1'))
  })

  test('test basic type shows "Properties of basic object types cannot be edited.", disables Add Property and Name, and hides Delete', () => {
    render(<TypeSettings typeId="page" />)
    expect(screen.getByRole('note')).toHaveTextContent(BASIC_TYPE_INFO)
    expect(screen.getByRole('button', { name: 'Add Property' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeDisabled()
    expect(screen.queryByRole('heading', { name: 'Delete Object Type' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Object Type' })).not.toBeInTheDocument()
    // The description, colour and layout stay editable.
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'Font' })).toBeEnabled()
  })

  test('a type that cannot be read shows why and disables every control', () => {
    useLinkIndex.setState({
      types: [{ ...PROJECT, readOnlyReason: 'The type file is not valid JSON.' }],
    })
    render(<TypeSettings typeId="project" />)
    expect(screen.getByText('The type file is not valid JSON.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Font' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete Object Type' })).toBeDisabled()
  })

  test('layout settings save at once', async () => {
    const user = userEvent.setup()
    render(<TypeSettings typeId="project" />)
    await user.click(screen.getByRole('radio', { name: 'Encyclopedia' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    expect(savedType().viewDesign).toBe('encyclopedia')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Font' }), 'serif')
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(2))
    expect(savedType(1).font).toBe('serif')
    expect(savedType(1).viewDesign).toBe('encyclopedia')
  })

  test('test Mark as Default sets templates.defaultTemplateId', async () => {
    const user = userEvent.setup()
    render(<TypeSettings typeId="project" />)
    const retro = await screen.findByRole('listitem', { name: 'Retro' })
    // The current default has no "Mark as Default".
    expect(
      within(screen.getByRole('listitem', { name: 'Kickoff' })).queryByRole('button', { name: 'Mark as Default' }),
    ).not.toBeInTheDocument()
    await user.click(within(retro).getByRole('button', { name: 'Mark as Default' }))
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    expect(savedType().templates).toEqual({ ids: ['t-a', 't-b'], defaultTemplateId: 't-b' })
    expect(mocked.saveType.mock.calls[0][1]).toEqual({ baseRevision: 'r1' })
  })

  test('Edit Template and New Template open the template', async () => {
    const user = userEvent.setup()
    const onOpenTemplate = vi.fn()
    render(<TypeSettings typeId="project" onOpenTemplate={onOpenTemplate} />)
    const kickoff = await screen.findByRole('listitem', { name: 'Kickoff' })
    await user.click(within(kickoff).getByRole('button', { name: 'Edit Template' }))
    expect(onOpenTemplate).toHaveBeenLastCalledWith('Templates/Projects/A.md')
    await user.click(screen.getByRole('button', { name: 'New Template' }))
    await waitFor(() => expect(mocked.createTemplate).toHaveBeenCalledWith('project'))
    await waitFor(() => expect(onOpenTemplate).toHaveBeenLastCalledWith('Templates/project/New template.md'))
  })

  test('Delete Template drops it from the type, then moves it to the Trash', async () => {
    const user = userEvent.setup()
    render(<TypeSettings typeId="project" />)
    const kickoff = await screen.findByRole('listitem', { name: 'Kickoff' })
    await user.click(within(kickoff).getByRole('button', { name: 'Delete Template' }))
    await waitFor(() => expect(mocked.deleteObject).toHaveBeenCalledWith('Templates/Projects/A.md'))
    expect(savedType().templates).toEqual({ ids: ['t-b'], defaultTemplateId: null })
    expect(mocked.saveType.mock.invocationCallOrder[0]).toBeLessThan(mocked.deleteObject.mock.invocationCallOrder[0])
  })
})

// Polish item 20: "Default list view", the layout a type page with no saved views opens in.
describe('TypeSettings default list view', () => {
  test('it lists the type page layouts and shows the built-in default while unset', () => {
    render(<TypeSettings typeId="project" />)
    const select = screen.getByRole('combobox', { name: 'Default list view' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'List',
      'Wall',
      'Kanban',
      'Gallery',
      'Table',
      'Embed',
      'Calendar',
      'Timeline',
      'Chart',
    ])
    expect(select).toHaveValue('list')
    expect(PROJECT).not.toHaveProperty('defaultDataViewLayout')
  })

  test('choosing a layout saves only that key', async () => {
    const user = userEvent.setup()
    render(<TypeSettings typeId="project" />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default list view' }), 'table')
    await waitFor(() => expect(mocked.saveType).toHaveBeenCalledTimes(1))
    const { defaultDataViewLayout, ...rest } = savedType()
    expect(defaultDataViewLayout).toBe('table')
    expect(rest).toEqual(PROJECT)
  })

  test('a chosen layout shows as selected', () => {
    useLinkIndex.setState({ types: [{ ...PROJECT, defaultDataViewLayout: 'wall' }, PAGE] })
    render(<TypeSettings typeId="project" />)
    expect(screen.getByRole('combobox', { name: 'Default list view' })).toHaveValue('wall')
  })
})
