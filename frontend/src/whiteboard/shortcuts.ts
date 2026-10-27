/**
 * Whiteboard shortcut keys (our choice of keys; the names are Capacities' `shortcuts.whiteboard*`,
 * see the plan's key table). Pure: `keyToCommand(e, ctx)` maps a key event to a command, or null.
 * Keys typed into an editor or input never reach the canvas.
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
}

/** Nudge distances: one grid cell, five with Shift (our choice). */
export const NUDGE = GRID
export const NUDGE_FAR = GRID * 5

/**
 * Keyboard resize (M8, `whiteboardResize` / `whiteboardResizeLarge`, provisional keys
 * Mod-Alt-Arrow and Mod-Alt-Shift-Arrow): one grid step, five with Shift. Right and Down grow,
 * Left and Up shrink ("Grows or shrinks from the right or bottom edge"). Alt-Arrow alone stays
 * `navigateBack`/`navigateForward`.
 */
export const RESIZE = GRID
export const RESIZE_FAR = GRID * 5

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

  // Undo / redo
  if (mod && !alt && lower === 'z') return shift ? { type: 'redo' } : { type: 'undo' }
  if (mod && !alt && !shift && lower === 'y') return { type: 'redo' }

  // Zoom
  if (mod && !alt && (key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd')) return { type: 'zoom', zoom: 'in' }
  if (mod && !alt && (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract')) return { type: 'zoom', zoom: 'out' }
  if (mod && !alt && !shift && (key === '0' || code === 'Digit0' || code === 'Numpad0')) return { type: 'zoom', zoom: 'reset' }
  if (!mod && !alt && shift && (code === 'Digit1' || key === '1' || key === '!')) return { type: 'zoom', zoom: 'fit' }
  if (!mod && !alt && shift && (code === 'Digit2' || key === '2' || key === '@')) return { type: 'zoom', zoom: 'selection' }

  // Order: Ctrl+] / Ctrl+[ (with Shift: to front / to back)
  const bracketRight = code === 'BracketRight' || key === ']' || key === '}'
  const bracketLeft = code === 'BracketLeft' || key === '[' || key === '{'
  if (mod && !alt && bracketRight) return sel ? { type: 'order', mode: shift ? 'front' : 'forward' } : null
  if (mod && !alt && bracketLeft) return sel ? { type: 'order', mode: shift ? 'back' : 'backward' } : null

  // Wrap in frame: Ctrl+Alt+G
  if (mod && alt && (lower === 'g' || code === 'KeyG')) return sel ? { type: 'wrap' } : null
  // Duplicate: Ctrl+D
  if (mod && !alt && !shift && lower === 'd') return sel ? { type: 'duplicate' } : null

  // Resize selection: Ctrl+Alt+Arrow (with Shift: farther)
  if (mod && alt && key in ARROWS) {
    if (!sel) return null
    const [x, y] = ARROWS[key]
    const step = shift ? RESIZE_FAR : RESIZE
    return { type: 'resize', dw: x * step, dh: y * step }
  }

  if (mod || alt) return null

  if (key in ARROWS) {
    if (!sel) return null
    const [x, y] = ARROWS[key]
    const step = shift ? NUDGE_FAR : NUDGE
    return { type: 'nudge', dx: x * step, dy: y * step }
  }
  if (key === 'Delete' || key === 'Backspace') return sel ? { type: 'delete' } : null
  if (key === 'Escape') return { type: 'escape' }
  if (key === 'Tab') return { type: 'cycle', backward: shift }
  if (key === ' ' || code === 'Space') return { type: 'pan' }

  if (shift) {
    if (lower === 'r') return { type: 'tool', tool: 'triangle' }
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
    case 'o':
      return { type: 'tool', tool: 'ellipse' }
    case 'l':
      return { type: 'tool', tool: 'line' }
    case 'a':
      return { type: 'tool', tool: 'arrow' }
    case 'f':
      return { type: 'tool', tool: 'frame' }
    case 'p':
      return { type: 'ink', tool: 'pen' }
    case 'm':
      return { type: 'ink', tool: 'highlighter' }
    case 'e':
      return { type: 'ink', tool: 'eraser' }
  }
  return null
}
