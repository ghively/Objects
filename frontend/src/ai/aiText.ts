/**
 * M10: the AI chat's strings. The catalog names only the entry points ("AI Chat", "Relevant
 * Content", "Find More", the shortcut names); everything else here is ours ("our string").
 */
import type { AiMode, AiSkipped } from '@/api/types'

/** Why a context page was left out of a turn (our strings). */
export const SKIP_REASONS: Record<AiSkipped['reason'], string> = {
  excluded: 'excluded from AI',
  template: 'template',
  missing: 'not found',
  tooLong: 'too long',
}

export const AI_CHAT_TEXT = {
  /** The side-panel entry's title and the Explore card (catalog). */
  title: 'AI Chat',
  exploreCardHelp: 'Ask about your notes with Claude Code.', // our string
  newChat: 'New chat', // our string
  modelForChat: 'Model for this chat', // our string (M16)
  defaultModel: 'Default', // our string (M16)
  defaultModelOf: (label: string) => `Default (${label})`, // our string (M16)
  context: 'Context', // our string
  addContext: 'Add a note to the context', // our string
  pickPage: 'Find a note', // our string
  noPages: 'No results',
  removeContext: (title: string) => `Remove ${title} from the context`, // our string
  block: 'Block', // our string
  removeBlock: 'Remove the block from the context', // our string
  inputLabel: 'Message', // our string
  placeholder: 'Ask about your notes…', // our string
  send: 'Send', // our string
  stop: 'Stop', // our string
  thinking: 'Thinking…', // our string
  stopped: 'Stopped.', // our string
  emptyAnswer: 'No answer came back.', // our string
  empty: 'Ask a question about the notes in the context, or about anything in your space.', // our string
  you: 'You', // our string
  assistant: 'Claude', // our string
  // per-message actions (the shortcut names from catalog section 2 where it has them)
  copy: 'Copy message',
  copied: 'Copied', // our string
  appendToPage: 'Append to note', // our string
  appendToPageNone: 'Add a note to the context to append to it.', // our string
  appended: 'Appended to the note', // our string
  appendToDailyNote: 'Append to daily note', // our string
  retry: 'Retry',
  rephrase: 'Rephrase',
  replace: 'Replace', // our string
  insertBelow: 'Insert below', // our string
  // proposals
  proposedTags: 'Suggested tags', // our string
  proposedProperties: 'Suggested properties', // our string
  proposedText: 'Suggested text', // our string
  property: 'Property', // our string
  value: 'Value', // our string
  accept: 'Accept', // our string
  dismiss: 'Dismiss', // our string
  accepted: 'Added', // our string
  noTarget: 'Add a note to the context first.', // our string
  /** Our string: the pages left out of a turn, each with its reason. */
  skipped: (pages: { title: string; reason: AiSkipped['reason'] }[]) =>
    `Left out: ${pages.map((p) => `${p.title} (${SKIP_REASONS[p.reason] ?? p.reason})`).join(', ')}`,
  /** Our string: a save that found the chat changed in another window or on disk. */
  changedElsewhere: 'This chat was changed elsewhere. Start a new chat to continue.',
  // status
  notFound: 'Claude Code not found',
  notFoundHelp: 'Install Claude Code and sign in, or set its path in Settings > AI Assistant.',
  notSignedIn: 'Claude Code is not signed in.', // our string
  openSettings: 'Open AI settings', // our string
  checking: 'Looking for Claude Code…', // our string
  notice:
    'AI Chat sends the notes in its context, and anything it reads with Object\'s search tools, to Anthropic through your Claude Code. Notes tagged "Exclude from AI" are never sent.',
  ok: 'OK',
  saveFailed: (why: string) => `Could not save this chat: ${why}`, // our string
  // Relevant Content (catalog)
  relevant: 'Relevant Content',
  findMore: 'Find More',
  relevantNone: 'Open a note to see content related to it.', // our string
  relevantEmpty: 'Nothing related found yet.', // our string
} as const

/** M20: a chat with a remote (A2A) agent: the context notice and the attachment chips (our strings). */
export const REMOTE_CHAT_TEXT = {
  noticeTitle: 'This leaves your computer',
  noticeBody: (name: string, host: string) =>
    `${name} is a remote agent. The context notes you send go to ${host}, outside this computer. Notes excluded from AI are never sent.`,
  noticeSend: 'Send',
  noticeCancel: 'Cancel',
  attachments: 'Attachments',
  showInFolder: 'Show in folder',
  revealFailed: (why: string) => `Could not show the file: ${why}`,
} as const

/** What the user bubble says for a request sent without words (our strings, catalog names where it has them). */
export const MODE_LABELS: Record<AiMode, string> = {
  chat: '',
  askBlock: 'Ask AI about this block',
  tagBlock: 'Let AI suggest tags for this block',
  tagObject: 'Add tags using AI',
  autofill: 'Fill empty properties using AI', // our string
  rephrase: 'Rephrase',
}

/** A friendly line for a tool the assistant used (our strings; Object's MCP read tools by short name). */
export function toolLine(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('search') || n.includes('grep') || n.includes('glob')) return 'Searching your notes…'
  if (n.includes('query') || n.includes('list') || n.includes('rows')) return 'Looking through your notes…'
  if (n.includes('read') || n.includes('get') || n.includes('object') || n.includes('page')) return 'Reading your notes…'
  if (n.includes('backlink') || n.includes('reference') || n.includes('graph')) return 'Following links…'
  return `Using ${name}…`
}
