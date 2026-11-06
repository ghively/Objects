// M18: the strings of the agent page's Memory, Skills and Learning tabs, their History lists, and
// the chat's Learning line. Ours unless marked as quoted from the spec
// (docs/superpowers/specs/2026-11-05-agents-design.md) or the plan
// (docs/superpowers/plans/2026-11-05-m18-learning.md).
import type { LedgerSource } from '@/api/types'

/** A number as the tabs show it: "2,200". */
export function count(n: number): string {
  return n.toLocaleString('en-US')
}

/** A date and time as the History rows and the curator line show them. */
export function learningDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export const LEARNING_TEXT = {
  // The row menu (spec section 2: "Memory & skills")
  memoryAndSkills: 'Memory & skills',

  // The tabs' labels (spec section 2)
  memoryTab: 'Memory',
  skillsTab: 'Skills',
  learningTab: 'Learning',

  // The Memory tab
  memory: 'Memory',
  memoryIntro: 'What it has learned about its work and environment',
  user: 'About you',
  userIntro: 'What it has learned about you',
  memoryPlaceholder: 'Nothing saved yet.',
  size: (chars: number, cap: number) => `${count(chars)} / ${count(cap)} characters`,
  overCap: "Over the cap: the agent can't add until it's shorter.",
  conflict: 'Changed elsewhere. Reload?', // M17's string
  reload: 'Reload',
  loading: 'Loading…',

  // History (`LedgerList`)
  history: 'History',
  historyEmpty: 'No changes yet.',
  undo: 'Undo',
  showMore: 'Show more',
  undoConflict: 'This changed again since. Undo the later change first.', // the route's 409 text
  source: (s: LedgerSource): string => {
    switch (s.kind) {
      case 'chat':
        return 'by the agent'
      case 'review':
        return 'by a review'
      case 'curator':
        return 'by the curator'
      case 'user':
        return 'by you'
      case 'undo':
        return 'by Undo'
      default:
        return ''
    }
  },

  // The Learning tab
  reviews: 'Reviews',
  reviewMemoryBefore: 'Review memory every',
  reviewMemoryAfter: 'messages',
  reviewSkillsBefore: 'Review skills every',
  reviewSkillsAfter: 'tool calls',
  reviewOff: '0 turns this review off',
  reviewModel: 'Review model',
  reviewModelDefault: 'Same as the chat',
  caps: 'Memory caps',
  memoryCapBefore: 'Memory',
  userCapBefore: 'About you',
  charactersAfter: 'characters',
  curator: 'Curator',
  curatorSwitch: 'Tidy skills while Object is idle',
  idleBefore: 'After',
  idleAfter: 'hours idle',
  everyBefore: 'At most every',
  everyAfter: 'days',
  consolidate: 'Also merge overlapping skills (uses Claude Code)',
  lastRun: (date: string) => `Last run: ${date}`,
  notRun: 'Not run yet',
  nextRun: (date: string) => `Next: when idle after ${date}`,
  reset: 'Reset to defaults',

  // The Skills tab (T10)
  skillName: 'Name',
  skillDescription: 'Description',
  skillState: 'State',
  skillPinned: 'Pinned',
  skillUses: 'Uses',
  skillLastUsed: 'Last used',
  skillMadeBy: 'Made by',
  never: 'Never',
  states: { active: 'Active', stale: 'Stale', archived: 'Archived' } as const,
  madeBy: { agent: 'Agent', user: 'You' } as const,
  showArchived: 'Show archived',
  filterSkills: 'Filter skills',
  newSkill: 'New skill',
  tidyUp: 'Tidy up now', // spec
  tidying: 'Tidying up…',
  lastTidy: (date: string) => `Last tidy-up, ${date}`,
  archive: 'Archive',
  restore: 'Restore',
  pin: 'Pin',
  unpin: 'Unpin',
  absorbedInto: (name: string) => `Absorbed into ${name}`,
  notText: "This file isn't text.",
  instructions: 'Instructions',
  descriptionCount: (n: number) => `${n}/60`,
  createSkill: 'Create skill',

  // The chat's Learning line and menu (T11)
  learning: 'Learning…', // spec
  nothingNew: 'Nothing new to learn',
  stopped: (message: string) => `Learning stopped: ${message}`,
  more: 'More',
  learnFromChat: 'Learn from this chat', // spec
} as const
