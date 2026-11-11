// M32: "Hide Tasks in this space". The quiet line a Tasks or Work target shows while the space
// hides Tasks, and the two ways the rest of the app reads the switch.
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { resetSpaceInfo, useSpaceInfo } from '@/settings/useSpaceInfo'
import { resetSettingsModal, useSettingsModal } from '@/settings/useSettingsModal'
import { TASKS_HIDDEN_TEXT, TasksHidden } from './TasksHidden'
import { isTasksHidden, useTasksHidden } from './tasksHidden'

const space = (hideTaskManagement?: boolean) => ({ name: 's', root: '/s', types: [], hideTaskManagement })

beforeEach(() => {
  resetSpaceInfo()
  resetSettingsModal()
})

describe('Hide Tasks in this space (M32)', () => {
  test('test the switch reads as off until the space says so, and follows it', () => {
    const { result } = renderHook(() => useTasksHidden())
    // Nothing loaded yet, then a space that does not say (an older answer): Tasks show.
    expect(result.current).toBe(false)
    expect(isTasksHidden()).toBe(false)
    act(() => useSpaceInfo.setState({ space: space(), loaded: true }))
    expect(result.current).toBe(false)
    act(() => useSpaceInfo.setState({ space: space(true), loaded: true }))
    expect(result.current).toBe(true)
    expect(isTasksHidden()).toBe(true)
    act(() => useSpaceInfo.setState({ space: space(false), loaded: true }))
    expect(result.current).toBe(false)
    expect(isTasksHidden()).toBe(false)
  })

  test('test the hidden page is one quiet line and the way to the setting', async () => {
    const user = userEvent.setup()
    render(<TasksHidden />)
    expect(TASKS_HIDDEN_TEXT.line).toBe('Tasks are hidden in this space.')
    expect(screen.getByText('Tasks are hidden in this space.')).toBeInTheDocument()
    // No list, no quick add, no task control: only the link to the setting.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(useSettingsModal.getState().isOpen).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Open Task management settings' }))
    expect(useSettingsModal.getState().isOpen).toBe(true)
    expect(useSettingsModal.getState().section).toBe('taskManagement')
  })
})
