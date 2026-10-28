/**
 * The Related tags tab (our rule): tags that other objects carry together with this object's
 * tags, as tag pills with how many objects share them. A click opens the Tag object
 * (Ctrl/Cmd+click in a new tab); a tag without an object is opened through M2's `openTag`.
 */
import type { ObjectSummary, RelatedTagEntry } from '@/api/types'
import { openTag } from '@/object/ObjectHeader'
import { tagColor, useTagObjects } from '@/properties/TagPicker'
import { useTabs } from '@/nav/tabs'
import { tagStyle } from '@/theme/palette'
import { EmptyState } from './BacklinksTab'
import { REFERENCES_TEXT } from './referencesUi'

export interface RelatedTagsTabProps {
  entries: RelatedTagEntry[]
  summaries: Record<string, ObjectSummary>
}

export function RelatedTagsTab({ entries, summaries }: RelatedTagsTabProps) {
  const tags = useTagObjects()
  if (entries.length === 0) return <EmptyState title={REFERENCES_TEXT.relatedTagsEmpty} />
  return (
    <ul className="flex flex-wrap gap-1.5" data-references-list="relatedTags">
      {entries.map((entry) => {
        const color = (entry.path ? summaries[entry.path]?.color : null) ?? tagColor(tags, entry.name)
        return (
          <li key={entry.path ?? entry.name}>
            <button
              type="button"
              data-related-tag={entry.name}
              onClick={(e) => {
                if (entry.path) {
                  useTabs.getState().open({ kind: 'object', path: entry.path }, { newTab: e.ctrlKey || e.metaKey })
                } else {
                  void openTag(entry.name).catch(() => undefined)
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-[1px] text-[13px] hover:opacity-90"
              style={tagStyle(color)}
            >
              <span>{entry.name}</span>
              <span className="opacity-70">{entry.count}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
