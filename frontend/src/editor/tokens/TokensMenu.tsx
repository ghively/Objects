/**
 * The text-selection toolbar, shown above a non-empty text
 * selection, in the live app's order (catalog section 6): Bold, Italic,
 * Strikethrough, Underline, Bullet list, To-do, Link, Code, Formula,
 * "Highlight text" (the colour panel, `ColorMenu`), `+` ("Create object from
 * text selection."), `@` ("Point the selected text at an object you already have.") and the
 * AI sparkle ("AI", M10; gone while "Hide AI features" is on). The two list buttons turn the block
 * into that list and back to text (the catalog read the second icon as
 * numbered or to-do; To-do is our choice).
 *
 * - Create: pick a type ("Search Object Types"); a new object of it is titled
 *   with the selection, the selection becomes `[[Title]]`, and the object opens
 *   where the click's modifier keys say (`createAndOpen`).
 * - Link existing: pick an object; the selection becomes a link to it, keeping
 *   the selected words as the label when they differ from the title (our choice).
 * - AI: opens the AI chat about the selected text (`aiEntries.openSelectionAi`);
 *   accepting an answer replaces the selection (if it is still the same text)
 *   or adds a paragraph below its block. The divider before it is our choice.
 * - The `highlightText` shortcut is not the panel: it toggles
 *   the last-used colour on the selection (`nodes/textStyle`).
 *
 * Mounted by `Editor.tsx` with this name and props (Task 25). Strings are
 * catalogued unless marked "our string"; the toolbar's look is our choice
 * (`tokens.css`).
 */
