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
import { typeLabel, typePlural } from '@/lib/typeLabel'
import { HOME } from '@/lib/words'
import { ensureLinkIndex, useLinkIndex } from '@/links/linkIndex'
import { referencesSettings } from '@/references/referencesUi'
import { useSettings } from '@/settings/useSettings'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { LINK_VIEWS } from '@/types/CardViewSettings'
import { OptionCards, SaveError, SecondaryButton, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'
import { normalizeLanguageTag } from '@/settings/spellcheck'
import { useSettingsTypes } from './ObjectTypes'

export const EDITOR_TEXT = {
  heading: 'Editor',
  description: "Manage your preferences for Object's editor.", // our string
  toggleStyle: 'Toggle style',
  toggleStyleDescription:
    "How toggle blocks look: 'toggle' (the default) or 'bullet', which suits people used to outliners.",
  toggleStyleToggle: 'Toggle',
  toggleStyleBullet: 'Bullet',
  disableNumbered: 'Turn off automatic numbered lists',
  disableNumberedDescription:
    "Typing '1.' and a space at the start of a text block will no longer turn it into a numbered list.",
  disableSpellcheck: 'Disable spellcheck',
  disableSpellcheckDescription: 'Turns off the system spellchecker in the editor and all text fields.',
  // M32: "Open notes as a full page" (was "Open objects…"; on by default now).
  fullPage: 'Open notes as a full page',
  fullPageDescription:
    'Clicking a note opens it as a full page. Images and PDFs keep opening in the preview, and you can still preview anything else by clicking with Option-Shift (Mac) or Alt-Shift (Windows) held down.',
  propertiesByDefault: 'Show properties by default', // our string
  // M32: the panel starts closed for a type with no properties of its own (Note, Daily note).
  propertiesByDefaultDescription:
    'Notes of a type that has properties of its own open with the properties panel showing. A plain Note or Daily note has none, so its panel starts closed. Off: the panel starts hidden for every type; the properties button shows it for that note.', // our string
  inlineIcons: 'Type icons on inline links',
  inlineIconsDescription: 'Put a small colored type icon before each inline link.',
  outliner: 'Hide outliner lines',
  outlinerDescription: 'Removes the vertical guide lines beside blocks nested in a toggle.',
  // M31
  hideAppMenu: 'Hide App Menu',
  hideAppMenuDescription:
    'Hides the space menu at the top left of the window. Tap Alt to show it again, and again to hide it. The palette and Settings (Ctrl+,) still reach its spaces and settings.', // our string
  openOnStart: 'When this space opens',
  openOnStartDescription:
    'What appears when the app starts or you switch to this space. Each space has its own choice, kept on this device only.',
  openModes: {
    lastOpenedPage: 'Where I left off',
    today: 'Calendar today',
    calendar: 'Calendar',
    specificObject: 'Specific note',
    // M32: the Home tab (`openOnStart` mode `home`; `nav/startup.ts` acts on it).
    home: HOME,
  },
  specificObjectDescription: 'The note shown when the app starts or you switch to this space.',
  selectObject: 'Select a note',
  startup: 'When Object starts', // our string
  startupDescription:
    'Pick the space this device opens first, and what it shows on start or when you switch to it.',
  startupSpace: 'Space on this device',
  startupSpaceDescription: 'If the selected space no longer exists, Object falls back to the last opened space.', // our string
  startupLast: 'Last opened space',
  startupSpecific: 'Specific space',
  noObjects: 'No results',
  // M8
  backlinkSections: 'Backlink sections start as',
  backlinkSectionsDescription:
    'Whether each section is expanded or collapsed when a note opens. Each note can still override it.',
  sections: {
    backlinks: 'Backlinks',
    relatedContent: 'Related Content',
    unlinkedMentions: 'Unlinked Mentions',
  },
  tri: { open: 'Open', closed: 'Closed', hidden: 'Hidden' },
  backlinkContentView: 'Backlink content view',
  backlinkContentViewDescription: 'How backlink content shows at first. With nothing picked, it is embedded.',
  hiddenTypes: 'Types without related content',
  hiddenTypesDescription: 'Notes of the types picked here leave out the related content section.',
  clearAll: 'Clear all',
  // M8
  nestedBacklinks: 'How nested backlinks show at first',
  nestedBacklinksDescription:
    'How a backlink inside nested blocks is shown by default: just the block that holds the link, which is shorter, or that block with every parent block above it, which gives more context.',
  nestedModes: {
    showBlockContainingBacklink: 'Just the linking block',
    showFullPathAbove: 'Full path above',
  },
  // Polish 2026-11-03
  spellCheckLang: 'Spellcheck language',
  // our string
  spellCheckLangDescription:
    'Specify the language for spell checking. Only one language can be spell checked at the same time, and support depends on your browser and operating system. Examples are "fr" or "de-CH": the first part names the language, the optional second part a region.',
  spellCheckLangPlaceholder: 'e.g. "en-GB"...',
  spellCheckLangInvalid: 'Invalid language tag...',
  experimental: 'Experimental',
  inlineLinks: 'Insert links inline by default',
  inlineLinksDescription:
    'Linking to a note always makes an inline link, even at the start of an empty block.',
  hideType: 'Keep type settings inside Settings only',
  hideTypeDescription:
    'Removes the controls for editing properties and type settings from pages. Settings is still where you change them.',
  highlightStyle: 'Highlight Style',
  highlightStyleDescription:
    'How highlight blocks and their notes look: with a colored rail and a separate notes area, or as plain text.',
  highlightStyles: {
    default: { name: 'Default', description: 'A colored rail marks the highlight, and its notes sit below in smaller type.' },
    minimal: { name: 'Minimal', description: 'No rail; the highlight reads as ordinary text.' },
  },
} as const

const T = EDITOR_TEXT

export const EDITOR_SEARCH: string[] = [
  T.toggleStyle,
  T.toggleStyleToggle,
  T.toggleStyleBullet,
  T.disableNumbered,
  T.disableSpellcheck,
  T.spellCheckLang,
  T.fullPage,
  T.propertiesByDefault,
  T.inlineLinks,
  T.hideType,
  T.highlightStyle,
  ...Object.values(T.highlightStyles).map((s) => s.name),
  T.inlineIcons,
  T.outliner,
  T.hideAppMenu,
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
// Catalog: Backlinks (and Related Content) Open | Closed; only Unlinked Mentions adds Hidden.
const TRIS: Tri[] = ['open', 'closed', 'hidden']
const TRIS_OPEN_CLOSED: Tri[] = ['open', 'closed']
function trisFor(k: (typeof SECTION_KEYS)[number]): Tri[] {
  return k === 'unlinkedMentions' ? TRIS : TRIS_OPEN_CLOSED
}
const NESTED_MODES = ['showBlockContainingBacklink', 'showFullPathAbove'] as const

/** "Types without related content": a checkbox per type and "Clear all". */
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
              aria-label={typePlural(t) || typeLabel(t)}
              onClick={() => onChange(checked ? value.filter((id) => id !== t.id) : [...value, t.id])}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border bg-raised px-2.5 text-[14px] text-fg hover:bg-hover ${checked ? 'border-fg-muted' : 'border-line'}`}
            >
              <Icon name={checked ? 'ph-check-square' : 'ph-square'} size={14} />
              <span className="truncate">{typePlural(t) || typeLabel(t)}</span>
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

/**
 * "Spellcheck language": a tag field, saved (normalised) on Enter or blur; an empty field saves
 * `null` (the device's language); a bad tag shows "Invalid language tag..." and is not
 * saved.
 */
function SpellCheckLangInput({ value, onSave }: { value: string | null; onSave(next: string | null): void }) {
  const [text, setText] = useState(value ?? '')
  const [invalid, setInvalid] = useState(false)
  useEffect(() => setText(value ?? ''), [value])
  const commit = () => {
    if (!text.trim()) {
      setInvalid(false)
      if (value !== null) onSave(null)
      return
    }
    const tag = normalizeLanguageTag(text)
    if (!tag) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setText(tag)
    if (tag !== value) onSave(tag)
  }
  return (
    <div className="flex flex-col gap-1">
      <input
        aria-label={T.spellCheckLang}
        aria-invalid={invalid || undefined}
        placeholder={T.spellCheckLangPlaceholder}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          setInvalid(false)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        className="h-8 w-full max-w-[240px] rounded-md border border-line bg-raised px-2 text-[14px] text-fg outline-none focus:border-fg-muted"
      />
      {invalid && <p className="text-[13px] text-[var(--danger)]">{T.spellCheckLangInvalid}</p>}
    </div>
  )
}

// M32: Home follows "Where I left off" (which itself falls back to Home when nothing was open).
const OPEN_MODES: OpenOnStartMode[] = ['lastOpenedPage', 'home', 'calendar', 'today', 'specificObject']

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

  // Read as the references section reads it: a "hidden" stored for Backlinks or Related Content
  // (before Settings dropped that option for them) shows as Closed, and the next change writes it so.
  const sectionsDefault: DeviceSettings['backlinkSectionsDefault'] = referencesSettings(settings).backlinkSectionsDefault

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
      <SettingGroup
        title={T.spellCheckLang}
        help={
          <>
            <span className="mr-1.5 inline-flex rounded border border-line px-1 text-[11px] font-medium text-fg-muted">{T.experimental}</span>
            {T.spellCheckLangDescription}
          </>
        }
      >
        <SpellCheckLangInput value={settings.spellCheckLang ?? null} onSave={(spellCheckLang) => set({ spellCheckLang })} />
      </SettingGroup>
      <SwitchRow title={T.fullPage} help={T.fullPageDescription} checked={settings.alwaysOpenAsFullPage} onChange={(v) => set({ alwaysOpenAsFullPage: v })} />
      <SwitchRow
        title={T.propertiesByDefault}
        help={T.propertiesByDefaultDescription}
        checked={settings.showPropertiesByDefault !== false}
        onChange={(v) => set({ showPropertiesByDefault: v })}
      />
      <SwitchRow
        title={T.inlineLinks}
        help={T.inlineLinksDescription}
        checked={!!settings.alwaysCreateInlineLinks}
        onChange={(v) => set({ alwaysCreateInlineLinks: v })}
      />
      {/* The switch shows the icons: on means `hideEntityIconsOnInlineLinks: false`. */}
      <SwitchRow
        title={T.inlineIcons}
        help={T.inlineIconsDescription}
        checked={!settings.hideEntityIconsOnInlineLinks}
        onChange={(v) => set({ hideEntityIconsOnInlineLinks: !v })}
      />
      <SwitchRow
        title={T.hideType}
        help={T.hideTypeDescription}
        checked={!!settings.hideTypeSettings}
        onChange={(v) => set({ hideTypeSettings: v })}
      />
      <SwitchRow title={T.outliner} help={T.outlinerDescription} checked={settings.hideOutlinerLines} onChange={(v) => set({ hideOutlinerLines: v })} />
      <SwitchRow title={T.hideAppMenu} help={T.hideAppMenuDescription} checked={!!settings.hideAppMenu} onChange={(v) => set({ hideAppMenu: v })} />
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
      {/* Object has no highlight blocks yet (they come from web and PDF highlights): the choice is
          stored and put on `<html data-highlight-style>` for when they exist. */}
      <SettingGroup title={T.highlightStyle} help={T.highlightStyleDescription}>
        <OptionCards
          label={T.highlightStyle}
          value={settings.highlightStyle ?? 'default'}
          options={(['default', 'minimal'] as const).map((v) => ({
            value: v,
            label: T.highlightStyles[v].name,
            description: T.highlightStyles[v].description,
          }))}
          onChange={(highlightStyle) => set({ highlightStyle })}
        />
      </SettingGroup>
      <SettingGroup title={T.backlinkSections} help={T.backlinkSectionsDescription}>
        {SECTION_KEYS.map((k) => (
          <div key={k} className="flex items-center gap-4">
            <span className="w-[160px] shrink-0 text-[14px] text-fg">{T.sections[k]}</span>
            <div className="min-w-0 flex-1">
              <OptionCards
                label={T.sections[k]}
                value={sectionsDefault[k]}
                options={trisFor(k).map((v) => ({ value: v, label: T.tri[v] }))}
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
