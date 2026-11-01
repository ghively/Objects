/**
 * The to-do list's Markdown tokenizer, made to follow CommonMark's list rules.
 *
 * `@tiptap/extension-list`'s own task-list tokenizer reads one line per item:
 * a lazy continuation line (`- [ ] Patch the hosts` then `Details in ….` with
 * no indent) ends the list and becomes a separate paragraph, and an indented
 * continuation line becomes a second paragraph. Either way the block no longer
 * matched its source and loaded as a raw block (known issue 6). Here the list's
 * extent and each item's content come from marked's GFM list tokenizer (lazy
 * lines, indented lines and nested lists as CommonMark reads them), and each
 * item's content is lexed again by the editor's own lexer, so wikilinks, inline
 * math and nested to-dos still parse.
 *
 * A list mixing to-dos and plain items (as GFM renders it) is one list here
 * too: a bullet list whose to-do items are task items (`withTaskItems` lets
 * `bulletList` hold them). Left to `@tiptap/markdown`, such a list is split
 * into a task list and a bullet list, which no longer matches its source. `[X]`
 * counts as done, like `[x]`.
 */
import type { AnyExtension } from '@tiptap/core'
import { TaskList } from '@tiptap/extension-list'
import { Marked, type Tokens } from 'marked'

type Helpers = { inlineTokens: (src: string) => unknown[]; blockTokens: (src: string) => unknown[] }
type Tokenizer = {
  name: string
  level?: 'block' | 'inline'
  start?: (src: string) => number
  tokenize: (src: string, tokens: unknown[], helpers: Helpers) => unknown
}
type ParseHelpers = { createNode: (type: string, attrs: Record<string, unknown>, content: unknown[]) => unknown; parseChildren: (tokens: unknown[]) => unknown[] }
type ListToken = { type: string; raw: string; items: unknown[]; mixed?: boolean }

const original = TaskList.config.markdownTokenizer as Tokenizer | undefined
const gfm = new Marked({ gfm: true })
const LIST_LINE = /^[ \t]*[-+*](?:[ \t]|$)/
const TASK_LINE = /^[ \t]*[-+*][ \t]+\[[ xX]\](?:[ \t]|$)/
const TASK_BOX = /\[[ xX]\]/
/** A blank line followed by a line that is neither indented nor a bullet ends every list. */
const LIST_END = /\n[ \t]*\n(?![ \t]|[-+*](?:[ \t]|$))/

/** The item's blocks lexed again by the editor's lexer: `[main text, ...nested]`. */
function itemBlocks(item: Tokens.ListItem, helpers: Helpers): { main: string; head: { type: string; text?: string } | undefined; nested: { type: string }[] } {
  const blocks = helpers.blockTokens(`${item.text}\n`) as { type: string; text?: string }[]
  const head = blocks[0]
  const isText = !!head && (head.type === 'paragraph' || head.type === 'text')
  return { main: isText ? (head.text ?? '') : '', head: isText ? head : undefined, nested: (isText ? blocks.slice(1) : blocks).filter((t) => t.type !== 'space') }
}

/** A to-do item as `TaskItem.parseMarkdown` reads it. */
function taskItemToken(item: Tokens.ListItem, helpers: Helpers): unknown {
  const { main, nested } = itemBlocks(item, helpers)
  return {
    type: 'taskItem',
    raw: '',
    mainContent: main,
    indentLevel: item.raw.length - item.raw.trimStart().length,
    checked: !!item.checked,
    text: main,
    tokens: helpers.inlineTokens(main),
    nestedTokens: nested,
  }
}

/** A plain item of a mixed list as `ListItem.parseMarkdown` reads it (marked's own shape, re-lexed). */
function listItemToken(item: Tokens.ListItem, helpers: Helpers): unknown {
  return { type: 'list_item', raw: item.raw, task: false, loose: item.loose, text: item.text, tokens: helpers.blockTokens(`${item.text}\n`) }
}

/** The task-list token for `src` when it starts with a bullet list holding a to-do, or undefined. */
function tokenizeTaskList(src: string, tokens: unknown[], helpers: Helpers): unknown {
  if (!LIST_LINE.test(src)) return undefined
  // Only the list itself is lexed (`src` is the rest of the document), and only when it may hold a box.
  const end = src.search(LIST_END)
  const own = end >= 0 ? src.slice(0, end + 1) : src
  if (!TASK_BOX.test(own)) return undefined
  const fallback = () => (TASK_LINE.test(src) ? original?.tokenize(src, tokens, helpers) : undefined)
  let list: Tokens.List | undefined
  try {
    const first = gfm.lexer(own)[0]
    list = first?.type === 'list' ? (first as Tokens.List) : undefined
  } catch {
    return fallback()
  }
  if (!list || list.ordered || !list.items.length || !list.items.some((i) => i.task)) return fallback()
  if (!src.startsWith(list.raw)) return fallback()
  const mixed = !list.items.every((i) => i.task)
  const items = list.items.map((item) => (item.task ? taskItemToken(item, helpers) : listItemToken(item, helpers)))
  return { type: 'taskList', raw: list.raw, items, mixed } satisfies ListToken
}

export const TaskListCommonMark = TaskList.extend({
  markdownTokenizer: {
    name: 'taskList',
    level: 'block',
    start(src: string) {
      const index = src.match(/^\s*[-+*]\s+\[([ xX])\]\s+/)?.index
      return index !== undefined ? index : -1
    },
    tokenize: tokenizeTaskList,
  } as never,

  // A mixed list is a bullet list with task items.
  parseMarkdown: ((token: ListToken, h: ParseHelpers) =>
    h.createNode(token.mixed ? 'bulletList' : 'taskList', {}, h.parseChildren(token.items ?? []))) as never,
})

/** StarterKit's `bulletList` taking task items too (a list mixing to-dos and plain items). */
export function withTaskItems<T extends AnyExtension>(ext: T): T {
  if (ext.name !== 'bulletList') return ext
  return ext.extend({ content: '(listItem | taskItem)+' }) as T
}
