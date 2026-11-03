/**
 * The one shortcut registry. Every entry carries Object's shortcut id (`shortcuts.<id>` in the
 * strings file), its category (`shortcuts.categories.<category>`), its English name
 * (`shortcuts.<id>.name`, verbatim unless marked "our string") and its keys.
 *
 * Keys are written `Mod-Shift-k`: modifiers `Mod` (Ctrl on Windows/Linux, Cmd on macOS), `Ctrl`,
 * `Meta`, `Alt`, `AltCtrl` (Alt on Windows/Linux, Ctrl on macOS: Object's Ctrl+Alt+L / ⌃⌘L
 * pattern), `Shift`, then one key: a letter, a digit, a punctuation character, or a
 * `KeyboardEvent.key` name (`Escape`, `ArrowUp`, `Enter`, `Tab`, `Backspace`, `Delete`, `Space`).
 *
 * The keys are Object's own (its shortcut table, `shortcuts36682.js` `var ex={…}`, checked in
 * `docs/superpowers/plans/reference-check-2026-10-28.md` §1). An id Object lists no key for
 * has `keys: []` and the Shortcuts sheet leaves it out. `provisional: true` marks a key that is
 * ours (no Object key to check against). `bound: false` entries are display-only: their
 * handlers live elsewhere (M1–M6 code), and they are registered so the Shortcuts sheet lists them
 * and the collision test sees them.
 */
import { useEffect, useRef } from 'react'

export type ShortcutScope = 'global' | 'editor' | 'calendar' | 'table' | 'whiteboard'

export interface ShortcutDef {
  id: string
  /** `shortcuts.categories.<category>`: block, text, navigation, global, page, calendar, whiteboard, … */
  category: string
  name: string
  keys: string[]
  scope: ShortcutScope
  provisional: boolean
  /** false: display-only, handled elsewhere. */
  bound?: boolean
}

/** `shortcuts.categories.*` labels (verbatim). */
export const CATEGORY_LABELS: Record<string, string> = {
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

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/** Whether `e` is one of `keys` (exact modifiers; `Mod` is Ctrl, or Cmd on macOS). */
export function matches(e: KeyEventLike, keys: string[]): boolean {
  const mac = isMacPlatform()
  for (const spec of keys) {
    const c = parseKeys(spec, mac)
    if (!!e.ctrlKey !== c.ctrl || !!e.metaKey !== c.meta || !!e.altKey !== c.alt || !!e.shiftKey !== c.shift) continue
    if (keyMatches(e, c.key)) return true
  }
  return false
}

const ARROW_GLYPHS: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }

/** How a key is shown in the Shortcuts sheet (`Ctrl+Shift+K`, or `⌘⇧K` on macOS; arrows as `↑`). */
export function formatKeys(spec: string, mac = isMacPlatform()): string {
  const c = parseKeys(spec, mac)
  const key = ARROW_GLYPHS[c.key] ?? (c.key === 'Space' ? 'Space' : c.key.length === 1 ? c.key.toUpperCase() : c.key)
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

/** Checked against Object's shortcut table (reference-check-2026-10-28 §1). */
const V = false
/** Object-only keys: Object has no such action to check against. */
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
 * M7's shortcuts (the plan's "Shortcut keys" table), with Object's keys. Ids Object lists
 * no key for (`heading1`-`heading4`, `toDo`, `toggle`, `textAlign*`: markdown only) have none.
 */
