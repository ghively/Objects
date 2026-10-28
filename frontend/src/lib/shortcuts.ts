/**
 * The one shortcut registry. Every entry carries Capacities' shortcut id (`shortcuts.<id>` in the
 * strings file), its category (`shortcuts.categories.<category>`), its English name
 * (`shortcuts.<id>.name`, verbatim unless marked "our string") and its keys.
 *
 * Keys are written `Mod-Shift-k`: modifiers `Mod` (Ctrl on Windows/Linux, Cmd on macOS), `Ctrl`,
 * `Meta`, `Alt`, `Shift`, then one key: a letter, a digit, a punctuation character, or a
 * `KeyboardEvent.key` name (`Escape`, `ArrowUp`, `Enter`, `Tab`, `Backspace`, `Delete`, `Space`).
 *
 * `provisional: true` keys are not in the trimmed reference (the plan's key table); Gene confirms
 * them in the hand-check. `bound: false` entries are display-only: their handlers live elsewhere
 * (M1–M6 code), and they are registered so the Shortcuts sheet lists them and the collision test
 * sees them.
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
  if (/^[a-z]$/i.test(key)) return (e.key ?? '').toLowerCase() === key.toLowerCase() || code === `Key${key.toUpperCase()}`
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

/** How a key is shown in the Shortcuts sheet (`Ctrl+Shift+K`, or `⌘⇧K` on macOS). */
export function formatKeys(spec: string, mac = isMacPlatform()): string {
  const c = parseKeys(spec, mac)
  const key = c.key === 'Space' ? 'Space' : c.key.length === 1 ? c.key.toUpperCase() : c.key
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

const P = true // provisional: keys from the plan's table, not in the trimmed reference

const def = (
  id: string,
  category: string,
  name: string,
  keys: string[],
  scope: ShortcutScope,
  provisional: boolean,
  bound?: boolean,
): ShortcutDef => (bound === undefined ? { id, category, name, keys, scope, provisional } : { id, category, name, keys, scope, provisional, bound })

/** M7's shortcuts (the plan's "Shortcut keys" table). */
export const M7_SHORTCUTS: ShortcutDef[] = [
  def('bold', 'text', 'Format bold', ['Mod-b'], 'editor', P),
  def('italic', 'text', 'Italicize', ['Mod-i'], 'editor', P),
  def('underline', 'text', 'Underline', ['Mod-u'], 'editor', P),
  def('strikethrough', 'text', 'Strikethrough', ['Mod-Shift-s'], 'editor', P),
  def('codeToken', 'text', 'Format as code', ['Mod-e'], 'editor', P),
  def('mathToken', 'text', 'Format as TeX-formula', ['Mod-Shift-m'], 'editor', P),

  def('heading1', 'block', 'Turn selected blocks into heading 1', ['Mod-Alt-1'], 'editor', P),
  def('heading2', 'block', 'Turn selected blocks into heading 2', ['Mod-Alt-2'], 'editor', P),
  def('heading3', 'block', 'Turn selected blocks into heading 3', ['Mod-Alt-3'], 'editor', P),
  def('heading4', 'block', 'Turn selected blocks into heading 4', ['Mod-Alt-4'], 'editor', P),
  def('toDo', 'block', 'Turn selected blocks into to-do', ['Mod-Alt-t'], 'editor', P),
  def('toggle', 'block', 'Add/remove toggle style to/from selected blocks', ['Mod-Alt-g'], 'editor', P),
  def('toggleCodeBlock', 'block', 'Turn block selection into code block', ['Mod-Alt-c'], 'editor', P),
  def('toggleMathBlock', 'block', 'Turn block selection into math block', ['Mod-Alt-m'], 'editor', P),
  def('textAlignLeft', 'block', 'Align text left', ['Mod-Shift-l'], 'editor', P),
  def('textAlignCenter', 'block', 'Text align center', ['Mod-Shift-e'], 'editor', P),
  def('textAlignRight', 'block', 'Text align right', ['Mod-Shift-r'], 'editor', P),
  def('selectActiveBlock', 'block', 'Set active block as block selection', ['Escape'], 'editor', P),
  def('expandBlockSelectionUpwards', 'block', 'Expand block selection upwards', ['Shift-ArrowUp'], 'editor', P),
  def('expandBlockSelectionDownwards', 'block', 'Expand block selection downwards', ['Shift-ArrowDown'], 'editor', P),
  def('selectAllBlocks', 'block', 'Select all blocks on current level or next higher level', ['Mod-a'], 'editor', P),
  def('deleteBlocks', 'block', 'Delete selected blocks', ['Backspace', 'Delete'], 'editor', P),
  def('duplicateBlocks', 'block', 'Duplicate selected blocks', ['Mod-d'], 'editor', P),
  def('copyBlocksAsMarkdown', 'block', 'Copy selected blocks as markdown', ['Mod-Shift-c'], 'editor', P),
  def('moveSelectedBlocksUp', 'block', 'Move selected blocks up', ['Mod-Shift-ArrowUp'], 'editor', P),
  def('moveSelectedBlocksDown', 'block', 'Move selected blocks down', ['Mod-Shift-ArrowDown'], 'editor', P),
  def('indentBlocks', 'block', 'Indent selected blocks', ['Tab'], 'editor', P),
  def('unindentBlocks', 'block', 'Unindent selected blocks', ['Shift-Tab'], 'editor', P),
  def('toggleTodoInBlockWithCursor', 'block', 'Check/uncheck to-do in active block', ['Mod-Enter'], 'editor', P),
  def(
    'toggleToggleInBlockWithCursor',
    'block',
    'Open/close toggle of active block. Inserts and focuses child block if no children are present. If to-do is present, use alternative with ⇧ key.',
    ['Mod-Shift-Enter'],
    'editor',
    P,
  ),
  def('insertBlockAbove', 'block', 'Insert block above and set cursor there', ['Alt-Shift-Enter'], 'editor', P),
  def('insertBlockBelow', 'block', 'Insert block below and set cursor there', ['Alt-Enter'], 'editor', P),

  def('closeTab', 'navigation', 'Close current tab', ['Mod-w'], 'global', P),
  def('openNewTab', 'navigation', 'Open new tab', ['Mod-t'], 'global', P),
  def('navigateTabs', 'navigation', 'Navigate tabs', ['Ctrl-Tab'], 'global', P),
  def('openTabList', 'navigation', 'Toggle tab menu when multiple tabs are open', ['Mod-Shift-a'], 'global', P),
  def('navigateBack', 'navigation', 'Navigate back', ['Alt-ArrowLeft'], 'global', P),
  def('navigateForward', 'navigation', 'Navigate forward', ['Alt-ArrowRight'], 'global', P),

  def('toggleSidepanel', 'global', 'Toggle right sidepanel', ['Mod-Shift-\\'], 'global', P),
  def('toggleLeftSidebar', 'global', 'Toggle left sidebar', ['Mod-\\'], 'global', P),
  def('toggleCalendarSidebar', 'global', 'Toggle calendar sidebar', ['Mod-Shift-y'], 'global', P),
  def('toggleDarkMode', 'global', 'Toggle dark mode', ['Mod-Shift-d'], 'global', P),
  // Verified: reference/recovered-ts/src/electron/electron-menu.ts binds Settings to CmdOrCtrl+,.
  def('openSettings', 'global', 'Open settings', ['Mod-,'], 'global', false),
  def('toggleShortcutsMenu', 'global', 'Show/hide shortcuts menu', ['Mod-/'], 'global', P),
]

/**
 * M1–M6 bindings, display-only (`bound: false`): their handlers stay where they are. The keys are
 * the built ones (our choices where no reference exists, as each module notes).
 */
export const EXISTING_SHORTCUTS: ShortcutDef[] = [
  // M5, palette/CommandPalette.tsx
  def('openSearchPalette', 'global', 'Search this space', ['Mod-k'], 'global', false, false),
  def('openCommandPalette', 'global', 'Open action palette', ['Mod-p'], 'global', false, false),
  // M5, object/ObjectView.tsx (no Capacities id: our id and our string)
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
  // M6, whiteboard/shortcuts.ts keyToCommand
  def('whiteboardSelect', 'whiteboard', 'Select tool', ['v'], 'whiteboard', false, false),
  def('whiteboardHand', 'whiteboard', 'Hand tool', ['h'], 'whiteboard', false, false),
  def('whiteboardText', 'whiteboard', 'Text', ['t'], 'whiteboard', false, false),
  def('whiteboardRectangle', 'whiteboard', 'Rectangle', ['r'], 'whiteboard', false, false),
  def('whiteboardEllipse', 'whiteboard', 'Ellipse', ['o'], 'whiteboard', false, false),
  def('whiteboardTriangle', 'whiteboard', 'Triangle', ['Shift-r'], 'whiteboard', false, false),
  def('whiteboardLine', 'whiteboard', 'Line', ['l'], 'whiteboard', false, false),
  def('whiteboardArrow', 'whiteboard', 'Arrow', ['a'], 'whiteboard', false, false),
  def('whiteboardFrame', 'whiteboard', 'Frame', ['f'], 'whiteboard', false, false),
  // Pen, highlighter and eraser have no Capacities shortcut id: our ids, our strings.
  def('whiteboardPen', 'whiteboard', 'Pen', ['p'], 'whiteboard', false, false),
  def('whiteboardHighlighter', 'whiteboard', 'Highlighter', ['m'], 'whiteboard', false, false),
  def('whiteboardEraser', 'whiteboard', 'Eraser', ['e'], 'whiteboard', false, false),
  def('whiteboardZoomIn', 'whiteboard', 'Zoom in', ['Mod-='], 'whiteboard', false, false),
  def('whiteboardZoomOut', 'whiteboard', 'Zoom out', ['Mod--'], 'whiteboard', false, false),
  def('whiteboardZoomReset', 'whiteboard', 'Zoom to 100%', ['Mod-0'], 'whiteboard', false, false),
  def('whiteboardFitAll', 'whiteboard', 'Zoom to fit', ['Shift-1'], 'whiteboard', false, false),
  def('whiteboardFitSelection', 'whiteboard', 'Zoom to selection', ['Shift-2'], 'whiteboard', false, false),
  def('whiteboardBringForward', 'whiteboard', 'Bring forward', ['Mod-]'], 'whiteboard', false, false),
  def('whiteboardBringToFront', 'whiteboard', 'Bring to front', ['Mod-Shift-]'], 'whiteboard', false, false),
  def('whiteboardSendBackward', 'whiteboard', 'Send backward', ['Mod-['], 'whiteboard', false, false),
  def('whiteboardSendToBack', 'whiteboard', 'Send to back', ['Mod-Shift-['], 'whiteboard', false, false),
  def('whiteboardWrapInFrame', 'whiteboard', 'Wrap in frame', ['Mod-Alt-g'], 'whiteboard', false, false),
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
  def('copyBlockReference', 'block', 'Copy block reference', ['Mod-Alt-r'], 'editor', P, true),
  def('turnIntoObject', 'block', 'Turn into object', ['Mod-Alt-o'], 'editor', P, true),
  def('turnIntoTask', 'block', 'Turn into task', ['Mod-Alt-k'], 'editor', P, true),
  def('turnBlockIntoTaskObject', 'block', 'Turn block into task object', ['Mod-Alt-Shift-k'], 'editor', P, true),
  def('highlightText', 'text', 'Highlight text selection', ['Mod-Shift-h'], 'editor', P, true),
  def('toggleFocusMode', 'global', 'Toggle focus mode', ['Mod-Shift-f'], 'global', P, true),
  def('openPresentationMode', 'page', 'Start presentation mode', ['Mod-Alt-p'], 'global', P, true),
  def('exitPresentationMode', 'page', 'Exit presentation mode', ['Escape'], 'global', P, true),
  def('nextPresentationSlide', 'page', 'Next presentation slide', ['ArrowRight'], 'global', P, true),
  def('previousPresentationSlide', 'page', 'Previous presentation slide', ['ArrowLeft'], 'global', P, true),
  def(
    'whiteboardResize',
    'whiteboard',
    'Resize selection',
    ['Mod-Alt-ArrowUp', 'Mod-Alt-ArrowDown', 'Mod-Alt-ArrowLeft', 'Mod-Alt-ArrowRight'],
    'whiteboard',
    P,
    true,
  ),
  def(
    'whiteboardResizeLarge',
    'whiteboard',
    'Resize selection farther',
    ['Mod-Alt-Shift-ArrowUp', 'Mod-Alt-Shift-ArrowDown', 'Mod-Alt-Shift-ArrowLeft', 'Mod-Alt-Shift-ArrowRight'],
    'whiteboard',
    P,
    true,
  ),
]

/** The ids only bound while presenting (the plan: "the last three only while presenting"). */
export const PRESENTATION_ONLY_IDS: readonly string[] = ['exitPresentationMode', 'nextPresentationSlide', 'previousPresentationSlide']

registerShortcuts(EXISTING_SHORTCUTS)
registerShortcuts(M7_SHORTCUTS)
registerShortcuts(M8_SHORTCUTS)
