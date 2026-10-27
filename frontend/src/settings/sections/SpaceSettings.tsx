// "Space Settings": the space's name, icon and description, written to `.object/space.json`
// through `PUT /api/space` (nothing else changes: no folder rename). M8: a "Delete space" row,
// always disabled here because this is the open space (delete other spaces from the spaces menu).
import { useEffect, useState } from 'react'
import type { Icon as IconValue } from '@/api/types'
import { IconOrEmoji, isIconifyId } from '@/components/Icon'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DELETE_SPACE_TEXT } from '@/spaces/DeleteSpaceDialog'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { SaveError, SectionHeader, SettingGroup, errorText } from '../controls'

export const SPACE_SETTINGS_TEXT = {
  heading: 'Space Settings', // CurrentSpaceSettings.heading
  description: 'Modify global properties of your space.', // our string, adapted from CurrentSpaceSettings.description
  name: 'Name', // SpaceDashboard.general.spaceName.label
  nameHeader: 'Set or update the name for this space.', // SpaceDashboard.general.spaceName.header
  namePlaceholder: 'What you want to call this space', // SpaceDashboard.general.spaceName.placeholder
  icon: 'Icon', // SpaceDashboard.general.spaceIcon.label
  iconHeader: 'Pick an icon to further identify this space.', // SpaceDashboard.general.spaceIcon.header
  description_: 'Description', // SpaceDashboard.general.spaceDescription.label
  descriptionHeader: 'Describe the purpose of this space.', // SpaceDashboard.general.spaceDescription.header
  descriptionPlaceholder: 'Your description', // SpaceDashboard.general.spaceDescription.placeholder
} as const

const T = SPACE_SETTINGS_TEXT

export const SPACE_SETTINGS_SEARCH: string[] = [T.name, T.icon, T.description_]

/** Longest space name `space.json` accepts (the server's rule). */
export const MAX_SPACE_NAME = 120

/** `space.json`'s icon string (an Iconify id or an emoji) as an `Icon`. */
export function spaceIconToIcon(s: string | null | undefined): IconValue | null {
  if (!s) return null
  return isIconifyId(s) ? { type: 'iconify', val: s } : { type: 'emoji', val: s }
}

/** An `Icon` as `space.json`'s icon string (its colour is not kept). */
export function iconToSpaceIcon(icon: IconValue | null | undefined): string | null {
  return icon?.val ? icon.val : null
}

export function SpaceSettingsSection() {
  const space = useSpaceInfo((s) => s.space)
  const [name, setName] = useState(space?.name ?? '')
  const [description, setDescription] = useState(space?.description ?? '')
  const [iconOpen, setIconOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void useSpaceInfo.getState().ensure()
  }, [])
  // Follow the stored values (the first load, a refused patch, another window's edit).
  useEffect(() => setName(space?.name ?? ''), [space?.name])
  useEffect(() => setDescription(space?.description ?? ''), [space?.description])

  const save = (patch: Parameters<ReturnType<typeof useSpaceInfo.getState>['patch']>[0]) => {
    setError(null)
    useSpaceInfo
      .getState()
      .patch(patch)
      .catch((e: unknown) => setError(errorText(e)))
  }

  const commitName = () => {
    const next = name.trim()
    if (!space || next === space.name) return
    if (!next || next.length > MAX_SPACE_NAME) {
      setName(space.name)
      return
    }
    save({ name: next })
  }
  const commitDescription = () => {
    if (!space) return
    const next = description.trim() ? description : null
    if (next === (space.description ?? null)) return
    save({ description: next })
  }

  const icon = spaceIconToIcon(space?.icon)
  return (
    <div>
      <SectionHeader icon="ph-gear-six" heading={T.heading} description={T.description} />
      <SettingGroup title={T.name} help={T.nameHeader}>
        <input
          aria-label={T.name}
          value={name}
          maxLength={MAX_SPACE_NAME}
          placeholder={T.namePlaceholder}
          disabled={!space}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitName()
            }
          }}
          className="h-9 w-full max-w-[420px] rounded-md border border-line bg-raised px-2 text-[15px] text-fg outline-none focus:border-fg-muted"
        />
      </SettingGroup>
      <SettingGroup title={T.icon} help={T.iconHeader}>
        <Popover open={iconOpen} onOpenChange={setIconOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={T.icon}
              disabled={!space}
              className="flex size-10 items-center justify-center rounded-md border border-line bg-raised text-fg hover:bg-hover"
            >
              <IconOrEmoji icon={icon} fallback="ph-planet" size={20} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto border-line bg-raised p-2 text-fg">
            <IconPicker
              value={icon}
              onChange={(next) => {
                setIconOpen(false)
                const s = iconToSpaceIcon(next)
                if (s !== (space?.icon ?? null)) save({ icon: s })
              }}
            />
          </PopoverContent>
        </Popover>
      </SettingGroup>
      <SettingGroup title={T.description_} help={T.descriptionHeader}>
        <textarea
          aria-label={T.description_}
          value={description}
          placeholder={T.descriptionPlaceholder}
          disabled={!space}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          className="w-full max-w-[520px] resize-y rounded-md border border-line bg-raised px-2 py-1.5 text-[15px] text-fg outline-none focus:border-fg-muted"
        />
      </SettingGroup>
      <SettingGroup title={DELETE_SPACE_TEXT.menuItem} help={DELETE_SPACE_TEXT.currentHint}>
        <div>
          <Button type="button" variant="destructive" size="sm" disabled title={DELETE_SPACE_TEXT.currentHint}>
            {DELETE_SPACE_TEXT.confirm}
          </Button>
        </div>
      </SettingGroup>
      <SaveError error={error} />
    </div>
  )
}
