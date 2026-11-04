/**
 * The "Merge into" dialog (M8 Task 6).
 * Mounted once in `shell/GlobalOverlays.tsx`; `useMerge.open(path)` (the object's `…` menu,
 * "Merge into object" / "Merge into tag") opens it.
 *
 * Steps: pick the target ("Merge into"; "Loading…" while the list loads; a tag lists only other
 * tags, any other object only non-tags), confirm ("Are you sure you want to merge “{sourceName}”
 * into “{targetName}”?" with the description and "Merge"), merging ("Merging objects…" /
 * "Merging tags…"), then "Object successfully merged" / "Tag successfully merged" and the target
 * opens. Whiteboards and templates are not offered (our choice; the server refuses whiteboards).
 */
import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { ObjectSummary } from '@/api/types'
import { IconOrEmoji } from '@/components/Icon'
import { Button } from '@/components/ui/button'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { showToast } from '@/editor/media/upload'
import { invalidateLinkIndex, typeOf, useLinkIndex } from '@/links/linkIndex'
import { useTabs } from '@/nav/tabs'
import { isWhiteboardType } from '@/whiteboard/isWhiteboard'
import { useMerge } from './useMerge'

/** Merging is limited to this many references (the server's `MERGE_LIMIT`, our value). */
export const MERGE_LIMIT = 5000

export interface MergeStrings {
  submenuTitle: string
  preparing: string
  nothingFound: string
  confirmTitle(sourceName: string, targetName: string): string
  confirmDescription(sourceName: string, targetName: string): string
  confirmText: string
  loading: string
  success: string
  error: string
  errorTooLarge: string
  errorTooLargeDescription(limit: number): string
}

export const MERGE_OBJECT: MergeStrings = {
  submenuTitle: 'Merge into',
  preparing: 'Loading…',
  nothingFound: 'No other objects found',
  confirmTitle: (s, t) => `Are you sure you want to merge “${s}” into “${t}”?`,
  confirmDescription: (s, t) =>
    `Single values already set on “${t}” stay. Lists are combined with “${s}”, and empty properties are filled from there. Content is added on.`,
  confirmText: 'Merge',
  loading: 'Merging objects…',
  success: 'Object successfully merged',
  error: 'Could not merge objects',
  errorTooLarge: 'This object is too large to merge',
  errorTooLargeDescription: (limit) =>
    `Merging is limited to ${limit} references. You can still merge a smaller object into this one, or remove some references first.`,
}

export const MERGE_TAG: MergeStrings = {
  submenuTitle: 'Merge into',
  preparing: 'Loading…',
  nothingFound: 'No other tags found',
  confirmTitle: (s, t) => `Are you sure you want to merge “${s}” into “${t}”?`,
  confirmDescription: (_s, t) => `References to this tag will be merged into “${t}”.`,
  confirmText: 'Merge',
  loading: 'Merging tags…',
  success: 'Tag successfully merged',
  error: 'Could not merge tags',
  errorTooLarge: 'This tag is too large to merge',
  errorTooLargeDescription: (limit) =>
    `Merging is limited to ${limit} references. You can still merge a smaller tag into this one, or remove some uses of this tag first.`,
}

/** Our string (the cancel button). */
export const CANCEL = 'Cancel'

const TAG_TYPE = 'tag'

export function MergeDialog() {
  const source = useMerge((s) => s.source)
  const close = useMerge((s) => s.close)
  return (
    <Dialog open={source !== null} onOpenChange={(o) => !o && close()}>
      {source !== null && (
        <DialogContent
          className="w-[min(440px,calc(100vw-32px))] gap-0 overflow-hidden border-line bg-raised-2 p-0 text-fg"
          data-merge-dialog=""
        >
          <MergeBody key={source} source={source} onDone={close} />
        </DialogContent>
      )}
    </Dialog>
  )
}

type Stage = { kind: 'pick' } | { kind: 'confirm'; target: ObjectSummary } | { kind: 'merging'; target: ObjectSummary }