export const M7_SHORTCUTS: ShortcutDef[] = [
  def('bold', 'text', 'Format bold', ['Mod-b'], 'editor', V),
  def('italic', 'text', 'Italicize', ['Mod-i'], 'editor', V),
  def('underline', 'text', 'Underline', ['Mod-u'], 'editor', V),
  def('strikethrough', 'text', 'Strikethrough', ['Mod-Shift-s'], 'editor', V),
  def('codeToken', 'text', 'Format as code', ['Mod-e'], 'editor', V),
  def('mathToken', 'text', 'Format as TeX-formula', ['Mod-m'], 'editor', V),

  def('heading1', 'block', 'Turn selected blocks into heading 1', [], 'editor', V),
  def('heading2', 'block', 'Turn selected blocks into heading 2', [], 'editor', V),
  def('heading3', 'block', 'Turn selected blocks into heading 3', [], 'editor', V),
  def('heading4', 'block', 'Turn selected blocks into heading 4', [], 'editor', V),
  def('toDo', 'block', 'Turn selected blocks into to-do', [], 'editor', V),
  def('toggle', 'block', 'Add/remove toggle style to/from selected blocks', [], 'editor', V),
  // With blocks selected (Mod-e / Mod-m on a text selection stay codeToken / mathToken).
  def('toggleCodeBlock', 'block', 'Turn block selection into code block', ['Mod-e'], 'editor', V),
  def('toggleMathBlock', 'block', 'Turn block selection into math block', ['Mod-m'], 'editor', V),
  def('textAlignLeft', 'block', 'Align text left', [], 'editor', V),
  def('textAlignCenter', 'block', 'Text align center', [], 'editor', V),
  def('textAlignRight', 'block', 'Text align right', [], 'editor', V),
  def('selectActiveBlock', 'block', 'Set active block as block selection', ['Escape'], 'editor', V),
  def('expandBlockSelectionUpwards', 'block', 'Expand block selection upwards', ['Shift-ArrowUp'], 'editor', V),
  def('expandBlockSelectionDownwards', 'block', 'Expand block selection downwards', ['Shift-ArrowDown'], 'editor', V),
  def('selectAllBlocks', 'block', 'Select all blocks on current level or next higher level', ['Mod-a'], 'editor', V),
  def('deleteBlocks', 'block', 'Delete selected blocks', ['Backspace', 'Delete'], 'editor', V),
  def('duplicateBlocks', 'block', 'Duplicate selected blocks', ['Mod-d'], 'editor', V),
  def('copyBlocksAsMarkdown', 'block', 'Copy selected blocks as markdown', ['Mod-Shift-c'], 'editor', V),
  // Alt+Up/Down moves the selected blocks, or the block holding the cursor; with Shift, on the
  // same level. Object's move always stays on the block's level, so both pairs do the same.
  def('moveSelectedBlocksUp', 'block', 'Move selected blocks up', ['Alt-ArrowUp'], 'editor', V),
  def('moveSelectedBlocksDown', 'block', 'Move selected blocks down', ['Alt-ArrowDown'], 'editor', V),
  def('moveSelectedBlocksUpOnSameLevel', 'block', 'Move selected blocks up on same level', ['Alt-Shift-ArrowUp'], 'editor', V),
  def('moveSelectedBlocksDownOnSameLevel', 'block', 'Move selected blocks down on same level', ['Alt-Shift-ArrowDown'], 'editor', V),
  def('moveUpBlockWithCursor', 'block', 'Move active block up', ['Alt-ArrowUp'], 'editor', V),
  def('moveDownBlockWithCursor', 'block', 'Move active block down', ['Alt-ArrowDown'], 'editor', V),
  def('moveUpBlockWithCursorOnSameLevel', 'block', 'Move active block up on same level', ['Alt-Shift-ArrowUp'], 'editor', V),
  def('moveDownBlockWithCursorOnSameLevel', 'block', 'Move active block down on same level', ['Alt-Shift-ArrowDown'], 'editor', V),
  def('indentBlocks', 'block', 'Indent selected blocks', ['Tab'], 'editor', V),
  def('unindentBlocks', 'block', 'Unindent selected blocks', ['Shift-Tab'], 'editor', V),
  def('toggleTodoInBlockWithCursor', 'block', 'Check/uncheck to-do in active block', ['Mod-Enter'], 'editor', V),
  def(
    'toggleToggleInBlockWithCursor',
    'block',
    'Open/close toggle of active block. Inserts and focuses child block if no children are present. If to-do is present, use alternative with ⇧ key.',
    ['Mod-Enter', 'Mod-Shift-Enter'],
    'editor',
    V,
  ),
  def('insertBlockAbove', 'block', 'Insert block above and set cursor there', ['Alt-Shift-Enter'], 'editor', V),
  def('insertBlockBelow', 'block', 'Insert block below and set cursor there', ['Alt-Enter'], 'editor', V),

  def('closeTab', 'navigation', 'Close current tab', ['Mod-w'], 'global', V),
  def('openNewTab', 'navigation', 'Open new tab', ['Mod-t'], 'global', V),
  def('navigateTabs', 'navigation', 'Navigate tabs', ['Ctrl-Tab'], 'global', V),
  // Object's Ctrl+Shift+A is `toggleChecklistMenu`, not the tab menu.
  def('openTabList', 'navigation', 'Toggle tab menu when multiple tabs are open', ['Mod-Shift-ArrowUp'], 'global', V),
  def('navigateBack', 'navigation', 'Navigate back', ['Mod-ArrowLeft', 'Mod-['], 'global', V),
  def('navigateForward', 'navigation', 'Navigate forward', ['Mod-ArrowRight', 'Mod-]'], 'global', V),

  def('toggleSidepanel', 'global', 'Toggle right sidepanel', ['Mod-Shift-ArrowRight'], 'global', V),
  def('toggleLeftSidebar', 'global', 'Toggle left sidebar', ['Mod-Shift-ArrowLeft'], 'global', V),
  // Object's Ctrl+Shift+Y is `openMinigame`.
  def('toggleCalendarSidebar', 'global', 'Toggle calendar sidebar', ['Mod-Alt-s'], 'global', V),
  def('toggleDarkMode', 'global', 'Toggle dark mode', ['Mod-Shift-l'], 'global', V),
  // Also docs/design-notes binds Settings to CmdOrCtrl+,.
  def('openSettings', 'global', 'Open settings', ['Mod-,'], 'global', V),
  def('toggleShortcutsMenu', 'global', 'Show/hide shortcuts menu', ['Mod-Shift-b'], 'global', V),
]

