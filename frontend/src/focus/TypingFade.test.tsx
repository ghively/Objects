// Polish item 5: while typing in the editor the chrome (top bar, header buttons) fades until the pointer moves.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { TYPING_ATTR, TYPING_FADE_ATTR, TypingFade } from './TypingFade'

function Shell() {
  return (
    <div>
      <TypingFade />
      <header {...{ [TYPING_FADE_ATTR]: '' }}>
        <button type="button">Back</button>
      </header>
      <div {...{ [TYPING_FADE_ATTR]: '' }}>
        <button type="button">More</button>
      </div>
      <div className="ProseMirror" contentEditable suppressContentEditableWarning data-testid="editor">
        <p>Text</p>
      </div>
      <input aria-label="Search" />
    </div>
  )
}

const faded = () => document.documentElement.hasAttribute(TYPING_ATTR)
const opacity = (name: string) => getComputedStyle(screen.getByRole('button', { name })).opacity

afterEach(() => {
  document.documentElement.removeAttribute(TYPING_ATTR)
})

describe('TypingFade', () => {
  test('typing in the editor fades the chrome; moving the pointer brings it back', () => {
    render(<Shell />)
    const editor = screen.getByTestId('editor')
    expect(faded()).toBe(false)
    expect(opacity('Back')).not.toBe('0')

    fireEvent.keyDown(editor, { key: 'a' })
    expect(faded()).toBe(true)
    expect(opacity('Back')).toBe('0')
    expect(opacity('More')).toBe('0')
    expect(getComputedStyle(screen.getByRole('button', { name: 'Back' })).pointerEvents).toBe('none')

    act(() => {
      fireEvent.mouseMove(document, { clientX: 10, clientY: 10 })
    })
    expect(faded()).toBe(false)
    expect(opacity('Back')).not.toBe('0')
  })

  test('Backspace, Enter and Delete count as typing; shortcuts, arrows and modifiers do not', () => {
    render(<Shell />)
    const editor = screen.getByTestId('editor')
    for (const init of [{ key: 'b', ctrlKey: true }, { key: 'k', metaKey: true }, { key: 'ArrowDown' }, { key: 'Shift' }, { key: 'Escape' }]) {
      fireEvent.keyDown(editor, init)
      expect(faded()).toBe(false)
    }
    for (const key of ['Backspace', 'Enter', 'Delete']) {
      fireEvent.keyDown(editor, { key })
      expect(faded()).toBe(true)
      fireEvent.mouseMove(document, { clientX: Math.random() * 100, clientY: 5 })
      expect(faded()).toBe(false)
    }
  })

  test('typing outside the editor does not fade', () => {
    render(<Shell />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search' }), { key: 'a' })
    expect(faded()).toBe(false)
  })

  test('a pointer event at the same spot (a scroll or layout change) does not bring the chrome back', () => {
    render(<Shell />)
    fireEvent.mouseMove(document, { clientX: 40, clientY: 50 })
    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'x' })
    expect(faded()).toBe(true)
    fireEvent.mouseMove(document, { clientX: 40, clientY: 50 })
    expect(faded()).toBe(true)
    fireEvent.mouseMove(document, { clientX: 41, clientY: 50 })
    expect(faded()).toBe(false)
  })

  test('unmounting restores the chrome', () => {
    const { unmount } = render(<Shell />)
    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'a' })
    expect(faded()).toBe(true)
    unmount()
    expect(faded()).toBe(false)
  })
})
