import type { ReadToolServer } from '@/api/types'
import { SettingGroup } from '@/settings/controls'
import { WORK_AGENT_TEXT as T } from './workAgentText'

/** Per server: its tools, each with a checkbox (marked = may run in read-only runs). */
export function ReadToolsList({
  servers,
  marked,
  onChange,
}: {
  servers: ReadToolServer[]
  marked: string[]
  onChange(next: string[]): void
}) {
  const toggle = (id: string, on: boolean) =>
    onChange(on ? (marked.includes(id) ? marked : [...marked, id]) : marked.filter((m) => m !== id))
  const markServerReadOnly = (s: ReadToolServer) => {
    const add = s.tools.filter((t) => t.serverSaysReadOnly).map((t) => t.id)
    onChange([...marked, ...add.filter((id) => !marked.includes(id))])
  }
  return (
    <SettingGroup title={T.readTools} help={T.readToolsHelp}>
      {servers.length === 0 && <p className="text-[13px] text-fg-muted">{T.noServers}</p>}
      {servers.map((s) => (
        <div key={s.name} role="group" aria-label={s.name} className="flex flex-col gap-1 py-1">
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-semibold">{s.name}</span>
            {s.listed && s.tools.some((t) => t.serverSaysReadOnly) && (
              <button type="button" className="text-[13px] text-fg-muted underline" onClick={() => markServerReadOnly(s)}>
                {T.markReadOnly}
              </button>
            )}
          </div>
          {!s.listed && <p className="text-[13px] text-fg-muted">{T.notListed}</p>}
          {s.listed &&
            s.tools.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-[14px]" title={t.description}>
                <input type="checkbox" checked={marked.includes(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} />
                <span>{t.name}</span>
                {t.serverSaysReadOnly && (
                  <span className="rounded border border-line px-1 text-[11px] text-fg-muted">{T.serverReadOnly}</span>
                )}
              </label>
            ))}
        </div>
      ))}
    </SettingGroup>
  )
}
