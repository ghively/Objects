import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { RevisionConflictError } from '@/api/client'
import { mockWhiteboardApi } from './test/mockWhiteboardApi'
import { useWhiteboardSettings } from './useWhiteboardSettings'

describe('useWhiteboardSettings', () => {
  test('settings toggle writes ui once; defaults when absent', async () => {
    const client = mockWhiteboardApi()
    const { result } = renderHook(() => useWhiteboardSettings(client))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.settings).toEqual({
      isSnappingToGrid: true,
      isSnappingToNodes: true,
      isShowingDots: true,
      isZoomingOnScroll: true,
      isEngineeringMode: false,
    })
    expect(client.saveSettings).not.toHaveBeenCalled()
    await act(async () => result.current.set('isEngineeringMode', true))
    expect(client.saveSettings).toHaveBeenCalledTimes(1)
    expect(client.saveSettings).toHaveBeenCalledWith({ isEngineeringMode: true }, 'ui-1')
    expect(result.current.settings.isEngineeringMode).toBe(true)
  })

  test('stored settings override the defaults', async () => {
    const client = mockWhiteboardApi()
    client.settings.mockResolvedValue({ settings: { isShowingDots: false }, revision: 'ui-9' })
    const { result } = renderHook(() => useWhiteboardSettings(client))
    await waitFor(() => expect(result.current.settings.isShowingDots).toBe(false))
    expect(result.current.settings.isSnappingToGrid).toBe(true)
  })

  test('409 refetches and re-applies the toggle once', async () => {
    const client = mockWhiteboardApi()
    const { result } = renderHook(() => useWhiteboardSettings(client))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    client.saveSettings.mockRejectedValueOnce(new RevisionConflictError('ui-5'))
    client.settings.mockResolvedValueOnce({ settings: { isShowingDots: false }, revision: 'ui-5' })
    await act(async () => result.current.set('isSnappingToGrid', false))
    expect(client.saveSettings).toHaveBeenCalledTimes(2)
    expect(client.saveSettings).toHaveBeenLastCalledWith({ isShowingDots: false, isSnappingToGrid: false }, 'ui-5')
    expect(result.current.settings.isShowingDots).toBe(false)
    expect(result.current.settings.isSnappingToGrid).toBe(false)
  })
})
