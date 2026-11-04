/**
 * Whiteboard copy and paste through the system clipboard (M8). A copied selection is written as
 * plain text: `object-whiteboard-v1:` + JSON of the selected nodes, the edges between them and
 * the blocks they use (our prefix). A paste gets
 * fresh ids for every node, edge and block, sits one grid step (30 px) down and right of the
 * originals (another 30 px for each further paste of the same clipboard; our choice), loses its
 * per-node lock (as Duplicate) and lands on top. Pasted plain text becomes a text block, a pasted
 * `http(s)` URL a web-link card (never fetched) and a pasted image an uploaded media node (the
 * canvas does the upload). Pure apart from `readClipboard` / `writeClipboard`.
 */
import type { WhiteboardBlock, WhiteboardData, WhiteboardEdge, WhiteboardNode, WhiteboardPosition } from '@/api/whiteboardTypes'
import { createFromTool, createWeblink, newId } from './actions'
import { GRID, nextContentZ, nextFrameZ, normalizeWeblinkUrl } from './model'

/** Our clipboard prefix. */
export const CLIPBOARD_PREFIX = 'object-whiteboard-v1:'

/** Offset of a paste from the copied nodes: one grid step. */
export const PASTE_OFFSET = GRID

export interface ClipboardPayload {
  nodes: WhiteboardNode[]
  edges: WhiteboardEdge[]
  blocks: Record<string, WhiteboardBlock>
}

/**
 * The copied part of `board` for the selection `ids`: the selected nodes, the end points of
 * selected connectors (a Line's ends) and of connectors from a selected node to a free point end
 * (our choice), the edges whose two ends are both copied, and the blocks those nodes and edges
 * use. `null` when nothing in `ids` is on the board.
 */
export function selectionPayload(board: WhiteboardData, ids: Iterable<string>): ClipboardPayload | null {
  const sel = new Set(ids)
  const nodeIds = new Set<string>()
  for (const id of sel) if (board.nodes[id]) nodeIds.add(id)
  const isPoint = (id: string) => board.nodes[id]?.kind === 'point'
  for (const e of Object.values(board.edges)) {
    if (sel.has(e.id)) {
      if (isPoint(e.source)) nodeIds.add(e.source)
      if (isPoint(e.target)) nodeIds.add(e.target)
    } else if (sel.has(e.source) && board.nodes[e.source] && isPoint(e.target)) nodeIds.add(e.target)
    else if (sel.has(e.target) && board.nodes[e.target] && isPoint(e.source)) nodeIds.add(e.source)
  }
  const nodes = Object.values(board.nodes).filter((n) => nodeIds.has(n.id))
  const edges = Object.values(board.edges).filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
  if (nodes.length === 0) return null
  const blocks: Record<string, WhiteboardBlock> = {}
  for (const owner of [...nodes, ...edges]) {
    if (owner.blockId !== undefined && board.blocks[owner.blockId]) blocks[owner.blockId] = board.blocks[owner.blockId]
  }
  return structuredClone({ nodes, edges, blocks })
}

/** The clipboard text for a payload. */
export function serializePayload(payload: ClipboardPayload): string {
  return CLIPBOARD_PREFIX + JSON.stringify(payload)
}

