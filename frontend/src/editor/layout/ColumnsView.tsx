/**
 * The columns block's node view ("Two Columns"):
 * - a CSS grid with one track per column at its `widths` (even when absent);
 * - a `Divider` between columns that drags and writes `widths` on release;
 * - on hover, "Column layout" with "Columns" and
 *   "Grid" (Grid writes `layout=grid`
 *   and wraps the columns into a responsive grid, without dividers), and
 *   "Add column" / "Remove column" (our strings), between 1 and 6 columns,
 *   redistributing widths evenly;
 * - the container's `color` option, painted like a block colour.
 */
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { LayoutGrid, Minus, Plus } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Option } from '../annotations'
import { renderOptions } from '../nodes/blockOptions'
import { Divider, MAX_COLUMNS, evenWidths, parseWidths } from './Divider'

/** The gap between columns, in pixels (our value). */
export const COLUMN_GAP = 24

/** `color: var(--x); background-color: var(--y);` -> a React style object. */
export function styleObject(css: string | undefined): CSSProperties {
  const out: Record<string, string> = {}
  for (const part of (css ?? '').split(';')) {
    const at = part.indexOf(':')
    if (at < 0) continue
    const key = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim()
    if (!key) continue
    out[key.startsWith('--') ? key : key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value
  }
  return out as CSSProperties
}

/** Options rendered as `data-block-*` attributes plus the colour as a style object. */
export function optionAttributes(options: Option[] | null | undefined): { attrs: Record<string, string>; style: CSSProperties } {
  const { style, ...attrs } = renderOptions(options)
  return { attrs, style: styleObject(style) }
}

/** The grid tracks for `widths` (fractions keep the gaps out of the sum). */
export function gridTemplate(widths: readonly number[] | null, count: number): string {
  if (!widths) return `repeat(${count}, minmax(0, 1fr))`
  return widths.map((w) => `minmax(0, ${w}fr)`).join(' ')
}

/** CSS `left` of the divider after column `index`: the columns before it plus the gaps, then half a gap. */
export function dividerLeft(widths: readonly number[], index: number): string {
  const n = widths.length
  const before = widths.slice(0, index + 1).reduce((a, b) => a + b, 0)
  return `calc((100% - ${(n - 1) * COLUMN_GAP}px) * ${before / 100} + ${index * COLUMN_GAP + COLUMN_GAP / 2}px)`
}

export function ColumnsView({ node, editor, getPos }: NodeViewProps) {
  const options = node.attrs.blockOptions as Option[] | null
  const count = node.childCount
  const stored = parseWidths(options, count)
  const [preview, setPreview] = useState<number[] | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const layout = options?.some((o) => o.key === 'layout' && o.value === 'grid') ? 'grid' : 'columns'
  const editable = editor.isEditable
  const shown = preview ?? stored
  const widths = shown ?? evenWidths(count)
  const { attrs, style } = optionAttributes(options)

  const pos = () => {
    const p = getPos()
    return typeof p === 'number' ? p : null
  }
  const run = (fn: (p: number) => boolean) => {
    const p = pos()
    if (p != null) fn(p)
  }

  const trackWidth = () => {
    const width = body.current?.getBoundingClientRect().width ?? 0
    return width - (count - 1) * COLUMN_GAP
  }

  return (
    <NodeViewWrapper
      {...attrs}
      className="block-columns"
      data-columns={String(count)}
      data-layout={layout}
      style={{
        ...style,
        '--columns-template': layout === 'grid' ? undefined : gridTemplate(shown, count),
        '--columns-gap': `${COLUMN_GAP}px`,
      }}
    >
      {editable && (
        <div className="block-columns-bar" contentEditable={false}>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" className="block-layout-btn" aria-label="Column layout" title="Column layout">
                <LayoutGrid size={14} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuLabel>Column layout</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={layout}
                onValueChange={(v) => run((p) => editor.chain().setColumnsLayout(p, v === 'grid' ? 'grid' : 'columns').run())}
              >
                <DropdownMenuRadioItem value="columns">Columns</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="grid">Grid</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className="block-layout-btn"
            aria-label="Add column"
            title="Add column"
            disabled={count >= MAX_COLUMNS}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run((p) => editor.chain().addColumn(p).run())}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="block-layout-btn"
            aria-label="Remove column"
            title="Remove column"
            disabled={count <= 1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run((p) => editor.chain().removeColumn(p).run())}
          >
            <Minus size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="block-columns-body" ref={body}>
        <NodeViewContent className="block-columns-grid" />
        {editable &&
          layout === 'columns' &&
          widths.slice(0, -1).map((_, i) => (
            <Divider
              key={i}
              index={i}
              widths={widths}
              left={dividerLeft(widths, i)}
              trackWidth={trackWidth}
              onPreview={setPreview}
              onCommit={(next) => run((p) => editor.chain().setColumnWidths(p, next).run())}
            />
          ))}
      </div>
    </NodeViewWrapper>
  )
}
