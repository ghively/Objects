/**
 * M20: a remote agent's Card tab: what its Agent Card says (spec section 1: "their card shows what
 * their Agent Card says"). Everything is plain text (React text nodes; never Markdown or HTML),
 * since the card comes from another machine. "Documentation" is a link only for an http/https URL.
 */
import type { ReactNode } from 'react'
import type { Agent } from '@/api/types'
import { REMOTE_TEXT as T } from './agentText'
import { chatDate } from './ChatsTab'

/** `url` when it is an http or https address, else null. */
export function httpUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[13px] font-semibold">{label}</span>
      <div className="text-[14px] break-words">{children}</div>
    </div>
  )
}

export function RemoteCardTab({ agent }: { agent: Agent }) {
  const remote = agent.remote
  if (!remote) return null
  const card = remote.card
  const docs = httpUrl(card.documentationUrl)
  return (
    <div className="flex flex-col gap-4" data-agent-tab="card">
      {card.description && (
        <Row label={T.description}>
          <p className="whitespace-pre-wrap" data-card-description="">
            {card.description}
          </p>
        </Row>
      )}
      {(card.provider || card.version) && (
        <div className="flex flex-wrap gap-6">
          {card.provider && <Row label={T.provider}>{card.provider}</Row>}
          {card.version && <Row label={T.version}>{card.version}</Row>}
        </div>
      )}
      {card.documentationUrl && (
        <Row label={T.documentation}>
          {docs ? (
            <a href={docs} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
              {card.documentationUrl}
            </a>
          ) : (
            <span data-card-docs="">{card.documentationUrl}</span>
          )}
        </Row>
      )}
      <div className="flex flex-wrap gap-6">
        <Row label={T.inputModes}>{card.inputModes.join(', ') || '—'}</Row>
        <Row label={T.outputModes}>{card.outputModes.join(', ') || '—'}</Row>
      </div>
      <Row label={T.skills}>
        {card.skills.length === 0 ? (
          <p className="text-fg-muted">{T.noSkills}</p>
        ) : (
          <ul aria-label={T.skills} className="flex flex-col gap-3">
            {card.skills.map((s) => (
              <li key={s.id} data-skill={s.id} className="flex flex-col gap-0.5">
                <span className="font-medium">{s.name}</span>
                {s.description && <span className="whitespace-pre-wrap text-fg-muted">{s.description}</span>}
                {s.tags.length > 0 && (
                  <span className="text-[13px] text-fg-muted">
                    {T.tags}: {s.tags.join(', ')}
                  </span>
                )}
                {s.examples.length > 0 && (
                  <span className="text-[13px] text-fg-muted">
                    {T.examples}: {s.examples.join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Row>
      <p className="text-[13px] text-fg-muted">{T.cardFetched(chatDate(remote.cardFetchedAt))}</p>
    </div>
  )
}