import type { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import {
  BoldIcon,
  CodeIcon,
  AtSignIcon,
  HighlighterIcon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  PlusIcon,
  SigmaIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAiHidden } from '@/ai/store'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { createAndOpen, type OpenMods } from '@/create/createAndOpen'
import { cn } from '@/lib/utils'
import { ensureLinkIndex, typeOf, useLinkIndex } from '@/links/linkIndex'
import { fuzzyMatch, fuzzyScore } from '@/links/LinkPicker'
import { TypeChip } from '@/shell/Sidebar'
import { AI_ICON, AI_TEXT, openSelectionAi, useAiBlocked } from '../aiEntries'
import { blockSelectionRange, turnInto } from '../extensions/blockSelection'
import { wikilinkTargetFor } from '../extensions/wikilink'
import { ColorMenu, COLOR_MENU_TEXT } from './ColorMenu'
import './tokens.css'

export const TOKENS_MENU_TEXT = {
  toolbar: 'Text selection', // our string (the toolbar's accessible name)
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  code: 'Code',
  formula: 'Formula',
  bullet: 'Bullet list',
  todo: 'To-do',
  link: 'Link',
  highlight: COLOR_MENU_TEXT.title,
  create: 'Make a new object out of the selected text.',
  reuse: 'Point the selected text at an object you already have.',
  ai: AI_TEXT.ai,
  searchTypes: 'Search Object Types',
  searchObjects: 'Search objects', // our string
  noObjects: 'No matching objects', // our string (as the link picker)
  addLink: 'Add a link',
  updateLink: 'Update link',
  removeLink: 'Remove link',
}

/** The order of the toolbar's buttons (their accessible names). */
export const TOKENS_MENU_ITEMS: readonly string[] = [
  TOKENS_MENU_TEXT.bold,
  TOKENS_MENU_TEXT.italic,
  TOKENS_MENU_TEXT.strikethrough,
  TOKENS_MENU_TEXT.underline,
  TOKENS_MENU_TEXT.bullet,
  TOKENS_MENU_TEXT.todo,
  TOKENS_MENU_TEXT.link,
  TOKENS_MENU_TEXT.code,
  TOKENS_MENU_TEXT.formula,
  TOKENS_MENU_TEXT.highlight,
  TOKENS_MENU_TEXT.create,
  TOKENS_MENU_TEXT.reuse,
  TOKENS_MENU_TEXT.ai, // M10, while AI features are not hidden
]

export type TokensMenuProps = { editor: Editor | null; path: string }

type Panel = 'color' | 'create' | 'reuse' | 'link' | null

/** The selected text, or `null` when the selection is not a non-empty text range the toolbar acts on. */
export function selectionText(editor: Editor): string | null {
  const { state } = editor
  const sel = state.selection
  if (!(sel instanceof TextSelection) || sel.empty) return null
  if (sel instanceof NodeSelection) return null
  if (blockSelectionRange(state)) return null
  // Not inside a code block (no marks apply there); our choice.
  if (sel.$from.parent.type.spec.code || sel.$to.parent.type.spec.code) return null
  const text = state.doc.textBetween(sel.from, sel.to, ' ', ' ')
  return text.trim() === '' ? null : text
}

/** A title from the selected words: one line, without the characters a `[[link]]` cannot hold (our choice). */
export function titleFromSelection(text: string): string {
  return text
    .replace(/[[\]|#^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Replace the selection with a link to `title` (`label` when the words differ). */
export function linkSelectionTo(editor: Editor, title: string, label?: string | null): boolean {
  const { from, to } = editor.state.selection
  const text = label ?? null
  return editor
    .chain()
    .focus()
    .insertContentAt({ from, to }, [{ type: 'wikilink', attrs: { target: title, label: text && text !== title ? text : null } }])
    .run()
}

/** "Make a new object out of the selected text.": the selection becomes `[[Title]]` and a new object of `typeId` gets that title. */
export async function createObjectFromSelection(editor: Editor, typeId: string, mods: OpenMods = {}): Promise<boolean> {
  const text = selectionText(editor)
  if (text === null) return false
  const title = titleFromSelection(text)
  if (!title) return false
  // Link first: opening the new object may take this editor away.
  linkSelectionTo(editor, title)
  await createAndOpen(typeId, { title }, mods)
  return true
}

/** "Point the selected text at an object you already have.": the selection becomes a link to `object` (by path when its title cannot be a target). */
export function linkSelectionToObject(editor: Editor, object: Pick<ObjectSummary, 'title' | 'path'>): boolean {
  const text = selectionText(editor)
  if (text === null) return false
  return linkSelectionTo(editor, wikilinkTargetFor(object), text.trim())
}

/** The list buttons: the block becomes a `kind` list, or text again when it is one already. */
export function toggleListFromSelection(editor: Editor, kind: 'bullet' | 'todo'): boolean {
  const active = editor.isActive(kind === 'bullet' ? 'bulletList' : 'taskList')
  return turnInto(editor, active ? 'text' : kind)
}

/** "Formula": the selected text becomes an inline formula. */
export function selectionToFormula(editor: Editor): boolean {
  const text = selectionText(editor)
  if (text === null) return false
  const { from, to } = editor.state.selection
  return editor.chain().focus().insertContentAt({ from, to }, [{ type: 'inlineMath', attrs: { text } }]).run()
}

function mods(e: MouseEvent | KeyboardEvent): OpenMods {
  return { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey }
}

function ToolButton({
  label,
  active,
  pressed,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  pressed?: boolean
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={active}
      data-active={pressed || active || undefined}
      className="tokens-button"
      // Keep the editor's selection and focus.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** A search box with a list under it, for the type and object pickers. */
function PickerPanel<T>({
  label,
  placeholder,
  initial,
  items,
  keyOf,
  render,
  empty,
  onPick,
  onClose,
}: {
  label: string
  placeholder: string
  initial?: string
  items: (query: string) => T[]
  keyOf: (item: T) => string
  render: (item: T) => ReactNode
  empty: string
  onPick: (item: T, e: MouseEvent | KeyboardEvent) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState(initial ?? '')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const list = items(query)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  return (
    <div className="tokens-panel tokens-picker" role="dialog" aria-label={label}>
      <input
        ref={inputRef}
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        className="tokens-input"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, list.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const item = list[active]
            if (item !== undefined) onPick(item, e)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <ul role="listbox" aria-label={label} className="tokens-list">
        {list.length === 0 && <li className="tokens-empty">{empty}</li>}
        {list.map((item, i) => (
          <li key={keyOf(item)} role="option" aria-selected={i === active}>
            <button
              type="button"
              className={cn('tokens-list-row', i === active && 'is-active')}
              onMouseEnter={() => setActive(i)}
              onClick={(e) => onPick(item, e)}
            >
              {render(item)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LinkPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = editor.isActive('link') ? String(editor.getAttributes('link').href ?? '') : ''
  const [href, setHref] = useState(current)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const apply = () => {
    const url = href.trim()
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    else editor.chain().focus().extendMarkRange('link').unsetLink().run()
    onClose()
  }
  const placeholder = current ? TOKENS_MENU_TEXT.updateLink : TOKENS_MENU_TEXT.addLink
  return (
    <div className="tokens-panel tokens-link" role="dialog" aria-label={TOKENS_MENU_TEXT.link}>
      <input
        ref={inputRef}
        aria-label={placeholder}
        placeholder={placeholder}
        value={href}
        className="tokens-input"
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
            editor.commands.focus()
          }
        }}
      />
      {current && (
        <button
          type="button"
          className="tokens-list-row"
          onClick={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            onClose()
          }}
        >
          {TOKENS_MENU_TEXT.removeLink}
        </button>
      )}
    </div>
  )
}

function rectOf(editor: Editor): { top: number; left: number } | null {
  const { from, to } = editor.state.selection
  try {
    const a = editor.view.coordsAtPos(from)
    const b = editor.view.coordsAtPos(to)
    return { top: Math.min(a.top, b.top), left: a.left }
  } catch {
    return { top: 0, left: 0 } // no layout (jsdom)
  }
}

export function TokensMenu({ editor }: TokensMenuProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [panel, setPanel] = useState<Panel>(null)
  const [, setTick] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<Panel>(null)
  panelRef.current = panel
  const types = useLinkIndex((s) => s.types)
  const objects = useLinkIndex((s) => s.objects)
  // Hidden too on a page excluded from AI or a template (M10).
  const aiBlocked = useAiBlocked(editor)
  const aiHidden = useAiHidden() || aiBlocked

  const refresh = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    const text = editor.isEditable ? selectionText(editor) : null
    const focused = editor.view.hasFocus() || panelRef.current !== null
    const show = text !== null && focused
    setVisible(show)
    if (!show) {
      if (text === null) setPanel(null)
      return
    }
    const r = rectOf(editor)
    if (r) setPos(r)
    setTick((t) => t + 1) // re-read the marks' active state
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const onBlur = ({ event }: { event: FocusEvent }) => {
      const next = event.relatedTarget as globalThis.Node | null
      if (next && rootRef.current?.contains(next)) return
      if (panelRef.current) return
      setVisible(false)
    }
    editor.on('selectionUpdate', refresh)
    editor.on('transaction', refresh)
    editor.on('focus', refresh)
    editor.on('blur', onBlur)
    return () => {
      editor.off('selectionUpdate', refresh)
      editor.off('transaction', refresh)
      editor.off('focus', refresh)
      editor.off('blur', onBlur)
    }
  }, [editor, refresh])


  // A click outside the toolbar and the editor closes an open panel.
  useEffect(() => {
    if (!panel || !editor) return
    const onDown = (e: globalThis.MouseEvent) => {
      const t = e.target as globalThis.Node
      if (rootRef.current?.contains(t) || editor.view.dom.contains(t)) return
      setPanel(null)
      setVisible(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [panel, editor])

  const typeItems = useMemo(
    () => (query: string) => {
      const q = query.trim()
      const list = types.filter((t: TypeDef) => !t.readOnlyReason)
      if (!q) return list
      return list
        .map((t) => ({ t, s: fuzzyScore(q, t.name) }))
        .filter((x) => x.s !== null)
        .sort((a, b) => (b.s as number) - (a.s as number))
        .map((x) => x.t)
    },
    [types],
  )
  const objectItems = useMemo(() => (query: string) => fuzzyMatch(query, objects), [objects])

  if (!editor || !visible) return null

  const toggle = (p: Exclude<Panel, null>) => {
    if (p === 'create' || p === 'reuse') void ensureLinkIndex()
    setPanel((cur) => (cur === p ? null : p))
  }
  const close = () => {
    setPanel(null)
    editor.commands.focus()
  }
  const run = (fn: () => boolean) => () => {
    fn()
    setPanel(null)
  }
  const text = selectionText(editor) ?? ''

  return createPortal(
    <div
      ref={rootRef}
      className="tokens-menu"
      data-tokens-menu=""
      style={{ top: pos.top, left: pos.left }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          close()
        }
      }}
    >
      <div role="toolbar" aria-label={TOKENS_MENU_TEXT.toolbar} className="tokens-bar">
        <ToolButton label={TOKENS_MENU_TEXT.bold} pressed={editor.isActive('bold')} onClick={run(() => editor.chain().focus().toggleBold().run())}>
          <BoldIcon aria-hidden />
        </ToolButton>
        <ToolButton label={TOKENS_MENU_TEXT.italic} pressed={editor.isActive('italic')} onClick={run(() => editor.chain().focus().toggleItalic().run())}>
          <ItalicIcon aria-hidden />
        </ToolButton>
        <ToolButton
          label={TOKENS_MENU_TEXT.strikethrough}
          pressed={editor.isActive('strike')}
          onClick={run(() => editor.chain().focus().toggleStrike().run())}
        >
          <StrikethroughIcon aria-hidden />
        </ToolButton>
        <ToolButton
          label={TOKENS_MENU_TEXT.underline}
          pressed={editor.isActive('underline')}
          onClick={run(() => editor.chain().focus().toggleUnderline().run())}
        >
          <UnderlineIcon aria-hidden />
        </ToolButton>
        <ToolButton label={TOKENS_MENU_TEXT.bullet} pressed={editor.isActive('bulletList')} onClick={run(() => toggleListFromSelection(editor, 'bullet'))}>
          <ListIcon aria-hidden />
        </ToolButton>
        <ToolButton label={TOKENS_MENU_TEXT.todo} pressed={editor.isActive('taskList')} onClick={run(() => toggleListFromSelection(editor, 'todo'))}>
          <ListChecksIcon aria-hidden />
        </ToolButton>
        <ToolButton label={TOKENS_MENU_TEXT.link} pressed={editor.isActive('link')} active={panel === 'link'} onClick={() => toggle('link')}>
          <LinkIcon aria-hidden />
        </ToolButton>
        <ToolButton label={TOKENS_MENU_TEXT.code} pressed={editor.isActive('code')} onClick={run(() => editor.chain().focus().toggleCode().run())}>
          <CodeIcon aria-hidden />
        </ToolButton>
        <ToolButton label={TOKENS_MENU_TEXT.formula} onClick={run(() => selectionToFormula(editor))}>
          <SigmaIcon aria-hidden />
        </ToolButton>
        <ToolButton
          label={TOKENS_MENU_TEXT.highlight}
          pressed={editor.isActive('textColor') || editor.isActive('highlight')}
          active={panel === 'color'}
          onClick={() => toggle('color')}
        >
          <HighlighterIcon aria-hidden />
        </ToolButton>
        <span className="tokens-divider" aria-hidden />
        <ToolButton label={TOKENS_MENU_TEXT.create} active={panel === 'create'} onClick={() => toggle('create')}>
          <PlusIcon aria-hidden />
        </ToolButton>
        <ToolButton label={TOKENS_MENU_TEXT.reuse} active={panel === 'reuse'} onClick={() => toggle('reuse')}>
          <AtSignIcon aria-hidden />
        </ToolButton>
        {!aiHidden && (
          <>
            <span className="tokens-divider" aria-hidden />
            <ToolButton
              label={TOKENS_MENU_TEXT.ai}
              onClick={() => {
                setPanel(null)
                openSelectionAi(editor)
              }}
            >
              <Icon name={AI_ICON} size={16} />
            </ToolButton>
          </>
        )}
      </div>
      {panel === 'color' && (
        <div className="tokens-panel">
          <ColorMenu editor={editor} onDone={() => setPanel(null)} />
        </div>
      )}
      {panel === 'link' && <LinkPanel editor={editor} onClose={() => setPanel(null)} />}
      {panel === 'create' && (
        <PickerPanel<TypeDef>
          label={TOKENS_MENU_TEXT.create}
          placeholder={TOKENS_MENU_TEXT.searchTypes}
          items={typeItems}
          keyOf={(t) => t.id}
          empty={TOKENS_MENU_TEXT.noObjects}
          render={(t) => (
            <>
              <TypeChip type={t} size={20} />
              <span className="tokens-list-label">{t.name}</span>
            </>
          )}
          onPick={(t, e) => {
            const m = mods(e)
            setPanel(null)
            void createObjectFromSelection(editor, t.id, m)
          }}
          onClose={close}
        />
      )}
      {panel === 'reuse' && (
        <PickerPanel<ObjectSummary>
          label={TOKENS_MENU_TEXT.reuse}
          placeholder={TOKENS_MENU_TEXT.searchObjects}
          initial={text.trim()}
          items={objectItems}
          keyOf={(o) => o.path}
          empty={TOKENS_MENU_TEXT.noObjects}
          render={(o) => {
            const type = typeOf(o.type)
            return (
              <>
                {type && <TypeChip type={type} size={20} />}
                <span className="tokens-list-label">{o.title}</span>
                {type && <span className="tokens-list-meta">{type.name}</span>}
              </>
            )
          }}
          onPick={(o) => {
            setPanel(null)
            linkSelectionToObject(editor, o)
          }}
          onClose={close}
        />
      )}
    </div>,
    document.body,
  )
}
