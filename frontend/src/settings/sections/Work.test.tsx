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
import { WORK_AGENT_TEXT } from '@/work/agent/workAgentText'
import { WorkSection, WORK_SEARCH, WORK_TEXT } from './Work'

const mocked = vi.mocked(api)
// M32: the section's controls work only while the Work page is on for the space.
const SPACE: SpaceInfo = { name: 'Lab', root: '/Lab', types: [], icon: null, description: null, hideTaskManagement: false, revision: 's1', jiraSite: null, workEnabled: true, workOn: true }
const OFF: SpaceInfo = { ...SPACE, workEnabled: null, workOn: false }

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  useSpaceInfo.setState({ space: SPACE, loaded: true })
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
  mocked.space.mockResolvedValue(SPACE)
  mocked.patchSpace.mockImplementation(async (patch) => ({
    ...SPACE,
    ...patch,
    ...(typeof patch.workEnabled === 'boolean' ? { workOn: patch.workEnabled } : {}),
    revision: 's2',
  }))
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

describe('WorkSection: the Work switch (M32)', () => {
  const useOff = () => {
    useSpaceInfo.setState({ space: OFF, loaded: true })
    mocked.space.mockResolvedValue(OFF)
  }

  test('test "Use the Work page in this space" is the first row, with its help text, and is searchable', () => {
    render(<WorkSection />)
    const first = screen.getAllByRole('region')[0]
    expect(first).toHaveAttribute('aria-label', 'Use the Work page in this space')
    expect(first).toHaveTextContent(
      'Adds a Work page under Tasks: the Now view, queues, captures, alerts and tickets, and ticket fields on tasks and projects. Off: Tasks is a plain task list.',
    )
    expect(within(first).getByRole('switch', { name: 'Use the Work page in this space' })).toHaveAttribute('aria-checked', 'true')
    expect(WORK_SEARCH).toContain('Use the Work page in this space')
    // On: no note, nothing disabled.
    expect(screen.queryByText(WORK_TEXT.offNote)).toBeNull()
    expect(screen.getByRole('textbox', { name: WORK_TEXT.jiraSite })).toBeEnabled()
  })

  test('test off: the rest of the section stays but every control is disabled, under one line', async () => {
    const user = userEvent.setup()
    useOff()
    render(<WorkSection />)
    expect(screen.getByRole('switch', { name: WORK_TEXT.usePage })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getAllByText('Turn on the Work page to use these.')).toHaveLength(1)
    // Nothing is removed: every group is still there, after the switch.
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(
      expect.arrayContaining([WORK_TEXT.usePage, WORK_TEXT.yourName, WORK_TEXT.jiraSite, WORK_TEXT.alertFolder, WORK_TEXT.alertIntervals, WORK_TEXT.alertType]),
    )
    for (const name of [WORK_TEXT.yourName, WORK_TEXT.jiraSite, WORK_TEXT.alertFolder]) {
      expect(screen.getByRole('textbox', { name })).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: WORK_TEXT.addInterval })).toBeDisabled()
    expect(screen.getByRole('button', { name: WORK_TEXT.addAlertType })).toBeDisabled()
    // The work agent group (its picker, switches and Desk sync) too.
    expect(await screen.findByRole('combobox', { name: WORK_AGENT_TEXT.picker })).toBeDisabled()
    expect(screen.getByRole('switch', { name: WORK_AGENT_TEXT.acts })).toBeDisabled()
    expect(screen.getByRole('switch', { name: WORK_AGENT_TEXT.autoRun })).toBeDisabled()
    // A disabled control saves nothing.
    await user.type(screen.getByRole('textbox', { name: WORK_TEXT.jiraSite }), 'https://example.atlassian.net')
    await user.click(screen.getByRole('switch', { name: WORK_AGENT_TEXT.autoRun }))
    expect(mocked.patchSpace).not.toHaveBeenCalled()
    expect(mocked.saveWorkAgentSettings).not.toHaveBeenCalled()
  })

  test('test the switch saves workEnabled to the space and the controls follow it', async () => {
    const user = userEvent.setup()
    useOff()
    render(<WorkSection />)
    await user.click(screen.getByRole('switch', { name: WORK_TEXT.usePage }))
    await waitFor(() => expect(mocked.patchSpace).toHaveBeenCalledWith({ workEnabled: true }, { baseRevision: 's1' }))
    await waitFor(() => expect(useSpaceInfo.getState().space?.workOn).toBe(true))
    expect(screen.getByRole('switch', { name: WORK_TEXT.usePage })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText(WORK_TEXT.offNote)).toBeNull()
    expect(screen.getByRole('textbox', { name: WORK_TEXT.jiraSite })).toBeEnabled()

    // And off again.
    await user.click(screen.getByRole('switch', { name: WORK_TEXT.usePage }))
    await waitFor(() => expect(mocked.patchSpace).toHaveBeenLastCalledWith({ workEnabled: false }, { baseRevision: 's2' }))
    expect(screen.getByText(WORK_TEXT.offNote)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: WORK_TEXT.jiraSite })).toBeDisabled()
  })

  test("test a refused switch shows the server's message and the stored value again", async () => {
    const user = userEvent.setup()
    useOff()
    mocked.patchSpace.mockRejectedValueOnce(new ApiError(423, 'This space is read-only.'))
    render(<WorkSection />)
    await user.click(screen.getByRole('switch', { name: WORK_TEXT.usePage }))
    const row = screen.getByRole('region', { name: WORK_TEXT.usePage })
    expect(await within(row).findByRole('alert')).toHaveTextContent('This space is read-only.')
    await waitFor(() => expect(screen.getByRole('switch', { name: WORK_TEXT.usePage })).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByText(WORK_TEXT.offNote)).toBeInTheDocument()
  })
})
