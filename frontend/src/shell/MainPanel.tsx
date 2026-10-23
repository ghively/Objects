import type { ReactNode } from 'react'

/** The inset content card: the only framed surface in the shell. */
export function MainPanel({ children }: { children?: ReactNode }) {
  return (
    <main className="min-w-0 flex-1 overflow-hidden pr-2 pb-2">
      <div className="h-full overflow-auto rounded-xl border border-line/60 bg-panel">{children}</div>
    </main>
  )
}
