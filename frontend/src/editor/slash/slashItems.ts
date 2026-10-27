/**
 * The `/` menu's sections and items, in Capacities' order. Strings are
 * Capacities' own (keys beside each); icons are our choice (Phosphor).
 *
 * Each item's `run` is called after the `/query` text has been removed. It may
 * return a sub-view for the menu to show next (the colour lists, the icon
 * picker, the bookmark URL field).
 */
import type { Editor } from '@tiptap/core'
import { api } from '@/api/client'
import type { AttachmentKind, TypeDef } from '@/api/types'
import { fuzzyScore } from '@/links/LinkPicker'
import { stemOf } from '@/links/linkIndex'
import { isWhiteboardType } from '@/whiteboard/isWhiteboard'
import { setQuote } from '../menus/BlockStyleMenu'
import type { Hierarchy, ListType } from '../nodes/blockOptions'
import { insertBlockNode } from '../nodes/containers'

export type SlashView = 'colorText' | 'colorBg' | 'icon' | 'bookmark'

export type SectionId = 'blocks' | 'structure' | 'dates' | 'reuse'

export interface SlashItem {
  id: string
  name: string
  /** The row's second line. */
  description?: string
  /** A Phosphor icon id. */
  icon: string
  run: (editor: Editor) => void | SlashView | Promise<void>
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
  footer: 'press "/" to search', // ControlDropdown.structure.slashCommand
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
}

const block = (id: string, name: string, description: string | undefined, icon: string, run: SlashItem['run']): SlashItem =>
  description === undefined ? { id, name, icon, run } : { id, name, description, icon, run }

const hierarchy = (level: Hierarchy) => (e: Editor) => {
  e.chain().focus().setHierarchy(level).run()
}
const list = (type: ListType) => (e: Editor) => {
  e.chain().focus().setListType(type).run()
}
const media = (kind: AttachmentKind) => (e: Editor) => {
  e.chain().focus().pickMedia(kind).run()
}

/** The "Create a block" items. */
export const BLOCK_ITEMS: readonly SlashItem[] = [
  block('text', 'Text', 'Just text', 'ph-text-t', (e) => {
    // blocks.TextBlock.*
    e.chain().focus().setHierarchy('Base').run()
  }),
  block('H1', 'Heading 1', 'Block with a heading level 1', 'ph-text-h-one', hierarchy('H1')), // ControlDropdown.custom.block_H1.*
  block('H2', 'Heading 2', 'Block with a heading level 2', 'ph-text-h-two', hierarchy('H2')),
  block('H3', 'Heading 3', 'Block with a heading level 3', 'ph-text-h-three', hierarchy('H3')),
  block('H4', 'Heading 4', 'Block with a heading level 4', 'ph-text-h-four', hierarchy('H4')),
  block('S', 'Small', 'Turn block into a small text block', 'ph-text-aa', hierarchy('S')), // block_S
  block('bullet', 'Bullet list', 'Add a bullet list to this block', 'ph-list-bullets', list('bullet')), // block_bullet
  block('numerical', 'Numbered list', 'Add a numbered list to this block', 'ph-list-numbers', list('numerical')),
  block('alphabetical', 'Alphabetical list', 'Add an alphabetical list to this block', 'ph-list-dashes', list('alphabetical')),
  block('roman', 'Roman list', 'Add a roman list to this block', 'ph-list-numbers', list('roman')),
  block('todo', 'To-do', 'Add a To-do box to this block', 'ph-check-square', list('todo')), // block_todo
  block('toggle', 'Toggle', 'Add a toggle to this block', 'ph-caret-right', (e) => {
    e.chain().focus().wrapInToggle().run() // block_toggle
  }),
  block('quote', 'Quote block', 'Turn block into a quote block', 'ph-quotes', (e) => {
    setQuote(e, true) // block_quote
  }),
  block('group', 'Group', 'A layout element to group multiple blocks into one container', 'ph-bounding-box', (e) => {
    e.chain().focus().wrapInGroup().run() // block_group
  }),
  block('icon', 'Icon', 'Add an icon to this block', 'ph-smiley', () => 'icon'), // block_icon
  block('colorText', 'Text', 'Change the text color of this block', 'ph-text-a-underline', () => 'colorText'), // block_color_text
  block('colorBg', 'Background', 'Change the background color of this block', 'ph-paint-bucket', () => 'colorBg'), // block_color_bg
  block('columns', 'Two Columns', 'Multiple blocks groups next to each other', 'ph-columns', (e) => {
    e.chain().focus().insertColumns(2).run() // blocks.GridBlock.*
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
  block('code', 'Code', 'A code block', 'ph-code', (e) => {
    e.chain().focus().setCodeBlock().run() // blocks.CodeBlock.*
  }),
  block('math', 'Math', 'A display style math block', 'ph-function', (e) => {
    e.chain().focus().insertMathBlock().run() // blocks.MathBlock.*
  }),
  block('table', 'Table', 'A simple block for tabular content', 'ph-table', (e) => {
    e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() // blocks.SimpleTableBlock.*
  }),
  block('image', 'Insert image', undefined, 'ph-image', media('image')), // pasteInput.image_from_file
  block('pdf', 'Insert PDF', undefined, 'ph-file-pdf', media('pdf')), // pasteInput.pdf_from_url
  block('audio', 'Insert audio', undefined, 'ph-speaker-high', media('audio')), // pasteInput.audio_from_url
  block('video', 'Insert video', undefined, 'ph-video-camera', media('video')), // pasteInput.video_from_url
  block('file', 'Insert file', undefined, 'ph-file', media('file')), // pasteInput.file
  block('bookmark', 'Create bookmark', undefined, 'ph-bookmark-simple', () => 'bookmark'), // pasteInput.bookmark
]

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

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
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
  const title = ctx.query.trim()
  return [
    { id: 'blocks', label: SLASH_TEXT.blocks, items: [...BLOCK_ITEMS] },
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
        // ControlDropdown.custom.entity_dailyNote_*, token_date, token_time
        block('today', 'Today', "Add a link to today's daily note", 'ph-calendar-blank', (e) => insertLink(e, dailyNoteTitle(now()))),
        block('tomorrow', 'Tomorrow', "Add a link to tomorrow's daily note", 'ph-calendar-plus', (e) =>
          insertLink(e, dailyNoteTitle(addDays(now(), 1))),
        ),
        block('yesterday', 'Yesterday', "Add a link to yesterday's daily note", 'ph-calendar-minus', (e) =>
          insertLink(e, dailyNoteTitle(addDays(now(), -1))),
        ),
        block('dateLink', 'Today - date link', "Add a link to today's date.", 'ph-calendar-check', (e) =>
          insertLink(e, dailyNoteTitle(now())),
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
      ],
    },
  ]
}

/** How well `query` matches an item: its name or description, whichever scores higher; null for no match. */
export function itemScore(query: string, item: SlashItem): number | null {
  const a = fuzzyScore(query, item.name)
  const b = item.description ? fuzzyScore(query, item.description) : null
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
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
      const scored = s.items
        .map((item, index) => ({ item, index, score: itemScore(q, item) }))
        .filter((x): x is { item: SlashItem; index: number; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score || a.index - b.index)
      return { ...s, items: scored.map((x) => x.item) }
    })
    .filter((s) => s.items.length > 0)
}

/** Whether `query` matches any item other than the "Create an object" ones (a space then closes the menu). */
export function hasRealMatch(sections: SlashSection[], query: string): boolean {
  return filterSections(sections, query).some((s) => s.id !== 'structure' && s.items.length > 0)
}
