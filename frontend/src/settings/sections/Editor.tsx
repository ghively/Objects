// "Editor": toggle style, the editor switches, what this space opens on and which space Object
// starts with, and (M8) the backlink defaults: each section's default state, the backlink content
// view, the types whose pages hide related content and how nested backlinks show. Every change is
// a device setting (`useSettings().patch`); "When this space opens" is stored per space root in
// `openOnStart`.
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import type { DeviceSettings, OpenOnStartMode, SpaceEntry, Tri } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ensureLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { LINK_VIEWS } from '@/types/CardViewSettings'
import { OptionCards, SaveError, SecondaryButton, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'
import { useSettingsTypes } from './ObjectTypes'

export const EDITOR_TEXT = {
  heading: 'Editor', // EditorSettings.heading
  description: 'Manage your preferences for how the editor of Object should work.', // our string, adapted from EditorSettings.description
  toggleStyle: 'Toggle style', // EditorSettings.toggleStyle.label
  toggleStyleDescription:
    "Set the style of the toggle block. You can choose between 'toggle' (default) and 'bullet'. The latter is especially for those, who are coming from an outliner way of thinking.",
  toggleStyleToggle: 'Toggle', // EditorSettings.toggleStyle.toggle
  toggleStyleBullet: 'Bullet', // EditorSettings.toggleStyle.bullet
  disableNumbered: 'Disable automatic detection of numbered lists', // EditorSettings.disableNumberedListTransformation.label
  disableNumberedDescription:
    "This will disable the automatic transformation of the shortcut for numbered lists at the start of a text block (e.g., in the case of '1.' followed by a space).",
  disableSpellcheck: 'Disable spellcheck', // EditorSettings.disableSpellcheck.label
  disableSpellcheckDescription: 'Disables system spellcheck in the editor and in text inputs.',
  fullPage: 'Always open as full page', // EditorSettings.alwaysOpenAsFullPage.label
  fullPageDescription:
    'Enabling this option will always open objects as a full page on click. Images and PDFs still open in the preview. Opening other content in the preview modal will still be available by holding Option-Shift (Mac) or Alt-Shift (Windows) while clicking.',
  inlineIcons: 'Show object type icon for inline object links', // EditorSettings.hideEntityIconsOnInlineLinks.label
  inlineIconsDescription: 'Set whether to display a small colored icon in front of inline links to an object.',
  outliner: 'Hide outliner lines', // EditorSettings.hideOutlinerLines.label
  outlinerDescription: 'Hides the vertical lines along the blocks nested inside a toggle block.',
  openOnStart: 'When this space opens', // EditorSettings.openOnStart.label
  openOnStartDescription:
    'Used when you start the app and when you switch to this space. It applies only to the current space and stays on this device. You can choose for each space individually.',
  openModes: {
    lastOpenedPage: 'Where I left off',
    today: 'Calendar today',
    calendar: 'Calendar',
    specificObject: 'Specific object',
  }, // EditorSettings.openOnStart.*
  specificObjectDescription: 'Choose which object should open when you start the app or switch to this space.',
  selectObject: 'Select object', // EditorSettings.openOnStart.selectObject
  startup: 'When Object starts', // our string, adapted from EditorSettings.startup.label
  startupDescription:
    'Choose which space opens on this device, then what that space shows when you start the app or switch to it.', // EditorSettings.startup.descriptionWithSpaces
  startupSpace: 'Space on this device', // EditorSettings.startupSpace.label
  startupSpaceDescription: 'If the selected space no longer exists, Object falls back to the last opened space.', // our string, adapted from EditorSettings.startupSpace.description
  startupLast: 'Last opened space', // EditorSettings.startupSpace.lastOpened
  startupSpecific: 'Specific space', // EditorSettings.startupSpace.specific
  noObjects: 'No results', // AppSettings.search.noResults
  // M8: EditorSettings.backlinkSectionsDefault.*
  backlinkSections: 'Default state for backlink sections',
  backlinkSectionsDescription:
    'Choose whether these sections should start open or closed on object pages. You can still change them per object.',
  sections: {
    backlinks: 'Backlinks',
    relatedContent: 'Related Content',
    unlinkedMentions: 'Unlinked Mentions',
  },
  tri: { open: 'Open', closed: 'Closed', hidden: 'Hidden' },
  backlinkContentView: 'Backlink content view',
  backlinkContentViewDescription: 'Choose the default view for backlink content. Embed is the default when no option is selected.',
  hiddenTypes: 'Hide related content for object types',
  hiddenTypesDescription: 'Select object types for which the related content section should be hidden on their pages.',
  clearAll: 'Clear all',
  // M8: EditorSettings.defaultContextualBacklinkViewMode.*
  nestedBacklinks: 'Default display of nested backlinks',
  nestedBacklinksDescription:
    'Set the default behavior of how to display contextual backlinks when they are nested within other blocks. You can get a more compact view by starting with the block with the actual backlink as root or get a more detailed view by showing the full path that is leading to the block with the backlink.',
  nestedModes: {
    showBlockContainingBacklink: 'Only block with backlink',
    showFullPathAbove: 'Full path above',
  },
} as const

const T = EDITOR_TEXT

export const EDITOR_SEARCH: string[] = [
  T.toggleStyle,
  T.toggleStyleToggle,
  T.toggleStyleBullet,
  T.disableNumbered,
  T.disableSpellcheck,
  T.fullPage,
  T.inlineIcons,
  T.outliner,
  T.openOnStart,
  ...Object.values(T.openModes),
  T.startup,
  T.startupSpace,
  T.startupLast,
  T.startupSpecific,
  T.backlinkSections,
  ...Object.values(T.sections),
  T.backlinkContentView,
  T.hiddenTypes,
  T.nestedBacklinks,
  ...Object.values(T.nestedModes),
]

const SECTION_KEYS = ['backlinks', 'relatedContent', 'unlinkedMentions'] as const
const TRIS: Tri[] = ['open', 'closed', 'hidden']
const NESTED_MODES = ['showBlockContainingBacklink', 'showFullPathAbove'] as const

/** "Hide related content for object types": a checkbox per type and "Clear all". */
function HiddenTypes({ value, onChange }: { value: string[]; onChange(next: string[]): void }) {
  const types = useSettingsTypes()
  const hidden = new Set(value)
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={T.hiddenTypes} className="flex flex-wrap gap-1.5">
        {types.map((t) => {
          const checked = hidden.has(t.id)
          return (
            <button
              key={t.id}
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={t.pluralName || t.name}
              onClick={() => onChange(checked ? value.filter((id) => id !== t.id) : [...value, t.id])}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border bg-raised px-2.5 text-[14px] text-fg hover:bg-hover ${checked ? 'border-fg-muted' : 'border-line'}`}
            >
              <Icon name={checked ? 'ph-check-square' : 'ph-square'} size={14} />
              <span className="truncate">{t.pluralName || t.name}</span>
            </button>
          )
        })}
      </div>
      <SecondaryButton disabled={value.length === 0} onClick={() => onChange([])}>
        {T.clearAll}
      </SecondaryButton>
    </div>
  )
}

const OPEN_MODES: OpenOnStartMode[] = ['lastOpenedPage', 'today', 'calendar', 'specificObject']

function ObjectSelect({ value, onSelect }: { value: string | undefined; onSelect(path: string): void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const objects = useLinkIndex((s) => s.objects)
  useEffect(() => {
    if (open) void ensureLinkIndex()
  }, [open])
  const current = value ? objects.find((o) => o.path === value) : undefined
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return objects.filter((o) => !needle || o.title.toLowerCase().includes(needle)).slice(0, 50)
  }, [objects, q])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 w-fit max-w-full items-center gap-1.5 rounded-md border border-line bg-raised px-3 text-[14px] text-fg hover:bg-hover"
        >
          <Icon name="ph-file-text" size={14} />
          <span className="truncate">{current?.title ?? value ?? T.selectObject}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] border-line bg-raised p-2 text-fg">
        <input
          autoFocus
          aria-label={T.selectObject}
          placeholder={T.selectObject}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-1 h-8 w-full rounded-md border border-line bg-transparent px-2 text-[14px] outline-none focus:border-fg-muted"
        />
        <ul role="listbox" aria-label={T.selectObject} className="max-h-[260px] overflow-y-auto">
          {shown.map((o) => (
            <li key={o.path}>
              <button
                type="button"
                role="option"
                aria-selected={o.path === value}
                onClick={() => {
                  onSelect(o.path)
                  setOpen(false)
                }}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-hover"
              >
                <span className="truncate">{o.title}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-1.5 text-[13px] text-fg-muted">{T.noObjects}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

export function EditorSection() {
  const settings = useSettings((s) => s.settings)
  const root = useSpaceInfo((s) => s.space?.root ?? null)
  const [spaces, setSpaces] = useState<SpaceEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void useSpaceInfo.getState().ensure()
    let live = true
    api
      .spaces()
      .then((list) => {
        if (live) setSpaces(list ?? [])
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const set = (p: Partial<DeviceSettings>) => {
    setError(null)
    useSettings
      .getState()
      .patch(p)
      .catch((e: unknown) => setError(errorText(e)))
  }

  const sectionsDefault: DeviceSettings['backlinkSectionsDefault'] = {
    ...settingsDefaults.backlinkSectionsDefault,
    ...(settings.backlinkSectionsDefault as Partial<DeviceSettings['backlinkSectionsDefault']> | undefined),
  }

  const entry = root ? settings.openOnStart?.[root] : undefined
  const mode: OpenOnStartMode = entry?.mode ?? 'lastOpenedPage'
  const setOpenOnStart = (next: { mode: OpenOnStartMode; path?: string }) => {
    if (!root) return
    set({ openOnStart: { ...(settings.openOnStart ?? {}), [root]: next } })
  }

  return (
    <div>
      <SectionHeader icon="ph-text-aa" heading={T.heading} description={T.description} />
      <SettingGroup title={T.toggleStyle} help={T.toggleStyleDescription}>
        <OptionCards
          label={T.toggleStyle}
          value={settings.toggleStyle}
          options={[
            { value: 'toggle', label: T.toggleStyleToggle },
            { value: 'bullet', label: T.toggleStyleBullet },
          ]}
          onChange={(toggleStyle) => set({ toggleStyle })}
        />
      </SettingGroup>
      <SwitchRow
        title={T.disableNumbered}
        help={T.disableNumberedDescription}
        checked={settings.disableNumberedListTransformation}
        onChange={(v) => set({ disableNumberedListTransformation: v })}
      />
      <SwitchRow
        title={T.disableSpellcheck}
        help={T.disableSpellcheckDescription}
        checked={settings.disableSpellcheck}
        onChange={(v) => set({ disableSpellcheck: v })}
      />
      <SwitchRow title={T.fullPage} help={T.fullPageDescription} checked={settings.alwaysOpenAsFullPage} onChange={(v) => set({ alwaysOpenAsFullPage: v })} />
      {/* The switch shows the icons: on means `hideEntityIconsOnInlineLinks: false`. */}
      <SwitchRow
        title={T.inlineIcons}
        help={T.inlineIconsDescription}
        checked={!settings.hideEntityIconsOnInlineLinks}
        onChange={(v) => set({ hideEntityIconsOnInlineLinks: !v })}
      />
      <SwitchRow title={T.outliner} help={T.outlinerDescription} checked={settings.hideOutlinerLines} onChange={(v) => set({ hideOutlinerLines: v })} />
      <SettingGroup title={T.openOnStart} help={T.openOnStartDescription}>
        <OptionCards
          label={T.openOnStart}
          value={mode}
          columns={2}
          options={OPEN_MODES.map((m) => ({ value: m, label: T.openModes[m] }))}
          onChange={(m) => setOpenOnStart(m === 'specificObject' && entry?.path ? { mode: m, path: entry.path } : { mode: m })}
        />
        {mode === 'specificObject' && (
          <div className="flex flex-col gap-1">
            <p className="text-[13px] text-fg-muted">{T.specificObjectDescription}</p>
            <ObjectSelect value={entry?.path} onSelect={(path) => setOpenOnStart({ mode: 'specificObject', path })} />
          </div>
        )}
      </SettingGroup>
      <SettingGroup title={T.startup} help={T.startupDescription} className="pb-0" />
      <SettingGroup title={T.startupSpace} help={T.startupSpaceDescription}>
        <OptionCards
          label={T.startupSpace}
          value={settings.startupSpace}
          options={[
            { value: 'lastOpened', label: T.startupLast },
            { value: 'specific', label: T.startupSpecific },
          ]}
          onChange={(startupSpace) =>
            set(
              startupSpace === 'specific'
                ? { startupSpace, startupSpacePath: settings.startupSpacePath ?? root }
                : { startupSpace },
            )
          }
        />
        {settings.startupSpace === 'specific' && (
          <select
            aria-label={T.startupSpecific}
            value={settings.startupSpacePath ?? ''}
            onChange={(e) => set({ startupSpacePath: e.target.value || null })}
            className="h-8 w-fit max-w-full rounded-md border border-line bg-raised px-2 text-[14px] text-fg"
          >
            {!settings.startupSpacePath && <option value="">{T.startupSpecific}</option>}
            {settings.startupSpacePath && !spaces.some((s) => s.path === settings.startupSpacePath) && (
              <option value={settings.startupSpacePath}>{settings.startupSpacePath}</option>
            )}
            {spaces.map((s) => (
              <option key={s.path} value={s.path}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </SettingGroup>
      <SettingGroup title={T.backlinkSections} help={T.backlinkSectionsDescription}>
        {SECTION_KEYS.map((k) => (
          <div key={k} className="flex items-center gap-4">
            <span className="w-[160px] shrink-0 text-[14px] text-fg">{T.sections[k]}</span>
            <div className="min-w-0 flex-1">
              <OptionCards
                label={T.sections[k]}
                value={sectionsDefault[k]}
                options={TRIS.map((v) => ({ value: v, label: T.tri[v] }))}
                onChange={(v) => set({ backlinkSectionsDefault: { ...sectionsDefault, [k]: v } })}
              />
            </div>
          </div>
        ))}
      </SettingGroup>
      <SettingGroup title={T.backlinkContentView} help={T.backlinkContentViewDescription}>
        <OptionCards
          label={T.backlinkContentView}
          value={settings.backlinkContentView ?? 'embed'}
          columns={4}
          options={LINK_VIEWS.map((v) => ({ value: v.value, label: v.name }))}
          onChange={(backlinkContentView) => set({ backlinkContentView })}
        />
      </SettingGroup>
      <SettingGroup title={T.hiddenTypes} help={T.hiddenTypesDescription}>
        <HiddenTypes value={settings.relatedContentHiddenTypes ?? []} onChange={(relatedContentHiddenTypes) => set({ relatedContentHiddenTypes })} />
      </SettingGroup>
      <SettingGroup title={T.nestedBacklinks} help={T.nestedBacklinksDescription}>
        <OptionCards
          label={T.nestedBacklinks}
          value={settings.nestedBacklinkView ?? 'showBlockContainingBacklink'}
          options={NESTED_MODES.map((m) => ({ value: m, label: T.nestedModes[m] }))}
          onChange={(nestedBacklinkView) => set({ nestedBacklinkView })}
        />
      </SettingGroup>
      <SaveError error={error} />
    </div>
  )
}
