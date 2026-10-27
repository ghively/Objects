import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import type { SpaceInfo } from '@/api/types'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { SpaceSettingsSection, iconToSpaceIcon, spaceIconToIcon } from './SpaceSettings'

const mocked = vi.mocked(api)
const SPACE: SpaceInfo = { name: 'Lab', root: '/spaces/Lab', types: [], icon: null, description: null, hideTaskManagement: false, revision: 's1' }

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  mocked.space.mockResolvedValue(SPACE)
  mocked.patchSpace.mockImplementation(async (patch) => ({ ...SPACE, ...patch, revision: 's2' }))
})

describe('SpaceSettingsSection', () => {
  test('test space settings patch space.json and refresh the space name', async () => {
    const user = userEvent.setup()
    render(<SpaceSettingsSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Space Settings' })).toBeInTheDocument()
    const name = screen.getByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(name).toHaveValue('Lab'))
    expect(name).toHaveAttribute('placeholder', 'What you want to call this space')
    expect(screen.getByText('Set or update the name for this space.')).toBeInTheDocument()

    await user.clear(name)
    await user.type(name, 'Home lab{Enter}')
    await waitFor(() => expect(mocked.patchSpace).toHaveBeenCalledWith({ name: 'Home lab' }, { baseRevision: 's1' }))
    await waitFor(() => expect(useSpaceInfo.getState().space).toMatchObject({ name: 'Home lab', revision: 's2' }))
    expect(document.title).toBe('Home lab · Object')

    // An empty name is never sent; the field goes back to the stored name.
    await user.clear(name)
    await user.tab()
    expect(name).toHaveValue('Home lab')
    expect(mocked.patchSpace).toHaveBeenCalledTimes(1)

    const description = screen.getByRole('textbox', { name: 'Description' })
    expect(description).toHaveAttribute('placeholder', 'Your description')
    await user.type(description, 'Rack notes')
    await user.tab()
    await waitFor(() => expect(mocked.patchSpace).toHaveBeenLastCalledWith({ description: 'Rack notes' }, { baseRevision: 's2' }))
  })

  test('test a stale space.json revision reloads and re-applies once', async () => {
    const user = userEvent.setup()
    mocked.space.mockResolvedValueOnce(SPACE).mockResolvedValueOnce({ ...SPACE, description: 'Theirs', revision: 's9' })
    mocked.patchSpace.mockRejectedValueOnce(new ConflictError('s9'))
    render(<SpaceSettingsSection />)
    const name = screen.getByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(name).toHaveValue('Lab'))
    await user.clear(name)
    await user.type(name, 'Mine{Enter}')
    await waitFor(() => expect(mocked.patchSpace).toHaveBeenLastCalledWith({ name: 'Mine' }, { baseRevision: 's9' }))
    expect(mocked.patchSpace).toHaveBeenCalledTimes(2)
  })

  test('test space icon strings map to icons and back', () => {
    expect(spaceIconToIcon('ph-planet')).toEqual({ type: 'iconify', val: 'ph-planet' })
    expect(spaceIconToIcon('🚀')).toEqual({ type: 'emoji', val: '🚀' })
    expect(spaceIconToIcon(null)).toBeNull()
    expect(iconToSpaceIcon({ type: 'iconify', val: 'ph-star', color: 'blue' })).toBe('ph-star')
    expect(iconToSpaceIcon(null)).toBeNull()
  })
})
