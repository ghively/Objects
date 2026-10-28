/**
 * The `/` menu (Task 12), one per editor: the sections of `slashItems.ts`
 * filtered by the query (`fuzzyScore` over each item's name and description),
 * the footer hint `press "/" to search`, and "No results" when nothing
 * matches. Arrow keys move, Enter runs, Escape closes; a space after a query
 * with no match closes it too. An item's sub-view (colour lists, icon picker,
 * the bookmark URL field) replaces the list.
 */
import type { Editor } from '@tiptap/core'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { cn } from '@/lib/utils'
import { useLinkIndex } from '@/links/linkIndex'
import { useSettings } from '@/settings/useSettings'
import { closeSlashMenu, registerSlashKeyHandler, useSlashMenu } from '../extensions/slashMenu'
import { T as STYLE_TEXT, setBlockColor } from '../menus/BlockStyleMenu'
import { BLOCK_COLORS, bgColorToken, colorMenuName, textColorToken, type ColorKind } from '../menus/colors'
import { filterSections, hasRealMatch, slashSections, SLASH_TEXT, type SlashItem, type SlashView } from './slashItems'
import '../handles/handles.css'

function position(rect: DOMRect | null): CSSProperties {
  if (!rect) return { position: 'fixed', left: 16, top: 16 }
  const top = rect.bottom + 4
  const left = Math.max(8, Math.min(rect.left, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 328))
  return { position: 'fixed', left, top }
}

function ColorView({ editor, kind, onDone }: { editor: Editor; kind: ColorKind; onDone: () => void }) {
  return (
    <div role="listbox" aria-label={kind === 'text' ? STYLE_TEXT.textColor : STYLE_TEXT.backgroundColor} className="slash-menu-list">
      <button type="button" role="option" aria-selected={false} className="slash-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => {
        setBlockColor(editor, kind, null)
        onDone()
      }}>
        <span className="slash-menu-name">{kind === 'text' ? STYLE_TEXT.removeText : STYLE_TEXT.removeBg}</span>
      </button>
      {BLOCK_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="option"
          aria-selected={false}
          className="slash-menu-item"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setBlockColor(editor, kind, c)
            onDone()
          }}
        >
          <span
            aria-hidden
            className="slash-menu-swatch"
            style={kind === 'text' ? { color: textColorToken(c) } : { backgroundColor: bgColorToken(c) }}
          >
            {kind === 'text' ? 'A' : ''}
          </span>
          <span className="slash-menu-name">{colorMenuName(kind, c)}</span>
        </button>
      ))}
    </div>
  )
}

function BookmarkView({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [url, setUrl] = useState('')
  return (
    <form
      className="slash-menu-url"
      onSubmit={(e) => {
        e.preventDefault()
        const href = url.trim()
        if (href) editor.chain().focus().insertBookmark(href, href).run()
        onDone()
      }}
    >
      <input
        autoFocus
        aria-label={SLASH_TEXT.pasteUrl}
        placeholder={SLASH_TEXT.pasteUrl}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onDone()
            editor.commands.focus()
          }
        }}
      />
    </form>
  )
}

function SubView({ editor, view, onDone }: { editor: Editor; view: SlashView; onDone: () => void }) {
  if (view === 'colorText' || view === 'colorBg') return <ColorView editor={editor} kind={view === 'colorText' ? 'text' : 'bg'} onDone={onDone} />
  if (view === 'bookmark') return <BookmarkView editor={editor} onDone={onDone} />
  return (
    <IconPicker
      value={null}
      onChange={(next) => {
        editor.chain().focus().setBlockOption('icon', next ? next.val : null).run()
        onDone()
      }}
    />
  )
}

export function SlashMenu({ editor }: { editor: Editor }) {
  const state = useSlashMenu()
  const types = useLinkIndex((s) => s.types)
  const twentyFourHourTime = useSettings((s) => s.settings.twentyFourHourTime)
  const open = state.editor === editor && state.range !== null
  const sub = state.sub && state.sub.editor === editor ? state.sub : null
  const query = open ? state.query : ''

  const all = useMemo(() => slashSections({ query, types, twentyFourHourTime }), [query, types, twentyFourHourTime])
  const sections = useMemo(() => filterSections(all, query), [all, query])
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections])
  // The active row; it goes back to the first one whenever the query changes.
  const [selection, setSelection] = useState({ query: '', index: 0 })
  const active = selection.query === query ? selection.index : 0
  const setActive = (index: number) => setSelection({ query, index })

  const run = (item: SlashItem) => {
    const s = useSlashMenu.getState()
    if (!s.range || editor.isDestroyed) return
    const rect = s.rect
    editor.chain().focus().deleteRange(s.range).run()
    closeSlashMenu(editor)
    const result = item.run(editor)
    if (typeof result === 'string') useSlashMenu.setState({ sub: { editor, view: result, rect } })
    else if (result instanceof Promise) void result.catch(() => undefined)
  }

  // A space after a query that matches nothing closes the menu.
  useEffect(() => {
    if (open && query.endsWith(' ') && !hasRealMatch(all, query)) closeSlashMenu(editor)
  }, [open, query, all, editor])

  const latest = useRef({ flat, active, run, setActive })
  useLayoutEffect(() => {
    latest.current = { flat, active, run, setActive }
  })
  useEffect(() => {
    const handler = (event: KeyboardEvent): boolean => {
      const { flat: items, active: at, run: go, setActive: select } = latest.current
      if (event.key === 'ArrowDown') {
        select(items.length ? (at + 1) % items.length : 0)
        return true
      }
      if (event.key === 'ArrowUp') {
        select(items.length ? (at - 1 + items.length) % items.length : 0)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[at]
        if (!item) return false
        go(item)
        return true
      }
      return false
    }
    return registerSlashKeyHandler(editor, handler)
  }, [editor])

  // A sub-view closes on Escape or a click outside it.
  const subRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!sub) return
    const done = () => useSlashMenu.setState({ sub: null })
    const onDown = (e: MouseEvent) => {
      if (subRef.current && !subRef.current.contains(e.target as Node)) done()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [sub])

  if (sub) {
    return createPortal(
      <div ref={subRef} className="slash-menu" data-slash-sub={sub.view} style={position(sub.rect)}>
        <SubView editor={editor} view={sub.view} onDone={() => useSlashMenu.setState({ sub: null })} />
      </div>,
      document.body,
    )
  }
  if (!open) return null

  const starts = sections.reduce<number[]>((acc, _s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + sections[i - 1].items.length], [])
  return createPortal(
    <div className="slash-menu" role="listbox" aria-label="/" style={position(state.rect)} onMouseDown={(e) => e.preventDefault()}>
      <div className="slash-menu-list">
        {sections.length === 0 && <div className="slash-menu-empty">{SLASH_TEXT.noResults}</div>}
        {sections.map((section, si) => (
          <div key={section.id} role="group" aria-label={section.label} className="slash-menu-section">
            <div className="slash-menu-heading">{section.label}</div>
            {section.items.map((item, k) => {
              const i = starts[si] + k
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-item={item.id}
                  className={cn('slash-menu-item', i === active && 'is-active')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(item)}
                >
                  <span className="slash-menu-icon" aria-hidden>
                    <Icon name={item.icon} size={18} />
                  </span>
                  <span className="slash-menu-text">
                    <span className="slash-menu-name">{item.name}</span>
                    {item.description && <span className="slash-menu-description">{item.description}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="slash-menu-footer">{SLASH_TEXT.footer}</div>
    </div>,
    document.body,
  )
}
