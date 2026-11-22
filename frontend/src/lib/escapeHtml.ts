/**
 * Escape text for safe interpolation into HTML, in text nodes and quoted attributes alike: the
 * five characters that can start markup or an entity (`& < > " '`) become numeric character
 * references, which no HTML or XML parser treats specially in either context.
 *
 * One shared copy for every renderer that builds HTML strings (`ai/markdown`, the editor's
 * `renderMath`, `TextBlockCell`). The three local copies it replaced all escaped exactly these
 * five characters; the numeric form is the math renderer's, whose test pins it.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
