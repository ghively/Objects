// "Automations" (M14, our section): the space's automation rules, each with a switch, its last run
// and its run log, plus "New automation" (the rule editor). Every string here is ours.
//
// T1 stub: the heading and description only. Lane U builds the list, the run log and the editor
// (contract "Settings > Automations" in docs/superpowers/plans/2026-11-05-m14-automations.md).
import { SectionHeader } from '../controls'

export const AUTOMATIONS_TEXT = {
  heading: 'Automations', // our string
  description: 'Rules that edit your objects for you, on this computer.', // our string
  create: 'New automation', // our string
  empty: 'No automations yet', // our string
  log: 'Run log', // our string
} as const

const T = AUTOMATIONS_TEXT

export const AUTOMATIONS_SEARCH: string[] = [T.create, T.log, 'Repeat']

export function AutomationsSection() {
  return (
    <div>
      <SectionHeader icon="ph-lightning" heading={T.heading} description={T.description} />
    </div>
  )
}
