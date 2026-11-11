// M9 Tasks 17-20 on the type page: the row menu, multi-select, Import CSV and query tabs.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Views } from '@/api/types'
import { defaultViews, objectSummary, propertyDef, row, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { resetLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { usePeek, useTabs } from '@/nav/tabs'
import { useRecent } from '@/nav/recent'
import { useDefs } from './useDefinitions'
import { TypePage } from './TypePage'

const mocked = vi.mocked(api)

const TITLE = propertyDef({ id: 'title', key: 'title', name: 'Title', type: 'entity_title' })
const BOOK = typeDef({ id: 'book', name: 'Book', pluralName: 'Books', revision: 'r1', propertyDefinitions: [TITLE] })
const PAGE = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1', propertyDefinitions: [TITLE] })

const mk = (path: string, title: string) => row({ summary: objectSummary({ path, type: 'book', title }), version: `v-${title}` })
const ROWS = [mk('Books/Alpha.md', 'Alpha'), mk('Books/Beta.md', 'Beta'), mk('Books/Gamma.md', 'Gamma')]

function views(over: Partial<Views> = {}): Views {
  return { ...defaultViews(), activeTab: 'all', ...over }
}

const rowEl = async (title: string) => (await screen.findByText(title)).closest('[data-path]') as HTMLElement

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useRecent.getState().clear()
  resetLinkIndex()
  useDefs.setState({ collections: [], queries: [], loaded: false })
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.views.mockResolvedValue({ views: views(), revision: 'r0' })
  mocked.saveViews.mockResolvedValue({ revision: 'r1' })
  mocked.rows.mockResolvedValue(ROWS)
  mocked.collections.mockResolvedValue([])
  mocked.queries.mockResolvedValue([])
  mocked.templates.mockResolvedValue([])
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.deleteObject.mockResolvedValue({ trashId: 't1' })
  useLinkIndex.setState({ types: [BOOK, PAGE], objects: ROWS.map((r) => r.summary), loaded: true })
})

describe('TypePage row menu (Task 17)', () => {
  test('test type page row menu items and order', async () => {
    const user = userEvent.setup()
    render(<TypePage type={BOOK} />)
    await user.pointer({ keys: '[MouseRight]', target: await rowEl('Alpha') })
    const menu = await screen.findByTestId('row-menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Select multiple',
      'Open in side panel',
      'Open in new tab',
      'Change type',
      'Copy object reference',
      'Duplicate',
      'Delete object',
    ])
  })

  test('test delete opens the delete dialog', async () => {
    const user = userEvent.setup()
    render(<TypePage type={BOOK} />)
    await user.pointer({ keys: '[MouseRight]', target: await rowEl('Beta') })
    await user.click(await screen.findByRole('menuitem', { name: 'Delete object' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete this object?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete 1 object' }))
    await waitFor(() => expect(mocked.deleteObject).toHaveBeenCalledWith('Books/Beta.md', { baseVersion: 'v-Beta' }))
  })

  test('test change type opens the type submenu and the change dialog', async () => {
    const user = userEvent.setup()
    mocked.suggestMapping.mockResolvedValue([])
    render(<TypePage type={BOOK} />)
    await user.pointer({ keys: '[MouseRight]', target: await rowEl('Alpha') })
    await user.click(await screen.findByRole('menuitem', { name: 'Change type' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Page' }))
    expect(await screen.findByText('Change object type?')).toBeInTheDocument()
    await waitFor(() => expect(mocked.suggestMapping).toHaveBeenCalledWith('Books/Alpha.md', 'page'))
  })
})

describe('TypePage Import CSV (Task 19)', () => {
  test('test import csv sits after type settings in the more menu and opens the dialog', async () => {
    const user = userEvent.setup()
    render(<TypePage type={BOOK} />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    const items = (await screen.findAllByRole('menuitem')).map((m) => m.textContent)
    // The catalog's order: New collection, Pin to sidebar, Type settings (M32: was "Object type settings"), Import.
    expect(items).toEqual(['New collection', 'Pin to sidebar', 'Pin to...', 'Type settings', 'Import CSV', 'Save as a saved search', 'Delete type'])
    await user.click(screen.getByRole('menuitem', { name: 'Import CSV' }))
    expect(await screen.findByText('Bulk import from CSV')).toBeInTheDocument()
  })

  test('Ctrl+I (openImportMenu) opens the CSV import, as the tab menu says, but not while typing', async () => {
    const user = userEvent.setup()
    render(<TypePage type={BOOK} />)
    await screen.findByText('Alpha')
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    await user.keyboard('{Control>}i{/Control}')
    expect(screen.queryByText('Bulk import from CSV')).toBeNull()
    field.remove()
    document.body.focus()
    await user.keyboard('{Control>}i{/Control}')
    expect(await screen.findByText('Bulk import from CSV')).toBeInTheDocument()
  })

  test('Ctrl+I does nothing on a type that takes no CSV', async () => {
    const user = userEvent.setup()
    const daily = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true, revision: 'r1' })
    render(<TypePage type={daily} />)
    await screen.findByRole('button', { name: 'More' })
    await user.keyboard('{Control>}i{/Control}')
    expect(screen.queryByText('Bulk import from CSV')).toBeNull()
  })

  test('test no import csv for daily notes', async () => {
    const user = userEvent.setup()
    const daily = typeDef({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', basic: true, revision: 'r1' })
    render(<TypePage type={daily} />)
    await user.click(await screen.findByRole('button', { name: 'More' }))
    await screen.findAllByRole('menuitem')
    expect(screen.queryByRole('menuitem', { name: 'Import CSV' })).toBeNull()
  })
})
