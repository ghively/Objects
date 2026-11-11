// The sidebar's "Help & Resources" section: its strings and its persisted fold. Everything it
// shows is bundled with the app (no remote page, no external link) and nothing is written into
// the space.

import { TASKS } from '@/lib/words'

export const HELP_TEXT = {
  section: 'Help & Resources',
  shortcuts: 'Keyboard shortcuts', // our string
  gettingStarted: 'Getting started', // our string
  markdownReference: 'Markdown reference', // our string
  guides: 'How-to guides', // our string
  guidesIntro: 'Short guides to Tasks and to four types you can add: People, Meetings, Projects and Books.', // our string (M32)
  allGuides: 'All guides', // our string
  show: 'Show Help & Resources', // our string
  hide: 'Hide Help & Resources', // our string
  close: 'Close',
} as const

export type HelpDoc = 'gettingStarted' | 'markdownReference' | 'guides'

/**
 * The how-to guides (decision D1): read-only Help pages bundled with the app. M32: "Tasks" leads
 * (the plain Tasks page, with a short section on the optional Work page; its id and file keep the
 * name they had as "The Tasks dashboard"), then one per type of the everyday set. They are never
 * seeded into a space as notes.
 */
export const GUIDES = [
  { id: 'tasksDashboard', title: TASKS },
  { id: 'people', title: 'People' },
  { id: 'meetings', title: 'Meetings' },
  { id: 'projects', title: 'Projects' },
  { id: 'books', title: 'Books' },
] as const

export type GuideId = (typeof GUIDES)[number]['id']

/** The fold of the section, kept per browser like the type rows' collection folds. */
export const HELP_COLLAPSED_KEY = 'object.sidebar.helpCollapsed'

export function readHelpCollapsed(): boolean {
  try {
    return localStorage.getItem(HELP_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function writeHelpCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(HELP_COLLAPSED_KEY, '1')
    else localStorage.removeItem(HELP_COLLAPSED_KEY)
  } catch {
    // storage can be blocked; the fold then lasts until reload
  }
}
