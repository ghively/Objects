// M24 Task 9: Settings > Work's work agent group. Strings are ours unless marked (spec).
import { AGENT_TEXT } from '@/agents/agentText'

export const WORK_AGENT_TEXT = {
  group: 'Work agent',
  picker: 'Work agent',
  none: 'None',
  create: 'Create the Work agent',
  dialogTitle: 'Create the Work agent',
  dialogText: 'Object makes a local agent named Work with the work-follow-through skill. Its shell is on, so approved changes can run.',
  shellWarning: AGENT_TEXT.shellWarning,
  copyReviewer: "Copy your change-reviewer into the Work agent's folder",
  copyReviewerHint: "The copy is the agent's own from then on.",
  cancel: 'Cancel',
  confirm: 'Create',
  acts: 'Agent acts on my approvals', // spec
  actsHelp: 'Off: entries wait in the Agent queue.',
  autoRun: 'Agent runs by itself', // catalog §10b
  autoRunHelp: 'Agent steps run by themselves when they become current, once per step text.',
  readTools: 'Read tools',
  readToolsHelp: 'Read-only runs (Agent steps, brain dumps, Desk sync) can use only the tools you mark here.',
  serverReadOnly: 'Server says read-only',
  markReadOnly: 'Mark the ones the server calls read-only',
  notListed: "Open the Work agent's Tools tab to list its tools.",
  noServers: 'No tool servers yet.',
  deskSync: 'Desk sync',
  setUpDeskSync: 'Set up Desk sync',
  deskSyncHelp: 'Reads Jira (and ServiceNow, once an MCP server for it exists) each weekday at 07:00 and updates ticket fields. Never writes to the desk.',
  deskSyncTime: 'Desk sync time',
  lastRun: 'Last run',
  neverRun: 'Not run yet',
  noReadTools: 'No read tools marked yet',
  changedElsewhere: 'The Work agent settings changed. Look again.',
} as const
