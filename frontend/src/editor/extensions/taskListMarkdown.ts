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
 * math and nested to-dos still parse. Mixed lists (some items without a box)
 * keep the original tokenizer.
 */
import { TaskList } from '@tiptap/extension-list'
import { Marked, type Tokens } from 'marked'

type Helpers = { inlineTokens: (src: string) => unknown[]; blockTokens: (src: string) => unknown[] }
type Tokenizer = {
  name: string
  level?: 'block' | 'inline'
  start?: (src: string) => number
  tokenize: (src: string, tokens: unknown[], helpers: Helpers) => unknown
}

const original = TaskList.config.markdownTokenizer as Tokenizer | undefined
const gfm = new Marked({ gfm: true })
const TASK_LINE = /^[ \t]*[-+*][ \t]+\[[ xX]\](?:[ \t]|$)/

/** The task-list token for `src` (which starts with a to-do line), or undefined. */
function tokenizeTaskList(src: string, tokens: unknown[], helpers: Helpers): unknown {
  if (!TASK_LINE.test(src)) return undefined
  const fallback = () => original?.tokenize(src, tokens, helpers)
  let list: Tokens.List | undefined
  try {
    const first = gfm.lexer(src)[0]
    list = first?.type === 'list' ? (first as Tokens.List) : undefined
  } catch {
    return fallback()
  }
  if (!list || list.ordered || !list.items.length || !list.items.every((i) => i.task)) return fallback()
  if (!src.startsWith(list.raw)) return fallback()
  const items = list.items.map((item) => {
    const blocks = helpers.blockTokens(`${item.text}\n`) as { type: string; text?: string }[]
    const head = blocks[0]
    const isText = !!head && (head.type === 'paragraph' || head.type === 'text')
    const main = isText ? (head.text ?? '') : ''
    const nested = isText ? blocks.slice(1) : blocks
    return {
      type: 'taskItem',
      raw: '',
      mainContent: main,
      indentLevel: item.raw.length - item.raw.trimStart().length,
      checked: !!item.checked,
      text: main,
      tokens: helpers.inlineTokens(main),
      nestedTokens: nested.filter((t) => t.type !== 'space'),
    }
  })
  return { type: 'taskList', raw: list.raw, items }
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
})
