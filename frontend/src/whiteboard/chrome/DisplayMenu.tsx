/**
 * "Canvas display": the five user-level switches under Object's own setting keys
 * (`component.model.ts` `whiteboard`: isSnappingToGrid, isSnappingToNodes, isShowingDots,
 * isZoomingOnScroll, isEngineeringMode).
 */
import { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import type { ResolvedSettings, SettingKey } from '../canvasTypes'
import { WB } from '../strings'
import { MenuHeading } from './controls'

export const DISPLAY_SETTINGS: { key: SettingKey; label: string }[] = [
  { key: 'isSnappingToGrid', label: WB.displaySnapToGrid.text },
  { key: 'isSnappingToNodes', label: WB.displaySnapToNodes.text },
  { key: 'isShowingDots', label: WB.displayShowDots.text },
  { key: 'isZoomingOnScroll', label: WB.displayScrollZoom.text },
  { key: 'isEngineeringMode', label: WB.displayEngineeringMode.text },
]

export interface DisplayMenuProps {
  settings: ResolvedSettings
  onSettings(key: SettingKey, value: boolean): void
}

export function DisplayMenu({ settings, onSettings }: DisplayMenuProps) {
  const id = useId()
  return (
    <div role="group" aria-label={WB.toolDisplay.text} data-whiteboard-display-menu="" className="flex flex-col">
      <MenuHeading>{WB.toolDisplay.text}</MenuHeading>
      {DISPLAY_SETTINGS.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between gap-6 rounded-md px-2 py-1.5 hover:bg-hover">
          <label htmlFor={`${id}-${key}`} className="flex-1 cursor-pointer text-[14px] text-fg">
            {label}
          </label>
          <Switch id={`${id}-${key}`} checked={settings[key]} onCheckedChange={(v) => onSettings(key, v)} />
        </div>
      ))}
    </div>
  )
}
