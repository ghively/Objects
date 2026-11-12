/**
 * The Markdown shortcuts that the built-in input rules do not cover, and their
 * combinations. The Shortcuts panel: "These are
 * markdown shortcuts that work at the start of a block. They can also be combined, but the Space
 * must only be used after the final command. Example: ">#Space" will create a heading 1 with a
 * toggle."
 *
 * Its list: Quote `|`, Toggle `>`, Bullet `*` or `-`, Numbered `1.`, Alphabetical `a)`, Roman
 * `i)`, To-do `[]`, Icon `()`, Heading `#` to `####`, each then Space; Horizontal line `---`.
 *
 * One rule reads the whole run of marks before the Space. A run that is a single bullet, number or
 * heading mark is left to the built-in rules (StarterKit's), which already convert it; everything
 * else is handled here, so `> ` makes a toggle rather than StarterKit's quote, and
 * `[] ` a to-do list like the menus make. The marks apply inside out: heading, icon, quote, list,
 * toggle (a toggle holds whatever the other marks made). A run with two marks of one kind (two
 * lists, two headings) is not a shortcut and stays text (our choice).
 *
 * M32: the GitHub way of writing a to-do works too. `[ ] ` and `[x] ` (or `[X] `) at the start of
 * a text line make an unchecked or a checked to-do, and so `- [ ] `, `* [ ] ` and `- [x] ` do: the
 * `- ` has made a bullet by then, and the box turns that bullet line into a to-do (only that
 * line, when the list has others). In a numbered list, a heading or an existing to-do the
 * characters stay text.
 *
 * M33: Settings > Editor > 'Typing "> " makes' (`greaterThanMakes`). With "A toggle" (the default)
 * nothing here changes. With "A quote" the `>` mark is the quote mark, as `|` is: `> ` makes the
 * quote block `| ` makes, and in a combined run it quotes too (`>#` a quoted heading; `>|` is two
 * marks of one kind and stays text). The toggle keeps its other ways in (the slash menu, the
 * menus). The setting is read when the Space is typed, so changing it needs no reload.
 */
import { Extension, InputRule } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useSettings } from '@/settings/useSettings'
import type { Hierarchy, ListType } from '../nodes/blockOptions'
import { listItemAt } from '../nodes/listItemOptions'

/**
 * The icon `()` gives a block. Object keeps no last-used block icon setting, so this one icon
 * (our choice).
 */
export const BLOCK_ICON_DEFAULT = 'ph-star'

type Parsed = { heading?: number; list?: ListType; quote?: boolean; toggle?: boolean; icon?: boolean; count: number }

const TOKEN = /\||>|\(\)|\[\]|[*-]|\d+\.|a\)|i\)|#{1,4}/y

/** What the `>` mark makes (the device setting `greaterThanMakes`). */
export type GreaterThanMakes = 'toggle' | 'quote'

/**
 * The marks in `run`, or null when it is not a run of marks (or repeats a kind). `greaterThan`:
 * what `>` is, a toggle (the default) or a second way to write the quote mark.
 */
export function parseMarks(run: string, numbered = true, greaterThan: GreaterThanMakes = 'toggle'): Parsed | null {
  const out: Parsed = { count: 0 }
  TOKEN.lastIndex = 0
  while (TOKEN.lastIndex < run.length) {
    const m = TOKEN.exec(run)
    if (!m) return null
    const t = m[0]
    out.count++
    if (t === '|' || (t === '>' && greaterThan === 'quote')) {
      if (out.quote) return null
      out.quote = true
    } else if (t === '>') {
      if (out.toggle) return null
      out.toggle = true
    } else if (t === '()') {
      if (out.icon) return null
      out.icon = true
    } else if (t.startsWith('#')) {
      if (out.heading) return null
      out.heading = t.length
    } else {
      if (out.list) return null
      if (/^\d/.test(t) && !numbered) return null
      out.list = t === '[]' ? 'todo' : t === 'a)' ? 'alphabetical' : t === 'i)' ? 'roman' : /^\d/.test(t) ? 'numerical' : 'bullet'
    }
  }
  return out.count ? out : null
}

