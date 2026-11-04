// A bundled help text (the getting-started guide or the Markdown reference), shown read-only in
// a dialog with the page editor's own rendering. The text ships with the app: nothing is fetched
// and nothing is written into the space. Loaded on demand from the sidebar's Help section.
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { MarkdownPreview } from '@/editor/code/MarkdownPreview'
import { HELP_TEXT, type HelpDoc } from './helpText'
import gettingStarted from './getting-started.md?raw'
import markdownReference from './markdown-reference.md?raw'

export const HELP_DOCS: Record<HelpDoc, string> = { gettingStarted, markdownReference }

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
          <MarkdownPreview text={HELP_DOCS[doc]} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
