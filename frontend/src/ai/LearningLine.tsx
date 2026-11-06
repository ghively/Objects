// M18: the chat's "Learning" line (spec sections 5 and 10): a small muted line after the reply a
// background review followed. Running: a spinner and "Learning…"; done: the summary as a button
// that opens the change on the agent page (the Memory tab when every change is a memory one, else
// the Skills tab) with its entries highlighted; "Nothing new to learn" is plain text; failed:
// "Learning stopped: {message}". Never a chat message: Copy and the saved AI Chat leave it out.
import type { ReviewStatus } from '@/api/types'
import { useLearningFocus } from '@/agents/learningFocus'
import { Icon } from '@/components/Icon'
import { useTabs } from '@/nav/tabs'

// "Learning…" is the spec's; the others are our strings (reviews.summary_text's "Nothing new to learn").
export const LEARNING_LINE_TEXT = {
  running: 'Learning…',
  nothing: 'Nothing new to learn',
  failed: (message: string) => `Learning stopped: ${message}`,
  failedNoMessage: 'Learning stopped.',
} as const

/**
 * Whether a done review changed only memory. Its summary (reviews.summary_text) names every kind
 * of change it made ("saved/changed n memories", "created/updated/archived n skills"), so a summary
 * without "skill" is memory-only; a review of the memory kind alone can change nothing else.
 */
export function memoryOnly(review: ReviewStatus): boolean {
  if (review.kinds.length > 0 && review.kinds.every((k) => k === 'memory')) return true
  return !!review.summary && /memor/i.test(review.summary) && !/skill/i.test(review.summary)
}

/** Highlight the review's entries and open the agent page on the tab that shows them. */
export function openReviewChange(review: ReviewStatus, agentId: string): void {
  useLearningFocus.getState().set(agentId, review.entryIds)
  useTabs.getState().open({ kind: 'agent', id: agentId, tab: memoryOnly(review) ? 'memory' : 'skills' })
}

export function LearningLine({ review, agentId }: { review: ReviewStatus; agentId: string }) {
  let body
  if (review.state === 'running') {
    body = (
      <span role="status" className="inline-flex items-center gap-1.5">
        <Icon name="ph-spinner-gap" size={12} className="animate-spin" />
        {LEARNING_LINE_TEXT.running}
      </span>
    )
  } else if (review.state === 'failed') {
    body = <span>{review.message ? LEARNING_LINE_TEXT.failed(review.message) : LEARNING_LINE_TEXT.failedNoMessage}</span>
  } else if (!review.summary || review.summary === LEARNING_LINE_TEXT.nothing || review.entryIds.length === 0) {
    body = <span>{review.summary || LEARNING_LINE_TEXT.nothing}</span>
  } else {
    body = (
      <button
        type="button"
        onClick={() => openReviewChange(review, agentId)}
        className="inline-flex items-center gap-1.5 rounded px-0.5 text-left hover:text-fg hover:underline"
      >
        <Icon name="ph-lightbulb" size={12} />
        {review.summary}
      </button>
    )
  }
  return (
    <div data-learning-line={review.id} data-state={review.state} className="text-xs text-fg-muted">
      {body}
    </div>
  )
}
