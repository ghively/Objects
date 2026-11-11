/**
 * The one shortcut registry. Every entry carries a shortcut id, its category, its English name
 * (catalogued unless marked "our string") and its keys.
 *
 * Keys are written `Mod-Shift-k`: modifiers `Mod` (Ctrl on Windows/Linux, Cmd on macOS), `Ctrl`,
 * `Meta`, `Alt`, `AltCtrl` (Alt on Windows/Linux, Ctrl on macOS: the Ctrl+Alt+L / ⌃⌘L
 * pattern), `Shift`, then one key: a letter, a digit, a punctuation character, or a
 * `KeyboardEvent.key` name (`Escape`, `ArrowUp`, `Enter`, `Tab`, `Backspace`, `Delete`, `Space`).
 * A spec with a space is a two-key sequence (M23: `g n` is G, then N): the Shortcuts sheet shows
 * it, but `matches` never matches it (its handler reads the sequence itself).
 *
 * The keys follow the shortcut table checked in
 * the Shortcuts sheet of `docs/behavior-catalog.md`. An id the table lists no key for
 * has `keys: []` and the Shortcuts sheet leaves it out. `provisional: true` marks a key that is
 * ours (no table key to check against). `bound: false` entries are display-only: their
 * handlers live elsewhere (M1–M6 code), and they are registered so the Shortcuts sheet lists them
 * and the collision test sees them.
 */
import { useEffect, useRef } from 'react'

/** `aiChat`: bound while focus is inside the AI chat panel (M10). `work`: on the Work page (M23). */
export type ShortcutScope = 'global' | 'editor' | 'calendar' | 'table' | 'whiteboard' | 'aiChat' | 'work'

export interface ShortcutDef {
  id: string
  /** The category: block, text, navigation, global, page, calendar, whiteboard, … */
  category: string
  name: string
  keys: string[]
  scope: ShortcutScope
  provisional: boolean
  /** false: display-only, handled elsewhere. */
  bound?: boolean
}

/** The category labels. */
export const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI Assistant',
  block: 'Block editing',
  calendar: 'Calendar',
  collection: 'Collection',
  database: 'Database',
  date: 'Date picker',
  global: 'General',
  markdown: 'Markdown',
  navigation: 'Navigation',
  page: 'Page',
  pdf: 'PDF viewer',
  table: 'Table',
  text: 'Text editing',
  weblink: 'Weblink',
  whiteboard: 'Whiteboard',
  work: 'Work',
}

/**
 * The order the Shortcuts sheet shows the groups in (the catalog's section 2). A category not
 * listed here (Whiteboard, Work) follows, in first-registration order.
 */
export const CATEGORY_ORDER: readonly string[] = [
  'global',
  'text',
  'markdown',
  'block',
  'page',
  'navigation',
  'calendar',
  'ai',
  'table',
  'date',
  'pdf',
  'weblink',
]

/** `categories` sorted for the sheet: `CATEGORY_ORDER` first, the rest in the order given. */
export function sortCategories(categories: readonly string[]): string[] {
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c)
    return i === -1 ? CATEGORY_ORDER.length : i
  }
  return [...categories].sort((a, b) => rank(a) - rank(b))
}

const registry = new Map<string, ShortcutDef>()

/** Add `defs` (an entry with an id already registered replaces it, keeping its place). */
export function registerShortcuts(defs: ShortcutDef[]): void {
  for (const d of defs) registry.set(d.id, { ...d, keys: [...d.keys] })
}

/** Every registered shortcut, in registration order (for the cheat sheet). */
export function allShortcuts(): ShortcutDef[] {
  return [...registry.values()]
}

/** Registered shortcuts grouped by category, categories in first-registration order. */
export function shortcutsByCategory(): Map<string, ShortcutDef[]> {
  const out = new Map<string, ShortcutDef[]>()
  for (const d of registry.values()) {
    const list = out.get(d.category)
    if (list) list.push(d)
    else out.set(d.category, [d])
  }
  return out
}

/** The keys of shortcut `id` (empty when it is not registered). */
export function keysFor(id: string): string[] {
  return registry.get(id)?.keys ?? []
}

// ---- matching ----

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const p = nav.userAgentData?.platform || nav.platform || ''
  return /mac|iphone|ipad|ipod/i.test(p)
}

interface Combo {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  key: string
}

/** Parse `Mod-Shift-k` for the current platform. `Mod--` is Mod with the minus key. */
export function parseKeys(spec: string, mac = isMacPlatform()): Combo {
  let key: string
  let mods: string[]
  if (spec === '-') {
    key = '-'
    mods = []
  } else if (spec.endsWith('--')) {
    key = '-'
    mods = spec.slice(0, -2).split('-')
  } else {
    const parts = spec.split('-')
    key = parts.pop() ?? ''
    mods = parts
  }
  const c: Combo = { ctrl: false, meta: false, alt: false, shift: false, key }
  for (const m of mods) {
    if (m === 'Mod') {
      if (mac) c.meta = true
      else c.ctrl = true
    } else if (m === 'Ctrl') c.ctrl = true
    else if (m === 'Meta' || m === 'Cmd') c.meta = true
    else if (m === 'Alt') c.alt = true
    else if (m === 'AltCtrl') {
      if (mac) c.ctrl = true
      else c.alt = true
    }
    else if (m === 'Shift') c.shift = true
  }
  return c
}

