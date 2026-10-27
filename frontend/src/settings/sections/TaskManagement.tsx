// "Task management": hide the Tasks page for this space (`space.json` `hideTaskManagement`) and
// open the Task type's settings.
import { useState } from 'react'
import type { TypeDef } from '@/api/types'
import { Icon } from '@/components/Icon'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { SaveError, SecondaryButton, SectionHeader, SettingGroup, SwitchRow, errorText } from '../controls'
import { openTypeSettings, useSettingsTypes } from './ObjectTypes'

export const TASK_MANAGEMENT_TEXT = {
  heading: 'Task management', // TaskManagementSettings.heading
  description: 'No need to switch context to work on your tasks.', // TaskManagementSettings.description
  hide: 'Hide Task Management', // TaskManagementSettings.hideTaskManagement.heading
  hideDescription:
    "If you don't want to use tasks in Object, you can simply hide it. You are changing this setting for your active space, not for all spaces.", // our string, adapted from TaskManagementSettings.hideTaskManagement.description
  hideInfo:
    'If you also do not want to see the task you already created, you need to delete the task object type in your current space.', // TaskManagementSettings.hideTaskManagement.info
  customization: 'Task Object Customization', // TaskManagementSettings.taskObjectCustomization.heading
  customizationDescription: 'Fine-tune your preferences like color or link behavior.', // .taskObjectCustomization.description
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
