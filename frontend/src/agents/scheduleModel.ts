// M21: an agent's schedules on the client (spec section 9). A schedule is an M14 rule with a
// `schedule` trigger and one `runAgent` action; the agent page's Schedules tab and the schedule
// dialog read and write it through M14's routes. Every string here is ours.
import type { AutomationRule, ScheduleTrigger } from '@/api/types'

export const SCHEDULE_TEXT = {
  tab: 'Schedules',
  heading: (space: string) =>
    `Prompts this agent runs on a schedule in “${space}”, while that space is open. Each run is saved as an AI Chat.`,
  create: 'New schedule',
  empty: 'No schedules yet.',
  list: 'Schedules',
  edit: 'Edit',
  log: 'Run log',
  runNow: 'Run now',
  running: (name: string) => `${name} is running now.`,
  off: 'Off',
  remove: 'Delete',
  menu: 'Schedule menu',
  enabled: 'Turned on',
  newTitle: 'New schedule',
  editTitle: 'Edit schedule',
  name: 'Name',
  prompt: 'Prompt',
  promptPlaceholder: (agent: string) => `What should ${agent} do each time? {date:YYYY-MM-DD} becomes the run's date.`,
  when: 'When',
  model: 'Model',
  defaultModel: (model: string) => `Agent's default (${model})`,
  cliDefault: 'CLI default',
  turnedOn: 'Turned on',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  needPrompt: 'A schedule needs a prompt.',
  conflict: 'This schedule was changed elsewhere. Save again to keep your version.',
} as const

export interface ScheduleFieldValues {
  name: string
  prompt: string
  trigger: ScheduleTrigger
  model: string | null
  enabled: boolean
}

/** The dialog's fields from an agent schedule (its one `runAgent` action and its schedule trigger). */
export function scheduleFieldsOf(rule: AutomationRule): ScheduleFieldValues {
  const action = rule.actions[0]
  const run = action?.kind === 'runAgent' ? action : null
  return {
    name: rule.name,
    prompt: run?.prompt ?? '',
    trigger: rule.trigger as ScheduleTrigger,
    model: run?.model ?? null,
    enabled: rule.enabled,
  }
}
