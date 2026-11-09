// The agent workflow's strings (M27; design sections 8, 9 and 10). Our strings: the behaviour catalog has no import wizard.
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export const AGENT_TEXT = {
  // Entry from the finish step.
  continueHeading: 'Next: organise with an agent',
  continueIntro:
    'An agent can propose types and properties for what was imported. You review the proposal, try it on 50 objects, and nothing is applied without your say.',
  continueButton: 'Review proposed schema',
  // A trial copy: the batch lives in the copy, so the review opens there after the switch.
  continueCopyIntro: 'The proposal belongs to the copy. Switch to it to review the proposed schema, try it on 50 objects and see the Import inbox.',
  continueCopyButton: 'Switch and review proposed schema',
  skip: 'Skip',

  // Proposed schema.
  proposalHeading: 'Proposed schema',
  proposalIntro: 'Accept, edit or turn down each item. Apply creates and edits the types, and only you can do it here.',
  loading: 'Loading…',
  refresh: 'Check again',
  noProposal: 'No proposal yet. An agent writes it into this import; check again when it has.',
  actions: { use: 'Use existing type', extend: 'Extend existing type', create: 'Create type' },
  documents: (n: number) => pl(n, 'document', 'documents'),
  examples: 'Examples',
  propertiesHeading: 'Properties',
  fillRate: (pct: number) => `${pct}% have a value`,
  optionsLabel: 'Options',
  mergedLabel: (to: string, from: string[]) => `${from.join(', ')} merged into ${to}`,
  relationTo: (t: string) => `Relation to ${t}`,
  accept: 'Accept',
  edit: 'Edit',
  reject: 'Turn down',
  status: { undecided: 'Not decided', accepted: 'Accepted', edited: 'Edited', rejected: 'Turned down' },
  nameLabel: 'Name',
  pluralLabel: 'Plural name',
  keepProperty: (name: string) => `Keep ${name}`,
  undecidedCount: (n: number) => `${pl(n, 'item', 'items')} still to decide`,
  apply: 'Apply',
  applying: 'Applying…',
  applied: (created: number, extended: number) => `${pl(created, 'type', 'types')} created, ${pl(extended, 'type', 'types')} extended.`,
  itemLabel: (name: string) => `Proposal item ${name}`,

  // Trial.
  trialHeading: 'Trial on the first 50 objects',
  trialIntro: 'Mark each result right or wrong. The rest starts only when you continue.',
  startTrial: 'Start trial',
  starting: 'Starting…',
  trialRunning: 'The agent is reading the first objects…',
  failed: 'The agent run failed. Nothing more was applied.',
  confidence: { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' },
  quote: 'Quote',
  valueRejected: 'Did not pass the check',
  right: 'Right',
  wrong: 'Wrong',
  markLabel: (verb: string, title: string) => `${verb}: ${title}`,
  accuracy: (right: number, marked: number, pct: number) => `${right} of ${marked} marked right (${pct}%)`,
  noMarks: 'Nothing marked yet',
  continueRest: 'Continue with the rest',
  continuing: 'Filing the rest…',
  noTrialItems: 'The trial has no results yet.',

  // Normalise.
  normaliseHeading: 'Normalise tags and options',
  normaliseIntro: 'These look like the same thing. Merge the ones that are.',
  normaliseNone: 'Nothing looks like a duplicate.',
  kinds: { tag: 'Tag', option: 'Option' },
  mergeInto: 'Merge into',
  mergeLabel: (values: string[]) => `Merge ${values.join(', ')}`,
  mergeCount: (n: number) => `Merge ${pl(n, 'group', 'groups')}`,
  merging: 'Merging…',
  next: 'Continue',

  // Done.
  doneHeading: 'Import inbox',
  inboxCount: (n: number) => `${pl(n, 'object', 'objects')} in the Import inbox for you to look at.`,
  inboxEmpty: 'The Import inbox is empty.',
  openInbox: 'Open Import inbox',
  inboxName: 'Import inbox',
  close: 'Close',
  error: (m: string) => m,
} as const
