// M23 Task 16: the Work page's keys, listed in the Shortcuts sheet under "Work". Display-only
// (`bound: false`): `useWorkKeys` handles them while the Work page is mounted. The keys are the
// spec's (section 5, keyboard); the ids and names are ours. `g n` is a two-key sequence.
import { registerShortcuts, type ShortcutDef } from '@/lib/shortcuts'
import { WORK_TEXT } from '../workText'

/** How long `g` waits for the view key (ours). */
export const G_SEQUENCE_MS = 1500

const def = (id: string, name: string, keys: string[]): ShortcutDef => ({
  id,
  category: 'work',
  name,
  keys,
  scope: 'work',
  provisional: false,
  bound: false,
})

/** `g` then this key opens the view (the Work views table; Tickets has no key). */
const GO: [string, string, string][] = [
  ['workGoNow', WORK_TEXT.viewNow, 'n'],
  ['workGoFlow', WORK_TEXT.viewFlow, 'w'],
  ['workGoProjects', WORK_TEXT.viewProjects, 'p'],
  ['workGoToday', WORK_TEXT.viewToday, 't'],
  ['workGoFloor', WORK_TEXT.viewFloor, 'o'],
  ['workGoQueues', WORK_TEXT.viewQueues, 'q'],
  ['workGoAgent', WORK_TEXT.viewAgent, 'h'],
  ['workGoStuck', WORK_TEXT.viewStuck, 's'],
  ['workGoWins', WORK_TEXT.viewWins, 'y'],
  ['workGoAlerts', WORK_TEXT.viewAlerts, 'l'],
  ['workGoEverything', WORK_TEXT.viewEverything, 'e'],
]

export const WORK_SHORTCUTS: ShortcutDef[] = [
  def('workSearch', 'Search work', ['/']),
  def('workBrainDump', 'Brain dump', ['b']),
  ...GO.map(([id, label, key]) => def(id, `Go to ${label}`, [`g ${key}`])),
  def('workNextRow', 'Next row', ['j']),
  def('workPreviousRow', 'Previous row', ['k']),
  def('workOpen', 'Open', ['Enter']),
  def('workPeek', 'Peek', ['Space']),
  def('workPreviousItem', 'Previous item', ['[']),
  def('workNextItem', 'Next item', [']']),
  def('workClose', 'Close', ['Escape']),
  def('workShortcuts', 'Shortcuts', ['?']),
]

registerShortcuts(WORK_SHORTCUTS)
