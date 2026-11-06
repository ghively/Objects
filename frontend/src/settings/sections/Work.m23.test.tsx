// M23 Task 17: Settings > Work's alert rows (Alert folder, Alert intervals, Add the Alert type).
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
import { resetSpaceInfo } from '@/settings/useSpaceInfo'
import { typeDef, workAlerts } from '@/test/mockApi'
import { WORK_SEARCH, WORK_TEXT, WorkSection } from './Work'

const mocked = vi.mocked(api)
const SPACE: SpaceInfo = { name: 'Lab', root: '/Lab', types: [], icon: null, description: null, hideTaskManagement: false, revision: 's1', jiraSite: null }
const FOLDER = 'C:\\Monitoring\\copy'

beforeEach(() => {
  vi.clearAllMocks()
  resetSpaceInfo()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
  mocked.space.mockResolvedValue(SPACE)
  mocked.settings.mockResolvedValue({ settings: settingsDefaults, revision: 'r0' })
  mocked.patchSettings.mockImplementation(async (patch) => ({ settings: { ...settingsDefaults, ...patch }, revision: 'r1' }))
  mocked.workAlerts.mockResolvedValue(workAlerts())
  mocked.ensureAlertType.mockResolvedValue({ type: typeDef({ id: 'alert', name: 'Alert', pluralName: 'Alerts' }), created: true })
})

describe('WorkSection alert rows', () => {
  test('test the alert rows come after Your name in Activity and Jira site, and are searchable', () => {
    render(<WorkSection />)
    const groups = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
    expect(groups).toEqual([WORK_TEXT.yourName, WORK_TEXT.jiraSite, WORK_TEXT.alertFolder, WORK_TEXT.alertIntervals, WORK_TEXT.alertType])
    expect(WORK_SEARCH).toEqual(expect.arrayContaining([WORK_TEXT.alertFolder, WORK_TEXT.alertIntervals, WORK_TEXT.addAlertType]))
  })

  test("test the alert folder saves workAlertFolder and a 422 shows the server's message", async () => {
    const user = userEvent.setup()
    mocked.patchSettings.mockRejectedValueOnce(new ApiError(422, 'Pick a folder (a full path).'))
    render(<WorkSection />)
    const folder = screen.getByRole('textbox', { name: WORK_TEXT.alertFolder })
    expect(folder).toHaveValue('')
    await user.type(folder, 'relative{Enter}')
    await waitFor(() => expect(mocked.patchSettings).toHaveBeenCalledWith({ workAlertFolder: 'relative' }, { baseRevision: 'r0' }))
    const group = screen.getByRole('region', { name: WORK_TEXT.alertFolder })
    expect(await within(group).findByRole('alert')).toHaveTextContent('Pick a folder (a full path).')
    // What was typed stays, so it can be fixed.
    expect(folder).toHaveValue('relative')

    await user.clear(folder)
    await user.type(folder, `  ${FOLDER}  `)
    await user.tab()
    await waitFor(() => expect(mocked.patchSettings).toHaveBeenLastCalledWith({ workAlertFolder: FOLDER }, { baseRevision: 'r0' }))
    await waitFor(() => expect(useSettings.getState().settings.workAlertFolder).toBe(FOLDER))
    expect(within(group).queryByRole('alert')).toBeNull()

    // Emptied: off (null).
    await user.clear(folder)
    await user.tab()
    await waitFor(() => expect(mocked.patchSettings).toHaveBeenLastCalledWith({ workAlertFolder: null }, { baseRevision: 'r1' }))
  })

  test('test an interval row saves {"printer-watch": 15}', async () => {
    const user = userEvent.setup()
    render(<WorkSection />)
    const group = screen.getByRole('region', { name: WORK_TEXT.alertIntervals })
    await user.click(within(group).getByRole('button', { name: WORK_TEXT.addInterval }))
    await user.type(within(group).getByRole('textbox', { name: WORK_TEXT.intervalSource }), 'printer-watch')
    // A row without minutes saves nothing yet.
    await user.tab()
    expect(mocked.patchSettings).not.toHaveBeenCalled()
    const minutes = within(group).getByRole('spinbutton', { name: WORK_TEXT.intervalMinutes })
    await user.clear(minutes)
    await user.type(minutes, '15')
    await user.tab()
    await waitFor(() =>
      expect(mocked.patchSettings).toHaveBeenCalledWith({ workAlertIntervals: { 'printer-watch': 15 } }, { baseRevision: 'r0' }),
    )
    await waitFor(() => expect(useSettings.getState().settings.workAlertIntervals).toEqual({ 'printer-watch': 15 }))

    // Removing the row saves the empty map.
    await user.click(within(group).getByRole('button', { name: `${WORK_TEXT.removeInterval} printer-watch` }))
    await waitFor(() => expect(mocked.patchSettings).toHaveBeenLastCalledWith({ workAlertIntervals: {} }, { baseRevision: 'r1' }))
  })

  test('test stored intervals show as rows, and a 422 shows the message', async () => {
    const user = userEvent.setup()
    useSettings.setState({ settings: { ...settingsDefaults, workAlertIntervals: { 'backup-check': 60 } }, revision: 'r0', loaded: true })
    mocked.patchSettings.mockRejectedValueOnce(new ApiError(422, 'Intervals are whole minutes from 1 to 10080.'))
    render(<WorkSection />)
    const group = screen.getByRole('region', { name: WORK_TEXT.alertIntervals })
    expect(within(group).getByRole('textbox', { name: WORK_TEXT.intervalSource })).toHaveValue('backup-check')
    const minutes = within(group).getByRole('spinbutton', { name: WORK_TEXT.intervalMinutes })
    expect(minutes).toHaveValue(60)
    await user.clear(minutes)
    await user.type(minutes, '99999')
    await user.tab()
    await waitFor(() =>
      expect(mocked.patchSettings).toHaveBeenCalledWith({ workAlertIntervals: { 'backup-check': 99999 } }, { baseRevision: 'r0' }),
    )
    expect(await within(group).findByRole('alert')).toHaveTextContent('Intervals are whole minutes from 1 to 10080.')
  })

  test('test Add the Alert type calls ensureAlertType and then shows The Alert type exists.', async () => {
    const user = userEvent.setup()
    render(<WorkSection />)
    const group = screen.getByRole('region', { name: WORK_TEXT.alertType })
    await waitFor(() => expect(mocked.workAlerts).toHaveBeenCalled())
    const add = within(group).getByRole('button', { name: WORK_TEXT.addAlertType })
    await waitFor(() => expect(add).toBeEnabled())
    await user.click(add)
    expect(mocked.ensureAlertType).toHaveBeenCalledTimes(1)
    expect(await within(group).findByText(WORK_TEXT.alertTypeExists)).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: WORK_TEXT.addAlertType })).toBeDisabled()
  })

  test('test an existing Alert type disables the button from the start', async () => {
    mocked.workAlerts.mockResolvedValue(workAlerts({ typeExists: true }))
    render(<WorkSection />)
    const group = screen.getByRole('region', { name: WORK_TEXT.alertType })
    expect(await within(group).findByText(WORK_TEXT.alertTypeExists)).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: WORK_TEXT.addAlertType })).toBeDisabled()
  })
})
