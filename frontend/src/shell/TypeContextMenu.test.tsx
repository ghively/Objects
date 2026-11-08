import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/create/createAndOpen', () => ({ createAndOpen: vi.fn(async () => ({ path: 'Meetings/New.md' })) }))

import { api } from '@/api/client'
import { createAndOpen } from '@/create/createAndOpen'
import { useTabs } from '@/nav/tabs'
import { objectSummary, typeDef as makeType } from '@/test/mockApi'
import { Sidebar } from './Sidebar'

const mocked = vi.mocked(api)
const MEETING = makeType({ id: 'meeting', name: 'Meeting', pluralName: 'Meetings', folder: 'Meetings' })
const DAILY = makeType({ id: 'dailynote', name: 'DailyNote', pluralName: 'DailyNotes', folder: 'DailyNotes', basic: true })

async function openMenu(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.pointer({ keys: '[MouseRight]', target: await screen.findByRole('button', { name: label }) })
}

beforeEach(() => {
  vi.mocked(createAndOpen).mockClear()
  useTabs.getState().reset()
  mocked.templates = vi.fn(async () => [objectSummary({ path: 'Templates/Meetings/Standup.md', title: 'Standup', id: 'tpl-1' })])
})

describe('Sidebar type context menu', () => {
  it('lists the type menu, in order', async () => {
    const user = userEvent.setup()
    render(<Sidebar types={[MEETING]} />)
    await openMenu(user, /Meetings/)
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Open', 'Create Meeting', 'New from template', 'New collection', 'Pin to sidebar', 'Object type settings', 'Import CSV', 'Delete object type'])
  })

  it('Pin to sidebar pins the type', async () => {
    const user = userEvent.setup()
    render(<Sidebar types={[MEETING]} />)
    await openMenu(user, /Meetings/)
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to sidebar' }))
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalled())
    const sent = JSON.stringify(mocked.patchUi.mock.calls[0][0])
    expect(sent).toContain('"kind":"type"')
    expect(sent).toContain('meeting')
  })

  it('Create <Type> creates and opens one', async () => {
    const user = userEvent.setup()
    render(<Sidebar types={[MEETING]} />)
    await openMenu(user, /Meetings/)
    await user.click(await screen.findByRole('menuitem', { name: 'Create Meeting' }))
    expect(createAndOpen).toHaveBeenCalledWith('meeting')
  })

  it('New from template lists the type\'s templates and creates from one', async () => {
    const user = userEvent.setup()
    render(<Sidebar types={[MEETING]} />)
    await openMenu(user, /Meetings/)
    await user.click(await screen.findByRole('menuitem', { name: 'New from template' }))
    // Radix submenus ignore a pointer that jumps straight in (jsdom); the click itself is what selects.
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Standup' }))
    expect(mocked.templates).toHaveBeenCalledWith('meeting')
    expect(createAndOpen).toHaveBeenCalledWith('meeting', { templateId: 'tpl-1' })
  })

  it('Open has a new-tab and a side-panel entry', async () => {
    const user = userEvent.setup()
    const onOpenTarget = vi.fn()
    render(<Sidebar types={[MEETING]} onOpenTarget={onOpenTarget} />)
    await openMenu(user, /Meetings/)
    await user.click(await screen.findByRole('menuitem', { name: 'Open' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in new tab' }))
    expect(onOpenTarget).toHaveBeenCalledWith({ kind: 'type', typeId: 'meeting' }, { newTab: true })
  })

  it('New collection opens the create dialog for the type', async () => {
    const user = userEvent.setup()
    render(<Sidebar types={[MEETING]} />)
    await openMenu(user, /Meetings/)
    await user.click(await screen.findByRole('menuitem', { name: 'New collection' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { hidden: true })).toBeInTheDocument()
  })

  it('Import opens the CSV import dialog for the type', async () => {
    const user = userEvent.setup()
    render(<Sidebar types={[MEETING]} />)
    await openMenu(user, /Meetings/)
    await user.click(await screen.findByRole('menuitem', { name: 'Import CSV' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })

  it('a daily note type has no Create, template or Import entries (its own flow)', async () => {
    const user = userEvent.setup()
    render(<Sidebar types={[DAILY]} />)
    await openMenu(user, /DailyNotes/)
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Open', 'New collection', 'Pin to sidebar', 'Object type settings'])
  })
})
