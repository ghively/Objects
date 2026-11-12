/**
 * M33: the window's own buttons, drawn by the page where the system draws none into a frameless
 * window (Linux, `controls === 'custom'`): "Minimize", "Maximize" / "Restore" and "Close", the
 * last things in the top bar. 'overlay' (Windows) and 'traffic' (macOS) are the system's own and
 * 'none' means no buttons (a tiling compositor, "Window buttons: Hide", the system's frame): all
 * three draw nothing, as a browser tab and the pywebview window do.
 *
 * They look like the bar's other buttons (its size, its hover) and are reachable by Tab after
 * everything else in it; Close takes the theme's danger colour under the pointer. They stay while the rest
 * of the bar fades for typing (`focus/TypingFade`), as the system's buttons do on the other two, and
 * they stay clickable then (`desktop.css`).
 */
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/utils'
import { desktop } from './bridge'
import { useChrome } from './useWindowChrome'

export const WINDOW_CONTROLS_TEXT = {
  group: 'Window',
  minimize: 'Minimize',
  maximize: 'Maximize',
  restore: 'Restore',
  close: 'Close',
} as const

const T = WINDOW_CONTROLS_TEXT

/**
 * One button. What is seen is the bar's usual 32px square (the inner box takes the hover); what is
 * clicked is taller and, for Close, wider: the full height of the bar, out to the window's edge.
 * So the pointer thrown into the corner of a maximised window closes it, as on every system.
 */
function ControlButton({ label, icon, size, onClick, danger }: { label: string; icon: string; size: number; onClick(): void; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn('group flex items-center pl-px outline-none', danger ? 'pr-2' : 'pr-px')}
    >
      <span
        className={cn(
          'flex size-8 items-center justify-center rounded-md text-fg group-focus-visible:outline-2',
          danger ? 'group-hover:bg-danger group-hover:text-white' : 'group-hover:bg-hover',
        )}
      >
        <Icon name={icon} size={size} />
      </span>
    </button>
  )
}

export function WindowControls() {
  const stored = useChrome((s) => s.controls)
  const maximized = useChrome((s) => s.maximized)
  const d = desktop()
  if (!d || (stored ?? d.controls) !== 'custom') return null
  return (
    // `ml-auto`: at the window's right end even when the tab strip, the bar's only part that
    // grows, is hidden (focus mode); the gap to the bar's last button is the group's own padding.
    <div role="group" aria-label={T.group} data-window-controls="" data-typing-stay="" className="app-no-drag -mr-2 ml-auto flex shrink-0 items-stretch self-stretch pl-1.5">
      <ControlButton label={T.minimize} icon="ph-minus" size={16} onClick={() => d.minimize()} />
      {maximized ? (
        <ControlButton label={T.restore} icon="ph-copy-simple" size={16} onClick={() => d.toggleMaximize()} />
      ) : (
        <ControlButton label={T.maximize} icon="ph-square" size={15} onClick={() => d.toggleMaximize()} />
      )}
      <ControlButton label={T.close} icon="ph-x" size={16} onClick={() => d.close()} danger />
    </div>
  )
}
