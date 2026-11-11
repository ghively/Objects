import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))
vi.mock('./switchSpace', async (orig) => ({
  ...(await orig()),
  switchSpace: vi.fn(async () => true),
}))

import { api, ApiError } from '@/api/client'
import { resetImportDialog, useImportDialog } from '@/import/useImportDialog'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { CREATE_SPACE_TEXT, CreateSpaceDialog, NEW_SPACE_SETUP, parentFolder, SETUPS, useCreateSpaceDialog } from './CreateSpaceDialog'
import { switchSpace } from './switchSpace'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  useCreateSpaceDialog.setState({ isOpen: false })
  resetImportDialog()
  mocked.space.mockResolvedValue({
    name: 'Work',
    root: '/home/gene/Spaces/Work',
    types: [],
    icon: null,
    description: null,
    hideTaskManagement: false,
    revision: '',
  })
})

async function openDialog() {
  const user = userEvent.setup()
  render(<CreateSpaceDialog />)
  act(() => useCreateSpaceDialog.getState().open())
  await screen.findByRole('dialog', { name: 'Create new space' })
  return user
}

describe('CreateSpaceDialog', () => {
  test('test create dialog validates, creates and offers to switch; 409 message', async () => {
    const user = await openDialog()
    expect(screen.getByText('Name your space')).toBeInTheDocument()
    expect(screen.getByText('Do I need a new space?')).toBeInTheDocument()
    expect(screen.getByText(CREATE_SPACE_TEXT.explainText)).toBeInTheDocument()
    const name = screen.getByPlaceholderText('Name')
    const location = screen.getByRole('textbox', { name: 'Location' })
    // The location defaults to the folder that holds the current space.
    await waitFor(() => expect(location).toHaveValue('/home/gene/Spaces'))

    const create = screen.getByRole('button', { name: 'Create space' })
    expect(create).toBeDisabled()
    await user.type(name, '   ')
    expect(create).toBeDisabled()

    // An existing folder: the server's 409 becomes our message, and nothing is switched.
    mocked.createSpace.mockRejectedValueOnce(new ApiError(409, 'exists'))
    await user.clear(name)
    await user.type(name, 'Research')
    expect(create).toBeEnabled()
    await user.click(create)
    expect(await screen.findByRole('alert')).toHaveTextContent('A folder with that name already exists here.')
    expect(mocked.createSpace).toHaveBeenCalledWith('Research', '/home/gene/Spaces', 'blank')

    // A free name: created, then offered a switch.
    await user.clear(name)
    await user.type(name, '  Reading list ')
    await user.click(create)
    await waitFor(() => expect(mocked.createSpace).toHaveBeenLastCalledWith('Reading list', '/home/gene/Spaces', 'blank'))
    expect(await screen.findByText(CREATE_SPACE_TEXT.created)).toBeInTheDocument()
    expect(switchSpace).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Switch space' }))
    expect(switchSpace).toHaveBeenCalledWith('/home/gene/Spaces/Reading list')
    expect(useCreateSpaceDialog.getState().isOpen).toBe(false)

  })

  test('test later closes without switching and cancel creates nothing', async () => {
    const user = await openDialog()
    await user.type(screen.getByPlaceholderText('Name'), 'Side project')
    await user.click(screen.getByRole('button', { name: 'Create space' }))
    await user.click(await screen.findByRole('button', { name: 'Later' }))
    expect(switchSpace).not.toHaveBeenCalled()
    expect(useCreateSpaceDialog.getState().isOpen).toBe(false)

    act(() => useCreateSpaceDialog.getState().open())
    const name = await screen.findByPlaceholderText('Name')
    expect(name).toHaveValue('')
    await user.type(name, 'Nope')
    mocked.createSpace.mockClear()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocked.createSpace).not.toHaveBeenCalled()
    expect(useCreateSpaceDialog.getState().isOpen).toBe(false)
  })

  // M32: a new space just starts. The dialog asks for a name and a folder, nothing else.
  test('test create dialog asks for a name and a folder only and makes the plain start', async () => {
    const user = await openDialog()
    expect(screen.queryByText('Pick a starting point')).toBeNull()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    for (const gone of ['Start with basic setup', 'IT operations', 'Empty space']) expect(screen.queryByText(gone)).toBeNull()
    expect(screen.getAllByRole('textbox').map((t) => t.getAttribute('aria-label') ?? t.closest('label')?.textContent)).toEqual(['Name', 'Location'])
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('/home/gene/Spaces'))
    await user.type(screen.getByPlaceholderText('Name'), 'Journal')
    await user.click(screen.getByRole('button', { name: 'Create space' }))
    await waitFor(() => expect(mocked.createSpace).toHaveBeenCalledWith('Journal', '/home/gene/Spaces', 'blank'))
    expect(NEW_SPACE_SETUP).toBe('blank')
    expect(await screen.findByText(CREATE_SPACE_TEXT.created)).toBeInTheDocument()
    // The starter sets stay in the client for the type gallery.
    expect(SETUPS.map((o) => o.value)).toEqual(['basic', 'itops', 'blank'])
    expect(typeof api.spaceSetup).toBe('function')
  })

  // Fix pass W9.
  test('test after creating the dialog is headed "Space created" and shows the whole path inside the box (W9)', async () => {
    const user = await openDialog()
    const long = '/home/gene/Documents/Spaces/Personal/Archive/2026/A much longer folder name than the dialog is wide/Reading list'
    mocked.createSpace.mockResolvedValueOnce({ path: long })
    await user.type(screen.getByPlaceholderText('Name'), 'Reading list')
    await user.click(screen.getByRole('button', { name: 'Create space' }))
    // The heading says what happened; the form's heading and intro are gone.
    const dialog = await screen.findByRole('dialog', { name: 'Space created' })
    expect(screen.queryByText('Create new space')).toBeNull()
    expect(screen.queryByText('Name your space')).toBeNull()
    expect(dialog).toHaveTextContent('Switch to it now?')
    // The path in full, free to wrap inside the box (not one unbreakable line that pushes the box wider).
    const path = screen.getByText(long)
    expect(path).toHaveAttribute('title', long)
    expect(path).toHaveClass('break-all')
    expect(path).not.toHaveClass('truncate')
    // Its column may shrink to the dialog's width, so the buttons stay inside too.
    expect(path.parentElement).toHaveClass('min-w-0')
    expect(dialog).toContainElement(screen.getByRole('button', { name: 'Later' }))
    expect(dialog).toContainElement(screen.getByRole('button', { name: 'Switch space' }))
  })

  test('test the Location field says the space is made as a new folder inside it (W9)', async () => {
    await openDialog()
    const location = screen.getByRole('textbox', { name: 'Location' })
    const hint = screen.getByText('The space is made as a new folder with its name inside this folder.')
    expect(location).toHaveAccessibleDescription('The space is made as a new folder with its name inside this folder.')
    // Under the field.
    expect(location.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('test a Location that is not there is said plainly, and nothing is offered to switch to (W9)', async () => {
    const user = await openDialog()
    const location = screen.getByRole('textbox', { name: 'Location' })
    await waitFor(() => expect(location).toHaveValue('/home/gene/Spaces'))
    await user.clear(location)
    await user.type(location, '/home/gene/Spaces/Second')
    await user.type(screen.getByPlaceholderText('Name'), 'Second')
    // The server's answer for a location that is no folder (missing, or a file).
    mocked.createSpace.mockRejectedValueOnce(new ApiError(404, '"/home/gene/Spaces/Second" is not a folder.'))
    await user.click(screen.getByRole('button', { name: 'Create space' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The folder "/home/gene/Spaces/Second" does not exist.')
    expect(screen.queryByText(/is not a folder/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Switch space' })).toBeNull()
    // Another 404 of the route keeps the server's own words.
    mocked.createSpace.mockRejectedValueOnce(new ApiError(404, 'Choose a folder for the new space.'))
    await user.click(screen.getByRole('button', { name: 'Create space' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Choose a folder for the new space.'))
  })

  test('test import from closes the dialog and opens the import dialog with the name and location (M15)', async () => {
    const user = await openDialog()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('/home/gene/Spaces'))
    await user.type(screen.getByPlaceholderText('Name'), 'Vault')
    expect(screen.getByText(CREATE_SPACE_TEXT.importDescription)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: CREATE_SPACE_TEXT.importFrom }))
    expect(useCreateSpaceDialog.getState().isOpen).toBe(false)
    expect(useImportDialog.getState()).toMatchObject({ isOpen: true, preset: { name: 'Vault', location: '/home/gene/Spaces' } })
    expect(mocked.createSpace).not.toHaveBeenCalled()
  })

  test('test parent folder of posix and windows roots', () => {
    expect(parentFolder('/home/gene/Spaces/Work')).toBe('/home/gene/Spaces')
    expect(parentFolder('/home/gene/Spaces/Work/')).toBe('/home/gene/Spaces')
    expect(parentFolder('/Work')).toBe('/')
    expect(parentFolder('C:\\Users\\gene\\Work')).toBe('C:\\Users\\gene')
    expect(parentFolder('C:\\Work')).toBe('C:\\')
  })
})
