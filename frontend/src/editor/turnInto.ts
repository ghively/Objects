/**
 * Turn a block into an object, a task, a Task object or a whiteboard (M8).
 *
 * - `turnIntoObject` ("Turn into object"): the block's text
 *   becomes the title of a new object of type `typeId` (default: the Page type, our choice), its
 *   children the body, and the block becomes `![[Title]]` shown as a Link block (`view=inline`,
 *   our choice).
 * - `turnIntoTask` ("Turn into task"): the same with the Task type.
 * - `turnTodoIntoTask` ("Turn into task object"): a
 *   to-do becomes a Task titled with its text, status Done when it was checked; with a block
 *   selection, every to-do in it (our choice). Not a to-do: nothing happens.
 * - `turnIntoWhiteboard` ("Turn into whiteboard"): the selected
 *   blocks become a new board (`whiteboard/turnInto.ts`' `turnBlocksIntoWhiteboard`), titled with
 *   the first block's text (our choice), and are replaced by an embed of it.
 *
 * "The block" is the list item holding the caret (its first line the title, its nested blocks the
 * children), else the text block, or, when that is the first block of a toggle or indent
 * container, the container (its other blocks the children). With a block selection: its first
 * block (a list's first item). A block without text is left alone. Each resolves `true` when it
 * changed the document. `pos` names the block (default: the selection).
 */
import type { Editor } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { api } from '@/api/client'
import type { TypeDef } from '@/api/types'
import { invalidateLinkIndex, stemOf, summaryOf, typeOf, useLinkIndex } from '@/links/linkIndex'
import { turnBlocksIntoWhiteboard } from '@/whiteboard/turnInto'
import { firstOptionOf, statusDef } from '@/tasks/statusCategory'
import { makeOption } from './annotations'
import { BLOCK_ID_SUFFIX } from './blocks'
import { blockSelectionRange, blocksSource, type BlockRange } from './extensions/blockSelection'
import { showToast } from './media/upload'

export type TurnIntoOptions = { pos?: number }

export const TURN_INTO_WHITEBOARD_FAILED = "The whiteboard wasn't created"

const LISTS = new Set(['bulletList', 'orderedList', 'taskList'])
const ITEMS = new Set(['listItem', 'taskItem'])
const CONTAINERS = new Set(['toggle', 'indent'])

/** A block to turn: the node replaced by the embed, its title and its children. */
interface Turnable {
  node: PMNode
  /** `item`: a list item (the list is split around it); `block`: any other block. */
  kind: 'item' | 'block'
  title: string
  children: PMNode[]
  checked: boolean
  todo: boolean
}

/** The plain text of a text block, without a trailing block id. */
function titleOf(node: PMNode): string {
  return node.textContent.replace(BLOCK_ID_SUFFIX, '').replace(/\s+/g, ' ').trim()
}

function itemTurnable(item: PMNode): Turnable | null {
  const first = item.firstChild
  if (!first?.isTextblock) return null
  const children: PMNode[] = []
  item.forEach((child, _offset, i) => {
    if (i > 0) children.push(child)
  })
  const todo = item.type.name === 'taskItem'
  return { node: item, kind: 'item', title: titleOf(first), children, checked: todo && !!item.attrs.checked, todo }
}

function blockTurnable(node: PMNode): Turnable | null {
  if (ITEMS.has(node.type.name)) return itemTurnable(node)
  if (LISTS.has(node.type.name)) return node.firstChild ? itemTurnable(node.firstChild) : null
  if (CONTAINERS.has(node.type.name)) {
    const first = node.firstChild
    if (!first?.isTextblock) return null
    const children: PMNode[] = []
    node.forEach((child, _o, i) => {
      if (i > 0) children.push(child)
    })
    return { node, kind: 'block', title: titleOf(first), children, checked: false, todo: false }
  }
  if (node.isTextblock && node.type.name !== 'codeBlock') {
    return { node, kind: 'block', title: titleOf(node), children: [], checked: false, todo: false }
  }
  return null
}

/** The block at `pos` (or the selection) as a `Turnable`, or null. */
function turnableAt(editor: Editor, pos?: number): Turnable | null {
  const { state } = editor
  if (pos == null) {
    const range = blockSelectionRange(state)
    if (range) return blockTurnable(range.blocks[0].node)
  }
  const at = pos ?? state.selection.from
  const node = state.doc.nodeAt(at)
  if (pos != null && node && !node.isText) return blockTurnable(node)
  const $pos = state.doc.resolve(at)
  for (let d = $pos.depth; d >= 1; d--) {
    const n = $pos.node(d)
    if (ITEMS.has(n.type.name)) return itemTurnable(n)
  }
  for (let d = $pos.depth; d >= 1; d--) {
    const n = $pos.node(d)
    if (n.isTextblock) {
      const parent = $pos.node(d - 1)
      if (CONTAINERS.has(parent.type.name) && $pos.index(d - 1) === 0) return blockTurnable(parent)
      return blockTurnable(n)
    }
  }
  const sel = state.selection as { node?: PMNode }
  return sel.node ? blockTurnable(sel.node) : null
}

