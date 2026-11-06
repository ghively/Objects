// M10: Settings > AI Assistant.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api } from '@/api/client'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { AI_ASSISTANT_TEXT as T, AiAssistantSection } from './AiAssistant'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  useSettings.setState({ settings: settingsDefaults, revision: 'r0', loaded: true })
})

describe('AiAssistantSection', () => {
  test('test hide switch patches aiHidden', async () => {
    const user = userEvent.setup()
    render(<AiAssistantSection />)
    expect(screen.getByRole('heading', { level: 2, name: 'AI Assistant' })).toBeInTheDocument()
    const sw = screen.getByRole('switch', { name: 'Hide AI features' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(sw)
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ aiHidden: true }, expect.anything())
    expect(useSettings.getState().settings.aiHidden).toBe(true)
  })

  test('test path saves on blur, empty is null, and a new path rechecks', async () => {
    const user = userEvent.setup()
    render(<AiAssistantSection />)
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalledTimes(1))
    const path = screen.getByRole('textbox', { name: T.path })
    await user.type(path, '/opt/claude/bin/claude')
    expect(mocked.patchSettings).not.toHaveBeenCalled()
    await user.tab()
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ claudePath: '/opt/claude/bin/claude' }, expect.anything())
    await waitFor(() => expect(mocked.aiStatus).toHaveBeenCalledTimes(2))

    await user.clear(path)
    await user.tab()
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ claudePath: null }, expect.anything())
  })

  test('test the Model picker saves aiModel', async () => {
    const user = userEvent.setup()
    render(<AiAssistantSection />)
    expect(screen.getByText(T.modelHelp)).toBeInTheDocument()
    expect(T.modelHelp).toBe("The default agent's model. Default uses Claude Code's own default.")
    const trigger = screen.getByRole('button', { name: T.model })
    expect(trigger).toHaveTextContent('Default')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Sonnet 5.5' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ aiModel: 'claude-sonnet-5-5' }, expect.anything())
    await waitFor(() => expect(screen.getByRole('button', { name: T.model })).toHaveTextContent('Sonnet 5.5'))
    await user.click(screen.getByRole('button', { name: T.model }))
    await user.click(await screen.findByRole('option', { name: 'Default' }))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ aiModel: null }, expect.anything())
  })

  test('test an aiModel set as text in M10 still shows', async () => {
    useSettings.setState({ settings: { ...settingsDefaults, aiModel: 'my-model' }, revision: 'r0', loaded: true })
    const user = userEvent.setup()
    render(<AiAssistantSection />)
    const trigger = screen.getByRole('button', { name: T.model })
    expect(trigger).toHaveTextContent('my-model')
    await user.click(trigger)
    expect(await screen.findByRole('option', { name: 'my-model' })).toHaveAttribute('aria-selected', 'true')
  })

  test('test status row shows ready, not found, and rechecks', async () => {
    const user = userEvent.setup()
    render(<AiAssistantSection />)
    const status = screen.getByRole('status', { name: T.status })
    await waitFor(() => expect(status).toHaveTextContent('Claude Code 2.0.0 is ready (/usr/bin/claude).'))
    mocked.aiStatus.mockResolvedValueOnce({ available: false, reason: 'notFound', claudePath: null, version: null, message: null })
    await user.click(screen.getByRole('button', { name: T.recheck }))
    await waitFor(() => expect(status).toHaveTextContent(T.notFound))
    expect(status).toHaveTextContent(T.notFoundHelp)
    mocked.aiStatus.mockResolvedValueOnce({ available: false, reason: 'notSignedIn', claudePath: '/c', version: '2', message: 'Run claude and sign in.' })
    await user.click(screen.getByRole('button', { name: T.recheck }))
    await waitFor(() => expect(status).toHaveTextContent('Run claude and sign in.'))
  })
})
