// M32: what a `tasks` or `work` target shows while the space hides Tasks ("Hide Tasks in this
// space"): one quiet line and the way back to the setting. A tab restored on Tasks, a pinned link
// or an old route lands here instead of on a page the user turned off, and says why.
import { useSettingsModal } from '@/settings/useSettingsModal'

export const TASKS_HIDDEN_TEXT = {
  line: 'Tasks are hidden in this space.', // our string
  settings: 'Open Task management settings', // our string
} as const

export function TasksHidden() {
  return (
    <div data-tasks-hidden="" className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-[15px] text-fg-muted">{TASKS_HIDDEN_TEXT.line}</p>
      <button
        type="button"
        className="rounded px-2 py-1 text-[14px] text-fg underline-offset-2 hover:bg-hover hover:underline"
        onClick={() => useSettingsModal.getState().open('taskManagement')}
      >
        {TASKS_HIDDEN_TEXT.settings}
      </button>
    </div>
  )
}
