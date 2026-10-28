import { useRef } from 'react'
import { Icon } from '@/components/Icon'
import { colorName } from '@/theme/palette'
import { KEY_HINT } from '../chrome/controls'
import { DEFAULT_INK, HIGHLIGHTER_WIDTHS, INK_COLORS, PEN_WIDTHS } from './inkModel'
import { INK_STRINGS } from './inkStrings'
import type { InkEraseMode, InkTool, InkToolbarProps, InkToolState } from './types'

/** `key` is the canvas shortcut shown in the tooltip; Select ink has none (our choice). */
const TOOLS: { tool: InkTool; icon: string; label: string; key?: string }[] = [
  { tool: 'pen', icon: 'ph-pen-nib', label: INK_STRINGS.pen, key: KEY_HINT.pen },
  { tool: 'highlighter', icon: 'ph-highlighter', label: INK_STRINGS.highlighter, key: KEY_HINT.highlighter },
  { tool: 'eraser', icon: 'ph-eraser', label: INK_STRINGS.eraser, key: KEY_HINT.eraser },
  { tool: 'select', icon: 'ph-lasso', label: INK_STRINGS.selectInk },
]

const ERASE_MODES: { mode: InkEraseMode; label: string }[] = [
  { mode: 'stroke', label: INK_STRINGS.eraseStrokes },
  { mode: 'partial', label: INK_STRINGS.erasePartially },
]

/** The eraser mode is a per-viewer convenience kept in localStorage. */
export const ERASE_MODE_KEY = 'object.ink.eraseMode'

function storedEraseMode(): InkEraseMode {
  try {
    return localStorage.getItem(ERASE_MODE_KEY) === 'partial' ? 'partial' : 'stroke'
  } catch {
    return 'stroke'
  }
}

function storeEraseMode(mode: InkEraseMode): void {
  try {
    localStorage.setItem(ERASE_MODE_KEY, mode)
  } catch {
    /* storage unavailable: the mode lasts for this session only */
  }
}

function widthsFor(tool: InkTool): readonly number[] {
  return tool === 'highlighter' ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS
}

function defaultWidth(tool: InkTool): number {
  return tool === 'highlighter' ? HIGHLIGHTER_WIDTHS[0] : DEFAULT_INK.width
}

const BUTTON =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-[var(--bg-hover)] aria-pressed:text-[var(--text)]'

/**
 * The pen group of the whiteboard toolbox (Gene's addition; our strings): Pen, Highlighter and
 * Eraser toggles, and for the drawing tools a colour row and the width choices. Clicking the
 * active tool turns ink off. The keys D, Shift+D and E (ours: P and M are Capacities' Triangle
 * and move menu) are handled by the canvas shortcuts.
 */
export function InkToolbar({ value, readOnly, onChange }: InkToolbarProps) {
  // Remember the colour and widths while ink is off, so turning it back on keeps them.
  const last = useRef<{ color: string; widths: Partial<Record<InkTool, number>> }>({ color: DEFAULT_INK.color, widths: {} })
  if (value) {
    last.current.color = value.color
    last.current.widths[value.tool] = value.width
  }

  const pick = (tool: InkTool) => {
    if (value?.tool === tool) {
      onChange(null)
      return
    }
    const remembered = last.current.widths[tool]
    const width = remembered !== undefined && widthsFor(tool).includes(remembered) ? remembered : defaultWidth(tool)
    const next: InkToolState = { tool, color: value?.color ?? last.current.color, width }
    if (tool === 'eraser') next.eraseMode = storedEraseMode()
    onChange(next)
  }

  const setEraseMode = (mode: InkEraseMode) => {
    storeEraseMode(mode)
    if (value) onChange({ ...value, eraseMode: mode })
  }

  const set = (patch: Partial<InkToolState>) => {
    if (value) onChange({ ...value, ...patch })
  }

  const drawing = !readOnly && value !== null && (value.tool === 'pen' || value.tool === 'highlighter')
  const erasing = !readOnly && value !== null && value.tool === 'eraser'

  return (
    <div
      role="group"
      aria-label={INK_STRINGS.pen}
      data-ink-toolbar=""
      className="flex items-center gap-1"
      title={readOnly ? INK_STRINGS.readOnly : undefined}
    >
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          className={BUTTON}
          aria-label={t.label}
          aria-pressed={!readOnly && value?.tool === t.tool}
          title={readOnly ? INK_STRINGS.readOnly : t.key ? `${t.label} (${t.key})` : t.label}
          disabled={readOnly}
          onClick={() => pick(t.tool)}
        >
          <Icon name={t.icon} size={18} />
        </button>
      ))}
      {erasing && (
        <div role="radiogroup" aria-label={INK_STRINGS.eraseMode} className="ml-1 flex items-center gap-0.5">
          {ERASE_MODES.map((m) => {
            const active = (value.eraseMode ?? 'stroke') === m.mode
            return (
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={m.label}
                title={m.label}
                data-erase-mode={m.mode}
                className={BUTTON}
                aria-pressed={active}
                onClick={() => setEraseMode(m.mode)}
              >
                <Icon name={m.mode === 'partial' ? 'ph-scissors' : 'ph-eraser'} size={16} />
              </button>
            )
          })}
        </div>
      )}
      {drawing && (
        <>
          <div role="radiogroup" aria-label={INK_STRINGS.inkColour} className="ml-1 flex flex-wrap items-center gap-0.5">
            {INK_COLORS.map((c) => {
              const active = value.color.toLowerCase() === c.hex
              return (
                <button
                  key={c.name}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={colorName(c.name)}
                  title={colorName(c.name)}
                  data-color={c.name}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full"
                  style={{ boxShadow: active ? `0 0 0 2px ${c.hex}` : undefined }}
                  onClick={() => set({ color: c.hex })}
                >
                  <span className="block h-3.5 w-3.5 rounded-full" style={{ backgroundColor: c.hex }} />
                </button>
              )
            })}
          </div>
          <div role="radiogroup" aria-label={INK_STRINGS.width} className="ml-1 flex items-center gap-0.5">
            {widthsFor(value.tool).map((w) => {
              const active = value.width === w
              return (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${INK_STRINGS.width} ${w}`}
                  title={`${INK_STRINGS.width} ${w}`}
                  data-width={w}
                  className={BUTTON}
                  aria-pressed={active}
                  onClick={() => set({ width: w })}
                >
                  <span
                    className="block rounded-full"
                    style={{
                      width: Math.min(18, Math.max(4, w / (value.tool === 'highlighter' ? 2 : 1) + 2)),
                      height: Math.min(18, Math.max(4, w / (value.tool === 'highlighter' ? 2 : 1) + 2)),
                      backgroundColor: value.color,
                      opacity: value.tool === 'highlighter' ? 0.35 : 1,
                    }}
                  />
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
