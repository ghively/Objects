// "Offline & Sync", keeping only its local part: Object stores everything as files on this
// device and has no cloud, so the sync status, content download state, media loading, media cache
// and cloud media storage have nothing to show. What stays is "Recalculate content index"
// (`POST /api/search/reindex`), which Object keeps here (M9 put it in Space Settings).
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Icon } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { SaveError, SectionHeader, SettingGroup, errorText } from '../controls'

export const OFFLINE_SYNC_TEXT = {
  heading: 'Offline & Sync', // OfflineSyncSettings.heading
  // our string, adapted from OfflineSyncSettings.description (no cloud here)
  description: 'Your content is stored as Markdown files on this device and is always available offline.',
  offline: 'Offline', // OfflineSyncSettings.sections.offline.heading
  // our string, adapted from OfflineSyncSettings.sections.offline.description
  offlineDescription: 'Object reads your notes from the space folder and keeps an index of them for search, backlinks and views.',
  reindexButton: 'Recalculate content index', // ContentLoadingStateIndicator.recomputeBacklinkIndex.button
  reindexDescription:
    'If some of your views are inconsistent or search results are not returning content, you can reindex your notes. This is usually not needed, only use it if you are having issues.', // ContentLoadingStateIndicator.recomputeBacklinkIndex.description
  reindexingHeading: 'Content is being indexed', // ContentLoadingStateIndicator.recomputingBacklinkIndex.heading
  reindexingDescription: 'Your notes are getting analyzed for search, backlinking, and your content views.', // ContentLoadingStateIndicator.recomputingBacklinkIndex.description
} as const

const T = OFFLINE_SYNC_TEXT

export const OFFLINE_SYNC_SEARCH: string[] = [T.offline, T.reindexButton]

/** How often the reindex row asks search whether the index is still `partial` (our choice). */
export const REINDEX_POLL_MS = 1000

/**
 * "Recalculate content index": drops and rebuilds the search index in the background. While
 * search reports `partial` (the rebuild, or the start-up sync) the row shows Object's
 * "Content is being indexed" state and the button waits. It only reads and asks; it writes no file.
 */
function ReindexRow() {
  const [indexing, setIndexing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ask on open and after each start (the server clears `ready` before it answers), then keep
  // asking while the index is partial.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      api
        .search('', { limit: 1 })
        .then((r) => {
          if (!alive) return
          setIndexing(r.partial)
          if (r.partial) timer = setTimeout(check, REINDEX_POLL_MS)
        })
        .catch(() => alive && setIndexing(false))
    }
    check()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [indexing])

  const start = () => {
    setError(null)
    api
      .reindex()
      .then(() => setIndexing(true))
      .catch((e: unknown) => setError(errorText(e)))
  }

  return (
    <SettingGroup title={T.reindexButton} help={T.reindexDescription}>
      <div>
        <Button type="button" variant="outline" size="sm" disabled={indexing} onClick={start}>
          <Icon name="ph-file-magnifying-glass" size={14} />
          {T.reindexButton}
        </Button>
      </div>
      {indexing && (
        <div role="status" className="text-[13px]">
          <p className="font-semibold text-fg">{T.reindexingHeading}</p>
          <p className="text-fg-muted">{T.reindexingDescription}</p>
        </div>
      )}
      <SaveError error={error} />
    </SettingGroup>
  )
}

export function OfflineSyncSection() {
  return (
    <div>
      <SectionHeader icon="ph-arrows-clockwise" heading={T.heading} description={T.description} />
      <SettingGroup title={T.offline} help={T.offlineDescription} className="pb-0" />
      <ReindexRow />
    </div>
  )
}
