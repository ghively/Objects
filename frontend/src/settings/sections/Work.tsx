// "Work" (M22, our section; Space group, after Automations): "Your name in Activity" (a device
// setting) and "Jira site" (a space setting). Task 1's stub renders the heading only; Task 12 adds
// the two rows, M23 its alert rows after them and M24 its work agent group after those.
import { SectionHeader } from '../controls'

export const WORK_TEXT = {
  heading: 'Work', // our string
  description: '', // our string (Task 12)
  yourName: 'Your name in Activity', // our string
  jiraSite: 'Jira site', // our string
  jiraSitePlaceholder: 'https://example.atlassian.net', // our string
} as const

const T = WORK_TEXT

export const WORK_SEARCH: string[] = [T.yourName, T.jiraSite]

export function WorkSection() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader icon="ph-briefcase" heading={T.heading} description={T.description} />
    </div>
  )
}
