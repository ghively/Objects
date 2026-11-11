// M31 item 1: the "Full Export" section (catalog section 1, General): "Automated Full Exports"
// and "Manual Full Export" with Spaces (This space | All Spaces), Include media, Links as
// wikilinks, Add the title as a top heading, the folder, "Export" and "Export All Spaces".
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

vi.mock('@/api/fullExportApi', () => ({
  fullExportApi: { start: vi.fn(), job: vi.fn(), status: vi.fn() },
}))

import { api, ApiError } from '@/api/client'
import { fullExportApi, type FullExportJob, type FullExportStatus } from '@/api/fullExportApi'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { FULL_EXPORT_TEXT, FullExportSection, JOB_POLL_MS } from './FullExport'

const mocked = vi.mocked(api)
const fx = vi.mocked(fullExportApi)

function status(auto: Partial<FullExportStatus['auto']> = {}): FullExportStatus {
  return {
    running: null,
    auto: {
      enabled: false,
      scope: 'current',
      folder: null,
      interval: 'daily',
      lastRun: null,
      lastFolder: null,
      lastError: null,
      nextRun: null,
      blocked: null,
      running: false,
      ...auto,
    },
  }
}

function job(partial: Partial<FullExportJob> = {}): FullExportJob {
  return { id: 'j1', state: 'running', scope: 'current', done: 0, total: 0, result: null, error: null, ...partial }
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettings.setState({ settings: { ...settingsDefaults, fullExportFolder: '/exports' }, revision: 'r0', loaded: true })
  mocked.patchSettings.mockImplementation(async (patch) => ({ settings: { ...useSettings.getState().settings, ...patch }, revision: 'r1' }))
  fx.status.mockResolvedValue(status())
})

