/**
 * Generates a synthetic ~1 MB body with 300 GFM tables (Review Focus 4).
 * Generated rather than committed so the repo stays small; it is deterministic.
 */
export function makeBigBody(tables = 300, targetBytes = 1_000_000): string {
  const perTable = Math.ceil(targetBytes / tables)
  const parts: string[] = ['# Inventory', '']
  for (let t = 0; t < tables; t++) {
    parts.push(`## Rack ${t}`, '', `Notes for rack ${t}: see [[Server ${t}]].`, '')
    parts.push('| Host | Role | Port | Owner |', '| --- | --- | --- | --- |')
    let size = 0
    for (let r = 0; size < perTable - 200; r++) {
      const row = `| host-${t}-${r} | role-${r % 7} | ${1000 + r} | team-${(t * r) % 13} |`
      parts.push(row)
      size += row.length + 1
    }
    parts.push('')
  }
  return parts.join('\n')
}
