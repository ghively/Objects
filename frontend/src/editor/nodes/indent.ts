/**
 * `indent` (M8): indented (child) blocks under a non-list block. In the file:
 *
 *   <!-- indent -->
 *   The parent paragraph
 *
 *   An indented child
 *   <!-- /indent -->
 *
 * The first block inside is the parent, the rest are its indented children:
 * the toggle's shape without collapsing (M7's annotation grammar, a new
 * container name). Plain rendering here (the children padded in, with the
 * outliner line unless `hideOutlinerLines`); Task 26 draws the finer styles.
 *
 * Commands: `indentBlock()` nests the block at the cursor under the block
 * before it (into that block's `indent` container or toggle when it has one,
 * else a new container holding both); `unindentBlock()` moves an indented
 * child out after its container, the children that followed it becoming its
 * own (outliner semantics). Neither rewrites a child: the children keep their
 * nodes, so their bytes stay as they were.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { containerSourceAttributes } from './containers'
import { BLOCK_PARENTS, leafBlockAt } from './blockOptions'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      /** Indent the block at the cursor under the block before it. */
      indentBlock: () => ReturnType
      /** Move an indented block out of its `indent` container. */
      unindentBlock: () => ReturnType
    }
  }
}

const trailingOf = (n: PMNode) => (n.attrs.blockTrailing as string | null | undefined) ?? null

/**
 * The blank lines a block gets when it takes over a container's trailing: a
 * container's last child keeps its own line end in its source, and the
 * container's trailing starts with the close line's, so one is dropped (as
 * `unwrapAt` does).
 */
function trailingAfter(n: PMNode, trailing: string | null): string | null {
  if (!trailing) return trailing
  const source = String(n.attrs.blockOrigin ?? '')
  const eol = /\r\n$/.exec(source)?.[0] ?? /\n$/.exec(source)?.[0] ?? /\r$/.exec(source)?.[0] ?? ''
  if (!eol || !trailing.startsWith(eol)) return trailing
  const rest = trailing.slice(eol.length)
  return rest === '' ? null : rest
}

function withTrailing(n: PMNode, trailing: string | null): PMNode {
  if (!('blockTrailing' in n.attrs) || trailingOf(n) === trailing) return n
  return n.type.create({ ...n.attrs, blockTrailing: trailing }, n.content, n.marks)
}

/** The block at the cursor that sits directly in a block parent, with its parent and index. */
function cursorBlock(tr: Transaction) {
  const leaf = leafBlockAt(tr.selection.$from)
  if (!leaf) return null
  const $pos = tr.doc.resolve(leaf.pos)
  if (!BLOCK_PARENTS.has($pos.parent.type.name)) return null
  return { ...leaf, parent: $pos.parent, index: $pos.index(), parentPos: $pos.depth > 0 ? $pos.before() : -1 }
}

/** Keep the cursor at the same offset inside the moved block. */
function restoreCursor(tr: Transaction, blockPos: number, offset: number) {
  const pos = Math.min(blockPos + offset, tr.doc.content.size)
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
}

export function indentBlockIn(tr: Transaction): boolean {
  const found = cursorBlock(tr)
  if (!found || found.index === 0) return false
  const { node, pos, parent, index } = found
  const offset = tr.selection.from - pos
  const prev = parent.child(index - 1)
  const prevPos = pos - prev.nodeSize
  const schema = tr.doc.type.schema

  if (prev.type.name === 'indent' || prev.type.name === 'toggle') {
    // Append to the container before: its last child gets the blank lines that followed the container.
    const children: PMNode[] = []
    prev.forEach((c) => children.push(c))
    const last = children.length - 1
    children[last] = withTrailing(children[last], trailingAfter(children[last], trailingOf(prev)) ?? trailingOf(children[last]))
    children.push(withTrailing(node, null))
    const container = prev.type.create({ ...prev.attrs, blockTrailing: trailingOf(node) }, children)
    tr.replaceWith(prevPos, pos + node.nodeSize, container)
    const childPos = prevPos + 1 + children.slice(0, -1).reduce((n, c) => n + c.nodeSize, 0)
    restoreCursor(tr, childPos, offset)
    return true
  }

  const container = schema.nodes.indent.create({ blockOptions: [], blockTrailing: trailingOf(node) }, [
    prev,
    withTrailing(node, null),
  ])
  tr.replaceWith(prevPos, pos + node.nodeSize, container)
  restoreCursor(tr, prevPos + 1 + prev.nodeSize, offset)
  return true
}

export function unindentBlockIn(tr: Transaction): boolean {
  const found = cursorBlock(tr)
  if (!found || found.parent.type.name !== 'indent' || found.index === 0) return false
  const { node, pos, parent: container, index, parentPos } = found
  const offset = tr.selection.from - pos
  const children: PMNode[] = []
  container.forEach((c) => children.push(c))
  const before = children.slice(0, index)
  const after = children.slice(index + 1)
  const out: PMNode[] = []

  // The container keeps the blocks before; with only its parent left it is unwrapped.
  const lastBefore = before[before.length - 1]
  if (before.length === 1) out.push(before[0])
  else {
    before[before.length - 1] = withTrailing(lastBefore, null)
    out.push(container.type.create({ ...container.attrs, blockTrailing: trailingOf(lastBefore) }, before))
  }

  const containerTrailing = trailingOf(container)
  if (after.length === 0) out.push(withTrailing(node, trailingAfter(node, containerTrailing)))
  else {
    const schema = tr.doc.type.schema
    const lastAfter = after.length - 1
    after[lastAfter] = withTrailing(after[lastAfter], null)
    out.push(schema.nodes.indent.create({ blockOptions: [], blockTrailing: containerTrailing }, [node, ...after]))
  }

  tr.replaceWith(parentPos, parentPos + container.nodeSize, out)
  const movedPos = parentPos + out[0].nodeSize + (after.length === 0 ? 0 : 1)
  restoreCursor(tr, movedPos, offset)
  return true
}

export const Indent = Node.create({
  name: 'indent',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return containerSourceAttributes()
  },

  parseHTML() {
    return [{ tag: 'div[data-indent]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-indent': '', class: 'block-indent' }), 0]
  },

  renderMarkdown(node: { content?: unknown[] }, h: { renderChildren: (c: unknown[], sep: string) => string }) {
    return node.content ? h.renderChildren(node.content, '\n\n') : ''
  },

  addCommands() {
    return {
      indentBlock:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) return cursorBlock(tr) !== null && cursorBlock(tr)!.index > 0
          return indentBlockIn(tr)
        },
      unindentBlock:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) {
            const f = cursorBlock(tr)
            return !!f && f.parent.type.name === 'indent' && f.index > 0
          }
          return unindentBlockIn(tr)
        },
    }
  },
})
