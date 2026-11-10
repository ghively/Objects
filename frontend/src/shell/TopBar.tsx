import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Icon, IconOrEmoji } from '@/components/Icon'
import { useSettings } from '@/settings/useSettings'
import { useSpaceInfo } from '@/settings/useSpaceInfo'
import { SpacesMenu } from '@/spaces/SpacesMenu'
import { openTodaysNote, TODAYS_NOTE_TEXT } from '@/calendar/openTodaysNote'
import { isEditableTarget } from '@/lib/shortcuts'

export const TOP_BAR_TEXT = {
  changeSpace: 'Change space',
  createNewTab: 'Create new tab',
  hideSidepanel: 'Hide sidepanel',
  showSidepanel: 'Show sidepanel',
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

/**
 * M31, Editor "Hide App Menu": Object's app menu is the top bar's space menu (the spaces, Space
 * settings, Space history, Create space, Open folder…); Object's window has no menu bar of its own.
 * With the setting on the menu's button is hidden. A lone tap of Alt (pressed and released with no
 * other key or click between) shows it, focused, as a hidden window menu bar comes back with Alt;
 * another tap hides it. Its spaces and settings stay in the palette and Ctrl+, too. While typing,
 * the tap shows the menu but the caret stays in the field; hiding it gives focus back to where it
 * was before the tap (`before`), not to the body.
 */
function useAppMenuShown(button: RefObject<HTMLButtonElement | null>): { shown: boolean; revealed: boolean } {
  const hide = useSettings((s) => !!s.settings.hideAppMenu)
  const [revealed, setRevealed] = useState(false)
  const revealedRef = useRef(false)
  const before = useRef<Element | null>(null)
  useEffect(() => {
    if (!hide) return
    let armed = false
    const onDown = (e: KeyboardEvent) => {
      armed = e.key === 'Alt' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.shiftKey
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || !armed) return
      armed = false
      const next = !revealedRef.current
      if (next) before.current = document.activeElement
      revealedRef.current = next
      setRevealed(next)
    }
    const disarm = () => {
      armed = false
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('pointerdown', disarm, true)
    window.addEventListener('blur', disarm)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('pointerdown', disarm, true)
      window.removeEventListener('blur', disarm)
      // Turned off (or unmounted): the next time it is on, the menu starts hidden.
      revealedRef.current = false
      setRevealed(false)
    }
  }, [hide])
  const shownByAlt = hide && revealed
  // Shown by Alt: focus it, so Enter or Space opens it, unless the tap came while typing (the caret
  // stays). Hidden again: focus goes back where it was if it fell to the body with the button.
  useEffect(() => {
    if (shownByAlt) {
      if (!isEditableTarget(before.current)) button.current?.focus()
      return
    }
    const prev = before.current
    before.current = null
    const active = document.activeElement
    if (prev instanceof HTMLElement && prev.isConnected && (active === null || active === document.body)) prev.focus()
  }, [shownByAlt, button])
  return { shown: !hide || revealed, revealed: shownByAlt }
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
  const spaceButtonRef = useRef<HTMLButtonElement>(null)
  const appMenu = useAppMenuShown(spaceButtonRef)
  return (
    <header data-typing-fade="" className="flex h-[42px] shrink-0 items-center gap-1 bg-app pr-2 pl-2.5 text-fg">
      <div className={`flex w-[348px] shrink-0 items-center ${appMenu.shown ? 'justify-between' : 'justify-end'}`}>
        {appMenu.shown && (
          <SpacesMenu>
            <button
              ref={spaceButtonRef}
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
        )}
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
      <BarButton label={TODAYS_NOTE_TEXT.button} icon="ph-notebook" onClick={() => void openTodaysNote()} />
      <BarButton
        label={sidepanelLabel}
        icon="ph-square-split-horizontal"
        onClick={onToggleRightPanel}
        pressed={rightPanelOpen}
      />
    </header>
  )
}
