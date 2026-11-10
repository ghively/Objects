/**
 * M27 the agent workflow after an import into the open space: Proposed schema -> Trial ->
 * Normalise -> the Import inbox count with a link to that collection (design sections 8-10).
 * M30: on a batch kept as Sources, the Entities step comes between Trial and Normalise.
 */
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { FilingMergeSuggestion, FilingStatus } from '@/api/types'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/nav/tabs'
import { EntitiesStep } from './EntitiesStep'
import { NormaliseStep } from './NormaliseStep'
import { ProposalStep } from './ProposalStep'
import { AGENT_TEXT as T } from './text'
import { TrialStep } from './TrialStep'

export type Stage = 'proposal' | 'trial' | 'entities' | 'normalise' | 'done'

export function AgentFlow({ batch, onClose, initial = 'proposal' }: { batch: string; onClose: () => void; initial?: Stage }) {
  const [stage, setStage] = useState<Stage>(initial)
  const [merges, setMerges] = useState<FilingMergeSuggestion[]>([])
  const toNormalise = (s: FilingStatus) => {
    setMerges(s.normalise)
    setStage('normalise')
  }
  return (
    <div className="flex flex-col gap-4">
      {stage === 'proposal' && <ProposalStep batch={batch} onApplied={() => setStage('trial')} onSkip={() => setStage('trial')} />}
      {stage === 'trial' && (
        <TrialStep
          batch={batch}
          onDone={(s) => {
            // A Write already running (a reopened dialog) is the Entities step's too: it follows the Write.
            if (s.state === 'entities' || s.state === 'writing') setStage('entities')
            else toNormalise(s)
          }}
        />
      )}
      {stage === 'entities' && <EntitiesStep batch={batch} onDone={toNormalise} />}
      {stage === 'normalise' && <NormaliseStep batch={batch} suggestions={merges} onDone={() => setStage('done')} />}
      {stage === 'done' && <InboxStep batch={batch} onClose={onClose} />}
    </div>
  )
}

type InboxRow = NonNullable<FilingStatus['inbox']>[number]

function InboxStep({ batch, onClose }: { batch: string; onClose: () => void }) {
  const [inbox, setInbox] = useState<{ id: string; count: number } | null | undefined>(undefined)
  // This batch's rows and why each went there (from the filing status; none when it cannot say).
  const [rows, setRows] = useState<InboxRow[]>([])
  useEffect(() => {
    let alive = true
    api
      .filingStatus(batch)
      .then((s) => alive && setRows(Array.isArray(s?.inbox) ? s.inbox : []))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [batch])
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const found = (await api.collections()).find((c) => c.name.toLowerCase() === T.inboxName.toLowerCase())
        if (!found) return alive && setInbox(null)
        const rows = await api.rows({ collectionIds: [found.id], preview: false })
        if (alive) setInbox({ id: found.id, count: rows.length })
      } catch {
        if (alive) setInbox(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [])
  const open = () => {
    if (!inbox) return
    onClose()
    useTabs.getState().open({ kind: 'collection', id: inbox.id })
  }
  return (
    <section aria-labelledby="inbox-heading" className="flex flex-col gap-3">
      <h3 id="inbox-heading" tabIndex={-1} className="text-[14px] font-semibold outline-none">
        {T.doneHeading}
      </h3>
      {inbox === undefined ? (
        <p className="text-[13px] text-fg-muted">{T.loading}</p>
      ) : (
        <p role="status" className="text-[14px]">
          {inbox && inbox.count > 0 ? T.inboxCount(inbox.count) : T.inboxEmpty}
        </p>
      )}
      {rows.length > 0 && (
        <ul aria-label={T.doneHeading} className="flex flex-col gap-1 text-[13px] text-fg-muted">
          {rows.map((r) => (
            <li key={`${r.path}\n${r.reason}`}>{T.inboxReason(r.title, r.reason)}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant={inbox ? 'ghost' : 'default'} onClick={onClose}>
          {T.close}
        </Button>
        {inbox && (
          <Button type="button" onClick={open}>
            {T.openInbox}
          </Button>
        )}
      </div>
    </section>
  )
}
