// Version control's words and small helpers (2026-11-08, "Version control and backup" in the
// behaviour catalog). Our strings: sentence case, as the rest of the app.
import { formatInZone } from '@/lib/zonedTime'
import { formattingLocale } from '@/properties/format'
import type { VcsStatus } from '@/api/vcsClient'

export const VCS_TEXT = {
  heading: 'Version control',
  description: 'Keep this space in a git repository: every change is saved as a version you can go back to.',
  enable: 'Turn on version control',
  enableHelp:
    'Object commits your changes after 2 quiet minutes, and when you switch spaces or quit. A folder that is already a git repository keeps its history.',
  enabled: 'Version control',
  enabledHelp: 'Turning it off stops the commits. The repository and its history stay in the folder.',
  gitMissing: 'Git is not installed',
  gitMissingHelp: 'Install git to keep versions of this space. Until then, version control stays off.',
  lastCommit: 'Last commit',
  noCommit: 'No commits yet',
  pending: (n: number) => (n === 1 ? '1 change waiting to be committed' : `${n} changes waiting to be committed`),
  upToDate: 'Everything is committed',
  commitNow: 'Commit now',
  openHistory: 'Space history',
  commitDelay: 'Commit after',
  commitDelayHelp: 'How long Object waits after the last change before it commits.',
  remote: 'Remote',
  remoteHelp:
    'A git remote to back up to: GitHub, GitLab or your own server (https://… or git@host:path). Object uses your git credentials; it never stores a password or token.',
  remotePlaceholder: 'https://github.com/you/notes.git',
  branch: 'Branch',
  branchPlaceholder: 'Current branch',
  saveRemote: 'Save remote',
  noRemote: 'No remote set',
  existingRemotes: 'This repository already has: ',
  autoPush: 'Push automatically',
  autoPushHelp: 'Push 10 minutes after a commit. Off: push only with Push now.',
  pushDelay: 'Push after',
  pushNow: 'Push now',
  fetchNow: 'Update from remote',
  lastPush: 'Last push',
  neverPushed: 'Not pushed yet',
  ahead: (n: number) => (n === 1 ? '1 commit to push' : `${n} commits to push`),
  behind: (n: number) => (n === 1 ? '1 new commit on the remote' : `${n} new commits on the remote`),
  inSync: 'In sync with the remote',
  diverged: (ahead: number, behind: number) =>
    `Remote has diverged: ${behind} commit${behind === 1 ? '' : 's'} there and ${ahead} here. Object never overwrites either side; merge them with git.`,
  ignoresObject: 'The .gitignore leaves out .object/, which holds this space’s types, trash and settings.',
  // "Offline & Sync" (General)
  backupHeading: 'Backup',
  backupAll: 'Back up all spaces',
  backupAllHelp: 'Turn on version control for every space on this device.',
  backupAllDone: (ok: number, failed: number) =>
    failed ? `Version control is on for ${ok} space${ok === 1 ? '' : 's'}; ${failed} couldn’t be turned on.` : `Version control is on for ${ok} space${ok === 1 ? '' : 's'}.`,
  backupState: 'Back up agents and settings',
  backupStateHelp:
    'Keep the agents, automations, device settings and the spaces list in their own git repository. Secrets and tokens are never included.',
  // the sidebar
  statusOff: '',
  statusSaved: (when: string) => `Backed up ${when}`,
  statusCommitted: (when: string) => `Saved ${when}`,
  statusError: 'Backup problem',
  statusPending: 'Changes waiting',
  // the history page
  historyTitle: 'Space history',
  historyDescription: 'Every version of this space. Pick one to see what changed.',
  historyOff: 'Version control is off for this space.',
  historyOffHelp: 'Turn it on in Settings > Version control to keep versions of the whole space.',
  historyEmpty: 'No versions yet',
  loadMore: 'Show older versions',
  filesChanged: (n: number) => (n === 1 ? '1 file changed' : `${n} files changed`),
  selectCommit: 'Select a version',
  selectCommitHelp: 'Pick a version on the left to see its changes.',
  binary: 'Binary file, not shown.',
  truncated: 'Cut short: the change is too long to show here.',
  restoreSpace: 'Restore space to this point',
  restoreConfirmTitle: 'Restore the whole space?',
  restoreConfirmDescription: (short: string, when: string) =>
    `Every file goes back to how it was at ${short} (${when}). Your changes so far are committed first, and the restore is a new version, so you can undo it.`,
  restoreConfirm: 'Restore',
  cancel: 'Cancel',
  restored: 'Space restored',
  nothingToRestore: 'The space already looks like this version.',
  // the object's Version History dialog
  gitVersions: 'In version control',
  gitVersion: (short: string) => `Commit ${short}`,
  gitRestoreDescription: (short: string) =>
    `Bring back the object as it was in ${short}? The current state is committed first, and the restore is a new version.`,
} as const

export function formatWhen(at: string | null | undefined): string {
  if (!at) return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  try {
    return formatInZone(d, { dateStyle: 'medium', timeStyle: 'short' }, formattingLocale())
  } catch {
    return d.toLocaleString()
  }
}

/** "just now", "5 min ago", "3 h ago", else the date. */
export function relativeWhen(at: string | null | undefined, now: number = Date.now()): string {
  if (!at) return ''
  const t = new Date(at).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return formatWhen(at)
}

/** The sidebar's one line for a repository's status; null when there is nothing to show. */
export function statusLine(s: VcsStatus | null, now: number = Date.now()): { text: string; tone: 'muted' | 'danger' } | null {
  if (!s || !s.gitAvailable || !s.enabled) return null
  if (s.error) return { text: VCS_TEXT.statusError, tone: 'danger' }
  if (s.remote?.diverged) return { text: VCS_TEXT.statusError, tone: 'danger' }
  if (s.remote?.lastPush && !s.remote.ahead) return { text: VCS_TEXT.statusSaved(relativeWhen(s.remote.lastPush, now)), tone: 'muted' }
  if (s.lastCommit) return { text: VCS_TEXT.statusCommitted(relativeWhen(s.lastCommit.at, now)), tone: 'muted' }
  if (s.pending) return { text: VCS_TEXT.statusPending, tone: 'muted' }
  return null
}

/** The first line of a commit message. */
export function subject(message: string): string {
  return message.split('\n')[0] ?? ''
}
