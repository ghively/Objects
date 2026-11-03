import { useEffect, type ReactNode } from 'react'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { SpacesMenu } from '@/spaces/SpacesMenu'

export const TOP_BAR_TEXT = {
  changeSpace: 'Change space', // SpaceOverview.changeSpace.tooltip
  createNewTab: 'Create new tab', // SpaceHeader.createNewTab
  hideSidepanel: 'Hide sidepanel', // RenderSidepanel.hideSidepanel
  showSidepanel: 'Show sidepanel', // RenderSidepanel.showSidepanel
} as const

export interface TopBarProps {
  spaceName: string
  onToggleSidebar: () => void
  onToggleRightPanel: () => void
  rightPanelOpen: boolean
  onBack?: () => void
  onForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onNewTab?: () => void
  /** Tab strip slot (filled by the tabs store in Task 9). */
  tabs?: ReactNode
}

function BarButton({
  label,
  icon,
  onClick,
  disabled,
  pressed,
  size = 18,
}: {
  label: string
  icon: string
  onClick?: () => void
  disabled?: boolean
  pressed?: boolean
  size?: number
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled || !onClick}
      className="flex size-8 items-center justify-center rounded-md text-fg hover:bg-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Icon name={icon} size={size} />
    </button>
  )
}

export function TopBar({
  spaceName,
  onToggleSidebar,
  onToggleRightPanel,
  rightPanelOpen,
  onBack,
  onForward,
  canGoBack = false,
  canGoForward = false,
  onNewTab,
  tabs,
}: TopBarProps) {
  // The stored space info follows renames and icon changes (Settings, the spaces menu) at once.
  const info = useSpaceInfo((s) => s.space)
  useEffect(() => {
    void useSpaceInfo.getState().ensure()
  }, [])
  const name = info?.name || spaceName
  const sidepanelLabel = rightPanelOpen ? TOP_BAR_TEXT.hideSidepanel : TOP_BAR_TEXT.showSidepanel
  return (
    <header data-typing-fade="" className="flex h-[42px] shrink-0 items-center gap-1 bg-app pr-2 pl-2.5 text-fg">
      <div className="flex w-[348px] shrink-0 items-center justify-between">
        <SpacesMenu>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[15px] font-semibold hover:bg-hover data-[state=open]:bg-hover"
            title={TOP_BAR_TEXT.changeSpace}
            aria-label={`${TOP_BAR_TEXT.changeSpace}: ${name}`}
          >
            <IconOrEmoji icon={info?.icon || null} fallback="ph-lightbulb" size={15} />
            <span className="max-w-[220px] truncate">{name}</span>
            <Icon name="ph-caret-up-down" size={13} className="text-fg-muted" />
          </button>
        </SpacesMenu>
        <BarButton label="Toggle sidebar" icon="ph-sidebar-simple" onClick={onToggleSidebar} />
      </div>
      <div className="flex items-center gap-0.5 pl-2">
        <BarButton label="Back" icon="ph-caret-left" onClick={onBack} disabled={!canGoBack} />
        <BarButton label="Forward" icon="ph-caret-right" onClick={onForward} disabled={!canGoForward} />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" data-slot="tab-strip">
        {tabs}
        <BarButton label={TOP_BAR_TEXT.createNewTab} icon="ph-plus" onClick={onNewTab} />
      </div>
      <BarButton
        label={sidepanelLabel}
        icon="ph-square-split-horizontal"
        onClick={onToggleRightPanel}
        pressed={rightPanelOpen}
      />
    </header>
  )
}
