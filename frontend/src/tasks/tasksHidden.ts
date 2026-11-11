// M32: "Hide Tasks in this space" (Settings > Task management; `space.json` `hideTaskManagement`).
// While it is set the space shows no Tasks: no Tasks entry in the sidebar, the Tasks page gives
// way to one quiet line, Home leaves its Tasks block out, the palette offers no "Create Task", and
// the task keys (Ctrl+Shift+T, in a note and outside one) do nothing. It hides Tasks, not Work:
// with Work on, the Work entry, page, toasts, overlays and keys stay, and the dashboard leaves its
// own task lists out (M23's rule: `work/page/WorkPage.tsx`). Nothing is deleted: the Task type and the tasks already made stay, and turning the
// switch off brings everything back. Read from the same store as the rest of the space's config.
import { useSpaceInfo } from '@/settings/useSpaceInfo'

/** Whether the open space hides Tasks (re-renders when it changes). */
export function useTasksHidden(): boolean {
  return useSpaceInfo((s) => s.space?.hideTaskManagement ?? false)
}

/** The same answer outside a component (a key handler, a command list). */
export function isTasksHidden(): boolean {
  return useSpaceInfo.getState().space?.hideTaskManagement ?? false
}
