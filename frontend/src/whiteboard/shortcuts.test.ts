import { describe, expect, test } from 'vitest'
import { keyToCommand, type KeyLike } from './shortcuts'

const sel = { hasSelection: true }
const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, ...mods })

describe('keyToCommand', () => {
  test('keys map to commands and are ignored in editors', () => {
    // Tools
    expect(keyToCommand(k('v'))).toEqual({ type: 'tool', tool: 'select' })
    expect(keyToCommand(k('h'))).toEqual({ type: 'tool', tool: 'hand' })
    expect(keyToCommand(k('t'))).toEqual({ type: 'tool', tool: 'text' })
    expect(keyToCommand(k('r'))).toEqual({ type: 'tool', tool: 'rectangle' })
    expect(keyToCommand(k('o'))).toEqual({ type: 'tool', tool: 'ellipse' })
    expect(keyToCommand(k('R', { shiftKey: true }))).toEqual({ type: 'tool', tool: 'triangle' })
    expect(keyToCommand(k('l'))).toEqual({ type: 'tool', tool: 'line' })
    expect(keyToCommand(k('a'))).toEqual({ type: 'tool', tool: 'arrow' })
    expect(keyToCommand(k('f'))).toEqual({ type: 'tool', tool: 'frame' })
    // Pan
    expect(keyToCommand(k(' ', { code: 'Space' }))).toEqual({ type: 'pan' })
    // Zoom
    expect(keyToCommand(k('=', { ctrlKey: true }))).toEqual({ type: 'zoom', zoom: 'in' })
    expect(keyToCommand(k('-', { ctrlKey: true }))).toEqual({ type: 'zoom', zoom: 'out' })
    expect(keyToCommand(k('0', { ctrlKey: true }))).toEqual({ type: 'zoom', zoom: 'reset' })
    expect(keyToCommand(k('!', { shiftKey: true, code: 'Digit1' }))).toEqual({ type: 'zoom', zoom: 'fit' })
    expect(keyToCommand(k('@', { shiftKey: true, code: 'Digit2' }))).toEqual({ type: 'zoom', zoom: 'selection' })
    // Duplicate
    expect(keyToCommand(k('d', { ctrlKey: true }), sel)).toEqual({ type: 'duplicate' })
    // Nudge
    expect(keyToCommand(k('ArrowLeft'), sel)).toEqual({ type: 'nudge', dx: -30, dy: 0 })
    expect(keyToCommand(k('ArrowDown'), sel)).toEqual({ type: 'nudge', dx: 0, dy: 30 })
    expect(keyToCommand(k('ArrowRight', { shiftKey: true }), sel)).toEqual({ type: 'nudge', dx: 150, dy: 0 })
    expect(keyToCommand(k('ArrowUp', { shiftKey: true }), sel)).toEqual({ type: 'nudge', dx: 0, dy: -150 })
    // Order
    expect(keyToCommand(k('}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' }), sel)).toEqual({ type: 'order', mode: 'front' })
    expect(keyToCommand(k(']', { ctrlKey: true, code: 'BracketRight' }), sel)).toEqual({ type: 'order', mode: 'forward' })
    expect(keyToCommand(k('[', { ctrlKey: true, code: 'BracketLeft' }), sel)).toEqual({ type: 'order', mode: 'backward' })
    expect(keyToCommand(k('{', { ctrlKey: true, shiftKey: true, code: 'BracketLeft' }), sel)).toEqual({ type: 'order', mode: 'back' })
    // Flip
    expect(keyToCommand(k('H', { shiftKey: true }), sel)).toEqual({ type: 'flip', axis: 'x' })
    expect(keyToCommand(k('V', { shiftKey: true }), sel)).toEqual({ type: 'flip', axis: 'y' })
    // Wrap in frame
    expect(keyToCommand(k('g', { ctrlKey: true, altKey: true, code: 'KeyG' }), sel)).toEqual({ type: 'wrap' })
    // Cycle
    expect(keyToCommand(k('Tab'))).toEqual({ type: 'cycle', backward: false })
    expect(keyToCommand(k('Tab', { shiftKey: true }))).toEqual({ type: 'cycle', backward: true })
    // Undo / redo
    expect(keyToCommand(k('z', { ctrlKey: true }))).toEqual({ type: 'undo' })
    expect(keyToCommand(k('Z', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'redo' })
    expect(keyToCommand(k('y', { ctrlKey: true }))).toEqual({ type: 'redo' })
    expect(keyToCommand(k('z', { metaKey: true }))).toEqual({ type: 'undo' })
    // Delete
    expect(keyToCommand(k('Delete'), sel)).toEqual({ type: 'delete' })
    expect(keyToCommand(k('Backspace'), sel)).toEqual({ type: 'delete' })
    // Pen group (Gene's)
    expect(keyToCommand(k('p'))).toEqual({ type: 'ink', tool: 'pen' })
    expect(keyToCommand(k('m'))).toEqual({ type: 'ink', tool: 'highlighter' })
    expect(keyToCommand(k('e'))).toEqual({ type: 'ink', tool: 'eraser' })
    // Escape
    expect(keyToCommand(k('Escape'))).toEqual({ type: 'escape' })

    // Ignored in editors and inputs.
    const input = document.createElement('input')
    const editor = document.createElement('div')
    editor.className = 'ProseMirror'
    const inner = document.createElement('p')
    editor.appendChild(inner)
    const textarea = document.createElement('textarea')
    for (const target of [input, inner, textarea]) {
      expect(keyToCommand(k('v', { target }))).toBeNull()
      expect(keyToCommand(k('Delete', { target }), sel)).toBeNull()
      expect(keyToCommand(k('z', { ctrlKey: true, target }))).toBeNull()
    }
  })

  test('selection commands need a selection; Ctrl+Backspace and unknown keys stay with the app', () => {
    expect(keyToCommand(k('Delete'))).toBeNull()
    expect(keyToCommand(k('ArrowLeft'))).toBeNull()
    expect(keyToCommand(k('d', { ctrlKey: true }))).toBeNull()
    expect(keyToCommand(k('Backspace', { ctrlKey: true }), sel)).toBeNull()
    expect(keyToCommand(k('n', { ctrlKey: true }))).toBeNull()
    expect(keyToCommand(k('q'))).toBeNull()
  })
})
