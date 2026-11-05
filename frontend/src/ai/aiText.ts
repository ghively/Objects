/**
 * M10: the AI chat's strings. The catalog names only the entry points ("AI Chat", "Relevant
 * Content", "Find More", the shortcut names); everything else here is ours ("our string").
 */
import type { AiMode } from '@/api/types'

export const AI_CHAT_TEXT = {
  /** The side-panel entry's title and the Explore card (catalog). */
  title: 'AI Chat',
  exploreCardHelp: 'Ask about your pages with Claude Code.', // our string
  newChat: 'New chat', // our string
  context: 'Context', // our string
  addContext: 'Add a page to the context', // our string
  pickPage: 'Find a page', // our string
  noPages: 'No results',
  removeContext: (title: string) => `Remove ${title} from the context`, // our string
  block: 'Block', // our string
  removeBlock: 'Remove the block from the context', // our string
  inputLabel: 'Message', // our string
  placeholder: 'Ask about your pages…', // our string
  send: 'Send', // our string
  stop: 'Stop', // our string
  thinking: 'Thinking…', // our string
  usedTools: 'Used:', // our string
  stopped: 'Stopped.', // our string
  emptyAnswer: 'No answer came back.', // our string
  empty: 'Ask a question about the pages in the context, or about anything in your space.', // our string
  you: 'You', // our string
  assistant: 'Claude', // our string
  // per-message actions (the shortcut names from catalog section 2 where it has them)
  copy: 'Copy message',
  copied: 'Copied', // our string
  appendToPage: 'Append to page', // our string
  appendToPageNone: 'Add a page to the context to append to it.', // our string
  appended: 'Appended to the page', // our string
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
  noTarget: 'Add a page to the context first.', // our string
  skipped: (titles: string[]) => `Left out (Exclude from AI): ${titles.join(', ')}`,
  // status
  notFound: 'Claude Code not found',
  notFoundHelp: 'Install Claude Code and sign in, or set its path in Settings > AI Assistant.',
  notSignedIn: 'Claude Code is not signed in.', // our string
  openSettings: 'Open AI settings', // our string
  checking: 'Looking for Claude Code…', // our string
  notice:
    'AI Chat sends the pages in its context, and anything it reads with Object\'s search tools, to Anthropic through your Claude Code. Pages tagged "Exclude from AI" are never sent.',
  ok: 'OK',
  saveFailed: (why: string) => `Could not save this chat: ${why}`, // our string
  // Relevant Content (catalog)
  relevant: 'Relevant Content',
  findMore: 'Find More',
  relevantNone: 'Open a page to see content related to it.', // our string
  relevantEmpty: 'Nothing related found yet.', // our string
} as const

/** What the user bubble says for a request sent without words (our strings, catalog names where it has them). */
export const MODE_LABELS: Record<AiMode, string> = {
  chat: '',
  askBlock: 'Ask AI about this block',
  tagBlock: 'Add tags to block using AI',
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
