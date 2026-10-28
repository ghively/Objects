/**
 * The zoom control (bottom right; our choice of position): Zoom out, the current percentage
 * opening the zoom menu ("Zoom in", "Zoom out", "Zoom to fit", "Zoom to selection",
 * "Zoom to 100%" and Object's presets), Zoom in.
 */
import { Icon } from '@/components/Icon'
import type { ZoomCommand, ZoomMenuProps } from '../canvasTypes'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_PRESETS } from '../model'
import { WB } from '../strings'
import { ChromeButton, hint, KEY_HINT, MenuRow, MenuSeparator, PopoverMenu } from './controls'

export function percent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

export function ZoomMenu({ zoom, onZoom }: ZoomMenuProps) {
  const commands: { cmd: ZoomCommand; label: string; key: string }[] = [
    { cmd: 'in', label: WB.toolZoomIn.text, key: KEY_HINT.zoomIn },
    { cmd: 'out', label: WB.toolZoomOut.text, key: KEY_HINT.zoomOut },
    { cmd: 'fit', label: WB.shortcutFitAll.text, key: KEY_HINT.fitAll },
    { cmd: 'selection', label: WB.toolFitSelection.text, key: KEY_HINT.fitSelection },
    { cmd: 'reset', label: WB.shortcutZoomReset.text, key: KEY_HINT.zoomReset },
  ]
  return (
    <div
      data-whiteboard-zoom=""
      className="flex items-center gap-0.5 rounded-xl border border-line bg-raised p-1 text-fg shadow-lg"
    >
      <ChromeButton
        label={WB.toolZoomOut.text}
        tip={hint(WB.shortcutZoomOut.text, KEY_HINT.zoomOut)}
        disabled={zoom <= ZOOM_MIN + 1e-9}
        onClick={() => onZoom('out')}
      >
        <Icon name="ph-minus" size={16} />
      </ChromeButton>
      <PopoverMenu
        label={percent(zoom)}
        trigger={<span className="min-w-10 text-center text-[13px] tabular-nums">{percent(zoom)}</span>}
        align="end"
      >
        {(close) => (
          <div role="menu" aria-label="Zoom" data-whiteboard-zoom-menu="" className="flex flex-col">
            {commands.map(({ cmd, label, key }) => (
              <MenuRow
                key={String(cmd)}
                label={label}
                trailing={<span className="text-[12px] text-fg-muted">{key}</span>}
                onSelect={() => {
                  onZoom(cmd)
                  close()
                }}
              />
            ))}
            <MenuSeparator />
            {ZOOM_PRESETS.map((z) => (
              <MenuRow
                key={z}
                label={percent(z)}
                selected={Math.abs(zoom - z) < 1e-6}
                onSelect={() => {
                  onZoom(z)
                  close()
                }}
              />
            ))}
          </div>
        )}
      </PopoverMenu>
      <ChromeButton
        label={WB.toolZoomIn.text}
        tip={hint(WB.shortcutZoomIn.text, KEY_HINT.zoomIn)}
        disabled={zoom >= ZOOM_MAX - 1e-9}
        onClick={() => onZoom('in')}
      >
        <Icon name="ph-plus" size={16} />
      </ChromeButton>
    </div>
  )
}