const PUNCTUATION_CODES: Record<string, string> = {
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  '=': 'Equal',
  '-': 'Minus',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
}

function keyMatches(e: Pick<KeyboardEvent, 'key' | 'code'>, key: string): boolean {
  const code = e.code ?? ''
  if (/^[a-z]$/i.test(key)) {
    // The character typed decides (AZERTY's Ctrl+Z is Undo, not Ctrl+W); the physical key only
    // when the layout gives no Latin letter (Cyrillic, Greek, macOS Option characters).
    const typed = e.key ?? ''
    if (/^[a-z]$/i.test(typed)) return typed.toLowerCase() === key.toLowerCase()
    return code === `Key${key.toUpperCase()}`
  }
  if (/^[0-9]$/.test(key)) return e.key === key || code === `Digit${key}` || code === `Numpad${key}`
  if (key === 'Space') return e.key === ' ' || code === 'Space'
  if (key in PUNCTUATION_CODES) return e.key === key || code === PUNCTUATION_CODES[key]
  return e.key === key
}

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> & {
  getModifierState?: (key: string) => boolean
}

/**
 * Whether `e` is one of `keys` (exact modifiers; `Mod` is Ctrl, or Cmd on macOS). An AltGr press
 * is never a shortcut: Windows reports it as Ctrl+Alt, so AltGr+Shift+L ("Ł" on a Polish layout)
 * would otherwise be Ctrl+Alt+Shift+L and couldn't be typed. Not on macOS, where some browsers
 * report Option as AltGraph and ⌥ shortcuts must still work.
 */
export function matches(e: KeyEventLike, keys: string[]): boolean {
  const mac = isMacPlatform()
  if (!mac && e.getModifierState?.('AltGraph')) return false
  for (const spec of keys) {
    if (isSequence(spec)) continue
    const c = parseKeys(spec, mac)
    if (!!e.ctrlKey !== c.ctrl || !!e.metaKey !== c.meta || !!e.altKey !== c.alt || !!e.shiftKey !== c.shift) continue
    if (keyMatches(e, c.key)) return true
  }
  return false
}

const ARROW_GLYPHS: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }

/** Keys the sheet names rather than prints: the catalog's Ctrl+Plus / Ctrl+Minus (`+` is Shift+= on most layouts). */
const KEY_NAMES: Record<string, string> = { '=': 'Plus', '+': 'Plus', '-': 'Minus' }
/** On macOS the glyphs read on their own (⌘+ / ⌘-). */
const MAC_KEY_NAMES: Record<string, string> = { '=': '+' }

/** Whether `spec` is a two-key sequence (`g n`). */
export function isSequence(spec: string): boolean {
  return spec.includes(' ')
}

/**
 * How a key is shown in the Shortcuts sheet (`Ctrl+Shift+K`, or `⌘⇧K` on macOS; arrows as `↑`).
 * A sequence shows its keys joined by "then" (`G then N`, our string).
 */
export function formatKeys(spec: string, mac = isMacPlatform()): string {
  if (isSequence(spec)) {
    return spec
      .split(' ')
      .filter(Boolean)
      .map((k) => formatKeys(k, mac))
      .join(' then ')
  }
  const c = parseKeys(spec, mac)
  const key =
    ARROW_GLYPHS[c.key] ??
    (mac ? MAC_KEY_NAMES[c.key] : KEY_NAMES[c.key]) ??
    (c.key === 'Space' ? 'Space' : c.key.length === 1 ? c.key.toUpperCase() : c.key)
  if (mac) return `${c.ctrl ? '⌃' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.meta ? '⌘' : ''}${key}`
  return [c.ctrl && 'Ctrl', c.meta && 'Meta', c.alt && 'Alt', c.shift && 'Shift', key].filter(Boolean).join('+')
}

/** Keys typed here belong to a text field or editor (copied from `App.tsx`'s rule). */
export function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false
  if (el.closest('input, textarea, select, .cm-editor')) return true
  const ce = el.closest('[contenteditable]')
  return !!ce && ce.getAttribute('contenteditable') !== 'false'
}

// ---- the one window listener ----

interface Binding {
  id: string
  handler: { current: (e: KeyboardEvent) => void }
  allowInEditable: boolean
}

const bindings = new Set<Binding>()
let listening = false

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  const editable = isEditableTarget(e.target) || isEditableTarget(document.activeElement)
  // The most recently mounted binding wins when two use the same shortcut.
  for (const b of [...bindings].reverse()) {
    if (editable && !b.allowInEditable) continue
    if (!matches(e, keysFor(b.id))) continue
    e.preventDefault()
    b.handler.current(e)
    return
  }
}

