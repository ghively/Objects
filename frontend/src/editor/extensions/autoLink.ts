/**
 * Which typed or pasted words become web links on their own (the Link extension's
 * `shouldAutoLink`).
 *
 * M32: a bare word ending in a file extension is a file name, not an address. Several common
 * extensions are also web endings (`.md` Moldova, `.py` Paraguay, `.sh`, `.rs`, `.pl`, `.cc`,
 * `.zip`, `.mov`), so `notes.md` and `config.py` used to turn into links to sites nobody meant.
 * A real address still links: one with a protocol (`https://…`), one starting `www.`, one with a
 * path, query or port (`docs.rs/serde`), a mail address, and any name whose ending is not in the
 * list (`example.com`, `notion.so`).
 */

/**
 * File extensions that are not linked as a bare `name.ext` (lower case, our list). The ones that
 * are also web endings are what this is for; the others are listed so the rule reads as "file
 * names", whatever the link finder knows about endings.
 */
export const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  // notes and text
  'md', 'markdown', 'txt', 'log', 'csv', 'tsv', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // code
  'py', 'sh', 'rs', 'ts', 'tsx', 'js', 'jsx', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'go', 'java', 'kt', 'rb', 'php', 'pl',
  'lua', 'swift', 'ml', 'sql', 'html', 'htm', 'css', 'scss', 'bat', 'cmd', 'ps1',
  // configuration and data
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'xml', 'lock', 'tf',
  // archives, media, binaries
  'zip', 'tar', 'gz', 'mov', 'mp3', 'mp4', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'exe', 'dll', 'bak', 'tmp',
])

/** True when `word` reads as a file name: a bare `name.ext` with nothing that makes it an address. */
export function looksLikeFileName(word: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(word) || word.includes('@') || /^www\./i.test(word)) return false
  if (/[/?#:]/.test(word)) return false
  const ext = /\.([a-z0-9]+)$/i.exec(word)?.[1].toLowerCase()
  return ext !== undefined && FILE_EXTENSIONS.has(ext)
}

/**
 * The Link extension's own rule (a protocol, or a host name with a dot that is not an IP
 * address), minus file names.
 */
export function shouldAutoLink(url: string): boolean {
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
  const hasMaybeProtocol = /^[a-z][a-z0-9+.-]*:/i.test(url)
  if (hasProtocol || (hasMaybeProtocol && !url.includes('@'))) return true
  const hostname = (url.includes('@') ? (url.split('@').pop() ?? '') : url).split(/[/?#:]/)[0]
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false
  if (!/\./.test(hostname)) return false
  return !looksLikeFileName(url)
}
