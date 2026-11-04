/**
 * The `[[` / `@` link picker: typing `[[` (or `@` at the start of a word) in the editor opens it, as a
 * popover under the caret (as in the live app). With nothing typed it lists the recently opened
 * objects, then a row per type that lists that type's objects; typing fuzzy-matches object titles.
 * Choosing replaces the brackets with a `[[Title]]` wikilink.
 *
 * In `embed` mode (M7, the editor's `pickObjectEmbed()`) the chosen object is
 * inserted as an embedded object block (`![[Title]]`) instead of a link.
 *
 * Linking at the start of an empty block (the block holds only the `[[` or `@`) makes an object
 * block too, unless the `alwaysCreateInlineLinks` setting is on.
 */
import type { Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import type { ObjectSummary, TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { KeyHints } from '@/components/KeyHints'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { setWikilinkTrigger, wikilinkTargetFor } from '@/editor/extensions/wikilink'
import { setObjectEmbedPicker } from '@/editor/nodes/objectEmbed'
import { useRecent } from '@/nav/recent'
import { useSettings } from '@/settings/useSettings'
import { TypeChip } from '@/shell/Sidebar'
import { cn } from '@/lib/utils'
import { ensureLinkIndex, typeOf, useLinkIndex } from './linkIndex'

export type LinkPickerMode = 'link' | 'embed'

/** True when choosing should make an object block: the trigger is all an otherwise empty paragraph holds. */
export function blockLinkAt(editor: Editor, range: { from: number; to: number }): boolean {
  if (useSettings.getState().settings.alwaysCreateInlineLinks) return false
  const text = editor.state.doc.textBetween(range.from, range.to, '\0', '\0')
  if (!isOpener(text)) return false
  const $from = editor.state.doc.resolve(range.from)
  const block = $from.parent
  return block.type.name === 'paragraph' && $from.parentOffset === 0 && block.content.size === range.to - range.from && block.textContent === text
}

interface PickerState {
  editor: Editor | null
  range: { from: number; to: number } | null
  /** `link` inserts a wikilink (replacing the `[[`); `embed` inserts an object embed block. */
  mode: LinkPickerMode
  show(editor: Editor, range: { from: number; to: number }, mode?: LinkPickerMode): void
  hide(): void
}

export const useLinkPicker = create<PickerState>()((set) => ({
  editor: null,
  range: null,
  mode: 'link',
  show: (editor, range, mode = 'link') => set({ editor, range, mode }),
  hide: () => set({ editor: null, range: null, mode: 'link' }),
}))

let installed = false
/** Route the editor's `[[` trigger, and its `pickObjectEmbed()`, to the picker. */
export function installLinkPicker(): void {
  if (installed) return
  installed = true
  setWikilinkTrigger((editor, range) => useLinkPicker.getState().show(editor, range))
  setObjectEmbedPicker((editor, range) => useLinkPicker.getState().show(editor, range, 'embed'))
}

/**
 * Score `title` against `query` as a case-insensitive subsequence match, or
 * null when it doesn't match. Higher is better: prefix and word-start hits and
 * consecutive runs score more; shorter titles win ties.
 */
export function fuzzyScore(query: string, title: string): number | null {
  const q = query.trim().toLowerCase()
  const t = title.toLowerCase()
  if (!q) return 0
  let score = 0
  let ti = 0
  let run = 0
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at < 0) return null
    if (at === ti) {
      run += 1
      score += 2 + run
    } else {
      run = 0
    }
    if (at === 0) score += 6
    else if (/[\s\-_/.(]/.test(t[at - 1])) score += 4
    ti = at + 1
  }
  if (t.startsWith(q)) score += 10
  return score - t.length * 0.01
}

export function fuzzyMatch(query: string, objects: ObjectSummary[], limit = 8): ObjectSummary[] {
  const scored: { o: ObjectSummary; s: number }[] = []
  for (const o of objects) {
    const s = fuzzyScore(query, o.title)
    if (s !== null) scored.push({ o, s })
  }
  scored.sort((a, b) => b.s - a.s || a.o.title.localeCompare(b.o.title))
  return scored.slice(0, limit).map((x) => x.o)
}

/**
 * The trigger hands over to the picker a moment after `[[` (once the brackets land), so a fast
 * typist's next characters can reach the editor first (seen in the Text cell). Those characters,
 * right after the `[[` and up to the cursor on the same line, are taken out of the document and
 * become the picker's query, as if typed there.
 */
function takeTypedAhead(editor: Editor | null, range: { from: number; to: number } | null, mode: LinkPickerMode): string {
  if (mode !== 'link' || !editor || !range || editor.isDestroyed) return ''
  const { doc, selection } = editor.state
  if (!selection.empty || selection.from <= range.to || selection.from > doc.content.size) return ''
  if (!isOpener(doc.textBetween(range.from, range.to, '\0', '\0'))) return ''
  const typed = doc.textBetween(range.to, selection.from, '\n', '\0')
  if (!typed || /[\n\0]/.test(typed)) return ''
  editor.commands.deleteRange({ from: range.to, to: selection.from })
  return typed
}

/** What opens the picker: `[[`, or `@` at the start of a word. */
const isOpener = (text: string) => text === '[[' || text === '@'

type Row = { kind: 'object'; o: ObjectSummary } | { kind: 'type'; t: TypeDef; count: number }

export function LinkPicker() {
  const { editor, range, mode, hide } = useLinkPicker()
  const objects = useLinkIndex((s) => s.objects)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const open = !!editor && !!range

  useEffect(() => {
    if (!open) return
    setQuery(takeTypedAhead(editor, range, mode))
    setActive(0)
    void ensureLinkIndex()
    // Only on opening: `editor`, `range` and `mode` are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const recentPaths = useRecent((s) => s.paths)
  const types = useLinkIndex((s) => s.types)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  useEffect(() => {
    if (open) setTypeFilter(null)
  }, [open])

  const rows: Row[] = useMemo(() => {
    const filterType = typeFilter ? types.find((t) => t.id === typeFilter) : undefined
    if (filterType) {
      const own = objects.filter((o) => o.type === filterType.id)
      return fuzzyMatch(query, own, 30).map((o) => ({ kind: 'object' as const, o }))
    }
    if (query.trim()) return fuzzyMatch(query, objects).map((o) => ({ kind: 'object' as const, o }))
    const byPath = new Map(objects.map((o) => [o.path, o]))
    const recent = recentPaths.map((p) => byPath.get(p)).filter((o): o is ObjectSummary => !!o).slice(0, 6)
    const counts = new Map<string, number>()
    for (const o of objects) counts.set(o.type, (counts.get(o.type) ?? 0) + 1)
    const typeRows = types
      .filter((t) => counts.has(t.id))
      .sort((a, b) => a.pluralName.localeCompare(b.pluralName, undefined, { sensitivity: 'base' }))
      .map((t) => ({ kind: 'type' as const, t, count: counts.get(t.id) ?? 0 }))
    const head: Row[] = [...recent.map((o) => ({ kind: 'object' as const, o })), ...typeRows]
    // No recents and no types to browse: the first few objects, as before.
    return head.length ? head : fuzzyMatch('', objects).map((o) => ({ kind: 'object' as const, o }))
  }, [query, objects, types, typeFilter, recentPaths])
  // Under the caret (the picker's range start); centred when the editor can't say.
  const anchor = useRef({
    getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
  })
  anchor.current.getBoundingClientRect = () => {
    try {
      if (editor && range && !editor.isDestroyed) {
        const c = editor.view.coordsAtPos(Math.min(range.from, editor.state.doc.content.size))
        return new DOMRect(c.left, c.top, 0, c.bottom - c.top)
      }
    } catch {
      // fall through
    }
    return new DOMRect(window.innerWidth / 2 - 160, window.innerHeight * 0.22, 0, 0)
  }

  const choose = (o: ObjectSummary | undefined) => {
    if (!editor || !range || editor.isDestroyed) return hide()
    if (o && mode === 'embed') {
      const at = Math.min(range.from, editor.state.doc.content.size)
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setSelection(Selection.near(tr.doc.resolve(at)))
          return true
        })
        .insertObjectEmbed(o.title)
        .run()
    } else if (o && blockLinkAt(editor, range)) {
      editor.chain().focus().deleteRange(range).insertObjectEmbed(o.title).run()
    } else if (o) {
      const text = editor.state.doc.textBetween(range.from, range.to, '\0', '\0')
      // Only replace the brackets (or the `@`) if they are still where the trigger saw them.
      const at = isOpener(text) ? range : { from: range.to, to: range.to }
      editor
        .chain()
        .focus()
        .insertContentAt(at, [{ type: 'wikilink', attrs: { target: wikilinkTargetFor(o), label: null } }])
        .run()
    } else {
      // Cancelled: the `[[` stays, since the link dropdown searches text typed
      // inline after it; the query typed here goes back after the brackets, as if typed there.
      const brackets = mode === 'link' && isOpener(editor.state.doc.textBetween(range.from, range.to, '\0', '\0'))
      if (brackets && query) editor.chain().focus().insertContentAt(range.to, { type: 'text', text: query }).run()
      else editor.commands.focus()
    }
    hide()
  }

  const pickRow = (row: Row | undefined) => {
    if (!row) return choose(undefined)
    if (row.kind === 'type') {
      setTypeFilter(row.t.id)
      setQuery('')
      setActive(0)
      return
    }
    choose(row.o)
  }
  const heading = typeFilter ? types.find((t) => t.id === typeFilter) : undefined

  return (
    <Popover open={open} onOpenChange={(v) => !v && choose(undefined)}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align="start"
        sideOffset={6}
        role="dialog"
        aria-label={mode === 'embed' ? 'Embed an object' : 'Link to an object'}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
        // Focus moving (the editor keeps and regains it while typing ahead) is not a dismissal; a click
        // outside or Escape is.
        onFocusOutside={(e) => e.preventDefault()}
        className="w-[min(340px,calc(100vw-32px))] gap-0 overflow-hidden rounded-xl border-line bg-raised p-0"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          {heading && <TypeChip type={heading} size={20} />}
          <input
            ref={inputRef}
            aria-label="Search objects"
            placeholder={heading ? heading.pluralName : mode === 'embed' ? 'Embed…' : 'Link to…'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.min(i + 1, rows.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                pickRow(rows[active])
              } else if (e.key === 'ArrowRight' && rows[active]?.kind === 'type') {
                e.preventDefault()
                pickRow(rows[active])
              } else if (e.key === 'Backspace' && !query && typeFilter) {
                e.preventDefault()
                setTypeFilter(null)
                setActive(0)
              }
            }}
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-muted"
          />
        </div>
        <ul role="listbox" aria-label="Objects" className="max-h-[320px] overflow-auto p-1.5">
          {rows.length === 0 && <li className="px-3 py-2 text-fg-muted italic">No matching objects</li>}
          {rows.map((row, i) => {
            const type = row.kind === 'object' ? typeOf(row.o.type) : row.t
            return (
              <li key={row.kind === 'object' ? row.o.path : `type:${row.t.id}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pickRow(row)}
                  className={cn(
                    'flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[15px]',
                    i === active && 'bg-hover-2',
                  )}
                >
                  {type && <TypeChip type={type} size={20} />}
                  {row.kind === 'object' ? (
                    <>
                      <span className="min-w-0 flex-1 truncate">{row.o.title}</span>
                      {type && <span className="text-[13px] text-fg-muted">{type.name}</span>}
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{row.t.pluralName}</span>
                      <span className="text-[13px] text-fg-muted tabular-nums">{row.count}</span>
                      <Icon name="ph-caret-right" size={12} />
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        <KeyHints />
      </PopoverContent>
    </Popover>
  )
}
