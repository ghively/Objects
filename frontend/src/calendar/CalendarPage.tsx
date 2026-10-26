import type { Target } from '@/nav/tabs'

export interface CalendarPageProps {
  /** App's right panel state (the mini month lives there). */
  rightPanelOpen: boolean
  onToggleRightPanel: () => void
  onOpenTarget: (t: Target) => void
}

/** Stub (M4 Task 7); Task 12 replaces this file with the Calendar page. */
export function CalendarPage(_props: CalendarPageProps) {
  return <div className="p-8 text-fg-muted">Loading results…</div>
}
