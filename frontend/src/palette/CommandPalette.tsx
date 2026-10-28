/**
 * The command palette: Ctrl+P or Ctrl+K "Search this space" (Capacities' `openSearchPalette`
 * keys, read from `lib/shortcuts.ts`). Capacities lists no key for "Open action palette"; it is
 * reached with the palette's switch button. The shortcut is caught on the window in the capture
 * phase, so it works with the caret in the editor, while no other modal dialog is open (the
 * object peek excepted). Esc closes.
 *
 * M8: the search view's "Open in extended search" row and Ctrl/Cmd+Shift+Enter (our key; plain
 * Shift+Enter stays M7's "open in the side panel") close the palette and open the extended search
 * page with what was typed.
 *
 * M8 (Task 17): the action palette adds "Open extended search", "Open settings", "Toggle focus
 * mode", "Open space "…"" for each other registered space, and the clipboard group (`paste.ts`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { SpaceEntry } from '@/api/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/components/Icon'
import { useCalendar } from '@/calendar/useCalendar'
import { createAndOpen } from '@/create/createAndOpen'
import { useLinkIndex } from '@/links/linkIndex'
import { keysFor, matches } from '@/lib/shortcuts'
import { currentTarget, usePeek, useTabs, type OpenOptions, type Target } from '@/nav/tabs'
import type { ActionContext } from './actions'
import { ActionsView } from './ActionsView'
import { openExtendedSearch } from '@/search/openSearch'
import { PALETTE_TEXT } from './searchOptions'
import { SearchView } from './SearchView'
import { usePalette, type PaletteMode } from './usePalette'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { switchSpace } from '@/spaces/switchSpace'

interface FocusStore {
  getState(): { toggle(): void }
}

/** `focus/useFocusMode.ts` (Tasks 3 and 9), when it exists; "Toggle focus mode" needs it. */
const focusModules = import.meta.glob<{ useFocusMode?: FocusStore }>('../focus/useFocusMode.ts', { eager: true })

let focusToggleOverride: (() => void) | null | undefined

/** Tests: use `fn` as the focus-mode toggle (`undefined` restores the module's). */
export function setFocusToggleForTests(fn: (() => void) | null | undefined): void {
  focusToggleOverride = fn
}

/** The focus-mode toggle, or null while focus mode isn't built. */
export function focusModeToggle(): (() => void) | null {
  if (focusToggleOverride !== undefined) return focusToggleOverride
  const store = Object.values(focusModules)[0]?.useFocusMode
  return store ? () => store.getState().toggle() : null
}

export interface CommandPaletteProps {
  onOpenTarget: (target: Target, opts?: OpenOptions) => void
  onToggleSidebar: () => void
  onToggleRightPanel: () => void
  onShowRightPanel: () => void
}

/** True when a modal dialog other than the palette (and the object peek) is open. */
function otherModalOpen(): boolean {
  const open = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(
    (el) => !el.closest('[data-command-palette]'),
  )
  const allowed = usePeek.getState().path ? 1 : 0
  return open.length > allowed
}

/** The palette mode `e` opens: the registry's `openSearchPalette` / `openCommandPalette` keys. */
export function paletteShortcut(e: KeyboardEvent): PaletteMode | null {
  if (matches(e, keysFor('openSearchPalette'))) return 'search'
  if (matches(e, keysFor('openCommandPalette'))) return 'actions'
  return null
}

export function CommandPalette({ onOpenTarget, onToggleSidebar, onToggleRightPanel, onShowRightPanel }: CommandPaletteProps) {
  const open = usePalette((s) => s.open)
  const mode = usePalette((s) => s.mode)
  const types = useLinkIndex((s) => s.types)
  const hasObjectOpen = useTabs((s) => currentTarget(s)?.kind === 'object')
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])

  // The registry, read each time the action palette opens ("Open space …").
  useEffect(() => {
    if (!open || mode !== 'actions') return
    let live = true
    api.spaces().then(
      (list) => live && setSpaces(list ?? []),
      () => live && setSpaces([]),
    )
    return () => {
      live = false
    }
  }, [open, mode])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const m = paletteShortcut(e)
      if (!m) return
      if (!usePalette.getState().open && otherModalOpen()) return
      e.preventDefault()
      e.stopPropagation()
      usePalette.getState().toggle(m)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const hide = useCallback(() => usePalette.getState().hide(), [])
  const toExtendedSearch = useCallback((q: string) => {
    usePalette.getState().hide()
    openExtendedSearch(q)
  }, [])

  const context: ActionContext = useMemo(
    () => ({
      types,
      hasObjectOpen,
      createObject: (typeId) => {
        void createAndOpen(typeId).catch((err: unknown) => console.warn('Could not create an object:', err))
      },
      openCalendar: () => onOpenTarget({ kind: 'calendar' }),
      openToday: () => {
        // The calendar in Day view on today; never creates a daily note (M4).
        const cal = useCalendar.getState()
        cal.setView('day')
        cal.today()
        onOpenTarget({ kind: 'calendar' })
      },
      openGlobalGraph: () => onOpenTarget({ kind: 'graph' }),
      openGraphView: onShowRightPanel,
      toggleSidebar: onToggleSidebar,
      toggleRightPanel: onToggleRightPanel,
      openExtendedSearch: () => openExtendedSearch(),
      openSettings: () => useSettingsModal.getState().open(),
      toggleFocusMode: focusModeToggle(),
      spaces,
      openSpace: (path) => {
        void switchSpace(path)
      },
    }),
    [types, hasObjectOpen, onOpenTarget, onShowRightPanel, onToggleSidebar, onToggleRightPanel, spaces],
  )

  const other: PaletteMode = mode === 'search' ? 'actions' : 'search'
  const footer = (
    <div className="flex items-center justify-end border-t border-line px-2 py-1.5">
      <button
        type="button"
        onClick={() => usePalette.getState().show(other)}
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover"
      >
        <Icon name="ph-arrows-left-right" size={14} />
        {mode === 'search' ? PALETTE_TEXT.switchToActions : PALETTE_TEXT.switchToSearch}
      </button>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && hide()}>
      <DialogContent
        data-command-palette=""
        showCloseButton={false}
        className="top-[18%] w-[min(640px,calc(100vw-32px))] max-w-none translate-y-0 gap-0 overflow-hidden rounded-xl border-line bg-raised-2 p-0 text-fg sm:max-w-none"
      >
        <DialogTitle className="sr-only">{mode === 'search' ? PALETTE_TEXT.searchTitle : PALETTE_TEXT.actionsTitle}</DialogTitle>
        <DialogDescription className="sr-only">
          {mode === 'search' ? PALETTE_TEXT.placeholderSearch : PALETTE_TEXT.placeholderActions}
        </DialogDescription>
        {mode === 'search' ? (
          <SearchView key="search" onDone={hide} footer={footer} onOpenExtendedSearch={toExtendedSearch} />
        ) : (
          <ActionsView key="actions" context={context} onDone={hide} footer={footer} />
        )}
      </DialogContent>
    </Dialog>
  )
}
