/**
 * Puts the device settings that act app-wide onto `<html>` once they are loaded (so the defaults
 * never overwrite what `index.html` painted first): the text size (`--app-zoom`, `zoom.ts`).
 * Mounted once by `shell/GlobalOverlays.tsx`.
 */
import { useEffect } from 'react'
import { settingsDefaults, useSettings } from '@/settings/useSettings'
import { applyZoom } from './zoom'

export function DeviceSettingsFollower() {
  const settings = useSettings((s) => s.settings)
  const loaded = useSettings((s) => s.loaded)
  const ready = loaded || settings !== settingsDefaults
  const zoom = settings.zoom
  useEffect(() => {
    if (ready) applyZoom(zoom)
  }, [ready, zoom])
  return null
}
