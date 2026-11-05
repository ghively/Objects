// M12: a rollup property's settings: which relation, which property of the related objects, and
// how to calculate it; each choice is saved at once. Numbers it sums or averages get a format.
import type { PropertyDef, RollupCalc, TypeDef } from '@/api/types'
import { useLinkIndex } from '@/links/linkIndex'
import { NUMBER_RESULT_CALCS, ROLLUP_CALC_LABELS, rollupCalcsFor, rollupRelations, rollupTargets } from './rollup'
import { ResultNumberFormat, SettingsSection } from './shared'
import { ROLLUP_TEXT } from './texts'

const SELECT = 'min-w-0 flex-1 rounded border border-line bg-raised px-2 py-1 text-[13px]'

export function RollupSection({ type, def, save }: { type: TypeDef; def: PropertyDef; save(next: PropertyDef): void }) {
  const types = useLinkIndex((s) => s.types)
  const relations = rollupRelations(type)
  const relationId = def.options.relationId ?? ''
  const targetId = def.options.targetId ?? ''
  const calc: RollupCalc = def.options.calc ?? 'showOriginal'
  const relation = relations.find((r) => r.id === relationId)
  const targets = rollupTargets(relation, types)
  const target = targets.find((t) => t.id === targetId)
  const calcs = rollupCalcsFor(target?.kind ?? null)
  if (!calcs.includes(calc)) calcs.push(calc)

  /** Save new choices, dropping a target the relation doesn't offer and a calculation that doesn't fit. */
  const choose = (patch: { relationId?: string; targetId?: string; calc?: RollupCalc }) => {
    const nextRelationId = patch.relationId ?? relationId
    const nextTargets = rollupTargets(
      relations.find((r) => r.id === nextRelationId),
      types,
    )
    let nextTargetId = patch.targetId ?? targetId
    if (!nextTargets.some((t) => t.id === nextTargetId)) nextTargetId = ''
    let nextCalc = patch.calc ?? calc
    if (!rollupCalcsFor(nextTargets.find((t) => t.id === nextTargetId)?.kind ?? null).includes(nextCalc)) nextCalc = 'showOriginal'
    if (nextRelationId === relationId && nextTargetId === targetId && nextCalc === calc) return
    save({ ...def, options: { ...def.options, relationId: nextRelationId, targetId: nextTargetId, calc: nextCalc } })
  }

  return (
    <>
      <SettingsSection title={ROLLUP_TEXT.heading} description={ROLLUP_TEXT.description}>
        {relations.length === 0 && <p className="mb-2 text-[13px] text-fg-muted">{ROLLUP_TEXT.noRelations}</p>}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[13px]">
            <span className="w-28 text-fg-muted">{ROLLUP_TEXT.relation}</span>
            <select
              aria-label={ROLLUP_TEXT.relation}
              value={relation ? relationId : ''}
              onChange={(e) => choose({ relationId: e.target.value })}
              className={SELECT}
            >
              <option value="">{ROLLUP_TEXT.chooseRelation}</option>
              {relations.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <span className="w-28 text-fg-muted">{ROLLUP_TEXT.property}</span>
            <select
              aria-label={ROLLUP_TEXT.property}
              value={target ? targetId : ''}
              disabled={!relation}
              onChange={(e) => choose({ targetId: e.target.value })}
              className={SELECT}
            >
              <option value="">{ROLLUP_TEXT.chooseProperty}</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <span className="w-28 text-fg-muted">{ROLLUP_TEXT.calculate}</span>
            <select
              aria-label={ROLLUP_TEXT.calculate}
              value={calc}
              onChange={(e) => choose({ calc: e.target.value as RollupCalc })}
              className={SELECT}
            >
              {calcs.map((c) => (
                <option key={c} value={c}>
                  {ROLLUP_CALC_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </SettingsSection>
      {NUMBER_RESULT_CALCS.has(calc) && <ResultNumberFormat title={ROLLUP_TEXT.numberFormat} def={def} save={save} />}
    </>
  )
}
