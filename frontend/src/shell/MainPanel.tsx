import type { ReactNode } from 'react'

/**
 * The inset content card: the only framed surface in the shell. The side
 * panel (`aside`, `shell/SidePanel.tsx`), when shown, lives inside the same
 * card behind a 1px rule, as a share of the card's width (Object's `sidepanelWidth`); the main
 * column takes the rest and has no minimum width of its own (none in the reference).
 */
export function MainPanel({ children, aside }: { children?: ReactNode; aside?: ReactNode }) {
  return (
    <main className="min-w-0 flex-1 overflow-hidden pr-2 pb-2">
      <div className="flex h-full overflow-hidden rounded-xl border border-chrome bg-panel">
        <div data-main-column="" className="h-full flex-1 overflow-auto">
          {children}
        </div>
        {aside}
      </div>
    </main>
  )
}