function addBinding(b: Binding): () => void {
  bindings.add(b)
  if (!listening && typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown)
    listening = true
  }
  return () => {
    bindings.delete(b)
    if (bindings.size === 0 && listening) {
      window.removeEventListener('keydown', onKeyDown)
      listening = false
    }
  }
}

/**
 * Run `handler` when shortcut `id`'s keys are pressed anywhere in the window. Keys typed in an
 * editable target are ignored unless `allowInEditable`. The event's default is prevented.
 */
export function useGlobalShortcut(
  id: string,
  handler: (e: KeyboardEvent) => void,
  opts: { allowInEditable?: boolean } = {},
): void {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  const allow = !!opts.allowInEditable
  useEffect(() => addBinding({ id, handler: ref, allowInEditable: allow }), [id, allow])
}

// ---- the registered shortcuts ----

/** Checked against the shortcut table (the behaviour catalog's Shortcuts sheet). */
const V = false
/** Object-only keys: the table has no such action to check against. */
const OURS = true

const def = (
  id: string,
  category: string,
  name: string,
  keys: string[],
  scope: ShortcutScope,
  provisional: boolean,
  bound?: boolean,
): ShortcutDef => (bound === undefined ? { id, category, name, keys, scope, provisional } : { id, category, name, keys, scope, provisional, bound })

/**
 * M7's shortcuts (the plan's "Shortcut keys" table), with the table's keys. Ids it lists
 * no key for (`heading1`-`heading4`, `toDo`, `toggle`, `textAlign*`: markdown only) have none.
 */
export const M7_SHORTCUTS: ShortcutDef[] = [
  def('bold', 'text', 'Format bold', ['Mod-b'], 'editor', V),
  def('italic', 'text', 'Italicize', ['Mod-i'], 'editor', V),
  // The table leaves Underline unbound: Ctrl+U is "Add new content" (`openAddEntityMenu`).
  def('underline', 'text', 'Underline', [], 'editor', V),
  def('strikethrough', 'text', 'Strikethrough', ['Mod-Shift-s'], 'editor', V),
  def('codeToken', 'text', 'Format as code', ['Mod-e'], 'editor', V),
  def('mathToken', 'text', 'Format as TeX formula', ['Mod-m'], 'editor', V),

  def('heading1', 'block', 'Make the selected blocks heading 1', [], 'editor', V),
  def('heading2', 'block', 'Make the selected blocks heading 2', [], 'editor', V),
  def('heading3', 'block', 'Make the selected blocks heading 3', [], 'editor', V),
  def('heading4', 'block', 'Make the selected blocks heading 4', [], 'editor', V),
  def('toDo', 'block', 'Make the selected blocks to-dos', [], 'editor', V),
  def('toggle', 'block', 'Turn toggle style on or off for the selected blocks', [], 'editor', V),
  // With blocks selected (Mod-e / Mod-m on a text selection stay codeToken / mathToken).
  def('toggleCodeBlock', 'block', 'Make the selected blocks a code block', ['Mod-e'], 'editor', V),
  def('toggleMathBlock', 'block', 'Make the selected blocks a math block', ['Mod-m'], 'editor', V),
  def('textAlignLeft', 'block', 'Align text left', [], 'editor', V),
  def('textAlignCenter', 'block', 'Text align center', [], 'editor', V),
  def('textAlignRight', 'block', 'Text align right', [], 'editor', V),
  def('selectActiveBlock', 'block', 'Select this block as a whole', ['Escape'], 'editor', V),
  def('expandBlockSelectionUpwards', 'block', 'Grow the block selection up', ['Shift-ArrowUp'], 'editor', V),
  def('expandBlockSelectionDownwards', 'block', 'Grow the block selection down', ['Shift-ArrowDown'], 'editor', V),
  def('selectAllBlocks', 'block', 'Select the blocks at this level, then the level above', ['Mod-a'], 'editor', V),
  def('deleteBlocks', 'block', 'Delete selected blocks', ['Backspace', 'Delete'], 'editor', V),
  def('duplicateBlocks', 'block', 'Make a copy of the selected blocks', ['Mod-d'], 'editor', V),
  def('copyBlocksAsMarkdown', 'block', 'Copy the selected blocks as Markdown text', ['Mod-Shift-c'], 'editor', V),
  // Alt+Up/Down moves the selected blocks, or the block holding the cursor; with Shift, on the
  // same level. Object's move always stays on the block's level, so both pairs do the same.
  def('moveSelectedBlocksUp', 'block', 'Move selected blocks up', ['Alt-ArrowUp'], 'editor', V),
  def('moveSelectedBlocksDown', 'block', 'Shift the selected blocks down', ['Alt-ArrowDown'], 'editor', V),
  def('moveSelectedBlocksUpOnSameLevel', 'block', 'Shift the selected blocks up among their siblings', ['Alt-Shift-ArrowUp'], 'editor', V),
  def('moveSelectedBlocksDownOnSameLevel', 'block', 'Shift the selected blocks down among their siblings', ['Alt-Shift-ArrowDown'], 'editor', V),
  def('moveUpBlockWithCursor', 'block', 'Move active block up', ['Alt-ArrowUp'], 'editor', V),
  def('moveDownBlockWithCursor', 'block', 'Move active block down', ['Alt-ArrowDown'], 'editor', V),
  def('moveUpBlockWithCursorOnSameLevel', 'block', 'Move this block up among its siblings', ['Alt-Shift-ArrowUp'], 'editor', V),
  def('moveDownBlockWithCursorOnSameLevel', 'block', 'Move this block down among its siblings', ['Alt-Shift-ArrowDown'], 'editor', V),
  def('indentBlocks', 'block', 'Indent selected blocks', ['Tab'], 'editor', V),
  def('unindentBlocks', 'block', 'Outdent the selected blocks', ['Shift-Tab'], 'editor', V),
  def('toggleTodoInBlockWithCursor', 'block', 'Tick or untick the to-do in this block', ['Mod-Enter'], 'editor', V),
  def(
    'toggleToggleInBlockWithCursor',
    'block',
    'Expand or collapse the toggle in this block; with no children yet, it adds one and puts the cursor there. In a to-do, add ⇧.',
    // The table's keys are Ctrl+Up/Down; Mod-Enter and Mod-Shift-Enter stay for the hands used to them.
    ['Mod-Enter', 'Mod-Shift-Enter', 'Mod-ArrowUp', 'Mod-ArrowDown'],
    'editor',
    V,
  ),
  def('insertBlockAbove', 'block', 'New block above, with the cursor in it', ['Alt-Shift-Enter'], 'editor', V),
  def('insertBlockBelow', 'block', 'New block below, with the cursor in it', ['Alt-Enter'], 'editor', V),

  def('closeTab', 'navigation', 'Close current tab', ['Mod-w'], 'global', V),
  def('openNewTab', 'navigation', 'Open new tab', ['Mod-t'], 'global', V),
  def('navigateTabs', 'navigation', 'Navigate tabs', ['Ctrl-Tab'], 'global', V),
  // Ctrl+Shift+A is not the tab menu (it is reserved for a checklist menu).
  def('openTabList', 'navigation', 'Show or hide the list of open tabs', ['Mod-Shift-ArrowUp'], 'global', V),
  def('navigateBack', 'navigation', 'Navigate back', ['Mod-ArrowLeft', 'Mod-['], 'global', V),
  def('navigateForward', 'navigation', 'Navigate forward', ['Mod-ArrowRight', 'Mod-]'], 'global', V),

  def('toggleSidepanel', 'global', 'Toggle right side panel', ['Mod-Shift-ArrowRight'], 'global', V),
  def('toggleLeftSidebar', 'global', 'Toggle left sidebar', ['Mod-Shift-ArrowLeft'], 'global', V),
  def('toggleCalendarSidebar', 'global', 'Toggle calendar sidebar', ['Mod-Alt-s'], 'global', V),
  def('openTodaysNote', 'global', "Pop out today's daily note", ['Mod-Shift-d'], 'global', OURS),
  def('toggleDarkMode', 'global', 'Toggle dark mode', ['Mod-Shift-l'], 'global', V),
  def('openSettings', 'global', 'Open settings', ['Mod-,'], 'global', V),
  def('toggleShortcutsMenu', 'global', 'Show or hide the shortcuts list', ['Mod-Shift-b'], 'global', V),
]

