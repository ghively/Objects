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

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { api, ApiError } from '@/api/client'
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { CREATE_SPACE_TEXT, CreateSpaceDialog, parentFolder, useCreateSpaceDialog } from './CreateSpaceDialog'
import { switchSpace } from './switchSpace'

const mocked = vi.mocked(api)

const STRINGS = readFileSync(
  path.resolve(import.meta.dirname, '../../../reference/app-unpacked/dist/virtual_intlify-i18n-0366822.js'),
  'utf8',
)
const inReference = (text: string) => STRINGS.includes(`s:\`${text}\``)
const OUR = new Set<string>([
  CREATE_SPACE_TEXT.location,
  CREATE_SPACE_TEXT.exists,
  CREATE_SPACE_TEXT.created,
  CREATE_SPACE_TEXT.switchNow,
  CREATE_SPACE_TEXT.later,
])

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  useCreateSpaceDialog.setState({ isOpen: false })
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
    expect(mocked.createSpace).toHaveBeenCalledWith('Research', '/home/gene/Spaces')

    // A free name: created, then offered a switch.
    await user.clear(name)
    await user.type(name, '  Reading list ')
    await user.click(create)
    await waitFor(() => expect(mocked.createSpace).toHaveBeenLastCalledWith('Reading list', '/home/gene/Spaces'))
    expect(await screen.findByText(CREATE_SPACE_TEXT.created)).toBeInTheDocument()
    expect(switchSpace).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Switch space' }))
    expect(switchSpace).toHaveBeenCalledWith('/home/gene/Spaces/Reading list')
    expect(useCreateSpaceDialog.getState().isOpen).toBe(false)

    for (const s of Object.values(CREATE_SPACE_TEXT)) {
      if (!OUR.has(s)) expect(inReference(s), s).toBe(true)
    }
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

  test('test parent folder of posix and windows roots', () => {
    expect(parentFolder('/home/gene/Spaces/Work')).toBe('/home/gene/Spaces')
    expect(parentFolder('/home/gene/Spaces/Work/')).toBe('/home/gene/Spaces')
    expect(parentFolder('/Work')).toBe('/')
    expect(parentFolder('C:\\Users\\gene\\Work')).toBe('C:\\Users\\gene')
    expect(parentFolder('C:\\Work')).toBe('C:\\')
  })
})
