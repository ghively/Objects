import type { ReactNode } from 'react'
import { Icon } from '@/components/Icon'

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
  return (
    <header className="flex h-[44px] shrink-0 items-center gap-1 bg-app pr-2 pl-1.5 text-fg">
      <div className="flex w-[324px] shrink-0 items-center justify-between">
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[15px] font-semibold hover:bg-hover"
          title="Space"
        >
          <Icon name="ph-lightbulb" size={15} />
          <span className="max-w-[220px] truncate">{spaceName}</span>
          <Icon name="ph-caret-up-down" size={13} className="text-fg-muted" />
        </button>
        <BarButton label="Toggle sidebar" icon="ph-sidebar-simple" onClick={onToggleSidebar} />
      </div>
      <div className="flex items-center gap-0.5 pl-2">
        <BarButton label="Back" icon="ph-caret-left" onClick={onBack} disabled={!canGoBack} />
        <BarButton label="Forward" icon="ph-caret-right" onClick={onForward} disabled={!canGoForward} />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" data-slot="tab-strip">
        {tabs}
        <BarButton label="New tab" icon="ph-plus" onClick={onNewTab} />
      </div>
      <BarButton
        label="Toggle right panel"
        icon="ph-square-split-horizontal"
        onClick={onToggleRightPanel}
        pressed={rightPanelOpen}
      />
    </header>
  )
}
