// Device settings (`GET`/`PUT /api/settings`). `patch` applies at once and saves after the
// patches before it with the latest revision; on a 409 it reloads and re-applies the same
// patch once (M3's `useViewState` rule: never a blind overwrite).
import { create } from 'zustand'
import { api, ConflictError } from '@/api/client'
import type { DeviceSettings } from '@/api/types'
import { settingsDefaults } from './defaults'

export { settingsDefaults }

export interface SettingsState {
  /** The defaults until `load()` resolves. */
  settings: DeviceSettings
  revision: string
  loaded: boolean
  load(): Promise<void>
  patch(partial: Partial<DeviceSettings>): Promise<void>
}

function merged(s: Partial<DeviceSettings> | null | undefined): DeviceSettings {
  return { ...settingsDefaults, ...(s ?? {}) }
}

let queue: Promise<void> = Promise.resolve()
let loading: Promise<void> | null = null
/** Patches made while a load is in flight: its answer predates them, so they go back on top. */
let patchedDuringLoad: Partial<DeviceSettings> | null = null

export const useSettings = create<SettingsState>((set, get) => ({
  settings: settingsDefaults,
  revision: '',
  loaded: false,

  load() {
    // One request shared by everyone asking while it is in flight (App's start-up and the first
    // settings reader mount in the same tick).
    if (loading) return loading
    const mine: Partial<DeviceSettings> = (patchedDuringLoad ??= {})
    loading = api
      .settings()
      .then((res) => {
        set({ settings: { ...merged(res?.settings), ...mine }, revision: res?.revision ?? '', loaded: true })
      })
      .finally(() => {
        if (patchedDuringLoad === mine) patchedDuringLoad = null
        loading = null
      })
    return loading
  },

  patch(partial) {
    set({ settings: { ...get().settings, ...partial } })
    if (patchedDuringLoad) Object.assign(patchedDuringLoad, partial)
    const send = async () => {
      try {
        const res = await api.patchSettings(partial, { baseRevision: get().revision })
        set({ revision: res?.revision ?? get().revision, loaded: true })
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e
        const fresh = await api.settings()
        const freshRevision = fresh?.revision ?? ''
        set({ settings: { ...merged(fresh?.settings), ...partial }, revision: freshRevision, loaded: true })
        const res = await api.patchSettings(partial, { baseRevision: freshRevision })
        set({ revision: res?.revision ?? freshRevision })
      }
    }
    const done = queue.then(send)
    // A failed save must not block the ones after it; the caller still sees the error.
    queue = done.catch(() => undefined)
    return done
  },
}))
