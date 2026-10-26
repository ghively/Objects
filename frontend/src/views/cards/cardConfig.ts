// Which properties a small card shows: the view's override, else the type's, else the default.
import type { DataViewDefinition, SmallCardViewConfig, TypeDef } from '@/api/types'
import { defaultSmallCard } from '../model'

export type CardProperty = SmallCardViewConfig['properties'][number]

/** The properties a card of `type` shows in a view with definition `view`. */
export function cardProperties(
  type: Pick<TypeDef, 'id' | 'propertyDefinitions' | 'smallCardViewConfig'>,
  view?: Partial<DataViewDefinition> | null,
): CardProperty[] {
  const own = view?.smallCardViewConfigs?.[type.id]
  if (own) return own.properties
  if (type.smallCardViewConfig) return type.smallCardViewConfig.properties
  return defaultSmallCard(type).properties
}

/** Whether the view uses the type's own card settings ("Use default" on). */
export const usesDefaultCard = (type: Pick<TypeDef, 'id'>, view: DataViewDefinition): boolean =>
  !view.smallCardViewConfigs?.[type.id]

/** "Use default" on removes the override; off copies the type default into the view. */
export function setUseDefault(type: TypeDef, view: DataViewDefinition, useDefault: boolean): DataViewDefinition {
  const configs = { ...view.smallCardViewConfigs }
  if (useDefault) delete configs[type.id]
  else configs[type.id] = { entityViewType: 'smallCard', properties: cardProperties(type).map((p) => ({ ...p })) }
  return { ...view, smallCardViewConfigs: Object.keys(configs).length ? configs : undefined }
}

/** Replace the view's override for `type` (turns "Use default" off). */
export function setCardProperties(type: TypeDef, view: DataViewDefinition, properties: CardProperty[]): DataViewDefinition {
  return {
    ...view,
    smallCardViewConfigs: { ...view.smallCardViewConfigs, [type.id]: { entityViewType: 'smallCard', properties } },
  }
}

export interface CardPropertyChoice extends CardProperty {
  name: string
}

/** Every property a card can show for `type`: its definitions, the type label and the body preview. */
export function cardPropertyChoices(type: Pick<TypeDef, 'propertyDefinitions'>): CardPropertyChoice[] {
  const out: CardPropertyChoice[] = [{ propertyType: 'entity_type', propertyId: 'type', name: 'Type' }]
  for (const d of type.propertyDefinitions) {
    if (d.type === 'entity_backlinks') continue
    if (out.some((c) => c.propertyId === d.key)) continue
    out.push({ propertyType: d.type, propertyId: d.key, name: d.name })
  }
  out.push({ propertyType: 'computed', propertyId: 'computed_preview', name: 'Preview' })
  return out
}
