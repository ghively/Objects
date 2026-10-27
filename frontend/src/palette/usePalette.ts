/** The command palette's open state and mode (not persisted). */
import { create } from 'zustand'

export type PaletteMode = 'search' | 'actions'

export interface PaletteState {
  open: boolean
  mode: PaletteMode
  /** Open the palette in `mode`. */
  show(mode: PaletteMode): void
  hide(): void
  /** Close when open in `mode`, else open (or switch) to `mode`. */
  toggle(mode: PaletteMode): void
}

export const usePalette = create<PaletteState>()((set, get) => ({
  open: false,
  mode: 'search',
  show(mode) {
    set({ open: true, mode })
  },
  hide() {
    set({ open: false })
  },
  toggle(mode) {
    const s = get()
    if (s.open && s.mode === mode) set({ open: false })
    else set({ open: true, mode })
  },
}))
