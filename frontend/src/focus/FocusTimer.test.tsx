// M8 Task 9: the focus timer counts down, pauses, survives a reload and completes.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FocusTimer } from './FocusTimer'
import { FOCUS_TEXT, FOCUS_TIMER_KEY, NO_TIMER, formatRemaining, readStoredTimer, timeLeft, useFocusMode } from './useFocusMode'

const T0 = Date.UTC(2026, 9, 27, 9, 0, 0)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(T0)
  localStorage.clear()
  useFocusMode.setState({ on: false, timer: NO_TIMER, completed: null, notice: null })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('FocusTimer', () => {
  test('test focus timer counts down and completes', () => {
    render(<FocusTimer show />)
    // Choose 15 minutes and start.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(FOCUS_TEXT.label) }))
    expect(screen.getByText(FOCUS_TEXT.chooseDuration, { selector: 'div' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: FOCUS_TEXT.preset(15) }))
    expect(screen.getByText(FOCUS_TEXT.prompt(15))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: FOCUS_TEXT.start(15) }))
    expect(screen.getByRole('timer').textContent).toBe(FOCUS_TEXT.running('15:00'))
    // Kept in localStorage (survives a reload), never in a file.
    expect(JSON.parse(localStorage.getItem(FOCUS_TIMER_KEY)!)).toEqual({ minutes: 15, endsAt: T0 + 15 * 60_000, pausedLeft: null })

    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByRole('timer').textContent).toBe(FOCUS_TEXT.running('14:00'))

    // Pause holds the time; resume carries on.
    fireEvent.click(screen.getByRole('button', { name: FOCUS_TEXT.pause }))
    act(() => vi.advanceTimersByTime(5 * 60_000))
    expect(screen.getByRole('timer').textContent).toBe(FOCUS_TEXT.running('14:00'))
    fireEvent.click(screen.getByRole('button', { name: FOCUS_TEXT.resume }))

    act(() => vi.advanceTimersByTime(14 * 60_000))
    expect(screen.getByText(FOCUS_TEXT.completeTitle)).toBeTruthy()
    expect(screen.getByText(FOCUS_TEXT.completeBody(15))).toBeTruthy()
    expect(localStorage.getItem(FOCUS_TIMER_KEY)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: FOCUS_TEXT.continue }))
    expect(useFocusMode.getState().completed).toBeNull()
  })

  test('a stored timer is read back after a reload', () => {
    localStorage.setItem(FOCUS_TIMER_KEY, JSON.stringify({ minutes: 25, endsAt: T0 + 10 * 60_000, pausedLeft: null }))
    const t = readStoredTimer()
    expect(t.minutes).toBe(25)
    expect(formatRemaining(timeLeft(t, T0))).toBe('10:00')
    localStorage.setItem(FOCUS_TIMER_KEY, '{bad')
    expect(readStoredTimer()).toEqual(NO_TIMER)
  })

  test('stop shows the time focused; cancel discards it', () => {
    render(<FocusTimer show />)
    act(() => useFocusMode.getState().startTimer(25))
    act(() => vi.advanceTimersByTime(30_000))
    fireEvent.click(screen.getByRole('button', { name: FOCUS_TEXT.stop }))
    expect(screen.getByText(FOCUS_TEXT.completeBodySeconds(30))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: FOCUS_TEXT.continue }))

    act(() => useFocusMode.getState().startTimer(25))
    fireEvent.click(screen.getByRole('button', { name: FOCUS_TEXT.cancel }))
    expect(useFocusMode.getState().completed).toBeNull()
    expect(useFocusMode.getState().timer).toEqual(NO_TIMER)
  })

  test('hidden when focus mode is off and no session runs', () => {
    const { container } = render(<FocusTimer show={false} />)
    expect(container.querySelector('[data-focus-timer]')).toBeNull()
  })
})
