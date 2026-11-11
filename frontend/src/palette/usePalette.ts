/**
 * The command palette's open state and mode (not persisted). Both modes show the same list,
 * content and actions together; the mode only tells which key opened it (Ctrl+K toggles).
 *
 * M32: `session` counts the openings. The search view is keyed on it, so every opening starts from
 * an empty query and no filters, also when the palette is reopened before its closing animation
 * has ended (the dialog's content was still mounted then, and showed the old query).
 */
import { create } from 'zustand'

export type PaletteMode = 'search' | 'actions'

export interface PaletteState {
  open: boolean
  mode: PaletteMode
  /** How many times the palette has been opened (a switch of mode while open is the same opening). */
  session: number
  /** Open the palette in `mode`. */
  show(mode: PaletteMode): void
  hide(): void
  /** Close when open in `mode`, else open (or switch) to `mode`. */
  toggle(mode: PaletteMode): void
}

export const usePalette = create<PaletteState>()((set, get) => ({
  open: false,
  mode: 'search',
  session: 0,
  show(mode) {
    const s = get()
    set({ open: true, mode, session: s.open ? s.session : s.session + 1 })
  },
  hide() {
    set({ open: false })
  },
  toggle(mode) {
    const s = get()
    if (s.open && s.mode === mode) set({ open: false })
    else set({ open: true, mode, session: s.open ? s.session : s.session + 1 })
  },
}))
