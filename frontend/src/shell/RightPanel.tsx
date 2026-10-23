import type { ReactNode } from 'react'

/** Toggleable right panel (~500px), inside the main card behind a 1px rule. Empty in M1. */
export function RightPanel({ open, children }: { open: boolean; children?: ReactNode }) {
  if (!open) return null
  return (
    <aside
      aria-label="Right panel"
      className="h-full w-[500px] shrink-0 overflow-auto border-l border-line bg-panel"
    >
      {children}
    </aside>
  )
}
