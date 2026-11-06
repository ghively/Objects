// M17: the Agents section's, the New agent dialog's and the tool switches' strings. Ours unless
// marked as quoted from the spec (docs/superpowers/specs/2026-11-05-agents-design.md).

export const AGENT_TEXT = {
  // The sidebar section
  heading: 'Agents',
  addMenu: 'Add an agent',
  newAgent: 'New agent',
  addFolder: 'Add agent folder…',
  deletedAgents: 'Deleted agents…',
  newAgentRow: 'New agent',
  rowMenu: (name: string) => `${name} actions`,
  openChat: 'Open chat',
  settings: 'Settings',
  duplicate: 'Duplicate',
  delete: 'Delete',
  leftInPlace: 'Removed from the list. Its folder was left where it is.',
  missingFolder: 'Folder missing',

  // The New agent dialog
  newTitle: 'New agent',
  newIntro: 'An agent is a folder with its own instructions, tools and chats.',
  startFrom: 'Start from',
  blank: 'Blank',
  duplicateOf: 'Duplicate of…',
  duplicateSource: 'Agent to duplicate',
  copyMemory: 'Copy memory',
  copySkills: 'Copy skills',
  copiedInstructions: (name: string) => `The instructions are copied from ${name}.`,
  copyName: (name: string) => `${name} copy`,
  name: 'Name',
  icon: 'Icon',
  description: 'Description',
  instructions: 'Instructions',
  instructionsPlaceholder: 'Who this agent is and how it should work.',
  model: 'Model',
  defaultModel: 'Default',
  tools: 'Tools',
  folder: 'Folder',
  inStateDir: "Inside Object's agents folder",
  chooseFolder: 'Choose a folder',
  folderPath: 'Folder path',
  cancel: 'Cancel',
  create: 'Create agent',

  // Add agent folder
  addFolderTitle: 'Add agent folder',
  addFolderIntro: 'Lists an agent folder that is already on this computer. Nothing in the folder is changed.',
  addFolderButton: 'Add folder',

  // Deleted agents
  trashTitle: 'Deleted agents',
  trashIntro: "Deleted agents' folders are kept here until you restore them.",
  trashEmpty: 'No deleted agents.',
  restore: 'Restore',
  close: 'Close',

  // The tool switches
  shellWarning: 'With the shell on, this agent can read every file on this computer, including pages excluded from AI.', // spec, verbatim
  turnOnTitle: 'Turn on the shell?',
  turnOn: 'Turn on',
  groupSwitch: (label: string) => `All of ${label}`,
} as const

// M20: remote agents (docs/superpowers/plans/2026-11-05-m20-a2a-and-delegation.md, Task 7). Our
// strings, except the "remote" mark (spec section 2: a small "remote" mark).
export const REMOTE_TEXT = {
  // The mark
  mark: 'remote',
  markLabel: 'Remote agent',

  // The sidebar section
  addRemote: 'Add remote agent…',

  // The Add remote agent dialog
  addTitle: 'Add remote agent',
  addIntro: 'Adds an agent that runs elsewhere and speaks A2A, by its Agent Card URL.',
  url: 'Agent Card URL or address',
  urlPlaceholder: 'https://agents.example.com',
  authentication: 'Authentication',
  authNone: 'None',
  authBearer: 'Bearer token',
  authHeader: 'Header',
  headerName: 'Header name',
  token: 'Token',
  value: 'Value',
  lookUp: 'Look up',
  lookingUp: 'Looking up…',
  name: 'Name',
  skills: 'Skills',
  sendsTo: (host: string) => `Sends messages to ${host}`,
  streaming: 'Streaming',
  noStreaming: 'No streaming',
  addButton: 'Add agent',
  cancel: 'Cancel',

  // The Profile tab
  icon: 'Icon',
  agentCard: 'Agent Card',
  cardUrl: 'Card URL',
  refreshCard: 'Refresh card',
  protocol: (version: string) => `A2A ${version}`,
  authNoneSet: 'None',
  authBearerSet: 'Bearer token: set',
  authHeaderSet: (name: string) => `Header ${name}: set`,
  authNeeded: 'Token: needed',
  replaceToken: 'Replace token…',
  save: 'Save',
  contextSent: 'Context sent',
  notYet: 'Not yet',
  firstSent: (date: string) => `First sent ${date}`,
  folder: 'Folder',
  openFolder: 'Open folder',
  removeFromList: 'Remove from list',
  removed: 'Removed from the list. Its folder was left where it is.',
  conflict: 'This agent was changed elsewhere. Its latest settings are shown: apply your change again.',
  refreshed: 'The card was fetched again.',

  // The Card tab
  description: 'Description',
  provider: 'Provider',
  version: 'Version',
  documentation: 'Documentation',
  inputModes: 'Input modes',
  outputModes: 'Output modes',
  tags: 'Tags',
  examples: 'Examples',
  noSkills: 'This card lists no skills.',
  cardFetched: (date: string) => `Card fetched ${date}`,

  // The Chats tab
  delegatedBy: (name: string) => `Delegated by ${name}`,
  delegatedByUnknown: 'Delegated by another agent',
} as const