describe('FullExportSection', () => {
  test('test strings and controls', async () => {
    render(<FullExportSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'Full Export' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Automated Full Exports' })).not.toBeChecked()
    expect(screen.getByRole('heading', { name: 'Manual Full Export' })).toBeInTheDocument()
    const spaces = screen.getByRole('radiogroup', { name: 'Spaces' })
    expect(within(spaces).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['This space', 'All Spaces'])
    expect(within(spaces).getByRole('radio', { name: 'This space' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Include media' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Links as wikilinks' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Add the title as a top heading' })).not.toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Folder' })).toHaveValue('/exports')
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Export All Spaces' })).toBeEnabled()
    expect(FULL_EXPORT_TEXT.wikilinksHelp).toBe('Writes links as [[title]] rather than [title](path).')
    await waitFor(() => expect(fx.status).toHaveBeenCalled())
  })

  test('test the options and the scope save their settings', async () => {
    const user = userEvent.setup()
    render(<FullExportSection />)
    await user.click(screen.getByRole('switch', { name: 'Links as wikilinks' }))
    await waitFor(() => expect(mocked.patchSettings).toHaveBeenCalledWith({ fullExportWikilinks: true }, { baseRevision: 'r0' }))
    await user.click(screen.getByRole('switch', { name: 'Include media' }))
    await user.click(screen.getByRole('switch', { name: 'Add the title as a top heading' }))
    await user.click(screen.getByRole('radio', { name: 'All Spaces' }))
    await waitFor(() => expect(useSettings.getState().settings.fullExportScope).toBe('all'))
    const s = useSettings.getState().settings
    expect([s.fullExportWikilinks, s.fullExportMedia, s.fullExportTitleHeading]).toEqual([true, false, true])
    const folder = screen.getByRole('textbox', { name: 'Folder' })
    await user.clear(folder)
    await user.type(folder, '/elsewhere{Enter}')
    await waitFor(() => expect(useSettings.getState().settings.fullExportFolder).toBe('/elsewhere'))
    await user.clear(folder)
    await user.tab()
    await waitFor(() => expect(useSettings.getState().settings.fullExportFolder).toBeNull())
  })

  test('test a refused folder shows why', async () => {
    const user = userEvent.setup()
    mocked.patchSettings.mockRejectedValue(new ApiError(422, 'Pick a folder (a full path).'))
    render(<FullExportSection />)
    const folder = screen.getByRole('textbox', { name: 'Folder' })
    await user.clear(folder)
    await user.type(folder, 'relative{Enter}')
    expect(await screen.findByText('Pick a folder (a full path).')).toBeInTheDocument()
    expect(folder).toHaveValue('relative')
  })

  test('test Export runs this space with the options, shows progress and where it wrote', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      fx.start.mockResolvedValue(job())
      fx.job
        .mockResolvedValueOnce(job({ done: 2, total: 5 }))
        .mockResolvedValueOnce(
          job({
            state: 'done',
            done: 5,
            total: 5,
            result: { folder: '/exports/Object export Lab 2026-11-10 1430', spaces: [{ name: 'Lab', folder: 'Lab', objects: 4, media: 1 }], objects: 4, media: 1 },
          }),
        )
      render(<FullExportSection />)
      await user.click(screen.getByRole('button', { name: 'Export' }))
      expect(fx.start).toHaveBeenCalledWith({ scope: 'current', folder: '/exports', media: true, wikilinks: false, titleHeading: false })
      expect(await screen.findByText('Exporting… 2 of 5 files')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
      await act(async () => {
        vi.advanceTimersByTime(JOB_POLL_MS + 10)
      })
      expect(await screen.findByText('/exports/Object export Lab 2026-11-10 1430')).toBeInTheDocument()
      expect(screen.getByText(/Exported 4 notes and 1 media file to/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })

  test('test Export All Spaces exports every space', async () => {
    const user = userEvent.setup()
    fx.start.mockResolvedValue(job({ scope: 'all' }))
    fx.job.mockResolvedValue(job({ scope: 'all', state: 'failed', error: 'The export could not be written: No space left on device' }))
    render(<FullExportSection />)
    await user.click(screen.getByRole('button', { name: 'Export All Spaces' }))
    expect(fx.start).toHaveBeenCalledWith(expect.objectContaining({ scope: 'all' }))
    expect(await screen.findByText('The export could not be written: No space left on device')).toBeInTheDocument()
  })

  test('test a refused start shows the server words', async () => {
    const user = userEvent.setup()
    fx.start.mockRejectedValue(new ApiError(422, 'Pick a folder outside your spaces: an export never writes inside a space.'))
    render(<FullExportSection />)
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(await screen.findByText('Pick a folder outside your spaces: an export never writes inside a space.')).toBeInTheDocument()
  })

  test('test Automated Full Exports: switch, interval, last run and why it is skipped', async () => {
    const user = userEvent.setup()
    render(<FullExportSection />)
    expect(screen.queryByRole('radiogroup', { name: 'How often' })).toBeNull()
    fx.status.mockResolvedValue(status({ enabled: true, blocked: 'The folder /exports isn\'t there.' }))
    await user.click(screen.getByRole('switch', { name: 'Automated Full Exports' }))
    await waitFor(() => expect(mocked.patchSettings).toHaveBeenCalledWith({ fullExportAuto: true }, { baseRevision: 'r0' }))
    const often = await screen.findByRole('radiogroup', { name: 'How often' })
    expect(within(often).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Daily', 'Weekly'])
    expect(await screen.findByText("The folder /exports isn't there.")).toBeInTheDocument()
    expect(screen.getByText('Not yet')).toBeInTheDocument()

    fx.status.mockResolvedValue(
      status({ enabled: true, lastRun: '2026-11-10T09:05:00Z', lastFolder: '/exports/Object export Lab 2026-11-10 0905', nextRun: '2026-11-17T09:05:00Z', interval: 'weekly' }),
    )
    await user.click(within(often).getByRole('radio', { name: 'Weekly' }))
    await waitFor(() => expect(useSettings.getState().settings.fullExportInterval).toBe('weekly'))
    expect(await screen.findByText('/exports/Object export Lab 2026-11-10 0905')).toBeInTheDocument()
    expect(screen.getByText('Next export')).toBeInTheDocument()
    expect(screen.queryByText("The folder /exports isn't there.")).toBeNull()
  })
})
