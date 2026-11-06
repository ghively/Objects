// M23 Task 14: Verified and Assumed as two columns, To raise confidence under them.
import type { JSX } from 'react'
import { WORK_TEXT } from '../workText'

function Column({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section aria-label={title} className="min-w-0 flex-1">
      <h4 className="text-[12px] font-semibold text-fg-muted">{title}</h4>
      {lines.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-[13px] text-fg">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-fg-muted">-</p>
      )}
    </section>
  )
}

export function EvidenceColumns({
  verified,
  assumed,
  toRaise,
}: {
  verified: string[]
  assumed: string[]
  toRaise: string[]
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-4">
        <Column title={WORK_TEXT.verified} lines={verified} />
        <Column title={WORK_TEXT.assumed} lines={assumed} />
      </div>
      {toRaise.length > 0 && <Column title={WORK_TEXT.toRaiseConfidence} lines={toRaise} />}
    </div>
  )
}
