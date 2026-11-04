/**
 * The canvas display settings (`ui.json` key `whiteboard`), with
 * the defaults filled in. Reading writes nothing; `set` writes once per toggle, through the one
 * `ui.json` save queue (`enqueueUiSave`, as the sidebar, the calendar and the graph), so it sends
 * the revision the save before it returned and no concurrent sidebar save meets a 409; on a 409
 * all the same it refetches and re-applies the toggle once (as M3's `useViewState`). Every landed
 * save moves the shared `useUiStore` revision forward (the server's `ui` event for it is our own
 * echo and is dropped).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConflictError } from '@/api/client'
import { whiteboardApi, type WhiteboardApi } from '@/api/whiteboardClient'
import type { WhiteboardSettings } from '@/api/whiteboardTypes'
import { enqueueUiSave, useUiStore } from '@/shell/usePinned'
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

/** A landed settings save: the shared `ui.json` state takes the new revision and value. */
function adoptUiRevision(settings: WhiteboardSettings, revision: string): void {
  const s = useUiStore.getState()
  useUiStore.setState({ ui: { ...s.ui, whiteboard: settings }, revision })
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
      await enqueueUiSave(async () => {
        try {
          // The queued `ui.json` saves keep the shared ui store's revision current; it is the fresher base.
          const ui = useUiStore.getState()
          const res = await client.saveSettings(next, ui.loaded && ui.revision ? ui.revision : ref.current.revision)
          ref.current = { stored: { ...res.settings, [key]: value }, revision: res.revision }
          adoptUiRevision(ref.current.stored, res.revision)
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
            adoptUiRevision(ref.current.stored, res.revision)
          } catch (err2) {
            console.warn('Could not save the canvas display settings:', err2)
          }
        }
      })
    },
    [client],
  )

  const settings = useMemo(() => resolveSettings(stored), [stored])
  return { settings, loaded, set }
}
