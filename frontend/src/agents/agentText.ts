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