/**
 * M1–M6 bindings, display-only (`bound: false`): their handlers stay where they are. The keys are
 * the built ones (our choices where no reference exists, as each module notes).
 */
export const EXISTING_SHORTCUTS: ShortcutDef[] = [
  // M5, palette/CommandPalette.tsx (it reads these keys). Object: search is Ctrl+P or Ctrl+K;
  // it lists no key for the action palette (reached from the palette's switch button).
  def('openSearchPalette', 'global', 'Search this space', ['Mod-p', 'Mod-k'], 'global', false, false),
  def('openCommandPalette', 'global', 'Open action palette', [], 'global', false, false),
  // M5, object/ObjectView.tsx (no Object id: our id and our string)
  def('findInPage', 'page', 'Find in page', ['Mod-f'], 'global', false, false),
  // M1–M3, App.tsx (outside editable targets)
  def('openAddEntityMenu', 'global', 'Add new content', ['Mod-u'], 'global', false, false),
  def('createNewEntityOfType', 'global', 'Create new object of current type', ['Mod-n'], 'global', false, false),
  def('deleteCurrentPage', 'page', 'Delete current page', ['Mod-Backspace'], 'global', false, false),
  // M4, calendar/CalendarChrome.tsx
  def('goToToday', 'calendar', 'Set active date to today', ['t'], 'calendar', false, false),
  def('setViewToMonth', 'calendar', 'Go to monthly view', ['m'], 'calendar', false, false),
  def('setViewToWeek', 'calendar', 'Go to weekly view', ['w'], 'calendar', false, false),
  def('setViewToRolling', 'calendar', 'Go to 3 days rolling view', ['r'], 'calendar', false, false),
  def('setViewToDay', 'calendar', 'Go to daily view', ['d'], 'calendar', false, false),
  def('goToPrevious', 'calendar', 'Go to previous day, week, or month', ['ArrowLeft'], 'calendar', false, false),
  def('goToNext', 'calendar', 'Go to next day, week, or month', ['ArrowRight'], 'calendar', false, false),
  def(
    'goToPreviousHigherUnit',
    'calendar',
    'Go to previous week, month, or year (depending on active view)',
    ['ArrowUp'],
    'calendar',
    false,
    false,
  ),
  def(
    'goToNextHigherUnit',
    'calendar',
    'Go to next week, month, or year (depending on active view)',
    ['ArrowDown'],
    'calendar',
    false,
    false,
  ),
  // M6, whiteboard/shortcuts.ts keyToCommand (Object's whiteboard table)
  def('whiteboardSelect', 'whiteboard', 'Select tool', ['v'], 'whiteboard', false, false),
  def('whiteboardHand', 'whiteboard', 'Hand tool', ['h'], 'whiteboard', false, false),
  def('whiteboardText', 'whiteboard', 'Text', ['t'], 'whiteboard', false, false),
  def('whiteboardRectangle', 'whiteboard', 'Rectangle', ['r'], 'whiteboard', false, false),
  def('whiteboardEllipse', 'whiteboard', 'Ellipse', ['o'], 'whiteboard', false, false),
  def('whiteboardTriangle', 'whiteboard', 'Triangle', ['p'], 'whiteboard', false, false),
  def('whiteboardLine', 'whiteboard', 'Line', ['l'], 'whiteboard', false, false),
  def('whiteboardArrow', 'whiteboard', 'Arrow', ['Shift-l'], 'whiteboard', false, false),
  def('whiteboardFrame', 'whiteboard', 'Frame', ['f'], 'whiteboard', false, false),
  // Pen, highlighter and eraser are Object's own (no Object id): our ids, our strings, our
  // keys. They avoid Object's letters (P is Triangle, M opens the move menu).
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
  def('whiteboardCycleBack', 'whiteboard', 'Cycle selected objects backward', ['Shift-Tab'], 'whiteboard', false, false),
  def('whiteboardPan', 'whiteboard', 'Pan', ['Space'], 'whiteboard', false, false),
  def('undo', 'whiteboard', 'Undo last change', ['Mod-z'], 'whiteboard', false, false),
  def('redo', 'whiteboard', 'Redo last change', ['Mod-Shift-z', 'Mod-y'], 'whiteboard', false, false),
]

