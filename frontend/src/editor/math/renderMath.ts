/**
 * KaTeX rendering for math blocks and inline formulas (Object's `MathBlock`
 * and inline math token). Never throws: invalid TeX comes back as KaTeX's
 * error colouring (`throwOnError: false`), and anything KaTeX itself throws on
 * is shown as escaped source text. `trust: false` keeps `\href`, `\url`,
 * `\includegraphics` and friends inert.
 *
 * The stylesheet is bundled locally (its font URLs are relative to the CSS
 * file, so Vite copies the fonts into the build); no network request is made.
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'

export type RenderMathOptions = { display: boolean }

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** The formula as HTML (KaTeX's HTML and MathML), safe to set as `innerHTML`. */
export function renderMath(text: string, opts: RenderMathOptions): string {
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
