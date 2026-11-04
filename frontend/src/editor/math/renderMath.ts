/**
 * KaTeX rendering for math blocks and inline formulas. Never throws: invalid TeX comes back as KaTeX's
 * error colouring (`throwOnError: false`), and anything KaTeX itself throws on
 * is shown as escaped source text. `trust: false` keeps `\href`, `\url`,
 * `\includegraphics` and friends inert.
 *
 * KaTeX (448 KB with its stylesheet) loads on the first formula, not with the
 * app (audit 2026-11-01 F1). Until it has loaded, `renderMath` returns the
 * escaped source in a `math-pending` span and starts the load; the views
 * re-render through `useMathReady` once it is there, with the same output as
 * before. The stylesheet is bundled locally (its font URLs are relative to the
 * CSS file, so Vite copies the fonts into the build); no network request is made.
 */
import { useEffect, useState } from 'react'
import type katexType from 'katex'

type Katex = typeof katexType

export type RenderMathOptions = { display: boolean }

let katex: Katex | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Load KaTeX and its stylesheet once; resolved when `renderMath` renders for real. */
export function loadMath(): Promise<void> {
  if (katex) return Promise.resolve()
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([mod]) => {
    katex = mod.default
    for (const fn of listeners) fn()
  })
  return loading
}

/** Has KaTeX loaded? */
export function mathReady(): boolean {
  return katex !== null
}

/** Run `fn` when KaTeX has loaded (never when it already has); returns the unsubscribe. */
function onMathReady(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** True once KaTeX has loaded; a view using it re-renders then. */
export function useMathReady(): boolean {
  const [ready, setReady] = useState(mathReady)
  useEffect(() => {
    if (ready) return
    if (mathReady()) {
      setReady(true)
      return
    }
    return onMathReady(() => setReady(true))
  }, [ready])
  return ready
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/**
 * The formula as HTML (KaTeX's HTML and MathML), safe to set as `innerHTML`.
 * Before KaTeX has loaded: the source text, and the load is started.
 */
export function renderMath(text: string, opts: RenderMathOptions): string {
  if (!katex) {
    void loadMath()
    return `<span class="math-pending">${escapeHtml(text)}</span>`
  }
  try {
    return katex.renderToString(text, {
      displayMode: opts.display,
      throwOnError: false,
      trust: false,
      output: 'htmlAndMathml',
      strict: 'ignore',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `<span class="katex-error" title="${escapeHtml(message)}">${escapeHtml(text)}</span>`
  }
}

const BLANK_LINES = /(\n[ \t]*\n(?:[ \t]*\n)*)/

/** Whether `tex` closes every `{` group and every `\begin{…}` environment it opens. */
function balanced(tex: string): boolean {
  let braces = 0
  let envs = 0
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i]
    if (c === '\\') {
      const name = /^[a-zA-Z]+/.exec(tex.slice(i + 1))?.[0]
      if (name === 'begin') envs++
      else if (name === 'end') envs--
      i += name ? name.length : 1
    } else if (c === '{') braces++
    else if (c === '}') braces--
  }
  return braces <= 0 && envs <= 0
}

/**
 * The rows of a display formula: TeX ignores a blank line, so a math block
 * with two formulas on lines of their own, a blank line between them, would
 * run them together on one line (known issue 7). Each blank-line-separated
 * part is its own row, except where a `{` group or an environment is still
 * open across the blank line (TeX's own reading is kept there). The source is
 * not changed; this only decides how it is drawn.
 */
export function displayMathRows(text: string): string[] {
  const pieces = text.split(BLANK_LINES)
  const rows: string[] = []
  let acc = ''
  for (let i = 0; i < pieces.length; i++) {
    // A separator only joins two parts of one row (an open group across the blank line).
    if (i % 2 === 1) {
      if (acc) acc += pieces[i]
      continue
    }
    acc += pieces[i]
    if (!acc.trim()) {
      acc = ''
      continue
    }
    if (balanced(acc)) {
      rows.push(acc)
      acc = ''
    }
  }
  const rest = acc.replace(/\s+$/, '')
  if (rest.trim()) rows.push(rest)
  return rows
}

/** A math block's formula as HTML: one KaTeX display row per `displayMathRows` row. */
export function renderDisplayMath(text: string): string {
  return displayMathRows(text)
    .map((row) => renderMath(row, { display: true }))
    .join('')
}