/**
 * M8's shortcuts (the plan's "Shortcut keys (new ids, provisional)" table; names
 * `shortcuts.<id>.name`, verbatim). Every key is provisional. Editor ones are bound by Task 25
 * (`editor/shortcuts.ts`), focus and presentation ones by Task 9, whiteboard ones by Task 21.
 * `exitPresentationMode`, `nextPresentationSlide` and `previousPresentationSlide` are active only
 * while presenting (scope `presentation` is not a scope here: they are global, and only the
 * presentation view binds them, so they never fire otherwise).
 */
export const M8_SHORTCUTS: ShortcutDef[] = [
  // Ctrl+Alt+L on Windows, ⌃⌘L on macOS.
  def('copyBlockReference', 'block', 'Copy block reference', ['Mod-AltCtrl-l'], 'editor', V, true),
  // `I` with blocks selected (typing `i` in text stays typing).
  def('turnIntoObject', 'block', 'Turn into object', ['i'], 'editor', V, true),
  // No key in Object: its only trigger is the markdown `()` + Space.
  def('turnIntoTask', 'block', 'Turn into task', [], 'editor', V, true),
  def('turnBlockIntoTaskObject', 'block', 'Turn block into task object', ['Mod-Shift-t'], 'editor', V, true),
  def('highlightText', 'text', 'Highlight text selection', ['Mod-Shift-h'], 'editor', V, true),
  def('toggleFocusMode', 'global', 'Toggle focus mode', ['Mod-Shift-m'], 'global', V, true),
  // Ctrl+Alt+P on Windows, ⌃⌘P on macOS.
  def('openPresentationMode', 'page', 'Start presentation mode', ['Mod-AltCtrl-p'], 'global', V, true),
  def('exitPresentationMode', 'page', 'Exit presentation mode', ['Escape'], 'global', V, true),
  def('nextPresentationSlide', 'page', 'Next presentation slide', ['ArrowRight'], 'global', V, true),
  def('previousPresentationSlide', 'page', 'Previous presentation slide', ['ArrowLeft'], 'global', V, true),
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
    'Resize selection farther',
    ['Mod-Shift-ArrowUp', 'Mod-Shift-ArrowDown', 'Mod-Shift-ArrowLeft', 'Mod-Shift-ArrowRight'],
    'whiteboard',
    V,
    true,
  ),
]

/**
 * Ids that share a key by design, as in Object: the handlers tell them apart (a text
 * selection or blocks selected; the cursor in a to-do or a toggle).
 */
export const SHARED_KEY_IDS: readonly (readonly string[])[] = [
  ['codeToken', 'toggleCodeBlock'],
  ['mathToken', 'toggleMathBlock'],
  ['toggleTodoInBlockWithCursor', 'toggleToggleInBlockWithCursor'],
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
 * Keys added by the 2026-11-02 polish pass. `groupBlocks` (Ctrl+G, the key Object's block
 * menu shows next to "Group"; name `shortcuts.groupBlocks.name`) is bound in
 * `editor/handles/groupKey.ts`, with blocks selected only.
 */
export const POLISH_SHORTCUTS: ShortcutDef[] = [
  def('groupBlocks', 'block', 'Group selected blocks or ungroup selected group block', ['Mod-g'], 'editor', V, true),
]

registerShortcuts(EXISTING_SHORTCUTS)
registerShortcuts(M7_SHORTCUTS)
registerShortcuts(M8_SHORTCUTS)
registerShortcuts(POLISH_SHORTCUTS)
