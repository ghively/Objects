// M19: every string of Settings > Integrations > MCP servers, the secret variables, the Set
// dialog and the agent page's server tool groups, shared by both front-end lanes. All are our
// strings, from the plan's "Labels" (docs/superpowers/plans/2026-11-05-m19-mcp-gateway.md).
import type { SecretVarUse } from '@/api/types'

export const MCP_TEXT = {
  // Settings > Integrations: the group
  heading: 'MCP servers',
  help: 'Outside MCP servers every agent on this computer can use. Each agent can switch them, or single tools, off on its Tools tab.',
  empty: 'No MCP servers yet.',
  add: 'Add MCP server',
  unreadable: "The MCP servers file can't be read.",
  newerVersion: 'These MCP servers were saved by a newer version of Object.',

  // A server's row
  enabled: 'Turned on',
  httpSummary: 'HTTP',
  sseSummary: 'SSE',
  urlSummary: (url: string, transport: 'http' | 'sse') => `${url} · ${transport === 'sse' ? 'SSE' : 'HTTP'}`,
  toolCount: (n: number) => `${n} ${n === 1 ? 'tool' : 'tools'}`,
  testFailed: (error: string) => `Test failed: ${error}`,
  test: 'Test',
  edit: 'Edit',
  delete: 'Delete',
  confirmDelete: 'Confirm delete',
  deleteHelp: 'Agents lose this server at once. Its secrets are deleted.',

  // The dialog
  addTitle: 'Add MCP server',
  editTitle: 'Edit MCP server',
  name: 'Name',
  nameFixed: "A server's name can't be changed.",
  connectBy: 'Connect by',
  byCommand: 'Command',
  byUrl: 'URL',
  command: 'Command',
  arguments: 'Arguments',
  argumentsHint: 'One per line',
  environment: 'Environment',
  rowName: 'Name',
  rowValue: 'Value',
  secret: 'Secret',
  addRow: 'Add',
  removeRow: 'Remove',
  url: 'URL',
  transport: 'Transport',
  transportHttp: 'HTTP',
  transportSse: 'SSE',
  headers: 'Headers',
  bearer: 'Bearer token',
  turnedOn: 'Turned on',
  savedSecret: '•••••• saved',
  replace: 'Replace',
  remove: 'Remove',
  cancel: 'Cancel',
  save: 'Save',

  // The Test result
  tools: (n: number) => `Tools (${n})`,
  testing: 'Testing…',

  // Secret variables
  secretVariables: 'Secret variables',
  secretVariablesHelp: "Values for ${NAME} in agent folders' .mcp.json files, kept on this computer only.",
  varSet: 'Set',
  varMissing: 'Missing',
  usedBy: (uses: SecretVarUse[]) => `Used by ${uses.map((u) => `${u.agentName} (${u.server})`).join(', ')}`,
  setVar: 'Set…',
  replaceVar: 'Replace…',
  deleteVar: 'Delete',
  deleteVarHelp: 'Agents that use this variable lose its value at once. This cannot be undone.',
  fromEnvironment: "Comes from this computer's environment",

  // The Set dialog
  setTitle: (name: string) => `Set ${name}`,
  value: 'Value',

  // The agent page
  needsSecrets: (names: string[]) => `Needs secrets: ${names.join(', ')}`,
  listing: 'Listing tools…',
  listFailed: (error: string) => `Couldn't list tools: ${error}`,
  turnedOffInSettings: 'Turned off in Settings > Integrations',
  noTools: 'No tools',
} as const
