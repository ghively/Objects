/**
 * The code block's languages (our list: Object's own list is not in the
 * trimmed reference set). `id` is what goes after the opening fence, `label`
 * is shown in the "Select language" picker, `ext` names a downloaded file.
 * Plain text is the empty language (a bare fence).
 *
 * `hljs` names the highlight.js grammar that colours the block (`code/highlight.ts`
 * registers exactly these). Plain text and Mermaid have none, so they stay
 * unhighlighted (highlight.js ships no Mermaid grammar; our choice).
 */
export type Language = { id: string; label: string; ext: string; aliases?: string[]; hljs?: string }

export const PLAIN_TEXT: Language = { id: '', label: 'Plain text', ext: 'txt', aliases: ['text', 'plaintext', 'txt'] }

export const LANGUAGES: readonly Language[] = [
  PLAIN_TEXT,
  { id: 'bash', label: 'Bash', ext: 'sh', aliases: ['sh', 'shell', 'zsh'], hljs: 'bash' },
  { id: 'c', label: 'C', ext: 'c', hljs: 'c' },
  { id: 'cpp', label: 'C++', ext: 'cpp', aliases: ['c++'], hljs: 'cpp' },
  { id: 'csharp', label: 'C#', ext: 'cs', aliases: ['cs', 'c#'], hljs: 'csharp' },
  { id: 'css', label: 'CSS', ext: 'css', hljs: 'css' },
  { id: 'diff', label: 'Diff', ext: 'diff', aliases: ['patch'], hljs: 'diff' },
  { id: 'dockerfile', label: 'Dockerfile', ext: 'dockerfile', aliases: ['docker'], hljs: 'dockerfile' },
  { id: 'go', label: 'Go', ext: 'go', aliases: ['golang'], hljs: 'go' },
  { id: 'graphql', label: 'GraphQL', ext: 'graphql', hljs: 'graphql' },
  { id: 'html', label: 'HTML', ext: 'html', aliases: ['xhtml'], hljs: 'xml' },
  { id: 'ini', label: 'INI', ext: 'ini', aliases: ['toml'], hljs: 'ini' },
  { id: 'java', label: 'Java', ext: 'java', hljs: 'java' },
  { id: 'javascript', label: 'JavaScript', ext: 'js', aliases: ['js', 'jsx'], hljs: 'javascript' },
  { id: 'json', label: 'JSON', ext: 'json', hljs: 'json' },
  { id: 'kotlin', label: 'Kotlin', ext: 'kt', hljs: 'kotlin' },
  { id: 'latex', label: 'LaTeX', ext: 'tex', aliases: ['tex'], hljs: 'latex' },
  { id: 'lua', label: 'Lua', ext: 'lua', hljs: 'lua' },
  { id: 'makefile', label: 'Makefile', ext: 'mk', aliases: ['make'], hljs: 'makefile' },
  { id: 'markdown', label: 'Markdown', ext: 'md', aliases: ['md'], hljs: 'markdown' },
  { id: 'mermaid', label: 'Mermaid', ext: 'mmd' },
  { id: 'nginx', label: 'Nginx', ext: 'conf', hljs: 'nginx' },
  { id: 'php', label: 'PHP', ext: 'php', hljs: 'php' },
  { id: 'powershell', label: 'PowerShell', ext: 'ps1', aliases: ['ps1', 'pwsh'], hljs: 'powershell' },
  { id: 'python', label: 'Python', ext: 'py', aliases: ['py'], hljs: 'python' },
  { id: 'r', label: 'R', ext: 'r', hljs: 'r' },
  { id: 'ruby', label: 'Ruby', ext: 'rb', aliases: ['rb'], hljs: 'ruby' },
  { id: 'rust', label: 'Rust', ext: 'rs', aliases: ['rs'], hljs: 'rust' },
  { id: 'scss', label: 'SCSS', ext: 'scss', aliases: ['sass'], hljs: 'scss' },
  { id: 'sql', label: 'SQL', ext: 'sql', hljs: 'sql' },
  { id: 'swift', label: 'Swift', ext: 'swift', hljs: 'swift' },
  { id: 'typescript', label: 'TypeScript', ext: 'ts', aliases: ['ts', 'tsx'], hljs: 'typescript' },
  { id: 'xml', label: 'XML', ext: 'xml', aliases: ['svg'], hljs: 'xml' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', aliases: ['yml'], hljs: 'yaml' },
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
