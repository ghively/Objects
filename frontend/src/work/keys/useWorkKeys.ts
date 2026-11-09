// M23 Task 16: the Work page's keyboard shortcuts (spec section 5, keyboard), one `keydown`
// listener while the Work page is mounted. Keys never act while Gene types: not in a field or an
// editor, not while a dialog or the peek is open, and Space and Enter on a focused button, link
// or checkbox stay that control's.
import { useEffect } from 'react'
import { isEditableTarget } from '@/lib/shortcuts'
import { entriesOf } from '@/nav/sidepanel'
import { activeTab, usePeek, useTabs } from '@/nav/tabs'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { clearWorkSearch, focusBrainDump, focusWorkSearch } from '../page/WorkPage'
import { openItemPanel } from '../state/workActions'
import { useWorkSelection } from '../state/useWorkSelection'
import { useWorkUi } from '../state/useWorkUi'
import { isTaskListView } from '../tasklists/registerView'
import { workViews } from '../views/registry'
import { G_SEQUENCE_MS } from './workShortcuts'

export { WORK_SHORTCUTS } from './workShortcuts'

const DIALOG = '[role="dialog"], [role="alertdialog"]'
const CONTROL = 'button, a[href], input[type="checkbox"], [role="button"], [role="checkbox"], [role="link"]'

/** The ids of the side panel's open entries that show a work item (the item panel), in the active tab. */
function workPanelEntries(): string[] {
  const tab = activeTab(useTabs.getState())
  if (!tab || tab.hideSidepanel) return []
  return entriesOf(tab)
    .filter((e) => e.isOpen && e.target?.kind === 'object' && e.target.work)
    .map((e) => e.id)
}

const asElement = (t: EventTarget | null): Element | null => (t instanceof Element ? t : null)

/** Space or Enter on a focused control belongs to the control. */
function onControl(e: KeyboardEvent): boolean {
  const el = asElement(e.target) ?? asElement(document.activeElement)
  return !!el?.closest(CONTROL)
}

/** Scroll the selected row (`[data-work-row]`) into view. */
function revealSelected(): void {
  const path = useWorkSelection.getState().selected()
  if (path === null) return
  for (const row of document.querySelectorAll('[data-work-row]')) {
    if (row.getAttribute('data-work-row') === path) {
      ;(row as HTMLElement).scrollIntoView?.({ block: 'nearest' })
      return
    }
  }
}

/** The Work keys while the Work page is mounted. */
export function useWorkKeys(): void {
  useEffect(() => {
    /** When `g` was pressed (null: no sequence waiting). */
    let gAt: number | null = null

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target) || isEditableTarget(document.activeElement)) {
        gAt = null
        return
      }
      // `?` also closes the Shortcuts sheet it opened (the sheet is a dialog).
      if (e.key === '?' && useSettingsModal.getState().shortcutsOpen) {
        e.preventDefault()
        useSettingsModal.getState().toggleShortcuts()
        return
      }
      if (document.querySelector(DIALOG) || usePeek.getState().path !== null) {
        gAt = null
        return
      }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      // The second key of `g` + a view key (in Just one thing, only `g n`).
      if (gAt !== null) {
        const fresh = Date.now() - gAt <= G_SEQUENCE_MS
        gAt = null
        if (fresh && key.length === 1) {
          const calm = useWorkUi.getState().calm
          // Hide Task Management leaves the task lists out, so `g i` (Inbox) does nothing then.
          const hideTasks = useSpaceInfo.getState().space?.hideTaskManagement ?? false
          const view = workViews().find(
            (v) => v.key === key && (!calm || v.id === 'now') && !(hideTasks && isTaskListView(v.id)),
          )
          if (view) {
            e.preventDefault()
            useWorkUi.getState().setView(view.id)
            return
          }
        }
      }

      const act = (fn: () => void) => {
        e.preventDefault()
        fn()
      }
      const selection = useWorkSelection.getState()
      switch (key) {
        case 'g':
          if (e.shiftKey) return
          e.preventDefault()
          gAt = Date.now()
          return
        case '/':
          return act(focusWorkSearch)
        case 'b':
          return act(focusBrainDump)
        case 'j':
        case 'k':
          if (e.shiftKey) return
          return act(() => {
            selection.move(key === 'j' ? 1 : -1)
            revealSelected()
          })
        case 'Enter': {
          const path = selection.selected()
          if (onControl(e) || path === null) return
          return act(() => openItemPanel(path))
        }
        case ' ': {
          const path = selection.selected()
          if (onControl(e) || path === null) return
          return act(() => usePeek.getState().peek(path, useWorkSelection.getState().list))
        }
        case '[':
        case ']':
          return act(() => {
            selection.move(key === '[' ? -1 : 1)
            revealSelected()
            const path = useWorkSelection.getState().selected()
            if (path !== null && workPanelEntries().length > 0) openItemPanel(path)
          })
        case 'Escape':
          return act(() => {
            const entries = workPanelEntries()
            if (entries.length) {
              for (const id of entries) useTabs.getState().closeSidepanelEntry(id)
            } else {
              useWorkUi.getState().setFocusLine(null)
              clearWorkSearch()
            }
          })
        case '?':
          return act(() => useSettingsModal.getState().toggleShortcuts())
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
