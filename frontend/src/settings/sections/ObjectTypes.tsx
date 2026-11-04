// "Object Types": every type of the space, basic ones first; a row opens that type's Type
// Settings tab and closes the modal.
import { useEffect } from 'react'
import type { TypeDef } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { TypeChip, byPluralName } from '@/shell/Sidebar'
import { useSettingsModal } from '@/settings/useSettingsModal'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { Icon } from '@/components/Icon'
import { SectionHeader, SettingGroup } from '../controls'

export const OBJECT_TYPES_TEXT = {
  heading: 'Object Types',
  description: 'Here you can customize your object types.',
  yourTypes: 'Your object types',
  yourTypesDescription: 'Select an object type to customize it.',
  basic: 'Basic object types',
  custom: 'Custom object types',
} as const

const T = OBJECT_TYPES_TEXT

export const OBJECT_TYPES_SEARCH: string[] = [T.yourTypes, T.basic, T.custom]

/** The space's types: the link index's when loaded, else the space info's. */
export function useSettingsTypes(): TypeDef[] {
  const indexTypes = useLinkIndex((s) => s.types)
  const spaceTypes = useSpaceInfo((s) => s.space?.types)
  useEffect(() => {
    void useSpaceInfo.getState().ensure()
  }, [])
  return indexTypes.length > 0 ? indexTypes : (spaceTypes ?? [])
}

/** Open `typeId`'s Type Settings in the main view and close the modal. */
export function openTypeSettings(typeId: string): void {
  useTabs.getState().open({ kind: 'typeSettings', typeId })
  useSettingsModal.getState().close()
}

function TypeList({ label, types }: { label: string; types: TypeDef[] }) {
  if (types.length === 0) return null
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <h4 className="pt-2 text-[13px] font-semibold text-fg-muted">{label}</h4>
      <ul className="flex flex-col gap-0.5">
        {types.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => openTypeSettings(t.id)}
              className="flex h-[38px] w-full items-center gap-2 rounded-lg px-2 text-left text-[15px] font-medium text-fg hover:bg-hover"
            >
              <TypeChip type={t} size={22} />
              <span className="min-w-0 flex-1 truncate">{t.pluralName}</span>
              <Icon name="ph-caret-right" size={14} className="text-fg-muted" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ObjectTypesSection() {
  const types = useSettingsTypes()
  const sorted = [...types].sort(byPluralName)
  return (
    <div>
      <SectionHeader icon="ph-cube" heading={T.heading} description={T.description} />
      <SettingGroup title={T.yourTypes} help={T.yourTypesDescription}>
        <TypeList label={T.basic} types={sorted.filter((t) => t.basic)} />
        <TypeList label={T.custom} types={sorted.filter((t) => !t.basic)} />
      </SettingGroup>
    </div>
  )
}