/** Every to-do in the block selection (or the one at the caret). */
function todosAt(editor: Editor, pos?: number): Turnable[] {
  const range = pos == null ? blockSelectionRange(editor.state) : null
  if (!range) {
    const t = turnableAt(editor, pos)
    return t?.todo ? [t] : []
  }
  const out: Turnable[] = []
  for (const b of range.blocks) {
    b.node.descendants((n) => {
      if (n.type.name === 'taskItem') {
        const t = itemTurnable(n)
        if (t) out.push(t)
        return false
      }
      return true
    })
  }
  return out
}

/** The Markdown of `nodes` as top-level blocks (the editor's serializer; unedited bytes kept). */
function markdownOf(editor: Editor, nodes: PMNode[]): string {
  if (nodes.length === 0) return ''
  const range = { blocks: nodes.map((node) => ({ node, pos: 0 })) } as unknown as BlockRange
  return blocksSource(editor, range)
}

/** Where `node` (by identity) sits in `doc` now, or -1. */
function findNode(doc: PMNode, node: PMNode): number {
  let found = -1
  doc.descendants((n, pos) => {
    if (found >= 0) return false
    if (n === node) {
      found = pos
      return false
    }
    return true
  })
  return found
}

/** The link text for the object at `path` titled `title`: the title, or the path when another object shares it. */
function linkTarget(path: string, title: string): string {
  const key = title.trim().toLowerCase()
  const clash = useLinkIndex.getState().objects.some((o) => o.path !== path && o.title.trim().toLowerCase() === key)
  return clash || !title.trim() ? path.replace(/\.md$/i, '') : title
}

/** A Link-block embed of `target` (attributes the schema lacks are ignored by `create`). */
function embedNode(editor: Editor, target: string, trailing: unknown): PMNode {
  return editor.schema.nodes.objectEmbed.create({
    target,
    label: null,
    blockOptions: [makeOption('view', 'inline')],
    blockTrailing: trailing ?? null,
  })
}

/** Replace each `[node, target]` with a Link-block embed of `target`, in one transaction. */
function replaceWithEmbeds(editor: Editor, items: { t: Turnable; target: string }[]): boolean {
  const tr = editor.state.tr
  let changed = false
  // Last first, so earlier positions stay valid; each node is found again by identity.
  for (const { t, target } of [...items].reverse()) {
    const pos = findNode(tr.doc, t.node)
    if (pos < 0) continue
    if (t.kind === 'block') {
      tr.replaceWith(pos, pos + t.node.nodeSize, embedNode(editor, target, t.node.attrs.blockTrailing))
      changed = true
      continue
    }
    const $pos = tr.doc.resolve(pos)
    const list = $pos.parent
    const listPos = $pos.before()
    const index = $pos.index()
    const beforeItems: PMNode[] = []
    const afterItems: PMNode[] = []
    list.forEach((child, _o, i) => {
      if (i < index) beforeItems.push(child)
      else if (i > index) afterItems.push(child)
    })
    const fresh = (content: PMNode[], trailing: unknown) =>
      list.type.create({ ...list.attrs, blockSource: null, blockTrailing: trailing ?? null }, Fragment.fromArray(content), list.marks)
    const parts: PMNode[] = []
    if (beforeItems.length) parts.push(fresh(beforeItems, null))
    parts.push(embedNode(editor, target, afterItems.length ? null : list.attrs.blockTrailing))
    if (afterItems.length) parts.push(fresh(afterItems, list.attrs.blockTrailing))
    tr.replaceWith(listPos, listPos + list.nodeSize, parts)
    changed = true
  }
  if (changed) editor.view.dispatch(tr)
  return changed
}

function basicType(name: string): TypeDef | undefined {
  const types = useLinkIndex.getState().types
  return types.find((t) => t.basic && t.name.toLowerCase() === name) ?? typeOf(name.charAt(0).toUpperCase() + name.slice(1))
}

const taskTypeId = () => basicType('task')?.id ?? 'Task'

/** Create the object for `t` (title, and its children as the body); returns the embed target. */
async function createFor(editor: Editor, t: Turnable, typeId: string, values?: Record<string, unknown>): Promise<string> {
  const body = markdownOf(editor, t.children)
  // The children go below the new object's own body (its heading or template) in the creating
  // write, so a creation rule's write can't come between the object and its text.
  const created = await api.createObject(typeId, {
    title: t.title,
    ...(values && Object.keys(values).length ? { values } : {}),
    ...(body.trim() ? { appendBody: body } : {}),
  })
  void invalidateLinkIndex()
  return linkTarget(created.path, t.title)
}