/**
 * M1–M6 bindings, display-only (`bound: false`): their handlers stay where they are. The keys are
 * the built ones (our choices where the table has none, as each module notes).
 */
export const EXISTING_SHORTCUTS: ShortcutDef[] = [
  // M5, palette/CommandPalette.tsx (it reads these keys). Search is Ctrl+P or Ctrl+K;
  // there is no key for the action palette (reached from the palette's switch button).
  def('openSearchPalette', 'global', 'Search this space', ['Mod-p', 'Mod-k'], 'global', false, false),
  def('openCommandPalette', 'global', 'Open action palette', [], 'global', false, false),
  // M5, object/ObjectView.tsx (our id and our string)
  def('findInPage', 'page', 'Find in page', ['Mod-f'], 'global', false, false),
  // M1–M3, App.tsx. M32: the two "new" keys also work with the caret in a note's text or title
  // (`NEW_KEYS_IN_NOTE` below says how each key was checked against the editor's own keys), and
  // each has a second key that a browser tab lets through. Delete stays out of editable targets
  // (there Ctrl+Backspace deletes a word).
  def('openAddEntityMenu', 'global', 'Add new content', ['Mod-u', 'AltCtrl-Shift-n'], 'global', false, false),
  def('createNewEntityOfType', 'global', 'New note, or one more of the type in view', ['Mod-n', 'AltCtrl-n'], 'global', false, false),
  def('deleteCurrentPage', 'page', 'Delete current page', ['Mod-Backspace'], 'global', false, false),
  // M4, calendar/CalendarChrome.tsx
  def('goToToday', 'calendar', 'Jump to today', ['t'], 'calendar', false, false),
  def('setViewToMonth', 'calendar', 'Go to monthly view', ['m'], 'calendar', false, false),
  def('setViewToWeek', 'calendar', 'Go to weekly view', ['w'], 'calendar', false, false),
  def('setViewToRolling', 'calendar', 'Show the day before and after', ['r'], 'calendar', false, false),
  def('setViewToDay', 'calendar', 'Go to daily view', ['d'], 'calendar', false, false),
  def('goToPrevious', 'calendar', 'Back one day, week or month', ['ArrowLeft'], 'calendar', false, false),
  def('goToNext', 'calendar', 'Forward one day, week or month', ['ArrowRight'], 'calendar', false, false),
  def(
    'goToPreviousHigherUnit',
    'calendar',
    'Back one week, month or year, by the current view',
    ['ArrowUp'],
    'calendar',
    false,
    false,
  ),
  def(
    'goToNextHigherUnit',
    'calendar',
    'Forward one week, month or year, by the current view',
    ['ArrowDown'],
    'calendar',
    false,
    false,
  ),
  // M6, whiteboard/shortcuts.ts keyToCommand (the whiteboard table)
  def('whiteboardSelect', 'whiteboard', 'Select tool', ['v'], 'whiteboard', false, false),
  def('whiteboardHand', 'whiteboard', 'Hand tool', ['h'], 'whiteboard', false, false),
  def('whiteboardText', 'whiteboard', 'Text', ['t'], 'whiteboard', false, false),
  def('whiteboardRectangle', 'whiteboard', 'Rectangle', ['r'], 'whiteboard', false, false),
  def('whiteboardEllipse', 'whiteboard', 'Ellipse', ['o'], 'whiteboard', false, false),
  def('whiteboardTriangle', 'whiteboard', 'Triangle', ['p'], 'whiteboard', false, false),
  def('whiteboardLine', 'whiteboard', 'Line', ['l'], 'whiteboard', false, false),
  def('whiteboardArrow', 'whiteboard', 'Arrow', ['Shift-l'], 'whiteboard', false, false),
  def('whiteboardFrame', 'whiteboard', 'Frame', ['f'], 'whiteboard', false, false),
  // Pen, highlighter and eraser are Object's own: our ids, our strings, our
  // keys. They avoid the taken letters (P is Triangle, M opens the move menu).
  def('whiteboardPen', 'whiteboard', 'Pen', ['d'], 'whiteboard', OURS, false),
  def('whiteboardHighlighter', 'whiteboard', 'Highlighter', ['Shift-d'], 'whiteboard', OURS, false),
  def('whiteboardEraser', 'whiteboard', 'Eraser', ['e'], 'whiteboard', OURS, false),
  def('whiteboardZoomIn', 'whiteboard', 'Zoom in', ['Mod-='], 'whiteboard', false, false),
  def('whiteboardZoomOut', 'whiteboard', 'Zoom out', ['Mod--'], 'whiteboard', false, false),
  def('whiteboardZoomReset', 'whiteboard', 'Zoom to 100%', ['Mod-0'], 'whiteboard', false, false),
  def('whiteboardFitAll', 'whiteboard', 'Zoom to fit', ['Shift-1'], 'whiteboard', false, false),
  def('whiteboardFitSelection', 'whiteboard', 'Zoom to selection', ['Shift-2'], 'whiteboard', false, false),
  def('whiteboardBringForward', 'whiteboard', 'Bring forward', ['Mod-]'], 'whiteboard', false, false),
  def('whiteboardBringToFront', 'whiteboard', 'Bring to front', [']'], 'whiteboard', false, false),
  def('whiteboardSendBackward', 'whiteboard', 'Send backward', ['Mod-['], 'whiteboard', false, false),
  def('whiteboardSendToBack', 'whiteboard', 'Send to back', ['['], 'whiteboard', false, false),
  def('whiteboardWrapInFrame', 'whiteboard', 'Wrap in frame', ['Mod-g'], 'whiteboard', false, false),
  def('whiteboardDuplicate', 'whiteboard', 'Duplicate selection', ['Mod-d'], 'whiteboard', false, false),
  def('whiteboardNudge', 'whiteboard', 'Nudge selection', ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], 'whiteboard', false, false),
  def(
    'whiteboardNudgeLarge',
    'whiteboard',
    'Nudge selection farther',
    ['Shift-ArrowUp', 'Shift-ArrowDown', 'Shift-ArrowLeft', 'Shift-ArrowRight'],
    'whiteboard',
    false,
    false,
  ),
  def('whiteboardFlipHorizontal', 'whiteboard', 'Flip horizontal', ['Shift-h'], 'whiteboard', false, false),
  def('whiteboardFlipVertical', 'whiteboard', 'Flip vertical', ['Shift-v'], 'whiteboard', false, false),
  def('whiteboardCycle', 'whiteboard', 'Cycle selected objects', ['Tab'], 'whiteboard', false, false),
  def('whiteboardCycleBack', 'whiteboard', 'Select the previous item', ['Shift-Tab'], 'whiteboard', false, false),
  def('whiteboardPan', 'whiteboard', 'Pan', ['Space'], 'whiteboard', false, false),
  // The catalog lists Undo and Redo under General: display-only, the editor (its history) and the
  // whiteboard (`whiteboard/shortcuts.ts`) handle the keys themselves.
  def('undo', 'global', 'Undo', ['Mod-z'], 'global', false, false),
  def('redo', 'global', 'Redo', ['Mod-Shift-z', 'Mod-y'], 'global', false, false),
]

