// The sidebar footer's backup line (2026-11-08): when version control is on for the open space,
// a quiet "Backed up 5 min ago" / "Saved just now", or "Backup problem" in the danger colour.
// Clicking it opens Space history; its tooltip carries the detail (the error, the counts).
// Nothing shows while version control is off.
import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useTabs } from '@/nav/tabs'
import { useVcsStatus, VCS_POLL_MS } from './useVcsStatus'
import { statusLine, VCS_TEXT } from './vcsText'

export function VcsStatusIndicator() {
  const status = useVcsStatus((s) => s.space)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    void useVcsStatus.getState().refresh()
    const timer = setInterval(() => {
      setNow(Date.now())
      void useVcsStatus.getState().refresh()
    }, VCS_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  const line = statusLine(status, now)
  if (!line) return null
  const detail = [
    status?.error?.message,
    status?.remote?.diverged ? VCS_TEXT.diverged(status.remote.ahead ?? 0, status.remote.behind ?? 0) : null,
    status?.pending ? VCS_TEXT.pending(status.pending) : null,
    status?.remote ? null : VCS_TEXT.noRemote,
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <button
      type="button"
      data-vcs-status={line.tone}
      title={detail || line.text}
      onClick={() => useTabs.getState().open({ kind: 'spaceHistory' })}
      className={`ml-auto flex h-8 min-w-0 items-center gap-1 rounded-md px-1.5 text-[12px] hover:bg-hover ${
        line.tone === 'danger' ? 'text-[var(--danger)]' : 'text-fg-muted hover:text-fg'
      }`}
    >
      <Icon name={line.tone === 'danger' ? 'ph-warning-circle' : 'ph-git-commit'} size={14} />
      <span className="truncate">{line.text}</span>
    </button>
  )
}