async function turnWith(editor: Editor, turnables: Turnable[], typeOfItem: (t: Turnable) => { typeId: string; values?: Record<string, unknown> }): Promise<boolean> {
  const live = turnables.filter((t) => t.title)
  if (!editor.isEditable || live.length === 0) return false
  const done: { t: Turnable; target: string }[] = []
  for (const t of live) {
    const { typeId, values } = typeOfItem(t)
    done.push({ t, target: await createFor(editor, t, typeId, values) })
  }
  if (editor.isDestroyed) return false
  return replaceWithEmbeds(editor, done)
}

export async function turnIntoObject(editor: Editor, typeId?: string | null, opts: TurnIntoOptions = {}): Promise<boolean> {
  const t = turnableAt(editor, opts.pos)
  if (!t) return false
  const tid = typeId || basicType('page')?.id || useLinkIndex.getState().types.find((x) => !x.readOnlyReason)?.id || 'Page'
  return turnWith(editor, [t], () => ({ typeId: tid }))
}

/** The Task values for a to-do: status Done when it was checked. */
function taskValues(t: Turnable): Record<string, unknown> | undefined {
  if (!t.checked) return undefined
  const type = typeOf(taskTypeId())
  const done = firstOptionOf(type, 'done')
  return done ? { [statusDef(type)?.key ?? 'status']: [done.text] } : undefined
}

export async function turnIntoTask(editor: Editor, opts: TurnIntoOptions = {}): Promise<boolean> {
  const t = turnableAt(editor, opts.pos)
  if (!t) return false
  return turnWith(editor, [t], (x) => ({ typeId: taskTypeId(), values: taskValues(x) }))
}

export async function turnTodoIntoTask(editor: Editor, opts: TurnIntoOptions = {}): Promise<boolean> {
  return turnWith(editor, todosAt(editor, opts.pos), (x) => ({ typeId: taskTypeId(), values: taskValues(x) }))
}

/** Is there a to-do at the selection (the block menu shows "Turn into task object" then)? */
export function hasTodoAt(editor: Editor): boolean {
  return todosAt(editor).length > 0
}

type BoardHelper = (blocks: string[], title: string) => Promise<string>

let boardHelperOverride: BoardHelper | null = null

/** Tests: use `fn` instead of the whiteboard module's helper (`null` restores it). */
export function setBoardHelperForTests(fn: BoardHelper | null): void {
  boardHelperOverride = fn
}

/** `whiteboard/turnInto.ts`' helper (Task 22; imported statically, as `AddToWhiteboardDialog` does). */
async function boardHelper(): Promise<BoardHelper> {
  return boardHelperOverride ?? turnBlocksIntoWhiteboard
}

export async function turnIntoWhiteboard(editor: Editor): Promise<boolean> {
  const range = blockSelectionRange(editor.state) ?? null
  let nodes: PMNode[]
  if (range) nodes = range.blocks.map((b) => b.node)
  else {
    const t = turnableAt(editor)
    if (!t) return false
    // The top-level block holding the caret.
    const $pos = editor.state.doc.resolve(editor.state.selection.from)
    nodes = [$pos.depth >= 1 ? $pos.node(1) : t.node]
  }
  if (!editor.isEditable || nodes.length === 0) return false
  const blocks = nodes.map((n) => markdownOf(editor, [n]).replace(/\s+$/, ''))
  const firstText = nodes.map((n) => n.textContent.replace(BLOCK_ID_SUFFIX, '').trim()).find(Boolean) ?? ''
  const title = firstText.split('\n')[0].slice(0, 80).trim() || 'Untitled whiteboard'
  const helper = await boardHelper()
  let path: string
  try {
    path = await helper(blocks, title)
  } catch (err) {
    showToast(TURN_INTO_WHITEBOARD_FAILED)
    throw err
  }
  void invalidateLinkIndex()
  if (editor.isDestroyed) return false
  const tr = editor.state.tr
  const first = findNode(tr.doc, nodes[0])
  const last = findNode(tr.doc, nodes[nodes.length - 1])
  if (first < 0 || last < 0) return false
  const end = last + nodes[nodes.length - 1].nodeSize
  const boardTitle = summaryOf(path)?.title || stemOf(path).replace(/\.whiteboard$/i, '') || title
  const embed = editor.schema.nodes.objectEmbed.create({
    target: linkTarget(path, boardTitle),
    label: null,
    blockTrailing: nodes[nodes.length - 1].attrs.blockTrailing ?? null,
  })
  tr.replaceWith(first, end, embed)
  editor.view.dispatch(tr)
  return true
}
