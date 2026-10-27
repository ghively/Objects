/**
 * The command palette: Ctrl+K "Search this space" and Ctrl+P "Open action palette". Both
 * shortcuts are caught on the window in the capture phase, so they work with the caret in the
 * editor, while no other modal dialog is open (the object peek excepted). Esc closes.
 */
import { useCallback, useEffect, useMemo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/components/Icon'
import { useCalendar } from '@/calendar/useCalendar'
import { createAndOpen } from '@/create/createAndOpen'
import { useLinkIndex } from '@/links/linkIndex'
import { currentTarget, usePeek, useTabs, type OpenOptions, type Target } from '@/nav/tabs'
import type { ActionContext } from './actions'
import { ActionsView } from './ActionsView'
import { PALETTE_TEXT } from './searchOptions'
import { SearchView } from './SearchView'
import { usePalette, type PaletteMode } from './usePalette'

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

function paletteShortcut(e: KeyboardEvent): PaletteMode | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null
  const key = e.key.toLowerCase()
  if (key === 'k') return 'search'
  if (key === 'p') return 'actions'
  return null
}

export function CommandPalette({ onOpenTarget, onToggleSidebar, onToggleRightPanel, onShowRightPanel }: CommandPaletteProps) {
  const open = usePalette((s) => s.open)
  const mode = usePalette((s) => s.mode)
  const types = useLinkIndex((s) => s.types)
  const hasObjectOpen = useTabs((s) => currentTarget(s)?.kind === 'object')

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
    }),
    [types, hasObjectOpen, onOpenTarget, onShowRightPanel, onToggleSidebar, onToggleRightPanel],
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
          <SearchView key="search" onDone={hide} footer={footer} />
        ) : (
          <ActionsView key="actions" context={context} onDone={hide} footer={footer} />
        )}
      </DialogContent>
    </Dialog>
  )
}
