/**
 * The code block's languages (our list: Object's own list is not in the
 * trimmed reference set). `id` is what goes after the opening fence, `label`
 * is shown in the "Select language" picker, `ext` names a downloaded file.
 * Plain text is the empty language (a bare fence).
 */
export type Language = { id: string; label: string; ext: string; aliases?: string[] }

export const PLAIN_TEXT: Language = { id: '', label: 'Plain text', ext: 'txt', aliases: ['text', 'plaintext', 'txt'] }

export const LANGUAGES: readonly Language[] = [
  PLAIN_TEXT,
  { id: 'bash', label: 'Bash', ext: 'sh', aliases: ['sh', 'shell', 'zsh'] },
  { id: 'c', label: 'C', ext: 'c' },
  { id: 'cpp', label: 'C++', ext: 'cpp', aliases: ['c++'] },
  { id: 'csharp', label: 'C#', ext: 'cs', aliases: ['cs', 'c#'] },
  { id: 'css', label: 'CSS', ext: 'css' },
  { id: 'diff', label: 'Diff', ext: 'diff', aliases: ['patch'] },
  { id: 'dockerfile', label: 'Dockerfile', ext: 'dockerfile', aliases: ['docker'] },
  { id: 'go', label: 'Go', ext: 'go', aliases: ['golang'] },
  { id: 'graphql', label: 'GraphQL', ext: 'graphql' },
  { id: 'html', label: 'HTML', ext: 'html', aliases: ['xhtml'] },
  { id: 'ini', label: 'INI', ext: 'ini', aliases: ['toml'] },
  { id: 'java', label: 'Java', ext: 'java' },
  { id: 'javascript', label: 'JavaScript', ext: 'js', aliases: ['js', 'jsx'] },
  { id: 'json', label: 'JSON', ext: 'json' },
  { id: 'kotlin', label: 'Kotlin', ext: 'kt' },
  { id: 'latex', label: 'LaTeX', ext: 'tex', aliases: ['tex'] },
  { id: 'lua', label: 'Lua', ext: 'lua' },
  { id: 'makefile', label: 'Makefile', ext: 'mk', aliases: ['make'] },
  { id: 'markdown', label: 'Markdown', ext: 'md', aliases: ['md'] },
  { id: 'mermaid', label: 'Mermaid', ext: 'mmd' },
  { id: 'nginx', label: 'Nginx', ext: 'conf' },
  { id: 'php', label: 'PHP', ext: 'php' },
  { id: 'powershell', label: 'PowerShell', ext: 'ps1', aliases: ['ps1', 'pwsh'] },
  { id: 'python', label: 'Python', ext: 'py', aliases: ['py'] },
  { id: 'r', label: 'R', ext: 'r' },
  { id: 'ruby', label: 'Ruby', ext: 'rb', aliases: ['rb'] },
  { id: 'rust', label: 'Rust', ext: 'rs', aliases: ['rs'] },
  { id: 'scss', label: 'SCSS', ext: 'scss', aliases: ['sass'] },
  { id: 'sql', label: 'SQL', ext: 'sql' },
  { id: 'swift', label: 'Swift', ext: 'swift' },
  { id: 'typescript', label: 'TypeScript', ext: 'ts', aliases: ['ts', 'tsx'] },
  { id: 'xml', label: 'XML', ext: 'xml', aliases: ['svg'] },
  { id: 'yaml', label: 'YAML', ext: 'yaml', aliases: ['yml'] },
]

/** The language for a fence's info string (by id or alias, case-insensitive); unknown ids keep their own name. */
export function languageOf(id: string | null | undefined): Language {
  const key = (id ?? '').trim().toLowerCase()
  if (!key) return PLAIN_TEXT
  const found = LANGUAGES.find((l) => l.id === key || l.aliases?.includes(key))
  return found ?? { id: id!.trim(), label: id!.trim(), ext: 'txt' }
}

/** The languages whose code block has a preview ("Edit" / "Edit & Display" / "Display"). */
export function hasPreview(id: string | null | undefined): 'markdown' | 'mermaid' | null {
  const lang = languageOf(id).id
  return lang === 'markdown' || lang === 'mermaid' ? lang : null
}

/** The picker's matches for `query` (label, id or alias contains it). */
export function filterLanguages(query: string): Language[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...LANGUAGES]
  return LANGUAGES.filter(
    (l) => l.label.toLowerCase().includes(q) || l.id.includes(q) || l.aliases?.some((a) => a.includes(q)),
  )
}
