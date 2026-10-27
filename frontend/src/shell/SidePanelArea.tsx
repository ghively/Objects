/**
 * One area of the side panel: a header (back and forward of the open entry, its icon and title,
 * "Browse sidepanel tabs", "New Sidepanel Tab", "Swap", "Open as page", "Open sidepanel menu" and
 * close) over the open entry's content. An empty entry shows "Explore". A plain click on an object
 * link inside the entry navigates the entry, which keeps its own back and forward.
 */
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { SpaceInfo } from '@/api/types'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Icon } from '@/components/Icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { AREAS, entryCanGoBack, entryCanGoForward, type PanelArea } from '@/nav/sidepanel'
import { useTabs, type OpenOptions, type SidepanelEntry, type SidepanelTarget, type Target } from '@/nav/tabs'
import { TargetLabel } from '@/shell/TabStrip'

export const SIDEPANEL_TEXT = {
  /** `RenderSidepanel.tabList` */
  tabList: 'Browse sidepanel tabs',
  /** `RenderSidepanel.createNewSidepanelEntry` */
  newEntry: 'New Sidepanel Tab',
  /** `RenderSidepanel.swapWithMainWindow.button` / `.tooltip` */
  swap: 'Swap',
  swapTooltip: 'Drag onto the main content to swap.',
  /** `CrossSurfaceTabDrag.sidepanelEntryNotSupportedForMainSwap` */
  swapNotSupported: 'This side panel tab cannot be swapped into the main panel.',
  /** `EntityMenu.navigateToEntity` */
  openAsPage: 'Open as page',
  /** `RenderSidepanel.openSidepanelMenu` */
  menu: 'Open sidepanel menu',
  /** our strings */
  moveTo: (n: number) => `Move to area ${n}`,
  close: 'Close',
  back: 'Back',
  forward: 'Forward',
  /** `RenderSidepanel.emptyState.title` */
  emptyTitle: 'Explore',
  /** our string, adapted from `RenderSidepanel.emptyState.description` (no AI chat) */
  emptyDescription: 'Open relevant content or view the graph view to expand the context of your work.',
  /** `LocalGraphPanel`'s heading (M5) */
  graph: 'Graph View',
  /** `SpaceTab.doubleClickToPersist` */
  doubleClickToPersist: 'Double click to make tab persistent.',
}

/** What an area renders for a target; `open` navigates the entry the content sits in. */
export type RenderSidepanelTarget = (target: SidepanelTarget, nav: { open(t: Target, opts?: OpenOptions): void }) => ReactNode

function HeaderButton({
  label,
  title,
  icon,
  onClick,
  disabled,
}: {
  label: string
  title?: string
  icon: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg hover:bg-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon name={icon} size={15} />
    </button>
  )
}

export function EntryLabel({ entry, space }: { entry: SidepanelEntry; space: SpaceInfo | null }) {
  if (entry.target?.kind === 'localGraph') {
    return (
      <>
        <Icon name="ph-graph" size={15} />
        <span className="truncate">{SIDEPANEL_TEXT.graph}</span>
      </>
    )
  }
  return <TargetLabel target={entry.target} space={space} />
}

export interface SidePanelAreaProps {
  area: PanelArea
  /** The entries of this area, in order; one of them is open. */
  entries: SidepanelEntry[]
  space: SpaceInfo | null
  renderTarget: RenderSidepanelTarget
}

