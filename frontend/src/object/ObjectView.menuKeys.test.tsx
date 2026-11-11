// Polish item 11: the object `...` menu's Export, Import and Pin key hints (registry entries
// openExportMenu, openImportMenu, toggleFavorite), Import, and the Copy > submenu.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceInfo, TypeDef } from '@/api/types'
import { objectDetail, objectSummary, typeDef } from '@/test/mockApi'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('@/find/FindBar', () => ({ FindBar: () => null }))
vi.mock('@/references/ReferencesSection', () => ({ ReferencesSection: () => null }))

import { api } from '@/api/client'
import { keysFor } from '@/lib/shortcuts'
import { resetLinkIndex } from '@/links/linkIndex'
import { useCollectionPeek, usePeek, useTabs } from '@/nav/tabs'
import { resetPinned } from '@/shell/usePinned'
import { IMPORT_CSV_TEXT } from '@/types/ImportCsvDialog'
import { EXPORT_TEXT } from './ExportDialog'
import { ObjectView } from './ObjectView'

const mocked = vi.mocked(api)
const PAGE: TypeDef = typeDef({ id: 'page', name: 'Page', pluralName: 'Pages', revision: 'r1' })
const PATH = 'Pages/Notes.md'

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  useTabs.getState().reset()
  usePeek.getState().close()
  useCollectionPeek.getState().close()
  resetLinkIndex()
  resetPinned()
  for (const fn of Object.values(mocked)) vi.mocked(fn).mockReset()
  mocked.resolve.mockResolvedValue(null)
  mocked.onChange.mockReturnValue(() => undefined)
  mocked.ui.mockResolvedValue({ ui: { pinned: [], sections: [], allNotesLayout: 'list' }, revision: 'u0' })
  const detail = objectDetail({
    summary: objectSummary({ path: PATH, type: PAGE.id, title: 'Notes', id: 'N1' }),
    frontmatter: { type: PAGE.name, title: 'Notes' },
    body: '# Head\n\nBody text.\n',
    version: 'v1',
  })
  mocked.space.mockResolvedValue({ name: 's', root: '/s', types: [PAGE] } satisfies SpaceInfo)
  mocked.objects.mockResolvedValue([detail.summary])
  mocked.object.mockResolvedValue(detail)
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  document.querySelectorAll('[data-editor-toasts]').forEach((n) => n.remove())
  vi.restoreAllMocks()
})

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  render(<ObjectView path={PATH} mode="page" />)
  await screen.findByText('Head')
  await user.click(screen.getByRole('button', { name: 'More' }))
  return screen.findByRole('menu')
}

const row = (menu: HTMLElement, label: string) => within(menu).getAllByRole('menuitem').find((i) => i.textContent?.startsWith(label))!

describe('object … menu key hints, Import and Copy', () => {
  test('the registry has the page keys', () => {
    expect(keysFor('openExportMenu')).toEqual(['Mod-e'])
    expect(keysFor('openImportMenu')).toEqual(['Mod-i'])
    expect(keysFor('toggleFavorite')).toEqual(['Mod-Shift-*'])
  })

  test('Export, Import and Pin to sidebar show their keys; Import follows Export', async () => {
    const user = userEvent.setup()
    const menu = await openMenu(user)
    expect(row(menu, 'Export')).toHaveTextContent('Ctrl E')
    expect(row(menu, 'Import')).toHaveTextContent('Ctrl I')
    expect(row(menu, 'Pin to sidebar')).toHaveTextContent('Ctrl Shift *')
    const n = within(menu).getAllByRole('menuitem').map((i) => i.textContent ?? '')
    expect(n.findIndex((x) => x.startsWith('Import'))).toBe(n.findIndex((x) => x.startsWith('Export')) + 1)
    expect(n.some((x) => x.startsWith('Share'))).toBe(false)
  })

  test('Import opens the type\'s import dialog', async () => {
    const user = userEvent.setup()
    const menu = await openMenu(user)
    await user.click(row(menu, 'Import'))
    expect(await screen.findByText(IMPORT_CSV_TEXT.heading)).toBeInTheDocument()
  })

  test('Copy > Copy reference and Copy as Markdown', async () => {
    const user = userEvent.setup()
    // user-event installs its own clipboard on setup: put the spy back.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    let menu = await openMenu(user)
    const n = within(menu).getAllByRole('menuitem').map((i) => i.textContent ?? '')
    expect(n.indexOf('Copy')).toBe(n.indexOf('Text stats') + 1)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy reference' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('[[Notes]]'))
    await waitFor(() => expect(document.querySelector('[data-editor-toasts]')?.textContent).toContain('Link copied'))
    await user.click(screen.getByRole('button', { name: 'More' }))
    menu = await screen.findByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy as Markdown' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Body text.')))
  }, 20000)

  test('Ctrl+E opens Export and Ctrl+Shift+* pins, outside the editor', async () => {
    render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Head')
    mocked.patchUi.mockResolvedValue({ ui: { pinned: [{ kind: 'object', id: 'N1' }], sections: [], allNotesLayout: 'list' }, revision: 'u1' })
    fireEvent.keyDown(document.body, { key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(mocked.patchUi).toHaveBeenCalledWith({ pinned: [{ kind: 'object', id: 'N1' }] }, expect.anything()))
    fireEvent.keyDown(document.body, { key: 'e', code: 'KeyE', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: EXPORT_TEXT.heading })).toBeInTheDocument()
  })

  test('Ctrl+E, Ctrl+I and Ctrl+Shift+* leave a page with a dialog or the collection peek open over it alone', async () => {
    render(<ObjectView path={PATH} mode="page" />)
    await screen.findByText('Head')
    // A dialog (Settings, say) with focus on its button.
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    dialog.appendChild(button)
    document.body.appendChild(dialog)
    button.focus()
    expect(fireEvent.keyDown(button, { key: 'e', code: 'KeyE', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(button, { key: 'i', code: 'KeyI', ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(button, { key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true })).toBe(true)
    dialog.remove()
    // The collection peek, focus on the body.
    useCollectionPeek.getState().peek('col-1')
    expect(fireEvent.keyDown(document.body, { key: 'e', code: 'KeyE', ctrlKey: true })).toBe(true)
    useCollectionPeek.getState().close()
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('dialog', { name: EXPORT_TEXT.heading })).toBeNull()
    expect(mocked.patchUi).not.toHaveBeenCalled()
  })

  test('an object in the side panel (mode page too) does not open Export for the main page: the main page does', async () => {
    render(
      <>
        <div data-sidepanel-entry="e1" data-testid="side">
          <ObjectView path={PATH} mode="page" />
        </div>
        <div data-testid="main">
          <ObjectView path={PATH} mode="page" />
        </div>
      </>,
    )
    await waitFor(() => expect(screen.getAllByText('Head')).toHaveLength(2))
    fireEvent.keyDown(document.body, { key: 'e', code: 'KeyE', ctrlKey: true })
    const exportDialogs = await screen.findAllByRole('dialog', { name: EXPORT_TEXT.heading })
    expect(exportDialogs).toHaveLength(1)
  })
})