/**
 * M32, "keys work while you type": what the new-note keys do with the caret in a note (its text,
 * its title, a field of its page), checked against the editors' own bindings.
 *
 * - **New note**, Ctrl+N: the rich editor, the title and the raw editor bind nothing to it, so it
 *   works in all three. In a browser tab Ctrl+N belongs to the browser (a new window, which a page
 *   cannot stop), so it also has **Alt+N**, which types nothing on Windows and Linux. On macOS that
 *   second key is Ctrl+N (`AltCtrl`: Option+N is the "˜" dead key), and with the caret in a text
 *   field Ctrl+N stays the system's "next line"; ⌘N works there.
 * - **The New menu**, Ctrl+U: the rich editor leaves Ctrl+U unbound (the catalog: Underline has no
 *   key), so it works in a note's text and title. In raw mode Ctrl+U is CodeMirror's "undo
 *   selection": it keeps that meaning there, and the menu also has **Alt+Shift+N**, which collides
 *   with nothing (macOS: Ctrl+Shift+N, with the same text-field rule as above).
 * - **Today's note**, Ctrl+Shift+D: no editor binds it; it works anywhere in the window.
 *
 * In other editable fields (a dialog's input, a quick-add box) the two "new" keys stay off, as
 * before M32.
 */
export const NEW_KEYS_IN_NOTE = {
  /** A note's view (page, peek or inline): the keys work in its editable fields. */
  noteSelector: '[data-object-view]',
  /** Raw mode keeps Ctrl+U ("undo selection"). */
  rawEditorSelector: '.cm-editor',
} as const