/** A run the built-in rules convert on their own: one bullet, number or heading mark. */
function builtIn(run: string): boolean {
  return /^(?:[*-]|\d+\.|#{1,4})$/.test(run)
}

export type MarkdownShortcutsOptions = {
  /** `false` when numbered-list detection is off (`1.` is then no mark, alone or combined). */
  numbered: boolean
  /**
   * M33: what `>` makes, asked each time a run is typed. The default reads the device setting
   * `greaterThanMakes` then, so a change in Settings applies to the next key.
   */
  greaterThanMakes: () => GreaterThanMakes
}

/** The device setting, as it is now (anything but `quote` is the default, a toggle). */
function greaterThanSetting(): GreaterThanMakes {
  return useSettings.getState().settings.greaterThanMakes === 'quote' ? 'quote' : 'toggle'
}

export const MarkdownShortcuts = Extension.create<MarkdownShortcutsOptions>({
  name: 'markdownShortcuts',
  // Before StarterKit's rules (default 100), whose `> ` would make a quote.
  priority: 200,

  addOptions() {
    return { numbered: true, greaterThanMakes: greaterThanSetting }
  },

  addInputRules() {
    const numbered = this.options.numbered
    const greaterThan = this.options.greaterThanMakes
    return [
      // M32: `[ ] ` / `[x] ` at the start of a text line or of a bullet line.
      new InputRule({
        find: /^\[([ xX])\] $/,
        handler: ({ state, range, match, chain }) => {
          const checked = match[1] !== ' '
          const $from = state.doc.resolve(range.from)
          const d = $from.depth
          if ($from.parent.type.name !== 'paragraph' || d < 1) return null
          const holder = $from.node(d - 1)
          const taskItem = state.schema.nodes.taskItem
          const taskList = state.schema.nodes.taskList
          if (!taskItem || !taskList) return null
          if (holder.type.name === 'taskItem') return null
          if (holder.type.name === 'listItem') {
            // A bullet line (`- ` was typed first): this line becomes a to-do, the others stay.
            const list = $from.node(d - 2)
            if (list.type.name !== 'bulletList' || $from.index(d - 1) !== 0) return null
            const itemPos = $from.before(d - 1)
            const listPos = $from.before(d - 2)
            chain()
              .deleteRange(range)
              .command(({ tr }) => {
                const item = tr.doc.nodeAt(itemPos)
                if (!item) return false
                tr.setNodeMarkup(itemPos, taskItem, { ...item.attrs, checked })
                // A list of to-dos only is a to-do list (as the menus make it).
                const now = tr.doc.nodeAt(listPos)
                let all = !!now
                now?.forEach((child) => {
                  if (child.type !== taskItem) all = false
                })
                if (now && all) tr.setNodeMarkup(listPos, taskList, now.attrs)
                return true
              })
              .run()
            return
          }
          chain()
            .deleteRange(range)
            .setListType('todo')
            .command(({ tr }) => {
              if (!checked) return true
              const $at = tr.selection.$from
              for (let depth = $at.depth; depth >= 1; depth--) {
                if ($at.node(depth).type !== taskItem) continue
                tr.setNodeMarkup($at.before(depth), undefined, { ...$at.node(depth).attrs, checked: true })
                break
              }
              return true
            })
            .run()
        },
      }),
      new InputRule({
        find: /^([|>()[\]*#\-.\dai]+) $/,
        handler: ({ state, range, match, chain }) => {
          const run = match[1]
          if (builtIn(run)) return null
          const marks = parseMarks(run, numbered, greaterThan())
          if (!marks) return null
          const $from = state.doc.resolve(range.from)
          const block = $from.parent
          if (block.type.name !== 'paragraph' && block.type.name !== 'heading') return null
          const blockPos = $from.before()

          let c = chain().deleteRange(range)
          if (marks.heading) c = c.setHierarchy(`H${marks.heading}` as Hierarchy)
          // An icon on the text block itself; in a list it goes on the item (below). A block icon
          // is saved only on a top-level text block, never inside a quote, so a quote skips it
          // (the quote is still made) rather than show an icon that is lost on save.
          if (marks.icon && !marks.list && !marks.quote) c = c.setBlockOption('icon', BLOCK_ICON_DEFAULT, blockPos)
          if (marks.quote) c = c.wrapIn('blockquote')
          if (marks.list) c = c.setListType(marks.list)
          if (marks.icon && marks.list)
            c = c.command(({ tr, commands }) => {
              if (!listItemAt(tr)) return true
              // The item's comment goes at the end of its first line; keep the caret before it,
              // so what is typed next comes before the comment (`- Text <!-- item: … -->`).
              const caret = tr.selection.from
              commands.setListItemOptions({ icon: BLOCK_ICON_DEFAULT })
              tr.setSelection(TextSelection.create(tr.doc, caret))
              return true
            })
          if (marks.toggle) {
            let caret = 0
            c = c
              .command(({ tr }) => {
                caret = tr.selection.from
                return true
              })
              .wrapInToggle()
              // The toggle replaces the blocks it wraps: put the caret back, one level deeper.
              .command(({ tr }) => {
                tr.setSelection(TextSelection.create(tr.doc, caret + 1))
                return true
              })
          }
          c.run()
        },
      }),
    ]
  },
})
