/**
 * Per-viewer conveniences, never written to the space: the board's tool memory
 * (`WhiteboardBoardToolMemory`) and its camera, in `localStorage` under
 * `object.wb.tools.<board>` and `object.wb.camera.<board>`. Every access is guarded: a
 * throwing or empty storage (private window, blocked site data) just means no memory.
 */
import type { WhiteboardBoardToolMemory } from '@/api/whiteboardTypes'
import type { Viewport } from './camera'

export const TOOLS_KEY = 'object.wb.tools.'
export const CAMERA_KEY = 'object.wb.camera.'

function read(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: the memory is a convenience */
  }
}

export function loadToolMemory(board: string): WhiteboardBoardToolMemory {
  const v = read(TOOLS_KEY + board)
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as WhiteboardBoardToolMemory) : {}
}

export function saveToolMemory(board: string, memory: WhiteboardBoardToolMemory): void {
  write(TOOLS_KEY + board, memory)
}

export function loadCamera(board: string): Viewport | null {
  const v = read(CAMERA_KEY + board) as Partial<Viewport> | null
  if (!v || typeof v !== 'object') return null
  const { x, y, zoom } = v
  if (![x, y, zoom].every((n) => typeof n === 'number' && Number.isFinite(n)) || (zoom as number) <= 0) return null
  return { x: x as number, y: y as number, zoom: zoom as number }
}

export function saveCamera(board: string, viewport: Viewport): void {
  write(CAMERA_KEY + board, { x: viewport.x, y: viewport.y, zoom: viewport.zoom })
}
