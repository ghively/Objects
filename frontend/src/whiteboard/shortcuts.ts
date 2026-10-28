/**
 * Whiteboard shortcut keys: Object's (its whiteboard shortcut table and canvas key handler;
 * reference-check-2026-10-28 §1), the same as the `whiteboard*` entries of `lib/shortcuts.ts`.
 * Pen (D), highlighter (Shift+D) and eraser (E) are Object's own tools and keys; they avoid
 * Object's P (Triangle) and M (move menu). Pure: `keyToCommand(e, ctx)` maps a key event to a
 * command, or null. Keys typed into an editor or input never reach the canvas. Letters match
 * `event.key` (the typed letter, whatever the layout).
 */
import type { WhiteboardTool } from '@/api/whiteboardTypes'
import type { OrderMode } from './actions'
import { GRID } from './model'

export type Command =
  | { type: 'tool'; tool: WhiteboardTool }
  | { type: 'ink'; tool: 'pen' | 'highlighter' | 'eraser' }
  | { type: 'zoom'; zoom: 'in' | 'out' | 'reset' | 'fit' | 'selection' }
  | { type: 'duplicate' }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'resize'; dw: number; dh: number }
  | { type: 'order'; mode: OrderMode }
  | { type: 'flip'; axis: 'x' | 'y' }
  | { type: 'wrap' }
  | { type: 'cycle'; backward: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'delete' }
  | { type: 'escape' }
  | { type: 'pan' }
  /** M8: system-clipboard copy, cut and paste of the selection (Ctrl/Cmd+C, X, V). */
  | { type: 'copy' }
  | { type: 'cut' }
  | { type: 'paste' }

export interface KeyLike {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  repeat?: boolean
  target?: EventTarget | null
}

export interface ShortcutContext {
  /** Something is selected (nudge, order, flip, duplicate, wrap and delete need it). */
  hasSelection?: boolean
  /** Snap to grid is on: nudge and resize take the large step. */
  gridSnap?: boolean
}

/** Nudge distances (Object): 1 px, and 30 px (one grid cell) with Shift or while snap to grid is on. */
export const NUDGE = 1
export const NUDGE_FAR = GRID

/**
 * Keyboard resize (M8, `whiteboardResize` / `whiteboardResizeLarge`, Object's Mod-Arrow and
 * Mod-Shift-Arrow): the nudge steps. Right and Down grow, Left and Up shrink ("Grows or shrinks
 * from the right or bottom edge").
 */
export const RESIZE = NUDGE
export const RESIZE_FAR = NUDGE_FAR

/** Whether keys typed at `target` belong to an editor or input rather than the canvas. */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  const el = target as HTMLElement
  if (el.isContentEditable) return true
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .ProseMirror, [data-whiteboard-editing]')
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

export function keyToCommand(e: KeyLike, ctx: ShortcutContext = {}): Command | null {
  if (isEditableTarget(e.target)) return null
  const mod = !!(e.ctrlKey || e.metaKey)
  const shift = !!e.shiftKey
  const alt = !!e.altKey
  const key = e.key
  const lower = key.length === 1 ? key.toLowerCase() : key
  const code = e.code ?? ''
  const sel = !!ctx.hasSelection
  const far = shift || !!ctx.gridSnap

  // Undo / redo
  if (mod && !alt && lower === 'z') return shift ? { type: 'redo' } : { type: 'undo' }
  if (mod && !alt && !shift && lower === 'y') return { type: 'redo' }

  // Zoom
  if (mod && !alt && (key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd')) return { type: 'zoom', zoom: 'in' }
  if (mod && !alt && (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract')) return { type: 'zoom', zoom: 'out' }
  if (mod && !alt && !shift && (key === '0' || code === 'Digit0' || code === 'Numpad0')) return { type: 'zoom', zoom: 'reset' }
  if (!mod && !alt && shift && (code === 'Digit1' || key === '1' || key === '!')) return { type: 'zoom', zoom: 'fit' }
  if (!mod && !alt && shift && (code === 'Digit2' || key === '2' || key === '@')) return { type: 'zoom', zoom: 'selection' }

  // Order: Ctrl+] / Ctrl+[ one step; ] / [ alone to front / to back (below).
  const bracketRight = key === ']' || (code === 'BracketRight' && !shift)
  const bracketLeft = key === '[' || (code === 'BracketLeft' && !shift)
  if (mod && !alt && !shift && bracketRight) return sel ? { type: 'order', mode: 'forward' } : null
  if (mod && !alt && !shift && bracketLeft) return sel ? { type: 'order', mode: 'backward' } : null

  // Wrap in frame: Ctrl+G
  if (mod && !alt && !shift && lower === 'g') return sel ? { type: 'wrap' } : null
  // Duplicate: Ctrl+D
  if (mod && !alt && !shift && lower === 'd') return sel ? { type: 'duplicate' } : null

  // Clipboard (M8): Ctrl+C / Ctrl+X need a selection; Ctrl+V always.
  if (mod && !alt && !shift && (lower === 'c' || code === 'KeyC')) return sel ? { type: 'copy' } : null
  if (mod && !alt && !shift && (lower === 'x' || code === 'KeyX')) return sel ? { type: 'cut' } : null
  if (mod && !alt && !shift && (lower === 'v' || code === 'KeyV')) return { type: 'paste' }

  // Resize selection: Ctrl+Arrow (with Shift or snap to grid: farther). Without a selection
  // Ctrl+Left/Right stay back and forward.
  if (mod && !alt && key in ARROWS) {
    if (!sel) return null
    const [x, y] = ARROWS[key]
    const step = far ? RESIZE_FAR : RESIZE
    return { type: 'resize', dw: x * step, dh: y * step }
  }

  if (mod || alt) return null

  if (key in ARROWS) {
    if (!sel) return null
    const [x, y] = ARROWS[key]
    const step = far ? NUDGE_FAR : NUDGE
    return { type: 'nudge', dx: x * step, dy: y * step }
  }
  if (!shift && bracketRight) return sel ? { type: 'order', mode: 'front' } : null
  if (!shift && bracketLeft) return sel ? { type: 'order', mode: 'back' } : null
  if (key === 'Delete' || key === 'Backspace') return sel ? { type: 'delete' } : null
  if (key === 'Escape') return { type: 'escape' }
  if (key === 'Tab') return { type: 'cycle', backward: shift }
  if (key === ' ' || code === 'Space') return { type: 'pan' }

  if (shift) {
    if (lower === 'l') return { type: 'tool', tool: 'arrow' }
    if (lower === 'd') return { type: 'ink', tool: 'highlighter' }
    if (lower === 'h') return sel ? { type: 'flip', axis: 'x' } : null
    if (lower === 'v') return sel ? { type: 'flip', axis: 'y' } : null
    return null
  }

  switch (lower) {
    case 'v':
      return { type: 'tool', tool: 'select' }
    case 'h':
      return { type: 'tool', tool: 'hand' }
    case 't':
      return { type: 'tool', tool: 'text' }
    case 'r':
      return { type: 'tool', tool: 'rectangle' }
    case 'p':
      return { type: 'tool', tool: 'triangle' }
    case 'o':
      return { type: 'tool', tool: 'ellipse' }
    case 'l':
      return { type: 'tool', tool: 'line' }
    case 'f':
      return { type: 'tool', tool: 'frame' }
    case 'd':
      return { type: 'ink', tool: 'pen' }
    case 'e':
      return { type: 'ink', tool: 'eraser' }
  }
  return null
}