/**
 * Whether a "new" key (`id`: `createNewEntityOfType` or `openAddEntityMenu`) may act on `e`:
 * always outside editable targets; inside one only in a note's view, and never where the key has a
 * text-editing meaning of its own (see `NEW_KEYS_IN_NOTE`).
 */
export function newKeyAllowed(id: 'createNewEntityOfType' | 'openAddEntityMenu', e: KeyboardEvent, mac = isMacPlatform()): boolean {
  const target = isEditableTarget(e.target) ? (e.target as Element) : isEditableTarget(document.activeElement) ? document.activeElement : null
  if (!target) return true
  if (!target.closest(NEW_KEYS_IN_NOTE.noteSelector)) return false
  // macOS: Ctrl+N and Ctrl+Shift+N move and select by line in a text field.
  if (mac && e.ctrlKey && !e.metaKey) return false
  // Raw mode: Ctrl+U (⌘U) is "undo selection".
  if (id === 'openAddEntityMenu' && !e.altKey && target.closest(NEW_KEYS_IN_NOTE.rawEditorSelector)) return false
  return true
}

/**
 * M8's shortcuts (the plan's "Shortcut keys (new ids, provisional)" table). Every key is provisional. Editor ones are bound by Task 25
 * (`editor/shortcuts.ts`), focus and presentation ones by Task 9, whiteboard ones by Task 21.
 * `exitPresentationMode`, `nextPresentationSlide` and `previousPresentationSlide` are active only
 * while presenting (scope `presentation` is not a scope here: they are global, and only the
 * presentation view binds them, so they never fire otherwise).
 */
export const M8_SHORTCUTS: ShortcutDef[] = [
  // Ctrl+Alt+L on Windows, ⌃⌘L on macOS.
  def('copyBlockReference', 'block', 'Copy block reference', ['Mod-AltCtrl-l'], 'editor', V, true),
  // `I` with blocks selected (typing `i` in text stays typing).
  def('turnIntoObject', 'block', 'Turn into a note', ['i'], 'editor', V, true),
  // No key: its only trigger is the markdown `()` + Space.
  def('turnIntoTask', 'block', 'Turn into task', [], 'editor', V, true),
  def('turnBlockIntoTaskObject', 'block', 'Make this block a task', ['Mod-Shift-t'], 'editor', V, true),
  def('highlightText', 'text', 'Highlight the selected text', ['Mod-Shift-h'], 'editor', V, true),
  def('toggleFocusMode', 'global', 'Toggle focus mode', ['Mod-Shift-m'], 'global', V, true),
  // Ctrl+Alt+P on Windows, ⌃⌘P on macOS.
  def('openPresentationMode', 'page', 'Start presentation mode', ['Mod-AltCtrl-p'], 'global', V, true),
  def('exitPresentationMode', 'page', 'Exit presentation mode', ['Escape'], 'global', V, true),
  def('nextPresentationSlide', 'page', 'Next presentation slide', ['ArrowRight'], 'global', V, true),
  def('previousPresentationSlide', 'page', 'Back one slide in the presentation', ['ArrowLeft'], 'global', V, true),
  def(
    'whiteboardResize',
    'whiteboard',
    'Resize selection',
    ['Mod-ArrowUp', 'Mod-ArrowDown', 'Mod-ArrowLeft', 'Mod-ArrowRight'],
    'whiteboard',
    V,
    true,
  ),
  def(
    'whiteboardResizeLarge',
    'whiteboard',
    'Resize the selection in bigger steps',
    ['Mod-Shift-ArrowUp', 'Mod-Shift-ArrowDown', 'Mod-Shift-ArrowLeft', 'Mod-Shift-ArrowRight'],
    'whiteboard',
    V,
    true,
  ),
]

