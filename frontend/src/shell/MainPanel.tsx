import type { ReactNode } from 'react'

/**
 * The inset content card: the only framed surface in the shell. The right
 * panel (`aside`), when open, lives inside the same card behind a 1px rule.
 */
export function MainPanel({ children, aside }: { children?: ReactNode; aside?: ReactNode }) {
  return (
    <main className="min-w-0 flex-1 overflow-hidden pr-2 pb-2">
      <div className="flex h-full overflow-hidden rounded-xl border border-chrome bg-panel">
        <div className="h-full min-w-0 flex-1 overflow-auto">{children}</div>
        {aside}
      </div>
    </main>
  )
}
