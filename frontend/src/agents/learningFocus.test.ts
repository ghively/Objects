import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { useFocusedEntries, useLearningFocus } from './learningFocus'

describe('learningFocus', () => {
  beforeEach(() => useLearningFocus.getState().clear())

  test('test set and clear the focused entries of one agent', () => {
    const { result } = renderHook(() => useFocusedEntries('assistant'))
    expect(result.current).toEqual([])
    act(() => useLearningFocus.getState().set('assistant', ['01JA', '01JB']))
    expect(useLearningFocus.getState()).toMatchObject({ agentId: 'assistant', entryIds: ['01JA', '01JB'] })
    expect(result.current).toEqual(['01JA', '01JB'])
    act(() => useLearningFocus.getState().set('other', ['01JC']))
    expect(result.current).toEqual([])
    act(() => useLearningFocus.getState().clear())
    expect(useLearningFocus.getState()).toMatchObject({ agentId: null, entryIds: [] })
  })
})
