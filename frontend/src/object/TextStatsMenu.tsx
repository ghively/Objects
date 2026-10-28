/**
 * The `…` menu's "Text Stats" submenu (M9, `EntityMenu.textStats.text`): titled "Text stats"
 * (`xRay.textStats.header`), with the same rows as the page inspector's Stats tab, counted on
 * the page's current Markdown when the submenu opens.
 */
import type { ObjectSummary } from '@/api/types'
import { TextStatsRows } from './PageInspector'
import { plainText, statRows, TEXT_STATS_TEXT, textStats } from './textStats'

export interface TextStatsMenuProps {
  getMarkdown(): string
  summary: ObjectSummary
  dailyNote: boolean
}

export function TextStatsMenu({ getMarkdown, summary, dailyNote }: TextStatsMenuProps) {
  const rows = statRows(textStats(plainText(getMarkdown())), summary, { dailyNote })
  return (
    <div data-testid="text-stats-menu" className="w-[220px] py-1 text-[13px]">
      <p className="px-2 pb-1 font-medium">{TEXT_STATS_TEXT.header}</p>
      <TextStatsRows rows={rows} />
    </div>
  )
}
