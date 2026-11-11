import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ApiError } from '@/api/client'
import type { SpaceInfo } from '@/api/types'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { WorkSection, WORK_TEXT } from './Work'

const mocked = vi.mocked(api)
const SPACE: SpaceInfo = { name: 'Lab', root: '/Lab', types: [], icon: null, description: null, hideTaskManagement: false, revision: 's1', jiraSite: null }

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
  mocked.space.mockResolvedValue(SPACE)
  mocked.patchSpace.mockImplementation(async (patch) => ({ ...SPACE, ...patch, revision: 's2' }))
  mocked.settings.mockResolvedValue({ settings: settingsDefaults, revision: 'r0' })
  mocked.patchSettings.mockImplementation(async (patch) => ({ settings: { ...settingsDefaults, ...patch }, revision: 'r1' }))
})

describe('WorkSection', () => {
  test('Your name in Activity saves activityName', async () => {
    const user = userEvent.setup()
    render(<WorkSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Work' })).toBeInTheDocument()
    const name = screen.getByRole('textbox', { name: WORK_TEXT.yourName })
    expect(name).toHaveValue('') // M32: no name is built in
    await user.type(name, 'Pat{Enter}')
    await waitFor(() => expect(mocked.patchSettings).toHaveBeenCalledWith({ activityName: 'Pat' }, { baseRevision: 'r0' }))
    expect(useSettings.getState().settings.activityName).toBe('Pat')
  })

  test('Jira site saves jiraSite to the space', async () => {
    const user = userEvent.setup()
    render(<WorkSection />)
    const site = screen.getByRole('textbox', { name: WORK_TEXT.jiraSite })
    await waitFor(() => expect(site).toBeEnabled())
    expect(site).toHaveAttribute('placeholder', 'https://example.atlassian.net')
    await user.type(site, 'https://example.atlassian.net')
    await user.tab()
    await waitFor(() =>
      expect(mocked.patchSpace).toHaveBeenCalledWith({ jiraSite: 'https://example.atlassian.net' }, { baseRevision: 's1' }),
    )
    await waitFor(() => expect(useSpaceInfo.getState().space?.jiraSite).toBe('https://example.atlassian.net'))

    // Emptied: saved as null.
    await user.clear(site)
    await user.tab()
    await waitFor(() => expect(mocked.patchSpace).toHaveBeenLastCalledWith({ jiraSite: null }, { baseRevision: 's2' }))
  })

  test("a 422 shows the server's message under the field", async () => {
    const user = userEvent.setup()
    mocked.patchSpace.mockRejectedValueOnce(new ApiError(422, 'The Jira site is a web address (https://…).'))
    mocked.patchSettings.mockRejectedValueOnce(new ApiError(422, 'Your name is one line of 1 to 60 characters.'))
    render(<WorkSection />)
    const site = screen.getByRole('textbox', { name: WORK_TEXT.jiraSite })
    await waitFor(() => expect(site).toBeEnabled())
    await user.type(site, 'ftp://x')
    await user.tab()
    const siteGroup = screen.getByRole('region', { name: WORK_TEXT.jiraSite })
    expect(await within(siteGroup).findByRole('alert')).toHaveTextContent('The Jira site is a web address (https://…).')

    const name = screen.getByRole('textbox', { name: WORK_TEXT.yourName })
    await user.clear(name)
    await user.type(name, 'X{Enter}')
    const nameGroup = screen.getByRole('region', { name: WORK_TEXT.yourName })
    expect(await within(nameGroup).findByRole('alert')).toHaveTextContent('Your name is one line of 1 to 60 characters.')
  })
})
