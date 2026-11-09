// M15: the import dialog's open state and what it opens with. One store, so "Create new space" >
// "Import from…" and Settings > "Import Content" open the same dialog, mounted in `GlobalOverlays`.
import { create } from 'zustand'
import type { ImportSourceKind } from '@/api/types'

export interface ImportDialogPreset {
  /** The reader to use; `auto` (the default) detects it. */
  kind?: ImportSourceKind | 'auto'
  /** The new space's name and location, carried over from "Create new space". */
  name?: string
  location?: string
  /** Reopen the agent workflow (Proposed schema, Trial, Normalise, Import inbox) for this batch of the open space. */
  reviewBatch?: string
}

export interface ImportDialogState {
  isOpen: boolean
  preset: ImportDialogPreset
  open(preset?: ImportDialogPreset): void
  close(): void
}

export const useImportDialog = create<ImportDialogState>()((set) => ({
  isOpen: false,
  preset: {},
  open: (preset = {}) => set({ isOpen: true, preset }),
  close: () => set({ isOpen: false }),
}))

/** Back to closed (tests). */
export function resetImportDialog(): void {
  useImportDialog.setState({ isOpen: false, preset: {} })
}
