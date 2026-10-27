/**
 * Small building blocks the whiteboard chrome shares: an icon button, a button that opens a
 * popover menu, a menu row, a group heading and the shape icons. Tooltips are the native
 * `title` (as elsewhere in the app); the accessible name is the Object label.
 */
import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { WhiteboardShapeMenuTool, WhiteboardTool } from '@/api/whiteboardTypes'
import { Icon } from '@/components/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { isShapeTool } from '../model'
import { shapePath } from '../shapes'
import { TOOL_LABEL } from '../strings'

/** Our shortcut keys (the plan's key table), shown in tooltips next to Object's names. */
export const KEY_HINT = {
  select: 'V',
  hand: 'H',
  text: 'T',
  rectangle: 'R',
  ellipse: 'O',
  triangle: 'Shift+R',
  line: 'L',
  arrow: 'A',
  frame: 'F',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  zoomReset: 'Ctrl+0',
  fitAll: 'Shift+1',
  fitSelection: 'Shift+2',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
  duplicate: 'Ctrl+D',
  front: 'Ctrl+Shift+]',
  forward: 'Ctrl+]',
  backward: 'Ctrl+[',
  back: 'Ctrl+Shift+[',
  flipX: 'Shift+H',
  flipY: 'Shift+V',
  wrap: 'Ctrl+Alt+G',
  delete: 'Delete',
} as const

/** "Name (Key)" for a tooltip. */
export function hint(name: string, key?: string): string {
  return key ? `${name} (${key})` : name
}

export interface ChromeButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  label: string
  pressed?: boolean
  /** Tooltip; defaults to the label. */
  tip?: string
}

/** A square icon button with its label as the accessible name. */
export const ChromeButton = forwardRef<HTMLButtonElement, ChromeButtonProps>(function ChromeButton(
  { label, pressed, tip, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={tip ?? label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      className={cn(
        'flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40',
        pressed && 'bg-hover text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

/** A button that opens a popover; `children` receives `close`. */
export function PopoverMenu({
  label,
  tip,
  trigger,
  pressed,
  disabled,
  side = 'top',
  align = 'center',
  className,
  triggerClassName,
  children,
}: {
  label: string
  tip?: string
  trigger: ReactNode
  pressed?: boolean
  disabled?: boolean
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  className?: string
  triggerClassName?: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChromeButton label={label} tip={tip} pressed={pressed} disabled={disabled} className={triggerClassName}>
          {trigger}
        </ChromeButton>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        className={cn('w-auto min-w-44 border-line bg-raised p-1.5 text-fg', className)}
      >
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  )
}

/** One row of a popover menu. */
export function MenuRow({
  label,
  icon,
  tip,
  selected,
  disabled,
  onSelect,
  trailing,
}: {
  label: string
  icon?: ReactNode
  tip?: string
  selected?: boolean
  disabled?: boolean
  onSelect(): void
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={tip}
      aria-current={selected ? 'true' : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] text-fg hover:bg-hover disabled:pointer-events-none disabled:opacity-40',
        selected && 'bg-hover',
      )}
    >
      {icon !== undefined && <span aria-hidden className="flex size-4 shrink-0 items-center justify-center text-fg-muted">{icon}</span>}
      <span className="flex-1">{label}</span>
      {trailing}
      {selected && <Icon name="ph-check" size={14} />}
    </button>
  )
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-1.5 pb-1 text-[12px] font-medium text-fg-muted">{children}</div>
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />
}

/** A small drawing of a shape-menu tool (or any shape) for buttons and menus. */
export function ShapeIcon({ tool, size = 16 }: { tool: WhiteboardShapeMenuTool | WhiteboardTool; size?: number }) {
  const s = size
  if (tool === 'line' || tool === 'arrow') {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
        <line x1={2.5} y1={13.5} x2={13.5} y2={2.5} />
        {tool === 'arrow' && <polyline points="7.5,2.5 13.5,2.5 13.5,8.5" strokeLinejoin="round" />}
      </svg>
    )
  }
  if (!isShapeTool(tool)) return null
  return (
    <svg width={s} height={s} viewBox="-1 -1 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" aria-hidden>
      <path d={shapePath(tool, 14, 14)} />
    </svg>
  )
}

/** The label of a tool. */
export function toolLabel(tool: WhiteboardTool): string {
  return TOOL_LABEL[tool].text
}
