/**
 * "Presentation settings": the Preferences switches ("Hide cover image",
 * "Hide progress indicator", "Hide title in header") and the Footer texts ("Left footer", "Right
 * footer"), saved to the device settings' `presentation` key (`PUT /api/settings`).
 *
 * Left out (listed for Gene): a watermark toggle (we draw no watermark) and "Block
 * properties" (our model has no block properties).
 */
import { useEffect, useState } from 'react'
import type { PresentationSettings as PresentationPrefs } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SettingGroup, SwitchRow } from '@/settings/controls'
import { settingsDefaults, useSettings } from '@/settings/useSettings'

export const PRESENTATION_SETTINGS_TEXT = {
  heading: 'Presentation settings',
  preferences: 'Preferences',
  hideCoverImage: { heading: 'Hide cover image', description: "Don't show the cover image on the title slide." },
  hideProgressIndicator: {
    heading: 'Hide progress indicator',
    description: "Don't show the horizontal progress bar at the top.",
  },
  hideTitle: {
    heading: 'Hide title in header',
    description: "Don't show the object title in the top-left corner on content slides.",
  },
  footer: 'Footer',
  left: { heading: 'Left footer', description: 'Text shown in the bottom-left corner of every slide.', placeholder: 'e.g. Company name' },
  right: {
    heading: 'Right footer',
    description: 'Text shown in the bottom-right corner of every slide.',
    placeholder: 'e.g. Confidential',
  },
} as const

/** The presentation settings in effect (the defaults for any missing field). */
export function usePresentationPrefs(): PresentationPrefs {
  const p = useSettings((s) => s.settings.presentation)
  return { ...settingsDefaults.presentation, ...(p ?? {}) }
}

function savePrefs(partial: Partial<PresentationPrefs>) {
  const current = { ...settingsDefaults.presentation, ...(useSettings.getState().settings.presentation ?? {}) }
  void useSettings
    .getState()
    .patch({ presentation: { ...current, ...partial } })
    .catch(() => undefined)
}

function FooterField({ which, value }: { which: 'left' | 'right'; value: string }) {
  const text = PRESENTATION_SETTINGS_TEXT[which]
  const key = which === 'left' ? 'footerLeft' : 'footerRight'
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) savePrefs({ [key]: draft })
  }
  return (
    <SettingGroup title={text.heading} help={text.description} className="py-2">
      <input
        aria-label={text.heading}
        value={draft}
        placeholder={text.placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        className="h-8 w-full rounded-md border border-line bg-app px-2 text-[14px] text-fg outline-none focus:border-fg-muted"
      />
    </SettingGroup>
  )
}

/** The settings rows (the popover's content). */
export function PresentationSettingsPanel() {
  const prefs = usePresentationPrefs()
  const T = PRESENTATION_SETTINGS_TEXT
  return (
    <div data-presentation-settings="" className="flex flex-col">
      <h2 className="text-[15px] font-semibold text-fg">{T.heading}</h2>
      <h3 className="mt-3 text-[13px] font-medium text-fg-muted">{T.preferences}</h3>
      {(['hideCoverImage', 'hideProgressIndicator', 'hideTitle'] as const).map((k) => (
        <SwitchRow
          key={k}
          title={T[k].heading}
          help={T[k].description}
          checked={prefs[k]}
          onChange={(v) => savePrefs({ [k]: v })}
        />
      ))}
      <h3 className="mt-3 text-[13px] font-medium text-fg-muted">{T.footer}</h3>
      <FooterField which="left" value={prefs.footerLeft} />
      <FooterField which="right" value={prefs.footerRight} />
    </div>
  )
}

/** The header button and its "Presentation settings" popover. */
export function PresentationSettings() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={PRESENTATION_SETTINGS_TEXT.heading}
          title={PRESENTATION_SETTINGS_TEXT.heading}
          className="flex size-8 items-center justify-center rounded-md text-fg hover:bg-hover"
        >
          <Icon name="ph-gear-six" size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        data-presentation-settings-content=""
        className="max-h-[80vh] w-[360px] overflow-auto border-line bg-raised p-4"
      >
        <PresentationSettingsPanel />
      </PopoverContent>
    </Popover>
  )
}

export default PresentationSettings
