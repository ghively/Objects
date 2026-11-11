import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { clearSaveState, setSaveState, useSaveState } from './saveStateStore'

describe('saveStateStore (M32 contract)', () => {
  it("reads 'saved' until an editor publishes a state, and follows it", () => {
    const { result } = renderHook(() => useSaveState('Notes/a.md'))
    expect(result.current).toBe('saved')
    act(() => setSaveState('Notes/a.md', 'unsaved'))
    expect(result.current).toBe('unsaved')
    act(() => setSaveState('Notes/a.md', 'saving'))
    expect(result.current).toBe('saving')
    act(() => clearSaveState('Notes/a.md'))
    expect(result.current).toBe('saved')
  })
})