/**
 * Ids that share a key by design: the handlers tell them apart (a text
 * selection or blocks selected; the cursor in a to-do or a toggle).
 */
export const SHARED_KEY_IDS: readonly (readonly string[])[] = [
  ['codeToken', 'toggleCodeBlock'],
  ['mathToken', 'toggleMathBlock'],
  ['toggleTodoInBlockWithCursor', 'toggleToggleInBlockWithCursor'],
  // Ctrl+Shift+T: a new task outside the editor (the window), the block made a task inside it.
  ['createNewTask', 'turnBlockIntoTaskObject'],
  ['moveSelectedBlocksUp', 'moveUpBlockWithCursor'],
  ['moveSelectedBlocksDown', 'moveDownBlockWithCursor'],
  ['moveSelectedBlocksUpOnSameLevel', 'moveUpBlockWithCursorOnSameLevel'],
  ['moveSelectedBlocksDownOnSameLevel', 'moveDownBlockWithCursorOnSameLevel'],
]

/** Whether `a` and `b` share their key by design (`SHARED_KEY_IDS`). */
export function sharesKeyByDesign(a: string, b: string): boolean {
  return SHARED_KEY_IDS.some((g) => g.includes(a) && g.includes(b))
}

/** The ids only bound while presenting (the plan: "the last three only while presenting"). */
export const PRESENTATION_ONLY_IDS: readonly string[] = ['exitPresentationMode', 'nextPresentationSlide', 'previousPresentationSlide']

/**
 * Keys added by the 2026-11-02 polish pass. `groupBlocks` (Ctrl+G, the key the block
 * menu shows next to "Group") is bound in
 * `editor/handles/groupKey.ts`, with blocks selected only.
 */
export const POLISH_SHORTCUTS: ShortcutDef[] = [
  def('groupBlocks', 'block', 'Group the selected blocks, or ungroup a selected group', ['Mod-g'], 'editor', V, true),
]

/**
 * The note `…` menu's page keys (ids and keys from the shortcut table; M32: "Favorite" reads "Pin",
 * as the sidebar's "Pinned"). Handled by `object/ObjectView.tsx` for the active view, outside editable targets for
 * Mod-e and Mod-i (in the editor they stay code and italic).
 */
export const OBJECT_MENU_SHORTCUTS: ShortcutDef[] = [
  def('openExportMenu', 'page', 'Export this page', ['Mod-e'], 'global', V, false),
  // "Import": on a type page Ctrl+I opens the type's CSV import, not a page's.
  def('openImportMenu', 'page', 'Import', ['Mod-i'], 'global', V, false),
  def('toggleFavorite', 'page', 'Pin or unpin this page', ['Mod-Shift-*'], 'global', V, false),
]

/**
 * M10's AI Assistant group (catalog section 2: open; copy message Ctrl+Alt+C; replace context;
 * append message Ctrl+Alt+A; append to daily note; retry Ctrl+Alt+R; close chat Ctrl+Alt+X;
 * rephrase Ctrl+Alt+U). Ctrl means Cmd on macOS, so the catalog's Ctrl+Alt is `Mod-Alt`.
 * `openAiChat` has no catalogued key: Ctrl+Alt+J is ours (provisional; next to Explore's Ctrl+J),
 * bound by `ai/AiHost.tsx` anywhere in the window. The others act on the chat's last assistant
 * message and are bound by `ai/AiChatPanel.tsx` while focus is inside the chat panel (scope
 * `aiChat`). "Replace context" and "Append to daily note" have no catalogued key: display-only,
 * keyless (the panel's buttons do them).
 */
export const AI_SHORTCUTS: ShortcutDef[] = [
  def('openAiChat', 'ai', 'Open AI chat', ['Mod-Alt-j'], 'global', OURS, true),
  def('aiCopyMessage', 'ai', 'Copy message', ['Mod-Alt-c'], 'aiChat', V, true),
  def('aiReplaceContext', 'ai', 'Replace context', [], 'aiChat', V, false),
  def('aiAppendMessage', 'ai', 'Append message', ['Mod-Alt-a'], 'aiChat', V, true),
  def('aiAppendToDailyNote', 'ai', 'Send a message to the daily note', [], 'aiChat', V, false),
  def('aiRetry', 'ai', 'Retry', ['Mod-Alt-r'], 'aiChat', V, true),
  def('aiCloseChat', 'ai', 'Close chat', ['Mod-Alt-x'], 'aiChat', V, true),
  def('aiRephrase', 'ai', 'Rephrase', ['Mod-Alt-u'], 'aiChat', V, true),
]

