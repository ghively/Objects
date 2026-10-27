// The Settings modal's open state and the section it shows, plus the Shortcuts sheet's open
// state. One store, so the sidebar gear, the `openSettings` / `toggleShortcutsMenu` shortcuts and
// the spaces menu ("Space settings", Task 18) all open the same modal.
import { create } from 'zustand'

export type SettingsSectionId =
  | 'appearance'
  | 'editor'
  | 'dateTime'
  | 'language'
  | 'notifications'
  | 'space'
  | 'objectTypes'
  | 'taskManagement'

export const DEFAULT_SECTION: SettingsSectionId = 'appearance'

export interface SettingsModalState {
  isOpen: boolean
  section: SettingsSectionId
  shortcutsOpen: boolean
  /** Open the modal, on `section` when given (else the last one shown). */
  open(section?: SettingsSectionId): void
  close(): void
  setSection(section: SettingsSectionId): void
  openShortcuts(): void
  closeShortcuts(): void
  toggleShortcuts(): void
}

export const useSettingsModal = create<SettingsModalState>()((set, get) => ({
  isOpen: false,
  section: DEFAULT_SECTION,
  shortcutsOpen: false,
  open(section) {
    set({ isOpen: true, section: section ?? get().section, shortcutsOpen: false })
  },
  close() {
    set({ isOpen: false })
  },
  setSection(section) {
    set({ section })
  },
  openShortcuts() {
    set({ shortcutsOpen: true, isOpen: false })
  },
  closeShortcuts() {
    set({ shortcutsOpen: false })
  },
  toggleShortcuts() {
    if (get().shortcutsOpen) set({ shortcutsOpen: false })
    else set({ shortcutsOpen: true, isOpen: false })
  },
}))

/** Back to closed (tests). */
export function resetSettingsModal(): void {
  useSettingsModal.setState({ isOpen: false, section: DEFAULT_SECTION, shortcutsOpen: false })
}
