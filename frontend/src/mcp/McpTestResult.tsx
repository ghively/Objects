/**
 * M19: a server's Test result, shown under its row in Settings > Integrations > MCP servers:
 * "Testing…" while it runs, then "Tools (n)" with one line per tool (name and description), or
 * the error (already redacted by the server); the row above says "Test failed".
 */
import type { McpTestResult as McpTestResultData } from '@/api/types'
import { MCP_TEXT as T } from './mcpText'

export function McpTestResult({ result, testing }: { result: McpTestResultData | null; testing: boolean }) {
  if (testing) {
    return (
      <p role="status" className="text-[12px] text-fg-muted">
        {T.testing}
      </p>
    )
  }
  if (!result) return null
  if (!result.ok) {
    return (
      <p role="alert" className="text-[12px] break-words text-[var(--danger)]">
        {result.error}
      </p>
    )
  }
  const heading = T.tools(result.tools.length)
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[12px] font-semibold text-fg">{heading}</p>
      <ul aria-label={heading} className="flex flex-col gap-0.5">
        {result.tools.map((t) => (
          <li key={t.name} className="flex min-w-0 gap-2 text-[12px]">
            <span className="shrink-0 font-mono text-fg">{t.name}</span>
            {t.description && <span className="min-w-0 truncate text-fg-muted">{t.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
