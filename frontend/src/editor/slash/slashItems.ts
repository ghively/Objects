/**
 * The `/` menu's sections and items, in Capacities' order. Strings and icons
 * are Capacities' own (keys beside each; reference check 2026-10-28, 2d).
 *
 * Images, PDFs, audio, video and files are not slash items in Capacities, and
 * not here: they are dropped or pasted into the editor (`extensions/fileDrop`).
 * "Reuse any content" is ours (not one of CreateMenu's sections): it is the
 * only way to insert an object, collection or query embed.
 *
 * Each item's `run` is called after the `/query` text has been removed. It may
 * return a sub-view for the menu to show next (the icon picker, the bookmark
 * URL field).
 */
import type { Editor } from '@tiptap/core'
import { api } from '@/api/client'
import type { Collection, Query, TypeDef } from '@/api/types'
import { useDefs } from '@/types/useDefinitions'
import { NOT_AVAILABLE, NotBuiltYet } from '@/lib/notBuilt'
import { zonedToday } from '@/lib/zonedTime'
import { addDays as addDayStr } from '@/calendar/dates'
import { recordAudio } from '../media/recordAudio'
import { showToast } from '../media/upload'
import { couldBeDate, parseDate } from './parseDate'
import { fuzzyScore } from '@/links/LinkPicker'
import { stemOf } from '@/links/linkIndex'
import { isWhiteboardType } from '@/whiteboard/isWhiteboard'
import { setBlockColor, setQuote } from '../menus/BlockStyleMenu'
import { BLOCK_COLORS, bgColorToken, colorMenuName, textColorToken } from '../menus/colors'
import type { Hierarchy, ListType } from '../nodes/blockOptions'
import { insertBlockNode } from '../nodes/containers'

export type SlashView = 'icon' | 'bookmark'

export type SectionId = 'blocks' | 'structure' | 'dates' | 'reuse'

export interface SlashItem {
  id: string
  name: string
  /** Shown as the tooltip of the row's right-hand `ph-text-align-justify` icon (on hover), not as a second line. */
  description?: string
  /** Capacities' `aliases.alias`: a short word the search also matches (`h1`, `todo`, `mmd`). */
  alias?: string
  /** An Iconify id (Phosphor, or a VS Code file icon). */
  icon: string
  /** The icon's colour (the colour items). */
  iconColor?: string
  run: (editor: Editor) => void | SlashView | Promise<void>
  /** M8: kept by the filter and listed first (the typed-date items). */
  pinned?: boolean
}

export interface SlashSection {
  id: SectionId
  label: string
  items: SlashItem[]
}

export const SLASH_TEXT = {
  blocks: 'Create a block', // CreateDropdown.sections.blocks.label
  structure: 'Create an object', // CreateDropdown.sections.structure.label
  dates: 'Link to a date', // CreateDropdown.sections.dates.label
  reuse: 'Reuse any content', // ControlDropdown.reuseContent.heading
  noResults: 'No results', // AppSettings.search.noResults
  pasteUrl: 'Paste URL', // EntityPicker.link.placeholder
  withEmptyTitle: (structureTitle: string) => `Create ${structureTitle}`, // ControlDropdown.structure.withEmptyTitle
  withPotentialTitle: (structureTitle: string, potentialTitle: string) =>
    `Create ${structureTitle} with title "${potentialTitle}"`, // ControlDropdown.structure.withPotentialTitle
}

export interface SlashContext {
  /** The text typed after `/`. */
  query: string
  /** The space's types (`useLinkIndex((s) => s.types)`). */
  types: TypeDef[]
  /** `DeviceSettings.twentyFourHourTime`. */
  twentyFourHourTime: boolean
  /** "Now" (tests pass a fixed date). */
  now?: Date
  /** M8: the collections and queries "Reuse any content" offers (default: the definitions store). */
  collections?: Pick<Collection, 'id' | 'name'>[]
  queries?: Pick<Query, 'id' | 'name'>[]
}

const block = (
  id: string,
  name: string,
  description: string | undefined,
  icon: string,
  run: SlashItem['run'],
  alias?: string,
): SlashItem => ({
  id,
  name,
  icon,
  run,
  ...(description === undefined ? {} : { description }),
  ...(alias === undefined ? {} : { alias }),
})