function MergeBody({ source, onDone }: { source: string; onDone(): void }) {
  const types = useLinkIndex((s) => s.types)
  const [objects, setObjects] = useState<ObjectSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'pick' })
  const [error, setError] = useState<{ title: string; description?: string } | null>(null)

  useEffect(() => {
    let live = true
    api
      .objects()
      .then((list) => live && setObjects(list))
      .catch(() => live && setObjects([]))
    return () => {
      live = false
    }
  }, [])

  const sourceSummary = objects?.find((o) => o.path === source)
  const isTag = sourceSummary ? sourceSummary.type === TAG_TYPE : false
  const text = isTag ? MERGE_TAG : MERGE_OBJECT
  const sourceName = sourceSummary?.title ?? source.replace(/^.*\//, '').replace(/\.md$/i, '')

  const candidates = useMemo(() => {
    if (!objects) return []
    const boardTypes = new Set(types.filter(isWhiteboardType).map((t) => t.id))
    const needle = query.trim().toLowerCase()
    return objects
      .filter((o) => o.path !== source && !o.template && !boardTypes.has(o.type))
      .filter((o) => (o.type === TAG_TYPE) === isTag)
      .filter((o) => !needle || o.title.toLowerCase().includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  }, [objects, types, query, source, isTag])

  const merge = async (target: ObjectSummary) => {
    setStage({ kind: 'merging', target })
    setError(null)
    try {
      const [s, t] = await Promise.all([api.object(source), api.object(target.path)])
      const res = await api.mergeObject(source, target.path, {
        sourceVersion: s.version,
        targetVersion: t.version,
      })
      void invalidateLinkIndex()
      showToast(text.success)
      onDone()
      useTabs.getState().open({ kind: 'object', path: res.target ?? target.path })
    } catch (e) {
      if (e instanceof ApiError && e.status === 413) {
        setError({ title: text.errorTooLarge, description: text.errorTooLargeDescription(MERGE_LIMIT) })
      } else {
        setError({ title: text.error })
      }
      setStage({ kind: 'confirm', target })
    }
  }

  if (stage.kind !== 'pick') {
    const busy = stage.kind === 'merging'
    return (
      <div className="flex flex-col gap-3 p-4" data-merge-confirm="">
        <DialogTitle className="text-[15px] font-semibold">{text.confirmTitle(sourceName, stage.target.title)}</DialogTitle>
        <DialogDescription className="text-[14px] text-fg-muted">
          {text.confirmDescription(sourceName, stage.target.title)}
        </DialogDescription>
        {busy && (
          <p className="text-[13px] text-fg-muted" data-merge-progress="">
            {text.loading}
          </p>
        )}
        {error && (
          <div className="text-[13px] text-red-600" role="alert" data-merge-error="">
            <p className="font-medium">{error.title}</p>
            {error.description && <p>{error.description}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onDone}>
            {CANCEL}
          </Button>
          <Button disabled={busy} onClick={() => void merge(stage.target)}>
            {text.confirmText}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <DialogTitle className="px-4 pt-4 pb-2 text-[15px] font-semibold">{text.submenuTitle}</DialogTitle>
      <DialogDescription className="sr-only">{text.submenuTitle}</DialogDescription>
      <Command shouldFilter={false} className="bg-transparent">
        <CommandInput autoFocus value={query} onValueChange={setQuery} aria-label={text.submenuTitle} />
        <CommandList className="max-h-80">
          {objects === null && (
            <p className="px-3 py-2 text-[13px] text-fg-muted" data-merge-loading="">
              {text.preparing}
            </p>
          )}
          {objects !== null && candidates.length === 0 && (
            <p className="px-3 py-2 text-[13px] text-fg-muted" data-merge-empty="">
              {text.nothingFound}
            </p>
          )}
          {candidates.length > 0 && (
            <CommandGroup>
              {candidates.map((o) => (
                <CommandItem key={o.path} value={o.path} onSelect={() => setStage({ kind: 'confirm', target: o })}>
                  <IconOrEmoji icon={o.icon ?? typeOf(o.type)?.icon} fallback="ph-file-text" size={16} />
                  <span className="flex-1 truncate">{o.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </>
  )
}

export default MergeDialog
