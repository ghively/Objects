/**
 * Find in page for the body editor: the `find-in-page-chrome` at the top right of the object
 * view while `useFind.path` is this object. Drives the formatted editor's `FindControl`
 * (`BodyEditorHandle.find`); raw mode has none, so the bar opens disabled there.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Icon } from '@/components/Icon'
import type { FindStatus } from '@/editor/extensions/findInPage'
import type { BodyEditorHandle } from '@/editor/useAutosave'
import { cn } from '@/lib/utils'
import { useFind } from './useFind'

export interface FindBarProps {
  path: string
  editorRef: RefObject<BodyEditorHandle | null>
}

/** UI strings: `FindInPage.*` verbatim, except those marked "our string". */
export const FIND_TEXT = {
  searchPlaceholder: 'Find',
  matchCase: 'Match case',
  wholeWord: 'Match whole word',
  previous: 'Previous match',
  next: 'Next match',
  toggleReplace: 'Toggle replace',
  replacePlaceholder: 'Replace',
  replace: 'Replace',
  replaceAll: 'Replace all',
  close: 'Close',
  noResults: (query: string) => `No results for "${query}"`,
  /** Our string: the count of matches, `{i}/{n}`. */
  count: (index: number, count: number) => `${index + 1}/${count}`,
  /** Our string: Find works only in the formatted editor. */
  rawMode: 'Find works in the formatted editor.',
}

const NO_STATUS: FindStatus = { index: -1, count: 0 }

function BarButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40',
        pressed && 'bg-line text-fg hover:bg-line',
      )}
    >
      {children}
    </button>
  )
}

export function FindBar({ path, editorRef }: FindBarProps) {
  const open = useFind((s) => s.path === path)
  const query = useFind((s) => s.query)
  const matchCase = useFind((s) => s.matchCase)
  const wholeWord = useFind((s) => s.wholeWord)
  const replaceOpen = useFind((s) => s.replaceOpen)
  const focusTick = useFind((s) => s.focusTick)
  const [replaceText, setReplaceText] = useState('')
  const [status, setStatus] = useState<FindStatus>(NO_STATUS)
  const chromeRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // The editor handle is a ref: re-read after every commit whether it offers find (raw mode doesn't).
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    const next = Boolean(editorRef.current?.find)
    if (next !== available) setAvailable(next)
  })

  // Follow the editor: every transaction (an edit, a move) may change the matches.
  useEffect(() => {
    if (!open || !available) return
    const find = editorRef.current?.find
    if (!find) return
    const sync = () => {
      const next = find.status()
      setStatus((prev) => (prev.index === next.index && prev.count === next.count ? prev : next))
    }
    const unsubscribe = find.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      // Closing (or leaving) clears the decorations.
      find.clear()
    }
  }, [open, available, editorRef])

  // Apply the query and options.
  useEffect(() => {
    if (!open || !available) return
    const find = editorRef.current?.find
    if (!find) return
    find.set(query, { matchCase, wholeWord })
    setStatus(find.status())
  }, [open, available, query, matchCase, wholeWord, editorRef])

  // Opening (again) focuses the input with its text selected.
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open, focusTick])

  // Esc closes. Window capture phase, so a surrounding dialog (the peek) doesn't also close.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!(e.target instanceof Node) || !chromeRef.current?.contains(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      useFind.getState().close()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  if (!open) return null

  const disabled = !available
  /** The editor's find control, read when acting (the handle is a ref). */
  const control = () => (available ? editorRef.current?.find : undefined)
  const next = () => control()?.next()
  const previous = () => control()?.previous()

  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (e.shiftKey) previous()
    else next()
  }
  const onReplaceKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) control()?.replaceAll(replaceText)
    else control()?.replace(replaceText)
  }

  const noMatches = !disabled && query !== '' && status.count === 0

  return (
    <div
      ref={chromeRef}
      role="search"
      aria-label="Find in page"
      data-testid="find-bar"
      className="find-in-page-chrome self-start rounded-xl border border-[#232226] bg-[#18181b] p-1 text-[13px]"
    >
      <div className="flex h-8 items-center gap-0.5">
        <BarButton
          label={FIND_TEXT.toggleReplace}
          pressed={replaceOpen}
          disabled={disabled}
          onClick={() => useFind.getState().toggleReplace()}
        >
          <Icon name={replaceOpen ? 'ph-caret-down' : 'ph-caret-right'} size={13} />
        </BarButton>
        <input
          ref={inputRef}
          type="text"
          aria-label={FIND_TEXT.searchPlaceholder}
          placeholder={FIND_TEXT.searchPlaceholder}
          value={query}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => useFind.getState().setQuery(e.target.value)}
          onKeyDown={onFindKey}
          className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-fg outline-none placeholder:text-fg-muted disabled:opacity-60"
        />
        {!disabled && status.count > 0 && (
          <span data-testid="find-count" className="shrink-0 px-1 text-[12px] text-fg-muted tabular-nums">
            {FIND_TEXT.count(status.index, status.count)}
          </span>
        )}
        <BarButton
          label={FIND_TEXT.matchCase}
          pressed={matchCase}
          disabled={disabled}
          onClick={() => useFind.getState().setOptions({ matchCase: !matchCase })}
        >
          <Icon name="ph-text-aa" size={15} />
        </BarButton>
        <BarButton
          label={FIND_TEXT.wholeWord}
          pressed={wholeWord}
          disabled={disabled}
          onClick={() => useFind.getState().setOptions({ wholeWord: !wholeWord })}
        >
          <span aria-hidden className="text-[11px] leading-none font-semibold underline underline-offset-2">
            ab
          </span>
        </BarButton>
        <BarButton label={FIND_TEXT.previous} disabled={disabled || status.count === 0} onClick={previous}>
          <Icon name="ph-arrow-up" size={14} />
        </BarButton>
        <BarButton label={FIND_TEXT.next} disabled={disabled || status.count === 0} onClick={next}>
          <Icon name="ph-arrow-down" size={14} />
        </BarButton>
        <BarButton label={FIND_TEXT.close} onClick={() => useFind.getState().close()}>
          <Icon name="ph-x" size={14} />
        </BarButton>
      </div>
      {replaceOpen && !disabled && (
        <div className="flex h-8 items-center gap-1 pl-[26px]">
          <input
            type="text"
            aria-label={FIND_TEXT.replacePlaceholder}
            placeholder={FIND_TEXT.replacePlaceholder}
            value={replaceText}
            spellCheck={false}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={onReplaceKey}
            className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-fg outline-none placeholder:text-fg-muted"
          />
          <button
            type="button"
            disabled={status.count === 0}
            onClick={() => control()?.replace(replaceText)}
            className="h-6 shrink-0 rounded-md px-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
          >
            {FIND_TEXT.replace}
          </button>
          <button
            type="button"
            disabled={status.count === 0}
            onClick={() => control()?.replaceAll(replaceText)}
            className="h-6 shrink-0 rounded-md px-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
          >
            {FIND_TEXT.replaceAll}
          </button>
        </div>
      )}
      {(disabled || noMatches) && (
        <div role="status" className="px-2 pt-0.5 pb-1 text-[12px] text-fg-muted">
          {disabled ? FIND_TEXT.rawMode : FIND_TEXT.noResults(query)}
        </div>
      )}
    </div>
  )
}