const hierarchy = (level: Hierarchy) => (e: Editor) => {
  e.chain().focus().setHierarchy(level).run()
}
const list = (type: ListType) => (e: Editor) => {
  e.chain().focus().setListType(type).run()
}

/**
 * The "Create a block" items, in Capacities' order (CreateMenu's
 * `[...operations, recordAudio, ...blocks]`): the `yke` operations without the
 * colour and AI ones, then Record audio, then the `Dee` blocks. Names,
 * descriptions, aliases and icons are Capacities' (`ControlDropdown.custom.*`,
 * `blocks.*`, `bke`). "Create bookmark" is ours (Capacities has no slash item
 * for it, and Object has no other way to insert one), last.
 */
export const BLOCK_ITEMS: readonly SlashItem[] = [
  // ControlDropdown.custom.block_Base.*
  block('Base', 'Standard', 'Turn block into a standard text block', 'ph-text-t', hierarchy('Base'), 'normal'),
  block('S', 'Small', 'Turn block into a small text block', 'ph-text-aa', hierarchy('S'), 'small'), // block_S
  block('H1', 'Heading 1', 'Block with a heading level 1', 'ph-text-h', hierarchy('H1'), 'h1'), // block_H1
  block('H2', 'Heading 2', 'Block with a heading level 2', 'ph-text-h-two', hierarchy('H2'), 'h2'),
  block('H3', 'Heading 3', 'Block with a heading level 3', 'ph-text-h-three', hierarchy('H3'), 'h3'),
  block('H4', 'Heading 4', 'Block with a heading level 4', 'ph-text-h-four', hierarchy('H4'), 'h4'),
  block('bullet', 'Bullet list', 'Add a bullet list to this block', 'ph-list-bullets', list('bullet'), 'list'), // block_bullet
  block('alphabetical', 'Alphabetical list', 'Add an alphabetical list to this block', 'ph-list-numbers', list('alphabetical')),
  block('numerical', 'Numbered list', 'Add a numbered list to this block', 'ph-list-numbers', list('numerical')),
  block('roman', 'Roman list', 'Add a roman list to this block', 'ph-list-numbers', list('roman')),
  block('quote', 'Quote block', 'Turn block into a quote block', 'ph-quotes', (e) => {
    setQuote(e, true) // block_quote
  }),
  block('todo', 'To-do', 'Add a To-do box to this block', 'ph-check-square', list('todo'), 'todo'), // block_todo
  block('toggle', 'Toggle', 'Add a toggle to this block', 'ph-caret-right-fill', (e) => {
    e.chain().focus().wrapInToggle().run() // block_toggle
  }),
  block('icon', 'Icon', 'Add an icon to this block', 'ph-smiley', () => 'icon', 'emoji'), // block_icon
  block('group', 'Group', 'A layout element to group multiple blocks into one container', 'ph-rectangle', (e) => {
    e.chain().focus().wrapInGroup().run() // block_group
  }),
  // CreateDropdown.recordAudio.*
  block('recordAudio', 'Record audio', 'Record audio and embed it at the cursor.', 'ph-microphone', (e) => {
    void recordAudio(e).catch((err) => {
      if (err instanceof NotBuiltYet) showToast(NOT_AVAILABLE)
    })
  }),
  block('math', 'Math', 'A display style math block', 'ph-function', (e) => {
    e.chain().focus().insertMathBlock().run() // blocks.MathBlock.*
  }),
  block('code', 'Code', 'A code block', 'ph-code', (e) => {
    e.chain().focus().setCodeBlock().run() // blocks.CodeBlock.*
  }),
  block('hr', 'Horizontal line', 'A horizontal line to separate different sections', 'ph-minus', (e) => {
    // blocks.HorizontalLineBlock.*: below the block (in place of it when empty).
    e.chain()
      .focus()
      .command(({ tr, state }) => {
        insertBlockNode(tr, state.schema.nodes.horizontalRule.create())
        return true
      })
      .run()
  }),
  block('columns', 'Two Columns', 'Multiple blocks groups next to each other', 'ph-columns', (e) => {
    e.chain().focus().insertColumns(2).run() // blocks.GridBlock.*
  }),
  block('table', 'Table', 'A simple block for tabular content', 'ph-table', (e) => {
    e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() // blocks.SimpleTableBlock.*
  }),
  block('bookmark', 'Create bookmark', undefined, 'ph-bookmark-simple', () => 'bookmark'), // pasteInput.bookmark (ours in this menu)
]