export function SidePanelArea({ area, entries, space, renderTarget }: SidePanelAreaProps) {
  const entry = entries.find((e) => e.isOpen)
  if (!entry) return null
  const s = useTabs.getState
  const target = entry.target
  const pageTarget: Target | null = target && target.kind !== 'localGraph' ? target : null
  const areaNumber = AREAS.indexOf(area) + 1

  // A plain click on a resolved object link inside the entry navigates the entry (Ctrl/Meta-click,
  // middle-click and Alt+Shift keep the link's own behaviour).
  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    const link = (e.target as HTMLElement | null)?.closest?.('[data-resolved-path]')
    const path = link?.getAttribute('data-resolved-path')
    if (!link || !path || !e.currentTarget.contains(link)) return
    e.preventDefault()
    e.stopPropagation()
    s().navigateSidepanelEntry(entry.id, { kind: 'object', path })
  }

  const nav = { open: (t: Target) => s().navigateSidepanelEntry(entry.id, t) }

  return (
    <section aria-label={`Side panel area ${areaNumber}`} data-area={area} className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
        <HeaderButton label={SIDEPANEL_TEXT.back} icon="ph-caret-left" disabled={!entryCanGoBack(entry)} onClick={() => s().sidepanelBack(entry.id)} />
        <HeaderButton
          label={SIDEPANEL_TEXT.forward}
          icon="ph-caret-right"
          disabled={!entryCanGoForward(entry)}
          onClick={() => s().sidepanelForward(entry.id)}
        />
        <div
          data-testid="sidepanel-entry-title"
          title={entry.isPersistent ? undefined : SIDEPANEL_TEXT.doubleClickToPersist}
          onDoubleClick={() => s().toggleSidepanelEntryPersistent(entry.id)}
          className={cn('flex min-w-0 flex-1 items-center gap-1.5 px-1 text-[14px] font-medium', !entry.isPersistent && 'italic')}
        >
          <EntryLabel entry={entry} space={space} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={SIDEPANEL_TEXT.tabList}
              title={SIDEPANEL_TEXT.tabList}
              className="flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1 text-[12px] text-fg-muted hover:bg-hover"
            >
              <Icon name="ph-stack" size={15} />
              {entries.length > 1 && <span>{entries.length}</span>}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[260px] border-line bg-raised">
            {entries.map((e) => (
              <DropdownMenuItem key={e.id} aria-current={e.isOpen ? 'true' : undefined} onSelect={() => s().activateSidepanelEntry(e.id)}>
                <EntryLabel entry={e} space={space} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <HeaderButton label={SIDEPANEL_TEXT.newEntry} icon="ph-plus" onClick={() => s().newSidepanelEntry(area)} />
        <HeaderButton
          label={SIDEPANEL_TEXT.swap}
          title={pageTarget ? SIDEPANEL_TEXT.swapTooltip : SIDEPANEL_TEXT.swapNotSupported}
          icon="ph-arrows-left-right"
          disabled={!pageTarget}
          onClick={() => s().swapWithMain(entry.id)}
        />
        <HeaderButton
          label={SIDEPANEL_TEXT.openAsPage}
          icon="ph-arrows-out-simple"
          disabled={!pageTarget}
          onClick={() => {
            if (!pageTarget) return
            s().closeSidepanelEntry(entry.id)
            s().open(pageTarget, { via: 'nav' })
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={SIDEPANEL_TEXT.menu}
              title={SIDEPANEL_TEXT.menu}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg hover:bg-hover"
            >
              <Icon name="ph-dots-three" size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px] border-line bg-raised">
            {AREAS.map((a, i) => (
              <DropdownMenuItem key={a} disabled={a === area} onSelect={() => s().moveSidepanelEntry(entry.id, a)}>
                <Icon name="ph-arrow-bend-down-right" size={14} />
                {SIDEPANEL_TEXT.moveTo(i + 1)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => s().closeSidepanelEntry(entry.id)}>
              <Icon name="ph-x" size={14} />
              {SIDEPANEL_TEXT.close}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <HeaderButton label={SIDEPANEL_TEXT.close} icon="ph-x" onClick={() => s().closeSidepanelEntry(entry.id)} />
      </header>
      <div className="min-h-0 flex-1 overflow-auto" data-sidepanel-entry={entry.id} onClickCapture={onClickCapture}>
        <ErrorBoundary what="This side panel tab" resetKey={target ? JSON.stringify(target) : ''}>
          {target ? (
            renderTarget(target, nav)
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-[18px] font-semibold">{SIDEPANEL_TEXT.emptyTitle}</p>
              <p className="max-w-[320px] text-[14px] text-fg-muted">{SIDEPANEL_TEXT.emptyDescription}</p>
              <button
                type="button"
                onClick={() => s().navigateSidepanelEntry(entry.id, { kind: 'localGraph' })}
                className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[14px] hover:bg-hover"
              >
                <Icon name="ph-graph" size={15} />
                {SIDEPANEL_TEXT.graph}
              </button>
            </div>
          )}
        </ErrorBoundary>
      </div>
    </section>
  )
}
