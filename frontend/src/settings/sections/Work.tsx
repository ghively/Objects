// "Work" (M22, our section; Space group, after Automations): "Your name in Activity" (a device
// setting, `activityName`, the name every work write puts in `## Activity`) and "Jira site" (a
// space setting, `jiraSite` in `.object/space.json`, which makes a Jira ticket's browse link). A
// refused save (422) shows the server's message under its field. M23 adds its alert rows after
// these two, and M24 its work agent group after those.
import { useEffect, useState } from 'react'
import { useSettings } from '@/settings/useSettings'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { SaveError, SectionHeader, SettingGroup, errorText } from '../controls'

export const WORK_TEXT = {
  heading: 'Work', // our string
  description: 'How your work items are logged and linked.', // our string
  yourName: 'Your name in Activity', // our string
  yourNameHelp: 'The name each step action, note and field change puts in the Activity log on this device.', // our string
  jiraSite: 'Jira site', // our string
  jiraSiteHelp: 'The web address of your Jira site. A Jira ticket ID then links to its page.', // our string
  jiraSitePlaceholder: 'https://example.atlassian.net', // our string
} as const

const T = WORK_TEXT

export const WORK_SEARCH: string[] = [T.yourName, T.jiraSite]

/** Longest Activity name the server accepts (`settings._valid`). */
export const MAX_ACTIVITY_NAME = 60
/** Longest Jira site the server accepts (`spaceconfig._checked`). */
export const MAX_JIRA_SITE = 300

const INPUT =
  'h-9 w-full max-w-[420px] rounded-md border border-line bg-raised px-2 text-[15px] text-fg outline-none focus:border-fg-muted'

export function WorkSection() {
  const activityName = useSettings((s) => s.settings.activityName)
  const space = useSpaceInfo((s) => s.space)
  const storedSite = space?.jiraSite ?? ''
  const [name, setName] = useState(activityName ?? '')
  const [site, setSite] = useState(storedSite)
  const [nameError, setNameError] = useState<string | null>(null)
  const [siteError, setSiteError] = useState<string | null>(null)

  useEffect(() => {
    void useSpaceInfo.getState().ensure()
  }, [])
  // Follow the stored values (the first load, another window's edit).
  useEffect(() => setName(activityName ?? ''), [activityName])
  useEffect(() => setSite(storedSite), [storedSite])

  const commitName = () => {
    if (name === activityName) return
    setNameError(null)
    useSettings
      .getState()
      .patch({ activityName: name })
      .catch((e: unknown) => setNameError(errorText(e)))
  }

  const commitSite = () => {
    if (!space) return
    const typed = site
    const next = typed.trim() === '' ? null : typed.trim()
    if (next === (space.jiraSite ?? null)) return
    setSiteError(null)
    useSpaceInfo
      .getState()
      .patch({ jiraSite: next })
      .catch((e: unknown) => {
        setSiteError(errorText(e))
        // The refused patch reloads the stored info; keep what was typed so it can be fixed.
        setSite(typed)
      })
  }

  return (
    <div>
      <SectionHeader icon="ph-briefcase" heading={T.heading} description={T.description} />
      <SettingGroup title={T.yourName} help={T.yourNameHelp}>
        <input
          aria-label={T.yourName}
          value={name}
          maxLength={MAX_ACTIVITY_NAME}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitName()
            }
          }}
          className={INPUT}
        />
        <SaveError error={nameError} />
      </SettingGroup>
      <SettingGroup title={T.jiraSite} help={T.jiraSiteHelp}>
        <input
          aria-label={T.jiraSite}
          type="text"
          inputMode="url"
          value={site}
          maxLength={MAX_JIRA_SITE}
          placeholder={T.jiraSitePlaceholder}
          disabled={!space}
          onChange={(e) => setSite(e.target.value)}
          onBlur={commitSite}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitSite()
            }
          }}
          className={INPUT}
        />
        <SaveError error={siteError} />
      </SettingGroup>
    </div>
  )
}
