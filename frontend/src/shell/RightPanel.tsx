import type { ReactNode } from 'react'

/** Toggleable right panel (~500px). Empty in M1. */
export function RightPanel({ open, children }: { open: boolean; children?: ReactNode }) {
  if (!open) return null
  return (
    <aside
      aria-label="Right panel"
      className="w-[500px] shrink-0 overflow-hidden pr-2 pb-2"
    >
      <div className="h-full overflow-auto rounded-xl border border-line/60 bg-panel">{children}</div>
    </aside>
  )
}
