/** The search and action palette. Stub: Task 7 replaces it and keeps these props. */
import type { OpenOptions, Target } from '@/nav/tabs'

export interface CommandPaletteProps {
  onOpenTarget: (target: Target, opts?: OpenOptions) => void
  onToggleSidebar: () => void
  onToggleRightPanel: () => void
  onShowRightPanel: () => void
}

export function CommandPalette(_props: CommandPaletteProps) {
  return null
}