/**
 * The colour items, listed only while there is search text: the 18
 * backgrounds, then the 18 text colours (Capacities' `[...bgThemes,
 * ...textThemes]`), named `colorThemes.theme-<kind>-<c>` ("Blue background"),
 * drawn with `block_color_bg`'s `ph-stop` / `block_color_text`'s `ph-text-aa`
 * in the colour.
 */
export const COLOR_ITEMS: readonly SlashItem[] = (['bg', 'text'] as const).flatMap((kind) =>
  BLOCK_COLORS.map(
    (c): SlashItem => ({
      id: `color:${kind}-${c}`,
      name: colorMenuName(kind, c),
      icon: kind === 'bg' ? 'ph-stop' : 'ph-text-aa',
      iconColor: kind === 'bg' ? bgColorToken(c) : textColorToken(c),
      run: (e) => {
        setBlockColor(e, kind, c)
      },
    }),
  ),
)

/** "Mermaid Diagram" (alias `mmd`), listed only while there is search text: a code block in Mermaid. */
export const MERMAID_ITEM: SlashItem = block(
  'mermaid',
  'Mermaid Diagram',
  'A code block', // blocks.CodeBlock.description
  'vscode-icons-file-type-mermaid',
  (e) => {
    e.chain().focus().setCodeBlock({ language: 'mermaid' }).run()
  },
  'mmd',
)

const pad = (n: number) => String(n).padStart(2, '0')

