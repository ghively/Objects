// The sidebar's "Help & Resources" section: its strings and its persisted fold. Everything it
// shows is bundled with the app (no remote page, no external link) and nothing is written into
// the space.

export const HELP_TEXT = {
  section: 'Help & Resources',
  shortcuts: 'Keyboard shortcuts', // our string
  gettingStarted: 'Getting started', // our string
  markdownReference: 'Markdown reference', // our string
  show: 'Show Help & Resources', // our string
  hide: 'Hide Help & Resources', // our string
  close: 'Close',
} as const

export type HelpDoc = 'gettingStarted' | 'markdownReference'

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