/** The payload in clipboard `text`, or `null` when it isn't ours (or is malformed). */
export function parsePayload(text: string | null | undefined): ClipboardPayload | null {
  if (typeof text !== 'string') return null
  const t = text.trimStart()
  if (!t.startsWith(CLIPBOARD_PREFIX)) return null
  let raw: unknown
  try {
    raw = JSON.parse(t.slice(CLIPBOARD_PREFIX.length))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  const nodes = Array.isArray(r.nodes)
    ? (r.nodes.filter(
        (n) => isObj(n) && typeof n.id === 'string' && typeof n.kind === 'string' && isObj(n.position) &&
          typeof n.position.x === 'number' && typeof n.position.y === 'number',
      ) as WhiteboardNode[])
    : []
  const ids = new Set(nodes.map((n) => n.id))
  const edges = Array.isArray(r.edges)
    ? (r.edges.filter(
        (e) => isObj(e) && typeof e.id === 'string' && ids.has(e.source as string) && ids.has(e.target as string),
      ) as WhiteboardEdge[])
    : []
  const blocks: Record<string, WhiteboardBlock> = {}
  if (isObj(r.blocks)) {
    for (const [k, v] of Object.entries(r.blocks)) if (isObj(v) && typeof v.type === 'string') blocks[k] = v as WhiteboardBlock
  }
  if (!nodes.length) return null
  return { nodes, edges, blocks }
}

/**
 * Adds `payload` to `board` with fresh ids, `offset` px down and right, on top of what is there
 * (frames above frames, content above content). Returns the board and the new node and edge ids.
 */
export function pastePayload(
  board: WhiteboardData,
  payload: ClipboardPayload,
  offset: number = PASTE_OFFSET,
): { board: WhiteboardData; ids: string[] } {
  const nodes = { ...board.nodes }
  const edges = { ...board.edges }
  const blocks = { ...board.blocks }
  const map = new Map<string, string>()
  const blockMap = new Map<string, string>()
  const created: string[] = []
  const copyBlock = (blockId: string | undefined): string | undefined => {
    if (blockId === undefined || !payload.blocks[blockId]) return undefined
    const done = blockMap.get(blockId)
    if (done) return done
    const nb = newId()
    blocks[nb] = structuredClone(payload.blocks[blockId])
    blockMap.set(blockId, nb)
    return nb
  }
  const ordered = [...payload.nodes].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  for (const n of ordered) {
    const copy: WhiteboardNode = structuredClone(n)
    copy.id = newId()
    copy.position = { ...n.position, x: n.position.x + offset, y: n.position.y + offset }
    const all = Object.values(nodes)
    if (n.kind === 'frame') copy.z = nextFrameZ(all)
    else if (n.kind !== 'point' || n.z !== undefined) copy.z = nextContentZ(all)
    const nb = copyBlock(n.blockId)
    if (nb !== undefined) copy.blockId = nb
    else delete copy.blockId
    delete copy.locked
    nodes[copy.id] = copy
    map.set(n.id, copy.id)
    created.push(copy.id)
  }
  for (const e of payload.edges) {
    const s = map.get(e.source)
    const t = map.get(e.target)
    if (!s || !t) continue
    const copy: WhiteboardEdge = structuredClone(e)
    copy.id = newId()
    copy.source = s
    copy.target = t
    const nb = copyBlock(e.blockId)
    if (nb !== undefined) copy.blockId = nb
    else delete copy.blockId
    edges[copy.id] = copy
    created.push(copy.id)
  }
  if (!created.length) return { board, ids: [] }
  return { board: { ...board, nodes, edges, blocks }, ids: created }
}

/** What pasted plain text becomes: a web link for a lone `http(s)` URL, else a text block. */
export type TextPaste = { kind: 'weblink'; url: string } | { kind: 'text'; markdown: string } | null

export function classifyText(text: string): TextPaste {
  const trimmed = text.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '')
  if (!trimmed.trim()) return null
  // Only a URL written with its scheme becomes a link card (a lone word stays text; our choice).
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    const url = normalizeWeblinkUrl(trimmed)
    if (url) return { kind: 'weblink', url }
  }
  return { kind: 'text', markdown: trimmed }
}

/** Places pasted text at `at` (a text block, or a web-link card for a URL). */
export function pasteText(
  board: WhiteboardData,
  text: string,
  at: WhiteboardPosition,
  opts: { id?: string; snap?: boolean } = {},
): WhiteboardData {
  const c = classifyText(text)
  if (!c) return board
  const id = opts.id ?? newId()
  if (c.kind === 'weblink') return createWeblink(board, { url: c.url }, at, { id, snap: opts.snap })
  return createFromTool(board, 'text', at, { id, snap: opts.snap, text: c.markdown })
}

// ---- the system clipboard ----

/** What the clipboard held when read. */
export interface ClipboardContent {
  text: string | null
  files: File[]
}

/** Writes `text` to the system clipboard; false when the clipboard is unavailable or refused. */
export async function writeClipboard(text: string): Promise<boolean> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  if (!clip || typeof clip.writeText !== 'function') return false
  try {
    await clip.writeText(text)
    return true
  } catch {
    return false
  }
}

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

/** The name a pasted image is uploaded under (our choice). */
export function pastedImageName(type: string): string {
  return `Pasted image.${IMAGE_EXT[type] ?? 'png'}`
}

/**
 * Reads the system clipboard: images through `navigator.clipboard.read()` where available, text
 * through `read()` or `readText()`. A refused or missing clipboard reads as empty.
 */
export async function readClipboard(): Promise<ClipboardContent> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  const out: ClipboardContent = { text: null, files: [] }
  if (!clip) return out
  if (typeof clip.read === 'function') {
    try {
      const items = await clip.read()
      for (const item of items) {
        const image = item.types.find((t) => t.startsWith('image/'))
        if (image) {
          const blob = await item.getType(image)
          out.files.push(new File([blob], pastedImageName(image), { type: image }))
        } else if (out.text === null && item.types.includes('text/plain')) {
          out.text = await (await item.getType('text/plain')).text()
        }
      }
      if (out.files.length || out.text !== null) return out
    } catch {
      /* fall back to readText */
    }
  }
  if (typeof clip.readText === 'function') {
    try {
      out.text = await clip.readText()
    } catch {
      /* refused */
    }
  }
  return out
}

/** The clipboard content of a native `paste` event (no permission prompt needed). */
export function contentOfPasteEvent(data: DataTransfer | null): ClipboardContent {
  const out: ClipboardContent = { text: null, files: [] }
  if (!data) return out
  const files = Array.from(data.files ?? [])
  out.files = files.filter((f) => f.type.startsWith('image/') || f.size > 0)
  const text = data.getData('text/plain')
  out.text = text ? text : null
  return out
}
