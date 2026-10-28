/**
 * The canvas display settings (`ui.json` key `whiteboard`, Object's user-level names), with
 * the defaults filled in. Reading writes nothing; `set` writes once per toggle, and on a 409
 * refetches and re-applies the toggle once (as M3's `useViewState`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConflictError } from '@/api/client'
import { whiteboardApi, type WhiteboardApi } from '@/api/whiteboardClient'
import type { WhiteboardSettings } from '@/api/whiteboardTypes'
import type { ResolvedSettings, SettingKey } from './canvasTypes'
import { DEFAULT_SETTINGS } from './model'

type SettingsClient = Pick<WhiteboardApi, 'settings' | 'saveSettings'>

export interface WhiteboardSettingsState {
  settings: ResolvedSettings
  loaded: boolean
  set(key: SettingKey, value: boolean): Promise<void>
}

export function resolveSettings(stored: WhiteboardSettings): ResolvedSettings {
  return { ...DEFAULT_SETTINGS, ...stored }
}

export function useWhiteboardSettings(client: SettingsClient = whiteboardApi): WhiteboardSettingsState {
  const [stored, setStored] = useState<WhiteboardSettings>({})
  const [loaded, setLoaded] = useState(false)
  const ref = useRef<{ stored: WhiteboardSettings; revision: string }>({ stored: {}, revision: '' })

  useEffect(() => {
    let alive = true
    client
      .settings()
      .then((res) => {
        if (!alive) return
        ref.current = { stored: res.settings, revision: res.revision }
        setStored(res.settings)
        setLoaded(true)
      })
      .catch(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [client])

  const set = useCallback(
    async (key: SettingKey, value: boolean) => {
      const next = { ...ref.current.stored, [key]: value }
      ref.current = { ...ref.current, stored: next }
      setStored(next)
      try {
        const res = await client.saveSettings(next, ref.current.revision)
        ref.current = { stored: { ...res.settings, [key]: value }, revision: res.revision }
      } catch (err) {
        if (!(err instanceof ConflictError)) {
          console.warn('Could not save the canvas display settings:', err)
          return
        }
        try {
          const fresh = await client.settings()
          const again = { ...fresh.settings, [key]: value }
          const res = await client.saveSettings(again, fresh.revision)
          ref.current = { stored: { ...res.settings, [key]: value }, revision: res.revision }
          setStored(ref.current.stored)
        } catch (err2) {
          console.warn('Could not save the canvas display settings:', err2)
        }
      }
    },
    [client],
  )

  const settings = useMemo(() => resolveSettings(stored), [stored])
  return { settings, loaded, set }
}
