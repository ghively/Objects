// M32, item 1: the note toolbar's save mark, read from the editor's published save state.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { clearSaveState, setSaveState } from '@/editor/saveStateStore'
import { SAVE_MARK_TEXT, SAVED_TEXT_MS, SaveMark } from './SaveMark'

const PATH = 'Pages/Notes.md'
const mark = () => document.querySelector('[data-save-mark]') as HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  act(() => clearSaveState(PATH))
  vi.useRealTimers()
})

describe('SaveMark', () => {
  test('a note nobody typed in shows no text, in a polite live region', () => {
    render(<SaveMark path={PATH} />)
    expect(mark()).toHaveAttribute('aria-live', 'polite')
    expect(mark()).toHaveAttribute('data-save-mark', '')
    expect(mark()).toHaveTextContent('')
  })

  test('says "Saving…" while edits wait or a save runs, then "Saved"', () => {
    render(<SaveMark path={PATH} />)
    act(() => setSaveState(PATH, 'unsaved'))
    expect(mark()).toHaveTextContent(SAVE_MARK_TEXT.saving)
    expect(mark()).toHaveAttribute('data-save-mark', 'saving')
    act(() => setSaveState(PATH, 'saving'))
    expect(mark()).toHaveTextContent('Saving…')
    act(() => setSaveState(PATH, 'saved'))
    expect(mark()).toHaveTextContent('Saved')
    expect(mark()).toHaveAttribute('data-save-mark', 'saved')
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument()
  })

  test('"Saved" fades to the check alone after a moment, and comes back with the next save', () => {
    render(<SaveMark path={PATH} />)
    act(() => setSaveState(PATH, 'saving'))
    act(() => setSaveState(PATH, 'saved'))
    expect(mark()).toHaveAttribute('data-quiet', 'false')
    act(() => vi.advanceTimersByTime(SAVED_TEXT_MS))
    expect(mark()).toHaveAttribute('data-quiet', 'true')
    // The word stays for a screen reader; only its look goes.
    expect(mark()).toHaveTextContent('Saved')
    act(() => setSaveState(PATH, 'unsaved'))
    expect(mark()).toHaveTextContent('Saving…')
    act(() => setSaveState(PATH, 'saved'))
    expect(mark()).toHaveAttribute('data-quiet', 'false')
  })

  test('a failed save shows nothing here (the editor shows its own error)', () => {
    render(<SaveMark path={PATH} />)
    act(() => setSaveState(PATH, 'saving'))
    act(() => setSaveState(PATH, 'error'))
    expect(mark()).toHaveTextContent('')
    expect(mark()).toHaveAttribute('data-save-mark', '')
    // The retry that works says so.
    act(() => setSaveState(PATH, 'saving'))
    act(() => setSaveState(PATH, 'saved'))
    expect(mark()).toHaveTextContent('Saved')
  })
})