/**
 * The 2026-11-08 sweep: catalogued keys Object had not bound ("bind the easy ones", Gene).
 * `createNewTask` (General, Ctrl+Shift+T) is bound by `shell/shortcuts.ts` outside editable
 * targets; inside the editor the key stays `turnBlockIntoTaskObject` (a shared pair).
 * `pasteAsPlainText` (Text editing, Ctrl+Shift+V) is bound by `editor/shortcuts.ts` through
 * `editor/extensions/pasteAsPlainText.ts`. `goToCalendar` (General, Ctrl+Alt+H: "press twice to
 * jump to today") is bound by `shell/shortcuts.ts` anywhere in the window. `toggleAllToggles`
 * (Block editing, Ctrl+O) is bound by `editor/shortcuts.ts` through `editor/extensions/toggleAll.ts`.
 * `increaseTextHierarchy` / `decreaseTextHierarchy` (Block editing, Ctrl+Plus / Ctrl+Minus) are
 * bound by `editor/shortcuts.ts` through `editor/extensions/textHierarchy.ts`; the registry
 * holds `Mod-=` (shown Ctrl+Plus) and the editor's key map answers the shifted `+` too. The
 * whiteboard's zoom keys are the same chords in their own scope. `mergeTextBlocks` (Block
 * editing, Ctrl+Shift+G; Ctrl+G stays `groupBlocks`) is bound by `editor/shortcuts.ts` through
 * `editor/extensions/mergeTextBlocks.ts`. `removeBlockStyles` (Block editing, Ctrl+Shift+X) is
 * bound by `editor/shortcuts.ts` through `editor/extensions/removeBlockStyles.ts`. `openBlockStyling`
 * (Block editing, Ctrl+Shift+E; Ctrl+E stays `openExportMenu`) is bound by `editor/shortcuts.ts`
 * through `editor/extensions/openBlockStyling.ts`, which asks the handles overlay
 * (`editor/handles/BlockHandles.tsx`) to open the block menu for the target blocks.
 */
export const SWEEP_SHORTCUTS: ShortcutDef[] = [
  def('createNewTask', 'global', 'Create new task', ['Mod-Shift-t'], 'global', V, true),
  def('pasteAsPlainText', 'text', 'Paste as plain text', ['Mod-Shift-v'], 'editor', V, true),
  def('goToCalendar', 'global', 'Go to Calendar', ['Mod-Alt-h'], 'global', V, true),
  def('toggleAllToggles', 'block', 'Open or close all toggles on the page', ['Mod-o'], 'editor', V, true),
  def('increaseTextHierarchy', 'block', 'Increase text hierarchy', ['Mod-='], 'editor', V, true),
  def('decreaseTextHierarchy', 'block', 'Decrease text hierarchy', ['Mod--'], 'editor', V, true),
  def('mergeTextBlocks', 'block', 'Merge the selected text blocks', ['Mod-Shift-g'], 'editor', V, true),
  def('removeBlockStyles', 'block', 'Remove block styles', ['Mod-Shift-x'], 'editor', V, true),
  def('openBlockStyling', 'block', 'Open block styling', ['Mod-Shift-e'], 'editor', V, true),
]

/**
 * M31, the catalog's Page group (§2): "Select all top-level blocks", "Copy deep link" and "Scroll
 * to top Home, bottom End, page up/down". Bound by `object/pageShortcuts.ts` for the active
 * object view (the page, or the peek while one is open). The catalog gives the two first no key:
 * Ctrl+Alt+Shift+A and Ctrl+Alt+Shift+L are ours (⌃⇧⌘A / ⌃⇧⌘L on macOS; L beside Copy block
 * reference's Ctrl+Alt+L), and they work with the caret in the editor. The scroll keys work
 * outside editable fields only; "Page up" and "Page down" are our names for the catalog's
 * "page up/down".
 */
export const PAGE_SHORTCUTS: ShortcutDef[] = [
  def('selectAllTopLevelBlocks', 'page', 'Select all top-level blocks', ['Mod-AltCtrl-Shift-a'], 'global', OURS, true),
  def('copyDeepLink', 'page', 'Copy deep link', ['Mod-AltCtrl-Shift-l'], 'global', OURS, true),
  def('scrollToTop', 'page', 'Scroll to top', ['Home'], 'global', V, true),
  def('scrollToBottom', 'page', 'Scroll to bottom', ['End'], 'global', V, true),
  def('scrollPageUp', 'page', 'Page up', ['PageUp'], 'global', V, true),
  def('scrollPageDown', 'page', 'Page down', ['PageDown'], 'global', V, true),
]

registerShortcuts(EXISTING_SHORTCUTS)
registerShortcuts(M7_SHORTCUTS)
registerShortcuts(M8_SHORTCUTS)
registerShortcuts(POLISH_SHORTCUTS)
registerShortcuts(OBJECT_MENU_SHORTCUTS)
registerShortcuts(AI_SHORTCUTS)
registerShortcuts(SWEEP_SHORTCUTS)
registerShortcuts(PAGE_SHORTCUTS)