/** The daily note's title for `d` (local date), `YYYY-MM-DD`. */
export function dailyNoteTitle(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The local time as text: `HH:mm`, or `h:mm AM/PM`. */
export function timestampText(d: Date, twentyFourHourTime: boolean): string {
  if (twentyFourHourTime) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const h = d.getHours() % 12 || 12
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}

function insertLink(e: Editor, target: string) {
  e.chain().focus().insertContent({ type: 'wikilink', attrs: { target, label: null } }).run()
}

function insertDateToken(e: Editor, day: string) {
  e.chain().focus().insertDateToken(day).run()
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A day `YYYY-MM-DD` as menu text, `Tue, Oct 27, 2026` (our format). */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${WEEKDAY_SHORT[weekday]}, ${MONTH_SHORT[m - 1]} ${d}, ${y}`
}

/**
 * The typed-date items (M8): for a query that names a day (`parseDate`), a
 * link to that daily note and a date token. Names are our strings, adapted
 * from `ControlDropdown.custom.entity_dailyNote_today` and `token_date`.
 */
export function typedDateItems(query: string, today: string): SlashItem[] {
  const day = parseDate(query, today)
  if (!day) return []
  const label = dayLabel(day)
  return [
    { id: `date:${day}`, name: label, description: 'Add a link to this daily note', icon: 'ph-calendar-blank', pinned: true, run: (e) => insertLink(e, day) },
    { id: `dateToken:${day}`, name: `${label} - date link`, description: 'Add a link to this date.', icon: 'ph-calendar-check', pinned: true, run: (e) => insertDateToken(e, day) },
  ]
}

/** The types offered in "Create an object" (whiteboards are created from "+ New"). */
export function creatableTypes(types: TypeDef[]): TypeDef[] {
  return types.filter((t) => !isWhiteboardType(t))
}

/** Create an object of `type` titled `title` and link it at the cursor. */
async function createAndLink(e: Editor, type: TypeDef, title: string): Promise<void> {
  const created = await api.createObject(type.id, title ? { title } : {})
  if (e.isDestroyed) return
  insertLink(e, title || stemOf(created.path))
}

/** Every section for `ctx`, unfiltered. */
export function slashSections(ctx: SlashContext): SlashSection[] {
  const now = () => ctx.now ?? new Date()
  // Today in the Time zone setting (M8); a test's fixed `now` is read as a local date.
  const today = () => (ctx.now ? dailyNoteTitle(ctx.now) : zonedToday())
  const title = ctx.query.trim()
  const defs = useDefs.getState()
  const collections = ctx.collections ?? defs.collections ?? []
  const queries = ctx.queries ?? defs.queries ?? []
  return [
    // The colour items and "Mermaid Diagram" only while searching (CreateMenu).
    { id: 'blocks', label: SLASH_TEXT.blocks, items: title ? [...BLOCK_ITEMS, ...COLOR_ITEMS, MERMAID_ITEM] : [...BLOCK_ITEMS] },
    {
      id: 'structure',
      label: SLASH_TEXT.structure,
      items: creatableTypes(ctx.types).map((t) => ({
        id: `structure:${t.id}`,
        name: title ? SLASH_TEXT.withPotentialTitle(t.name, title) : SLASH_TEXT.withEmptyTitle(t.name),
        icon: t.icon?.type === 'iconify' ? t.icon.val : 'ph-file-plus',
        run: (e: Editor) => createAndLink(e, t, title),
      })),
    },
    {
      id: 'dates',
      label: SLASH_TEXT.dates,
      items: [
        ...typedDateItems(ctx.query, today()),
        // ControlDropdown.custom.entity_dailyNote_*, token_date, token_time
        block('today', 'Today', "Add a link to today's daily note", 'ph-calendar-blank', (e) => insertLink(e, today())),
        block('tomorrow', 'Tomorrow', "Add a link to tomorrow's daily note", 'ph-calendar-plus', (e) =>
          insertLink(e, addDayStr(today(), 1)),
        ),
        block('yesterday', 'Yesterday', "Add a link to yesterday's daily note", 'ph-calendar-minus', (e) =>
          insertLink(e, addDayStr(today(), -1)),
        ),
        block('dateLink', 'Today - date link', "Add a link to today's date.", 'ph-calendar-check', (e) =>
          insertDateToken(e, today()),
        ),
        block('timestamp', 'Now – timestamp', 'Add a timestamp with the current time', 'ph-clock', (e) => {
          e.chain().focus().insertContent(timestampText(now(), ctx.twentyFourHourTime)).run()
        }),
      ],
    },
    {
      id: 'reuse',
      label: SLASH_TEXT.reuse,
      items: [
        block('reuse', SLASH_TEXT.reuse, undefined, 'ph-arrows-clockwise', (e) => {
          e.chain().focus().pickObjectEmbed().run()
        }),
        // M8: embed a collection or a query as a live view (descriptions are our strings).
        ...collections.map((c) =>
          block(`collection:${c.id}`, c.name, 'Embed this collection', 'ph-stack', (e) => {
            e.chain().focus().insertDataViewEmbed('collection', c.id).run()
          }),
        ),
        ...queries.map((q) =>
          block(`query:${q.id}`, q.name, 'Embed this query', 'ph-funnel', (e) => {
            e.chain().focus().insertDataViewEmbed('query', q.id).run()
          }),
        ),
      ],
    },
  ]
}

/** How well `query` matches an item: its name, alias or description, whichever scores highest; null for no match. */
export function itemScore(query: string, item: SlashItem): number | null {
  const scores = [item.name, item.alias, item.description]
    .map((text) => (text ? fuzzyScore(query, text) : null))
    .filter((x): x is number => x !== null)
  return scores.length ? Math.max(...scores) : null
}

/**
 * The sections with only the items matching `query`, best match first within
 * each section. The "Create an object" items carry the query as the new title,
 * so they always match while there is one.
 */
export function filterSections(sections: SlashSection[], query: string): SlashSection[] {
  const q = query.trim()
  if (!q) return sections
  return sections
    .map((s) => {
      if (s.id === 'structure') return s
      const pinned = s.items.filter((item) => item.pinned)
      const scored = s.items
        .filter((item) => !item.pinned)
        .map((item, index) => ({ item, index, score: itemScore(q, item) }))
        .filter((x): x is { item: SlashItem; index: number; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score || a.index - b.index)
      return { ...s, items: [...pinned, ...scored.map((x) => x.item)] }
    })
    .filter((s) => s.items.length > 0)
}

/** Whether `query` matches any item other than the "Create an object" ones (a space then closes the menu). */
export function hasRealMatch(sections: SlashSection[], query: string, now: Date = new Date()): boolean {
  // M8: a phrase that is (or may still become) a date keeps the menu open.
  if (couldBeDate(query, dailyNoteTitle(now))) return true
  return filterSections(sections, query).some((s) => s.id !== 'structure' && s.items.length > 0)
}
