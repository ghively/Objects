/**
 * The `[[` link picker: typing `[[` in the editor opens it; it fuzzy-matches
 * object titles and replaces the brackets with a `[[Title]]` wikilink.
 *
 * In `embed` mode (M7, the editor's `pickObjectEmbed()`) the chosen object is
 * inserted as an embedded object block (`![[Title]]`) instead of a link.
 */
import type { Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import type { ObjectSummary } from '@/api/types'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { setWikilinkTrigger } from '@/editor/extensions/wikilink'
import { setObjectEmbedPicker } from '@/editor/nodes/objectEmbed'
import { TypeChip } from '@/shell/Sidebar'
import { cn } from '@/lib/utils'
import { ensureLinkIndex, typeOf, useLinkIndex } from './linkIndex'

export type LinkPickerMode = 'link' | 'embed'

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
  if (doc.textBetween(range.from, range.to, '\0', '\0') !== '[[') return ''
  const typed = doc.textBetween(range.to, selection.from, '\n', '\0')
  if (!typed || /[\n\0]/.test(typed)) return ''
  editor.commands.deleteRange({ from: range.to, to: selection.from })
  return typed
}

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

  const matches = useMemo(() => fuzzyMatch(query, objects), [query, objects])

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
    } else if (o) {
      const text = editor.state.doc.textBetween(range.from, range.to, '\0', '\0')
      // Only replace the brackets if they are still where the trigger saw them.
      const at = text === '[[' ? range : { from: range.to, to: range.to }
      editor
        .chain()
        .focus()
        .insertContentAt(at, [{ type: 'wikilink', attrs: { target: o.title, label: null } }])
        .run()
    } else {
      editor.commands.focus()
    }
    hide()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && choose(undefined)}>
      <DialogContent
        showCloseButton={false}
        className="top-[22%] w-[520px] max-w-[calc(100vw-32px)] translate-y-0 gap-0 rounded-xl border-line bg-raised p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <DialogTitle className="sr-only">{mode === 'embed' ? 'Embed an object' : 'Link to an object'}</DialogTitle>
        <input
          ref={inputRef}
          aria-label="Search objects"
          placeholder={mode === 'embed' ? 'Embed…' : 'Link to…'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(i + 1, matches.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(matches[active])
            }
          }}
          className="h-12 w-full border-b border-line bg-transparent px-4 text-[15px] outline-none placeholder:text-fg-muted"
        />
        <ul role="listbox" aria-label="Objects" className="max-h-[320px] overflow-auto p-1.5">
          {matches.length === 0 && <li className="px-3 py-2 text-fg-muted italic">No matching objects</li>}
          {matches.map((o, i) => {
            const type = typeOf(o.type)
            return (
              <li key={o.path} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    'flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[15px]',
                    i === active && 'bg-hover-2',
                  )}
                >
                  {type && <TypeChip type={type} size={20} />}
                  <span className="min-w-0 flex-1 truncate">{o.title}</span>
                  {type && <span className="text-[13px] text-fg-muted">{type.name}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
