/**
 * M32: what a rename does to a note's text, as the server does it (`Space.rename_object`).
 *
 * A rename rewrites the first `# Old title` heading of the body to `# New title` in the same
 * write that changes the title. The view that renamed the note still holds the text from before,
 * and goes on saving on the version the rename answered: without the same rewrite on its side its
 * next save would put the old heading back over the new one, with no conflict to stop it.
 *
 * The server's rule, mirrored line for line: the lines that are `#`, spaces or tabs, text, then
 * any closing spaces, tabs and `#`s are looked at in order; one inside a fenced code block is
 * skipped; the first whose text (trimmed) is exactly the old title is replaced by `# <new title>`,
 * and nothing else changes. No such line: the text is returned as it is. A `\r` before the line
 * break is kept (the server only ever sees `\n`; a text that still has `\r\n` keeps it).
 */

/** A fence line: up to three spaces, then three or more backticks or tildes (`relink._FENCE_RE`). */
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** A level-one heading line (`space._HEADING_RE`), matched against one line without its break. */
const HEADING = /^#[ \t]+([\s\S]+?)[ \t#]*$/

/** `body` with its first `# <oldTitle>` heading outside a code fence reading `# <newTitle>`. */
export function retitledBody(body: string, oldTitle: string, newTitle: string): string {
  // The server collapses the new title's whitespace before it compares or writes.
  const title = newTitle.split(/\s+/).filter(Boolean).join(' ')
  if (!title || title === oldTitle) return body
  let fence: string | null = null
  let pos = 0
  for (;;) {
    const nl = body.indexOf('\n', pos)
    const end = nl === -1 ? body.length : nl
    const cr = end > pos && body[end - 1] === '\r' ? 1 : 0
    const line = body.slice(pos, end - cr)
    const f = line.includes('```') || line.includes('~~~') ? FENCE.exec(line) : null
    if (fence !== null) {
      // Closed by a fence of the same character, at least as long, with nothing after it.
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null
    } else if (f && !(f[1][0] === '`' && line.slice(f[0].length).includes('`'))) {
      fence = f[1]
    } else {
      const m = HEADING.exec(line)
      if (m && m[1].trim() === oldTitle) return `${body.slice(0, pos)}# ${title}${body.slice(end - cr)}`
    }
    if (nl === -1) return body
    pos = nl + 1
  }
}
