import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

import { api, ConflictError } from '@/api/client'
import { deviceSettings } from '@/test/mockApi'
import { settingsDefaults, useSettings } from './useSettings'

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  useSettings.setState({ settings: settingsDefaults, revision: '', loaded: false })
})

describe('useSettings', () => {
  test('test settings store loads defaults, patches optimistically and reapplies once on 409', async () => {
    // Defaults before load.
    expect(useSettings.getState().settings).toEqual(settingsDefaults)
    expect(settingsDefaults.themeMode).toBe('dark')
    expect(useSettings.getState().loaded).toBe(false)

    mocked.settings.mockResolvedValueOnce({ settings: deviceSettings({ font: 'serif' }), revision: 'r1' })
    await useSettings.getState().load()
    expect(useSettings.getState()).toMatchObject({ revision: 'r1', loaded: true })
    expect(useSettings.getState().settings.font).toBe('serif')

    // Optimistic: applied before the save resolves.
    let release!: () => void
    mocked.patchSettings.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({ settings: deviceSettings({ font: 'serif', themeMode: 'light' }), revision: 'r2' }))),
    )
    const p = useSettings.getState().patch({ themeMode: 'light' })
    expect(useSettings.getState().settings.themeMode).toBe('light')
    await vi.waitFor(() => expect(mocked.patchSettings).toHaveBeenCalledTimes(1))
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ themeMode: 'light' }, { baseRevision: 'r1' })
    release()
    await p
    expect(useSettings.getState().revision).toBe('r2')

    // 409: reload, re-apply the same patch on the fresh settings, send once more.
    mocked.patchSettings.mockRejectedValueOnce(new ConflictError('r5'))
    mocked.settings.mockResolvedValueOnce({ settings: deviceSettings({ font: 'monospace', themeMode: 'light' }), revision: 'r5' })
    mocked.patchSettings.mockResolvedValueOnce({ settings: deviceSettings(), revision: 'r6' })
    await useSettings.getState().patch({ twentyFourHourTime: true })
    expect(mocked.patchSettings).toHaveBeenCalledTimes(3)
    expect(mocked.patchSettings).toHaveBeenLastCalledWith({ twentyFourHourTime: true }, { baseRevision: 'r5' })
    const s = useSettings.getState()
    expect(s.revision).toBe('r6')
    expect(s.settings).toMatchObject({ font: 'monospace', themeMode: 'light', twentyFourHourTime: true })

    // A second 409 is not retried again.
    mocked.patchSettings.mockRejectedValueOnce(new ConflictError('r7'))
    mocked.settings.mockResolvedValueOnce({ settings: deviceSettings(), revision: 'r7' })
    mocked.patchSettings.mockRejectedValueOnce(new ConflictError('r8'))
    await expect(useSettings.getState().patch({ font: 'serif' })).rejects.toBeInstanceOf(ConflictError)
    expect(mocked.patchSettings).toHaveBeenCalledTimes(5)
  })

  test('patches are sent in order, each with the revision the previous one returned', async () => {
    useSettings.setState({ revision: 'a', loaded: true })
    mocked.patchSettings
      .mockResolvedValueOnce({ settings: deviceSettings(), revision: 'b' })
      .mockResolvedValueOnce({ settings: deviceSettings(), revision: 'c' })
    await Promise.all([useSettings.getState().patch({ font: 'serif' }), useSettings.getState().patch({ hideOutlinerLines: true })])
    expect(mocked.patchSettings.mock.calls.map((c) => c[1])).toEqual([{ baseRevision: 'a' }, { baseRevision: 'b' }])
    expect(useSettings.getState().revision).toBe('c')
    expect(useSettings.getState().settings).toMatchObject({ font: 'serif', hideOutlinerLines: true })
  })
})
