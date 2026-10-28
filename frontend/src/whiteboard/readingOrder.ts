/**
 * The board's reading order (Object's `WhiteboardData.readingOrder`, `whiteboard.model.ts`):
 * "Explicit node-id reading order. When set, export / search / the outline use this sequence
 * first; remaining nodes keep the geometric top-to-bottom, left-to-right sort. Reordering never
 * moves canvas geometry."
 *
 * Also the floating inspector's data (outline headings, frames, stats) and the presentation's
 * slides (frames in reading order). Pure functions; our code.
 */
import type { WhiteboardBlock, WhiteboardData, WhiteboardNode } from '@/api/whiteboardTypes'
import { nodeBox } from './actions'
import type { Box } from './model'
import { WB } from './strings'

/** Top-to-bottom, then left-to-right (ties by id, so the order is stable). */
export function geometricCompare(a: WhiteboardNode, b: WhiteboardNode): number {
  return a.position.y - b.position.y || a.position.x - b.position.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Nodes in reading order: the `readingOrder` ids that exist first, then the rest geometrically. */
export function orderedNodes(board: WhiteboardData, keep: (n: WhiteboardNode) => boolean = () => true): WhiteboardNode[] {
  const out: WhiteboardNode[] = []
  const seen = new Set<string>()
  const explicit = Array.isArray(board.readingOrder) ? board.readingOrder : []
  for (const id of explicit) {
    const n = typeof id === 'string' ? board.nodes[id] : undefined
    if (!n || seen.has(id) || !keep(n)) continue
    seen.add(id)
    out.push(n)
  }
  const rest = Object.values(board.nodes)
    .filter((n) => !seen.has(n.id) && keep(n))
    .sort(geometricCompare)
  return [...out, ...rest]
}

/** The frames in reading order. */
export function orderedFrames(board: WhiteboardData): WhiteboardNode[] {
  return orderedNodes(board, (n) => n.kind === 'frame')
}

/** A frame's name in the inspector and the presentation: its title, else "Frame". */
export function frameLabel(frame: WhiteboardNode): string {
  const t = typeof frame.title === 'string' ? frame.title.trim() : ''
  return t || WB.toolFrame.text
}

/**
 * The board with the frames in `frameIds` order as the start of `readingOrder`; the other ids
 * already in it keep their relative order after them. Geometry is untouched.
 */
export function setFrameOrder(board: WhiteboardData, frameIds: readonly string[]): WhiteboardData {
  const frames = frameIds.filter((id) => board.nodes[id]?.kind === 'frame')
  const set = new Set(frames)
  const others = (Array.isArray(board.readingOrder) ? board.readingOrder : []).filter(
    (id) => typeof id === 'string' && !set.has(id) && id in board.nodes,
  )
  return { ...board, readingOrder: [...frames, ...others] }
}

/** Moves the item at `from` to `to` (a new array). */
export function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length) return next
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item)
  return next
}

// ---- outline ----

export interface OutlineHeading {
  /** The node whose text block holds the heading (click zooms to it). */
  nodeId: string
  level: number
  text: string
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const FENCE = /^ {0,3}(```|~~~)/

/** Strips inline Markdown that only decorates (emphasis, code, links) from heading text. */
function plainHeading(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|==|`)/g, '')
    .trim()
}

/** The ATX headings of one Markdown text, outside code fences. */
export function headingsOf(markdown: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = []
  let fence: string | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const f = FENCE.exec(line)
    if (f) {
      if (fence === null) fence = f[1]
      else if (f[1] === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const m = HEADING.exec(line)
    if (m) {
      const text = plainHeading(m[2])
      if (text) out.push({ level: m[1].length, text })
    }
  }
  return out
}

/** The headings in the board's text blocks (nodes in reading order). */
export function boardOutline(board: WhiteboardData): OutlineHeading[] {
  const out: OutlineHeading[] = []
  for (const n of orderedNodes(board)) {
    const block = n.blockId ? board.blocks[n.blockId] : undefined
    if (!block || block.type !== 'text' || typeof block.markdown !== 'string') continue
    for (const h of headingsOf(block.markdown)) out.push({ nodeId: n.id, ...h })
  }
  return out
}

// ---- stats (our choice of stats) ----

export interface BoardStats {
  text: number
  objects: number
  media: number
  weblinks: number
  shapes: number
  frames: number
  connectors: number
  words: number
  strokes: number
}

/** Words in a Markdown text: runs of letters or digits, markup ignored. */
export function wordCount(markdown: string): number {
  const plain = markdown
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t: string, a?: string) => a ?? t)
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/[#>*_`~=|[\]-]+/g, ' ')
  return (plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu) ?? []).length
}

const isText = (b: WhiteboardBlock | undefined): b is Extract<WhiteboardBlock, { type: 'text' }> =>
  !!b && b.type === 'text' && typeof (b as { markdown?: unknown }).markdown === 'string'

/**
 * Counts for the inspector's "Stats": nodes by kind (text blocks, objects, media, web links,
 * shapes, frames), connectors, words in every text (nodes, shapes, labels) and ink strokes.
 */
export function boardStats(board: WhiteboardData, strokes: readonly unknown[] = []): BoardStats {
  const s: BoardStats = { text: 0, objects: 0, media: 0, weblinks: 0, shapes: 0, frames: 0, connectors: 0, words: 0, strokes: strokes.length }
  for (const n of Object.values(board.nodes)) {
    if (n.kind === 'frame') s.frames++
    else if (n.kind === 'shape') s.shapes++
    else if (n.kind === 'block') {
      const b = n.blockId ? board.blocks[n.blockId] : undefined
      if (b?.type === 'entity') s.objects++
      else if (b?.type === 'media') s.media++
      else if (b?.type === 'weblink') s.weblinks++
      else s.text++
    }
  }
  s.connectors = Object.keys(board.edges).length
  const owners = [...Object.values(board.nodes), ...Object.values(board.edges)]
  for (const o of owners) {
    const b = o.blockId ? board.blocks[o.blockId] : undefined
    if (isText(b)) s.words += wordCount(b.markdown)
    else if (typeof (o as { label?: unknown }).label === 'string') s.words += wordCount((o as { label: string }).label)
  }
  return s
}

// ---- presentation ----

export interface Slide {
  /** The frame shown, or null for the whole board (a board without frames). */
  frameId: string | null
  label: string
  box: Box
}

/**
 * The presentation's slides: each frame in reading order (else top-to-bottom, left-to-right);
 * a board without frames is one slide of everything (our choice).
 */
export function presentationSlides(board: WhiteboardData): Slide[] {
  const frames = orderedFrames(board)
  if (frames.length) return frames.map((f) => ({ frameId: f.id, label: frameLabel(f), box: nodeBox(f) }))
  const nodes = Object.values(board.nodes)
  if (!nodes.length) return []
  const boxes = nodes.map((n) => nodeBox(n))
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.width))
  const maxY = Math.max(...boxes.map((b) => b.y + b.height))
  return [{ frameId: null, label: '', box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } }]
}
