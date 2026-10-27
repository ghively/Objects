/**
 * "Highlight text" (`tokensMenu.color.name`): the tokens menu's colour panel,
 * two sections of the 18 theme colours, "Text color" (`tokensMenu.color.title`)
 * and "Background color" (`tokensMenu.color.background`), each led by
 * "No color" (`tokensMenu.color.without`), which removes that kind's mark.
 *
 * A text colour is the `textColor` mark (`<span data-color="text-<c>">`), a
 * background colour the `highlight` mark (`<mark data-color="bg-<c>">`). The
 * swatch names are Object's `colorThemes.theme-text-<c>` /
 * `colorThemes.theme-bg-<c>` ("Blue text", "Blue background").
 */
import type { Editor } from '@tiptap/core'
import { CheckIcon } from 'lucide-react'
import { THEME_COLORS, type ThemeColor } from '@/theme/palette'
import { bgColorToken, bgTextToken, colorMenuName, textColorToken, type ColorKind } from '../menus/colors'

export const COLOR_MENU_TEXT = {
  title: 'Highlight text', // tokensMenu.color.name
  text: 'Text color', // tokensMenu.color.title
  background: 'Background color', // tokensMenu.color.background
  without: 'No color', // tokensMenu.color.without
}

/** Colour the selected text, or with `null` remove its text colour. */
export function applyTextColor(editor: Editor, color: ThemeColor | null): boolean {
  return editor.chain().focus().setTextColor(color).run()
}

/** Give the selected text a background colour, or with `null` remove it. */
export function applyHighlight(editor: Editor, color: ThemeColor | null): boolean {
  return editor.chain().focus().setHighlight(color).run()
}

/** The colour of each kind on the selection (the mark at its start), for the check marks. */
export function currentTokenColors(editor: Editor): { text: ThemeColor | null; bg: ThemeColor | null } {
  const text = editor.isActive('textColor') ? (editor.getAttributes('textColor').color as ThemeColor) : null
  const bg = editor.isActive('highlight') ? (editor.getAttributes('highlight').color as ThemeColor) : null
  return { text: text ?? null, bg: bg ?? null }
}

function Swatch({ kind, color }: { kind: ColorKind; color: ThemeColor }) {
  return kind === 'text' ? (
    <span aria-hidden data-swatch={`text-${color}`} className="tokens-swatch" style={{ color: textColorToken(color) }}>
      A
    </span>
  ) : (
    <span
      aria-hidden
      data-swatch={`bg-${color}`}
      className="tokens-swatch"
      style={{ backgroundColor: bgColorToken(color), color: bgTextToken(color) }}
    >
      A
    </span>
  )
}

function Section({
  editor,
  kind,
  current,
  onDone,
}: {
  editor: Editor
  kind: ColorKind
  current: ThemeColor | null
  onDone?: () => void
}) {
  const apply = (c: ThemeColor | null) => {
    if (kind === 'text') applyTextColor(editor, c)
    else applyHighlight(editor, c)
    onDone?.()
  }
  const title = kind === 'text' ? COLOR_MENU_TEXT.text : COLOR_MENU_TEXT.background
  return (
    <div role="group" aria-label={title} className="tokens-color-section">
      <div className="tokens-color-title">{title}</div>
      <button
        type="button"
        role="menuitem"
        className="tokens-color-row"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => apply(null)}
      >
        {COLOR_MENU_TEXT.without}
      </button>
      <div className="tokens-color-grid">
        {THEME_COLORS.map((c) => {
          const name = colorMenuName(kind, c)
          return (
            <button
              key={c}
              type="button"
              role="menuitem"
              aria-label={name}
              title={name}
              data-color-value={`${kind}-${c}`}
              aria-current={current === c || undefined}
              className="tokens-color-cell"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(c)}
            >
              <Swatch kind={kind} color={c} />
              {current === c && <CheckIcon className="tokens-color-check" aria-hidden />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface ColorMenuProps {
  editor: Editor
  /** Called after a colour is applied. */
  onDone?: () => void
}

/** The two colour sections; rendered inside the tokens menu's panel. */
export function ColorMenu({ editor, onDone }: ColorMenuProps) {
  const current = currentTokenColors(editor)
  return (
    <div role="menu" aria-label={COLOR_MENU_TEXT.title} className="tokens-color-menu">
      <Section editor={editor} kind="text" current={current.text} onDone={onDone} />
      <Section editor={editor} kind="bg" current={current.bg} onDone={onDone} />
    </div>
  )
}
