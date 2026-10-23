/**
 * An object's full view, shared by the page and the peek: property panel,
 * header and body editor (formatted or raw), with the `…` menu.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { ObjectDetail } from '@/api/types'
import { Icon } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Editor } from '@/editor/Editor'
import { RawMode } from '@/editor/RawMode'
import { installLinkPicker } from '@/links/LinkPicker'
import { typeOf, useLinkIndex, ensureLinkIndex } from '@/links/linkIndex'
import { installWikilinkPresenter } from '@/links/wikilinkPresenter'
import { useTabs } from '@/nav/tabs'
import { ObjectHeader } from './ObjectHeader'
import { PropertyPanel } from './PropertyPanel'

installWikilinkPresenter()
installLinkPicker()

export interface ObjectViewProps {
  path: string
  mode: 'page' | 'peek'
  /** Peek only: open the object as a page in the current tab. */
  onExpand?: () => void
  /** Called after an action that should dismiss the peek (e.g. open in new tab). */
  onDismiss?: () => void
  /** Bottom-right slot (the peek's pager). */
  footer?: ReactNode
}

function ToolButton({ label, icon, onClick }: { label: string; icon: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md text-fg hover:bg-hover"
    >
      <Icon name={icon} size={17} />
    </button>
  )
}

export function ObjectView({ path, mode, onExpand, onDismiss, footer }: ObjectViewProps) {
  const [detail, setDetail] = useState<ObjectDetail | null>(null)
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [conflict, setConflict] = useState(false)
  // Subscribe so the type chip and properties pick up types once the index loads.
  useLinkIndex((s) => s.revision)

  const load = useCallback(async () => {
    const d = await api.object(path)
    setDetail(d)
    setVersion(d.version)
    setConflict(false)
    return d
  }, [path])

  useEffect(() => {
    let alive = true
    setDetail(null)
    setError(null)
    void ensureLinkIndex()
    api
      .object(path)
      .then((d) => {
        if (!alive) return
        setDetail(d)
        setVersion(d.version)
        setConflict(false)
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [path])

  const toggleRaw = async () => {
    // Re-read so the other mode starts from the saved text (the menu click already blurred and flushed).
    try {
      await load()
    } catch {
      /* keep what we have */
    }
    setRaw((r) => !r)
  }

  const summary = detail?.summary
  const type = typeOf(summary?.type)
  const readOnly = !!summary?.readOnly

  return (
    <div className="flex h-full min-h-0 w-full" data-object-view={mode}>
      {detail && panelOpen && <PropertyPanel type={type} frontmatter={detail.frontmatter} />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-3 pt-3">
          <ToolButton
            label={panelOpen ? 'Hide properties' : 'Show properties'}
            icon="ph-sidebar-simple"
            onClick={() => setPanelOpen((v) => !v)}
          />
          <div className="flex items-center gap-0.5 rounded-xl border border-line px-1 py-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More"
                  title="More"
                  className="flex size-8 items-center justify-center rounded-md hover:bg-hover"
                >
                  <Icon name="ph-dots-three" size={18} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 border-line bg-raised">
                <DropdownMenuItem
                  onSelect={() => {
                    useTabs.getState().open({ kind: 'object', path }, { newTab: true })
                    onDismiss?.()
                  }}
                >
                  <Icon name="ph-arrow-square-out" size={16} />
                  Open in new tab
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void api.reveal(path).catch(() => undefined)}>
                  <Icon name="ph-folder-open" size={16} />
                  Reveal in Explorer
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={raw} onCheckedChange={() => void toggleRaw()}>
                  Raw Markdown
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {onExpand && <ToolButton label="Open as page" icon="ph-arrows-out-simple" onClick={onExpand} />}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[820px] px-12 pt-6 pb-24" data-object-path={path}>
            {error && (
              <div className="rounded-lg border border-line bg-raised p-4">
                <p className="font-semibold">Couldn't open this object.</p>
                <p className="mt-1 text-fg-muted">{error}</p>
              </div>
            )}
            {!detail && !error && <p className="text-fg-muted">Loading…</p>}
            {detail && summary && (
              <>
                <ObjectHeader summary={summary} type={type} />
                {readOnly && (
                  <div role="status" className="mb-4 rounded-lg border border-line bg-raised px-3 py-2 text-[14px] text-fg-muted">
                    This object's frontmatter couldn't be read, so it opens read-only. Fix the file to edit it.
                  </div>
                )}
                {conflict && (
                  <div role="alert" className="mb-4 rounded-lg border border-danger/60 bg-raised px-3 py-2 text-[14px]">
                    This file changed on disk, so your last edit wasn't saved.{' '}
                    <button type="button" className="underline" onClick={() => void load()}>
                      Reload
                    </button>
                  </div>
                )}
                <div className="text-[17px]">
                  {raw ? (
                    <RawMode
                      path={path}
                      text={detail.body}
                      version={version}
                      readOnly={readOnly}
                      onSaved={setVersion}
                      onConflict={() => setConflict(true)}
                    />
                  ) : (
                    <Editor
                      path={path}
                      body={detail.body}
                      version={version}
                      readOnly={readOnly}
                      onSaved={setVersion}
                      onConflict={() => setConflict(true)}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        {footer && <div className="absolute right-4 bottom-4">{footer}</div>}
      </div>
    </div>
  )
}
