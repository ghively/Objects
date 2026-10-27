// The Settings modal ("Settings", `AppSettings.heading`): a left nav with "Search settings", the
// "General" and "Space" groups and a "Shortcuts" row at the bottom; the content shows the chosen
// section. Changes save at once: device settings through `useSettings().patch`, `ui.json` keys
// through `api.patchUi`, space keys through `api.patchSpace` (each reloads and re-applies once on
// a 409).
import { useMemo, useState, type ComponentType } from 'react'
import { Icon } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { APPEARANCE_SEARCH, APPEARANCE_TEXT, AppearanceSection } from './sections/Appearance'
import { DATE_TIME_SEARCH, DATE_TIME_TEXT, DateTimeSection } from './sections/DateTime'
import { EDITOR_SEARCH, EDITOR_TEXT, EditorSection } from './sections/Editor'
import { LANGUAGE_SEARCH, LANGUAGE_TEXT, LanguageSection } from './sections/Language'
import { NOTIFICATIONS_SEARCH, NOTIFICATIONS_TEXT, NotificationsSection } from './sections/Notifications'
import { OBJECT_TYPES_SEARCH, OBJECT_TYPES_TEXT, ObjectTypesSection } from './sections/ObjectTypes'
import { SPACE_SETTINGS_SEARCH, SPACE_SETTINGS_TEXT, SpaceSettingsSection } from './sections/SpaceSettings'
import { TASK_MANAGEMENT_SEARCH, TASK_MANAGEMENT_TEXT, TaskManagementSection } from './sections/TaskManagement'
import { SHORTCUTS_TEXT } from './ShortcutsSheet'
import { useSettingsModal, type SettingsSectionId } from './useSettingsModal'

export const SETTINGS_TEXT = {
  heading: 'Settings', // AppSettings.heading
  search: 'Search settings', // AppSettings.search.placeholder
  noResults: 'No results', // AppSettings.search.noResults
  general: 'General', // general.general
  space: 'Space', // AppSettings.currentSpace.label
  shortcuts: SHORTCUTS_TEXT.heading, // ShortcutsCheatSheet.tooltip
} as const

export interface SettingsSectionDef {
  id: SettingsSectionId
  group: 'general' | 'space'
  label: string
  icon: string
  /** The option labels search matches besides the heading and description. */
  search: string[]
  Component: ComponentType
}

export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: 'appearance', group: 'general', label: APPEARANCE_TEXT.heading, icon: 'ph-paint-brush', search: APPEARANCE_SEARCH, Component: AppearanceSection },
  { id: 'editor', group: 'general', label: EDITOR_TEXT.heading, icon: 'ph-text-aa', search: EDITOR_SEARCH, Component: EditorSection },
  { id: 'dateTime', group: 'general', label: DATE_TIME_TEXT.heading, icon: 'ph-calendar-blank', search: DATE_TIME_SEARCH, Component: DateTimeSection },
  { id: 'language', group: 'general', label: LANGUAGE_TEXT.heading, icon: 'ph-translate', search: LANGUAGE_SEARCH, Component: LanguageSection },
  {
    id: 'notifications',
    group: 'general',
    label: NOTIFICATIONS_TEXT.heading,
    icon: 'ph-bell',
    search: NOTIFICATIONS_SEARCH,
    Component: NotificationsSection,
  },
  { id: 'space', group: 'space', label: SPACE_SETTINGS_TEXT.heading, icon: 'ph-gear-six', search: SPACE_SETTINGS_SEARCH, Component: SpaceSettingsSection },
  { id: 'objectTypes', group: 'space', label: OBJECT_TYPES_TEXT.heading, icon: 'ph-cube', search: OBJECT_TYPES_SEARCH, Component: ObjectTypesSection },
  {
    id: 'taskManagement',
    group: 'space',
    label: TASK_MANAGEMENT_TEXT.heading,
    icon: 'ph-check-circle',
    search: TASK_MANAGEMENT_SEARCH,
    Component: TaskManagementSection,
  },
]

const GROUPS: { id: SettingsSectionDef['group']; label: string }[] = [
  { id: 'general', label: SETTINGS_TEXT.general },
  { id: 'space', label: SETTINGS_TEXT.space },
]

/** The sections whose heading or option labels contain `query` (case-insensitive). */
export function filterSections(query: string): SettingsSectionDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return SETTINGS_SECTIONS
  return SETTINGS_SECTIONS.filter((s) => [s.label, ...s.search].some((t) => t.toLowerCase().includes(q)))
}

function NavRow({ icon, label, active, onClick }: { icon: string; label: string; active?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-[34px] w-full items-center gap-2 rounded-lg px-2 text-left text-[14px] font-medium text-fg hover:bg-hover',
        active && 'bg-hover',
      )}
    >
      <Icon name={icon} size={16} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

export function SettingsModal() {
  const isOpen = useSettingsModal((s) => s.isOpen)
  const section = useSettingsModal((s) => s.section)
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterSections(query), [query])
  const current = shown.find((s) => s.id === section) ?? shown[0]
  const Current = current?.Component

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) {
          useSettingsModal.getState().close()
          setQuery('')
        }
      }}
    >
      <DialogContent
        data-settings-modal=""
        className="flex h-[min(760px,88vh)] max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-2xl border-line bg-panel p-0 text-fg sm:max-w-[1080px]"
      >
        <nav aria-label={SETTINGS_TEXT.heading} className="flex w-[340px] max-w-[40%] shrink-0 flex-col border-r border-line bg-app p-3">
          <DialogTitle className="px-2 pt-1 pb-3 text-[18px] font-semibold">{SETTINGS_TEXT.heading}</DialogTitle>
          <DialogDescription className="sr-only">{SETTINGS_TEXT.search}</DialogDescription>
          <label className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-line bg-raised px-2 text-fg-muted focus-within:border-fg-muted">
            <Icon name="ph-magnifying-glass" size={15} />
            <input
              type="search"
              aria-label={SETTINGS_TEXT.search}
              placeholder={SETTINGS_TEXT.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-muted"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {GROUPS.map((g) => {
              const rows = shown.filter((s) => s.group === g.id)
              if (rows.length === 0) return null
              return (
                <div key={g.id} role="group" aria-label={g.label} className="pb-2">
                  <h3 className="px-2 pt-3 pb-1 text-[13px] font-semibold text-[var(--text-section)]">{g.label}</h3>
                  {rows.map((s) => (
                    <NavRow
                      key={s.id}
                      icon={s.icon}
                      label={s.label}
                      active={current?.id === s.id}
                      onClick={() => useSettingsModal.getState().setSection(s.id)}
                    />
                  ))}
                </div>
              )
            })}
            {shown.length === 0 && <p className="px-2 py-3 text-[14px] text-fg-muted">{SETTINGS_TEXT.noResults}</p>}
          </div>
          <div className="border-t border-line pt-2">
            <NavRow icon="ph-keyboard" label={SETTINGS_TEXT.shortcuts} onClick={() => useSettingsModal.getState().openShortcuts()} />
          </div>
        </nav>
        <div data-settings-content={current?.id ?? ''} className="min-w-0 flex-1 overflow-y-auto px-8 pt-7 pb-10">
          {Current ? <Current key={current.id} /> : <p className="text-[14px] text-fg-muted">{SETTINGS_TEXT.noResults}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
