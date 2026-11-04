/**
 * The `/` menu's trigger (Task 12): `@tiptap/suggestion` on a `/` typed at the
 * start of a block or after a space, tab or no-break space (so `and/or`, `11/04`
 * and URLs stay plain text), in any text block but code and raw blocks, and on
 * the `/` that `openSlashMenu` types. Spaces are allowed in the query (an
 * object title). Its state goes to the `useSlashMenu` store, which the editor's
 * `<SlashMenu>` (`slash/SlashMenu.tsx`) draws; key presses while it is open go
 * to that component first. Escape closes it (the suggestion's own rule).
 */
import { Extension, type Editor, type Range } from '@tiptap/core'
import { PluginKey, TextSelection } from '@tiptap/pm/state'
import { Suggestion, exitSuggestion } from '@tiptap/suggestion'
import { create } from 'zustand'
import type { SlashView } from '../slash/slashItems'

export const slashMenuKey = new PluginKey('slashMenu')

export interface SlashMenuState {
  /** The editor the open menu belongs to. */
  editor: Editor | null
  /** The `/query` text's range. */
  range: Range | null
  query: string
  /** Where the `/` is on screen (for placing the menu). */
  rect: DOMRect | null
  /** A sub-view opened by an item (after the `/query` text is gone): the colour lists, the icon picker, the URL field. */
  sub: { editor: Editor; view: SlashView; rect: DOMRect | null } | null
}

export const useSlashMenu = create<SlashMenuState>(() => ({
  editor: null,
  range: null,
  query: '',
  rect: null,
  sub: null,
}))

type KeyHandler = (event: KeyboardEvent) => boolean
const keyHandlers = new WeakMap<Editor, KeyHandler>()

/** The mounted menu of `editor` handles keys while it is open (true when it did); returns the unregister. */
export function registerSlashKeyHandler(editor: Editor, handler: KeyHandler): () => void {
  keyHandlers.set(editor, handler)
  return () => {
    if (keyHandlers.get(editor) === handler) keyHandlers.delete(editor)
  }
}

function rectOf(clientRect: (() => DOMRect | null) | null | undefined): DOMRect | null {
  try {
    return clientRect?.() ?? null
  } catch {
    return null
  }
}

/** Close the menu (the `/query` text stays). */
export function closeSlashMenu(editor: Editor): void {
  if (!editor.isDestroyed) exitSuggestion(editor.view, slashMenuKey)
  const s = useSlashMenu.getState()
  if (s.editor === editor) useSlashMenu.setState({ editor: null, range: null, query: '', rect: null })
}

/**
 * Where `openSlashMenu` typed its `/`: that one opens the menu wherever it is,
 * while a typed `/` opens it only at a block's start or after whitespace.
 */
const openedAt = new WeakMap<Editor, number>()

const GAP_BEFORE_SLASH = /[ \t ]$/

/** A typed `/` at `pos` opens the menu: at the start of a block, after a line break, or after a space, tab or no-break space. */
function slashMayOpenAt(doc: Editor['state']['doc'], pos: number): boolean {
  const before = doc.resolve(pos).nodeBefore
  if (!before) return true
  if (before.isText) return GAP_BEFORE_SLASH.test(before.text ?? '')
  return before.type.name === 'hardBreak'
}

/** Type a `/` at the cursor, which opens the menu there. */
export function openSlashMenu(editor: Editor): void {
  const { state } = editor
  const { from } = state.selection
  openedAt.set(editor, from)
  const tr = state.tr.insertText('/', from)
  tr.setSelection(TextSelection.create(tr.doc, from + 1))
  editor.view.dispatch(tr)
  editor.view.focus()
}

const NO_SLASH_IN = new Set(['codeBlock', 'rawBlock'])

export const SlashMenu = Extension.create({
  name: 'slashMenu',
  // Its keys (arrows, Enter, Escape) come before every other key map.
  priority: 1000,

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      Suggestion({
        pluginKey: slashMenuKey,
        editor,
        char: '/',
        allowSpaces: true,
        // The prefix rule (block start or whitespace before the `/`) is checked in
        // `allow`, which sees across mark boundaries and inline nodes and lets
        // `openSlashMenu` open the menu anywhere.
        allowedPrefixes: null,
        allow: ({ state, range }) => {
          if (!editor.isEditable) return false
          const $from = state.doc.resolve(range.from)
          if (NO_SLASH_IN.has($from.parent.type.name)) return false
          return openedAt.get(editor) === range.from || slashMayOpenAt(state.doc, range.from)
        },
        render: () => ({
          onStart: (p) => {
            useSlashMenu.setState({ editor: p.editor, range: p.range, query: p.query, rect: rectOf(p.clientRect), sub: null })
          },
          onUpdate: (p) => {
            useSlashMenu.setState({ editor: p.editor, range: p.range, query: p.query, rect: rectOf(p.clientRect) })
          },
          onExit: (p) => {
            openedAt.delete(editor)
            if (useSlashMenu.getState().editor === p.editor) {
              useSlashMenu.setState({ editor: null, range: null, query: '', rect: null })
            }
          },
          onKeyDown: ({ event }) => {
            if (useSlashMenu.getState().editor !== editor) return false
            return keyHandlers.get(editor)?.(event) ?? false
          },
        }),
      }),
    ]
  },
})
