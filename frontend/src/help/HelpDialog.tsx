// A bundled help text (the getting-started guide, the Markdown reference or a how-to guide), shown
// read-only in a dialog with the page editor's own rendering. The text ships with the app: nothing is
// fetched and nothing is written into the space. Loaded on demand from the sidebar's Help section.
import { useState } from 'react'
import { Icon } from '@/components/Icon'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { MarkdownPreview } from '@/editor/code/MarkdownPreview'
import { GUIDES, HELP_TEXT, type GuideId, type HelpDoc } from './helpText'
import gettingStarted from './getting-started.md?raw'
import markdownReference from './markdown-reference.md?raw'
import books from './guides/books.md?raw'
import meetings from './guides/meetings.md?raw'
import people from './guides/people.md?raw'
import projects from './guides/projects.md?raw'
import tasksDashboard from './guides/tasks-dashboard.md?raw'

export const HELP_DOCS: Record<Exclude<HelpDoc, 'guides'>, string> = { gettingStarted, markdownReference }

export const GUIDE_DOCS: Record<GuideId, string> = { people, meetings, projects, books, tasksDashboard }

/** The guides' list, then the one picked, with a way back to the list. */
function Guides() {
  const [guide, setGuide] = useState<GuideId | null>(null)
  if (guide)
    return (
      <div data-guide={guide}>
        <button
          type="button"
          onClick={() => setGuide(null)}
          className="mb-2 flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-caret-left" size={12} />
          {HELP_TEXT.allGuides}
        </button>
        <MarkdownPreview text={GUIDE_DOCS[guide]} />
      </div>
    )
  return (
    <div>
      <h1 className="text-[22px] font-bold">{HELP_TEXT.guides}</h1>
      <p className="mt-1 mb-3 text-[14px] text-fg-muted">{HELP_TEXT.guidesIntro}</p>
      <ul className="flex flex-col gap-0.5">
        {GUIDES.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => setGuide(g.id)}
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[15px] hover:bg-hover"
            >
              <Icon name="ph-book-open-text" size={16} />
              {g.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function HelpDialog({ doc, onClose }: { doc: HelpDoc; onClose(): void }) {
  const title = HELP_TEXT[doc]
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        data-help-doc={doc}
        className="flex max-h-[85vh] flex-col gap-3 border-line bg-panel text-fg sm:max-w-[720px]"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{HELP_TEXT.section}</DialogDescription>
        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          {doc === 'guides' ? <Guides /> : <MarkdownPreview text={HELP_DOCS[doc]} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
