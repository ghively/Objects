import { describe, expect, test } from 'vitest'
import { keysFor, parseKeys } from '@/lib/shortcuts'
import { KEY_HINT } from './chrome/controls'
import { keyToCommand, type Command, type KeyLike } from './shortcuts'

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
    expect(keyToCommand(k('p'))).toEqual({ type: 'tool', tool: 'triangle' })
    expect(keyToCommand(k('R', { shiftKey: true }))).toBeNull()
    expect(keyToCommand(k('l'))).toEqual({ type: 'tool', tool: 'line' })
    expect(keyToCommand(k('L', { shiftKey: true }))).toEqual({ type: 'tool', tool: 'arrow' })
    expect(keyToCommand(k('a'))).toBeNull()
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
    // Capacities: 1 px, 30 px with Shift or while snap to grid is on.
    expect(keyToCommand(k('ArrowLeft'), sel)).toEqual({ type: 'nudge', dx: -1, dy: 0 })
    expect(keyToCommand(k('ArrowDown'), sel)).toEqual({ type: 'nudge', dx: 0, dy: 1 })
    expect(keyToCommand(k('ArrowDown'), { ...sel, gridSnap: true })).toEqual({ type: 'nudge', dx: 0, dy: 30 })
    expect(keyToCommand(k('ArrowRight', { shiftKey: true }), sel)).toEqual({ type: 'nudge', dx: 30, dy: 0 })
    expect(keyToCommand(k('ArrowUp', { shiftKey: true }), { ...sel, gridSnap: true })).toEqual({ type: 'nudge', dx: 0, dy: -30 })
    // Order
    expect(keyToCommand(k(']', { code: 'BracketRight' }), sel)).toEqual({ type: 'order', mode: 'front' })
    expect(keyToCommand(k(']', { ctrlKey: true, code: 'BracketRight' }), sel)).toEqual({ type: 'order', mode: 'forward' })
    expect(keyToCommand(k('[', { ctrlKey: true, code: 'BracketLeft' }), sel)).toEqual({ type: 'order', mode: 'backward' })
    expect(keyToCommand(k('[', { code: 'BracketLeft' }), sel)).toEqual({ type: 'order', mode: 'back' })
    expect(keyToCommand(k(']'))).toBeNull()
    // The old Ctrl+Shift+] / [ do nothing.
    expect(keyToCommand(k('}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' }), sel)).toBeNull()
    expect(keyToCommand(k('{', { ctrlKey: true, shiftKey: true, code: 'BracketLeft' }), sel)).toBeNull()
    // Flip
    expect(keyToCommand(k('H', { shiftKey: true }), sel)).toEqual({ type: 'flip', axis: 'x' })
    expect(keyToCommand(k('V', { shiftKey: true }), sel)).toEqual({ type: 'flip', axis: 'y' })
    // Wrap in frame
    expect(keyToCommand(k('g', { ctrlKey: true, code: 'KeyG' }), sel)).toEqual({ type: 'wrap' })
    expect(keyToCommand(k('g', { metaKey: true }), sel)).toEqual({ type: 'wrap' })
    expect(keyToCommand(k('g', { ctrlKey: true, altKey: true, code: 'KeyG' }), sel)).toBeNull()
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
    // Object's own ink tools: D, Shift+D, E (P is Capacities' Triangle, M its move menu).
    expect(keyToCommand(k('d'))).toEqual({ type: 'ink', tool: 'pen' })
    expect(keyToCommand(k('D', { shiftKey: true }))).toEqual({ type: 'ink', tool: 'highlighter' })
    expect(keyToCommand(k('e'))).toEqual({ type: 'ink', tool: 'eraser' })
    expect(keyToCommand(k('m'))).toBeNull()
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

  // The registry (Shortcuts sheet, tooltips) and keyToCommand must agree.
  test('every registered whiteboard key runs its command', () => {
    const EXPECTED: Record<string, Command> = {
      whiteboardSelect: { type: 'tool', tool: 'select' },
      whiteboardHand: { type: 'tool', tool: 'hand' },
      whiteboardText: { type: 'tool', tool: 'text' },
      whiteboardRectangle: { type: 'tool', tool: 'rectangle' },
      whiteboardEllipse: { type: 'tool', tool: 'ellipse' },
      whiteboardTriangle: { type: 'tool', tool: 'triangle' },
      whiteboardLine: { type: 'tool', tool: 'line' },
      whiteboardArrow: { type: 'tool', tool: 'arrow' },
      whiteboardFrame: { type: 'tool', tool: 'frame' },
      whiteboardPen: { type: 'ink', tool: 'pen' },
      whiteboardHighlighter: { type: 'ink', tool: 'highlighter' },
      whiteboardEraser: { type: 'ink', tool: 'eraser' },
      whiteboardBringToFront: { type: 'order', mode: 'front' },
      whiteboardBringForward: { type: 'order', mode: 'forward' },
      whiteboardSendBackward: { type: 'order', mode: 'backward' },
      whiteboardSendToBack: { type: 'order', mode: 'back' },
      whiteboardWrapInFrame: { type: 'wrap' },
      whiteboardDuplicate: { type: 'duplicate' },
      whiteboardFlipHorizontal: { type: 'flip', axis: 'x' },
      whiteboardFlipVertical: { type: 'flip', axis: 'y' },
      whiteboardZoomReset: { type: 'zoom', zoom: 'reset' },
    }
    for (const [id, cmd] of Object.entries(EXPECTED)) {
      const keys = keysFor(id)
      expect(keys.length, id).toBeGreaterThan(0)
      for (const spec of keys) {
        const c = parseKeys(spec, false)
        const key = c.key.length === 1 && c.shift ? c.key.toUpperCase() : c.key
        const e = k(key, { ctrlKey: c.ctrl, metaKey: c.meta, altKey: c.alt, shiftKey: c.shift })
        expect(keyToCommand(e, sel), `${id} ${spec}`).toEqual(cmd)
      }
    }
    // Capacities' whiteboard table (reference-check-2026-10-28 §1).
    expect(keysFor('whiteboardArrow')).toEqual(['Shift-l'])
    expect(keysFor('whiteboardTriangle')).toEqual(['p'])
    expect(keysFor('whiteboardBringToFront')).toEqual([']'])
    expect(keysFor('whiteboardSendToBack')).toEqual(['['])
    expect(keysFor('whiteboardWrapInFrame')).toEqual(['Mod-g'])
    expect(keysFor('whiteboardResize')).toEqual(['Mod-ArrowUp', 'Mod-ArrowDown', 'Mod-ArrowLeft', 'Mod-ArrowRight'])
    expect(keysFor('whiteboardResizeLarge')).toEqual(['Mod-Shift-ArrowUp', 'Mod-Shift-ArrowDown', 'Mod-Shift-ArrowLeft', 'Mod-Shift-ArrowRight'])
    for (const spec of keysFor('whiteboardResize')) {
      const c = parseKeys(spec, false)
      expect(keyToCommand(k(c.key, { ctrlKey: true }), sel)?.type, spec).toBe('resize')
    }
    // Tooltips show the same keys.
    expect(KEY_HINT.triangle).toBe('P')
    expect(KEY_HINT.arrow).toBe('Shift+L')
    expect(KEY_HINT.front).toBe(']')
    expect(KEY_HINT.wrap).toBe('Ctrl+G')
    expect(KEY_HINT.pen).toBe('D')
    expect(KEY_HINT.highlighter).toBe('Shift+D')
  })
})
