// "Task management": hide Tasks for this space (`space.json` `hideTaskManagement`) and open the
// Task type's settings. M32: Tasks is its own plain page, so the switch says what it hides there
// (the Tasks page, its sidebar entry and the task features); before, it left the task lists out of
// the dashboard. The key and what is stored are unchanged.
import { useState } from 'react'
import type { TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { SaveError, SecondaryButton, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'
import { openTypeSettings, useSettingsTypes } from './ObjectTypes'

export const TASK_MANAGEMENT_TEXT = {
  heading: 'Task management',
  description: 'Plan and track tasks right next to your notes.',
  hide: 'Hide Tasks in this space', // M32, our string (was "Hide Task Management")
  hideDescription:
    'Hides the Tasks page, its entry in the sidebar and the task features in this space. Other spaces are not changed.', // our string
  hideInfo:
    'Tasks you already made are kept. To remove them too, delete the Task type from this space.',
  customization: 'Task type settings',
  customizationDescription: 'Set the color, how task links behave and more.', // .taskObjectCustomization.description
  openSettings: 'Open settings', // .taskObjectCustomization.button
} as const

const T = TASK_MANAGEMENT_TEXT

export const TASK_MANAGEMENT_SEARCH: string[] = [T.hide, T.customization]

/** The basic Task type (as the Tasks page finds it). */
export function findTaskType(types: TypeDef[]): TypeDef | undefined {
  return types.find((t) => t.basic && t.name.toLowerCase() === 'task') ?? types.find((t) => t.id === 'task')
}

export function TaskManagementSection() {
  const hidden = useSpaceInfo((s) => s.space?.hideTaskManagement ?? false)
  const ready = useSpaceInfo((s) => !!s.space)
  const types = useSettingsTypes()
  const taskType = findTaskType(types)
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <SectionHeader icon="ph-check-circle" heading={T.heading} description={T.description} />
      <SwitchRow
        title={T.hide}
        help={T.hideDescription}
        checked={hidden}
        onChange={(v) => {
          if (!ready) return
          setError(null)
          useSpaceInfo
            .getState()
            .patch({ hideTaskManagement: v })
            .catch((e: unknown) => setError(errorText(e)))
        }}
      >
        <p className="flex gap-1.5 text-[13px] text-fg-muted">
          <Icon name="ph-info" size={14} className="mt-0.5 shrink-0" />
          {T.hideInfo}
        </p>
      </SwitchRow>
      <SettingGroup title={T.customization} help={T.customizationDescription}>
        <SecondaryButton disabled={!taskType} onClick={() => taskType && openTypeSettings(taskType.id)}>
          {T.openSettings}
        </SecondaryButton>
      </SettingGroup>
      <SaveError error={error} />
    </div>
  )
}
