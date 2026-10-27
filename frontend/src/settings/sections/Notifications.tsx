// "Notifications": M4's reminder switch (`ui.json` `reminders.enabled`, default on) and where
// reminder banners can appear.
import { useEffect, useState } from 'react'
import { api, ConflictError } from '@/api/client'
import { Icon } from '@/components/Icon'
import { reloadUi, useUiStore } from '@/shell/usePinned'
import { SaveError, SectionHeader, SwitchRow, errorText } from '../controls'

export const NOTIFICATIONS_TEXT = {
  heading: 'Notifications', // NotificationsSettings.heading
  description: 'Control reminder delivery on this computer.', // our string, adapted from NotificationsSettings.description
  activate: 'Activate notifications', // NotificationsSettings.activation.heading
  limitsHeading: 'Notifications only work while Object is open', // our string, adapted from deliveryLimits.desktop.heading
  limitsBody: 'Reminder banners appear on this computer only while Object is running.', // our string, adapted from deliveryLimits.desktop.body
} as const

const T = NOTIFICATIONS_TEXT

export const NOTIFICATIONS_SEARCH: string[] = [T.activate, T.limitsHeading]

/** Write `ui.json` `reminders.enabled` with the store's revision; one reload and retry on a 409. */
export async function saveRemindersEnabled(enabled: boolean): Promise<void> {
  const before = useUiStore.getState()
  useUiStore.setState({ ui: { ...before.ui, reminders: { enabled } } })
  try {
    let res
    try {
      res = await api.patchUi({ reminders: { enabled } }, { baseRevision: before.revision })
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e
      const fresh = await api.ui()
      useUiStore.setState({ ui: { ...(fresh?.ui ?? before.ui), reminders: { enabled } }, revision: fresh?.revision ?? '' })
      res = await api.patchUi({ reminders: { enabled } }, { baseRevision: fresh?.revision ?? '' })
    }
    useUiStore.setState({ revision: res?.revision ?? useUiStore.getState().revision })
  } catch (e) {
    const cur = useUiStore.getState().ui
    useUiStore.setState({ ui: { ...cur, reminders: before.ui.reminders ?? { enabled: !enabled } } })
    throw e
  }
}

export function NotificationsSection() {
  const loaded = useUiStore((s) => s.loaded)
  const enabled = useUiStore((s) => s.ui.reminders?.enabled ?? true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!loaded) void reloadUi()
  }, [loaded])
  return (
    <div>
      <SectionHeader icon="ph-bell" heading={T.heading} description={T.description} />
      <SwitchRow
        title={T.activate}
        checked={enabled}
        onChange={(v) => {
          setError(null)
          saveRemindersEnabled(v).catch((e: unknown) => setError(errorText(e)))
        }}
      />
      <aside aria-label={T.limitsHeading} className="mt-2 flex gap-2 rounded-lg border border-line bg-raised p-3 text-[13px]">
        <span className="pt-0.5 text-fg-muted">
          <Icon name="ph-info" size={16} />
        </span>
        <div>
          <p className="font-semibold text-fg">{T.limitsHeading}</p>
          <p className="mt-0.5 text-fg-muted">{T.limitsBody}</p>
        </div>
      </aside>
      <SaveError error={error} />
    </div>
  )
}
