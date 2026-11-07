/**
 * M27 the agent workflow after an import into the open space: Proposed schema -> Trial ->
 * Normalise -> the Import inbox count with a link to that collection (design sections 8-10).
 */
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { FilingMergeSuggestion } from '@/api/types'
import { Button } from '@/components/ui/button'
import { useTabs } from '@/nav/tabs'
import { NormaliseStep } from './NormaliseStep'
import { ProposalStep } from './ProposalStep'
import { AGENT_TEXT as T } from './text'
import { TrialStep } from './TrialStep'

type Stage = 'proposal' | 'trial' | 'normalise' | 'done'

export function AgentFlow({ batch, onClose, initial = 'proposal' }: { batch: string; onClose: () => void; initial?: Stage }) {
  const [stage, setStage] = useState<Stage>(initial)
  const [merges, setMerges] = useState<FilingMergeSuggestion[]>([])
  return (
    <div className="flex flex-col gap-4">
      {stage === 'proposal' && <ProposalStep batch={batch} onApplied={() => setStage('trial')} onSkip={() => setStage('trial')} />}
      {stage === 'trial' && (
        <TrialStep
          batch={batch}
          onDone={(s) => {
            setMerges(s.normalise)
            setStage('normalise')
          }}
        />
      )}
      {stage === 'normalise' && <NormaliseStep batch={batch} suggestions={merges} onDone={() => setStage('done')} />}
      {stage === 'done' && <InboxStep onClose={onClose} />}
    </div>
  )
}

function InboxStep({ onClose }: { onClose: () => void }) {
  const [inbox, setInbox] = useState<{ id: string; count: number } | null | undefined>(undefined)
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
