/**
 * M20: one file artifact of a remote agent's reply, as a chip under it: its name and size. A
 * `file` (saved under the agent's `files/<chatId>/`) has "Show in folder"; Object never opens it.
 * A `url` is a link only when it is http or https, with M16's chat link rules (a new window,
 * `rel="noopener noreferrer"`, opened by the OS browser); any other scheme shows as plain text.
 */
import { api } from '@/api/client'
import type { RemoteAttachment } from '@/api/types'
import { Icon } from '@/components/Icon'
import { showToast } from '@/editor/media/upload'
import { REMOTE_CHAT_TEXT as R } from './aiText'

/** "12 KB" (our format): bytes below 1 KB, whole KB below 1 MB, then MB with one decimal. */
function formatSize(size: number | null): string {
  if (size === null || !Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function httpUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

export function AttachmentChip({ agentId, attachment }: { agentId: string; attachment: RemoteAttachment }) {
  const size = formatSize(attachment.size)
  const href = attachment.kind === 'url' ? httpUrl(attachment.url) : null
  const file = attachment.kind === 'file' ? attachment.file : null
  const reveal = () => {
    if (!file) return
    api.revealAgentFile(agentId, file).catch((e: unknown) => showToast(R.revealFailed(e instanceof Error ? e.message : String(e))))
  }
  return (
    <span
      data-attachment=""
      title={attachment.name}
      className="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-md border border-line bg-raised pr-0.5 pl-2 text-[12px] text-fg"
    >
      <Icon name={attachment.kind === 'url' ? 'ph-link' : 'ph-file'} size={13} />
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="truncate underline-offset-2 hover:underline">
          {attachment.name}
        </a>
      ) : (
        <span className="truncate">{attachment.name}</span>
      )}
      {size && <span className="shrink-0 text-fg-muted">{size}</span>}
      {file && (
        <button
          type="button"
          aria-label={R.showInFolder}
          title={R.showInFolder}
          onClick={reveal}
          className="flex size-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Icon name="ph-folder-open" size={13} />
        </button>
      )}
    </span>
  )
}
