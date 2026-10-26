// import plugin
import { cloneDeep, merge } from 'lodash-es'
import { v4 as uuid } from 'uuid'
import { Block, DeepPartial, NumberFormatConfig, TextBlock } from '../models/blocks.model.js'
import {
  Component,
  ComponentFull,
  ComponentPreview,
  LoadingStates,
  MediaImageFull,
  RootStructureFull,
} from '../models/component.model.js'
import type { DateObject, DateObjectConstraints, DateResolution } from '../models/date.model.js'
import { LinkToken, TextToken } from '../models/tokens.model.js'
import {
  BlocksProperty,
  BlocksPropertyDefinition,
  BooleanProperty,
  BooleanPropertyDefinition,
  DatetimeProperty,
  DatetimePropertyDefinition,
  EntityProperty,
  EntityPropertyDefinition,
  IconProperty,
  ImageFileResourcePropertyDefinition,
  NumberProperty,
  NumberPropertyDefinition,
  Property,
  PropertyDefinition,
  PropertyTypes,
  SimpleTableBlockPropertyDefinition,
  SystemCreatedAtPropertyDefinition,
  SystemDescriptionPropertyDefinition,
  SystemIconPropertyDefinition,
  SystemLastUpdatedPropertyDefinition,
  systemProperties,
  SystemProperty,
  SystemTagsPropertyDefinition,
  SystemTitlePropertyDefinition,
  SystemTypePropertyDefinition,
  TextBlockPropertyDefinition,
  TextProperty,
  TextPropertyDefinition,
  UrlProperty,
  UrlPropertyDefinition,
  UtilDateEventProperty,
  UtilDateObjectProperty,
  type AliasesProperty,
  type DatetimeSimpleProperty,
  type DatetimeSimplePropertyDefinition,
  type LabelItem,
  type LabelProperty,
  type LabelPropertyDefinition,
  type SystemAliasesPropertyDefinition,
  type SystemBacklinksPropertyDefinition,
  type SystemCollectionsPropertyDefinition,
} from './../models/property.model.js'
import { FALLBACK_ICON } from './basicEntitiesBackbone.js'
import { basicStructureIcons } from './basicStructures.js'
import { generateBlock, isEmptyBlock, parseTokensToPlainTextBackbone } from './blockHelper.js'
import { themeColors } from './colorThemes.js'
import { getEntityTitle, isMediaImageLinkProperty, onlyRootSpaceFull, SessionContextConfig } from './componentChecks.js'
import { generateLinkNode } from './componentHelper.js'
import { generateDefaultNumberFormatConfig, isValidHttpUrl, safeDecodeURIComponent } from './general.js'
import { isPhosphorVariant } from './icon.utils.js'
import { markdownLinkBasenameCandidates, titleForCreatedMarkdownLinkTarget } from './import.utils.js'
import { PropertyTransformationAdditionalInfo } from './ioBackbone.js'
import { extractHttpUrlFromPropertyValue, getUrlInformation, stampWebReferencedMediaImage } from './mediaProcessing.js'
import { structureFilterFnBackbone } from './structureHeuristicsBackbone.js'
import { taskUtils } from './taskUtils.js'
import { generateToken, preprocessMarkdownText } from './textHelper.js'
import { MdToBlocksConfig, MdToBlocksContext } from './textProcessingBackbone.js'

export const propertyIcons: {
  [x in PropertyTypes | 'computed_wordCount' | 'computed_preview']: string
} = {
  text: 'ph-text-align-left',
  textBlock: 'ph-text-align-left',
  boolean: 'ph-check-square',
  number: 'ph-hash',
  blocks: 'ph-list-dashes',
  url: 'ph-link',
  datetime: 'ph-calendar',
  datetimeSimple: 'ph-calendar-blank',
  label: 'ph-caret-circle-down',
  entity_title: 'ph-text-t',
  entity_icon: 'ph-smiley',
  entity_description: 'ph-info',
  entity_createdAt: 'ph-calendar-blank',
  entity_lastUpdated: 'ph-clock-clockwise',
  entity_tags: 'ph-tag',
  entity_aliases: 'ph-cards',
  entity_collections: basicStructureIcons['RootDatabase'].val,
  entity_backlinks: 'ph-line-segment',
  entity_type: 'ph-notebook',
  simpleTableBlock: 'ph-table',
  entity: 'ph-file-text',
  media_imageFileResource: 'ph-file-arrow-down',
  media_audioFileResource: 'ph-file-arrow-down',
  media_videoFileResource: 'ph-file-arrow-down',
  media_pdfFileResource: 'ph-file-arrow-down',
  media_fileFileResource: 'ph-file-arrow-down',
  media_tweets: 'ph-twitter-logo',
  util_aiChat: 'ph-chats',
  util_dateObject: 'ph-calendar-blank',
  util_dateEvent: 'ph-calendar-blank',
  computed_wordCount: 'ph-hash',
  computed_preview: 'ph-list-magnifying-glass',
}

export const LABEL_TEXT_MAX_LENGTH = 100
export const LABEL_PROPERTY_MAX_ELEMENTS = 500
export const ALIASES_MAX_LENGTH = 8

export function generatePropertyDefinition(
  type: PropertyTypes,
  forceId: string | undefined = undefined,
  t: (key: string, details?: any) => string
): PropertyDefinition {
  const base: Pick<PropertyDefinition, 'id' | 'name' | 'description' | 'icon' | 'readOnly'> = {
    id: forceId ? forceId : uuid(),
    name: { val: systemProperties.includes(type as SystemProperty) ? '' : t('propertyDefinition.newPropertyName') },
    description: { val: '' },
    icon: propertyIcons[type] ? { type: 'iconify', val: propertyIcons[type] } : FALLBACK_ICON,
    readOnly: false,
  }
  // SYSTEM_PROPERTIES OVERWRITE
  if (type === 'entity_icon') {
    const adjusted: SystemIconPropertyDefinition = {
      ...base,
      id: 'icon',
      type: 'entity_icon',
      dataType: 'icon',
      icon: {
        type: 'iconify',
        val: 'ph-smiley',
      },
    }
    return adjusted
  } else if (type === 'entity_title') {
    const adjusted: SystemTitlePropertyDefinition = {
      ...base,
      id: 'title',
      type: 'entity_title',
      dataType: 'string',
      icon: {
        type: 'iconify',
        val: 'ph-text-t',
      },
    }
    return adjusted
  } else if (type === 'entity_createdAt') {
    const adjusted: SystemCreatedAtPropertyDefinition = {
      ...base,
      id: 'createdAt',
      type: 'entity_createdAt',
      dataType: 'datetime',
      mode: 'datetime',
      readOnly: true,
      icon: {
        type: 'iconify',
        val: 'ph-calendar-blank',
      },
    }
    return adjusted
  } else if (type === 'entity_lastUpdated') {
    const adjusted: SystemLastUpdatedPropertyDefinition = {
      ...base,
      id: 'lastUpdated',
      type: 'entity_lastUpdated',
      dataType: 'datetime',
      mode: 'datetime',
      readOnly: true,
      icon: {
        type: 'iconify',
        val: 'ph-clock-clockwise',
      },
    }
    return adjusted
  } else if (type === 'entity_description') {
    const adjusted: SystemDescriptionPropertyDefinition = {
      ...base,
      id: 'description',
      type: 'entity_description',
      dataType: 'string',
      icon: {
        type: 'iconify',
        val: 'ph-info',
      },
    }
    return adjusted
  } else if (type === 'entity_aliases') {
    const adjusted: SystemAliasesPropertyDefinition = {
      ...base,
      id: 'aliases',
      type: 'entity_aliases',
      dataType: 'system',
    }
    return adjusted
  } else if (type === 'entity_tags') {
    const adjusted: SystemTagsPropertyDefinition = {
      ...base,
      id: 'tags',
      type: 'entity_tags',
      dataType: 'entity',
      icon: {
        type: 'iconify',
        val: 'ph-tag',
      },

      allowedStructures: ['RootTag'],
      isArray: true,
    }
    return adjusted
  } else if (type === 'entity_type') {
    const adjusted: SystemTypePropertyDefinition = {
      ...base,
      id: 'type',
      type: 'entity_type',
      dataType: 'entity',
      icon: basicStructureIcons['RootStructure'],

      allowedStructures: ['RootStructure'],
      isArray: false,
    }
    return adjusted
  } else if (type === 'entity_collections') {
    const adjusted: SystemCollectionsPropertyDefinition = {
      ...base,
      id: 'collections',
      type: 'entity_collections',
      dataType: 'system',
    }
    return adjusted
  } else if (type === 'entity_backlinks') {
    const adjusted: SystemBacklinksPropertyDefinition = {
      ...base,
      id: 'backlinks',
      type: 'entity_backlinks',
      dataType: 'system',
    }
    return adjusted
  } else if (type === 'media_imageFileResource') {
    const adjusted: ImageFileResourcePropertyDefinition = {
      ...base,
      id: 'media_imageFileResource',
      type: 'media_imageFileResource',
      icon: {
        type: 'iconify',
        val: 'ph-file',
      },
      readOnly: true,
      dataType: 'fileResource',
    }
    return adjusted
    // BLOCKs
  } else if (type === 'blocks') {
    const adjusted: BlocksPropertyDefinition = {
      ...base,
      type: 'blocks',
      dataType: 'blocks',
    }
    return adjusted
  } else if (type === 'simpleTableBlock') {
    const adjusted: SimpleTableBlockPropertyDefinition = {
      ...base,
      type: 'simpleTableBlock',
      dataType: 'blocks',
    }
    return adjusted
  } else if (type === 'textBlock') {
    const adjusted: TextBlockPropertyDefinition = {
      ...base,
      type: 'textBlock',
      dataType: 'blocks',
    }
    return adjusted
  }
  // DATETIME
  else if (type === 'datetime') {
    const adjusted: DatetimePropertyDefinition = {
      ...base,
      type: 'datetime',
      mode: 'datetime',
      dataType: 'datetime',
    }
    return adjusted
  } else if (type === 'datetimeSimple') {
    const adjusted: DatetimeSimplePropertyDefinition = {
      ...base,
      type: 'datetimeSimple',
      dataType: 'datetime',
      mode: 'datetime',
    }
    return adjusted
  }
  // PRIMITIVES
  else if (type === 'text') {
    const adjusted: TextPropertyDefinition = {
      ...base,
      type: 'text',
      dataType: 'string',
    }
    return adjusted
  } else if (type === 'number') {
    const adjusted: NumberPropertyDefinition = {
      ...base,
      type: 'number',
      dataType: 'number',
      numberFormat: undefined,
    }
    return adjusted
  } else if (type === 'boolean') {
    const adjusted: BooleanPropertyDefinition = {
      ...base,
      type: 'boolean',
      dataType: 'boolean',
    }
    return adjusted
  } else if (type === 'url') {
    const adjusted: UrlPropertyDefinition = {
      ...base,
      type: 'url',
      dataType: 'url',
    }
    return adjusted
  } else if (type === 'entity') {
    const adjusted: EntityPropertyDefinition = {
      ...base,
      type: 'entity',
      dataType: 'entity',
      allowedStructures: ['RootPage'],
      isArray: true,
    }
    return adjusted
  } else if (type === 'label') {
    const adjusted: LabelPropertyDefinition = {
      ...base,
      dataType: 'label',
      type: 'label',
      isArray: false,
      set: [],
    }
    return adjusted
  } else {
    throw new Error('property typenot implemented')
  }
  // LABEL
}

// @ts-expect-error
export function initializeProperty(definition: PropertyDefinition): Property['val'] | undefined {
  // PRIMITIVES

  if (definition.dataType === 'string') {
    return { val: undefined }
  } else if (definition.dataType === 'icon') {
    return {
      val: {
        type: 'emoji',
        val: '👋',
      },
    }
  } else if (definition.dataType === 'boolean') {
    return {
      val: false,
    }
  } else if (definition.dataType === 'number') {
    return {
      val: undefined,
    }
  } else if (definition.dataType === 'url') {
    return {
      val: '',
    }
  } else if (definition.dataType === 'label') {
    return {
      val: [],
    }
  } else if (definition.dataType === 'blocks') {
    const newVal: BlocksProperty = {
      val: definition.id,
    }
    return newVal
  } else if (definition.type === 'datetime') {
    const value: DatetimeProperty = {
      val: [],
    }
    return value
  } else if (definition.type === 'datetimeSimple') {
    const value: DatetimeSimpleProperty = {
      val: undefined,
    }
    return value
  } else if (definition.dataType === 'entity') {
    return { val: [] }
    // SPECIAL TYPES
  } else if (definition.type === 'media_imageFileResource') {
    return {
      val: undefined,
    }
  } else if (definition.type === 'util_aiChat') {
    return {
      val: undefined,
    }
  } else if (
    definition.type === 'media_audioFileResource' ||
    definition.type === 'media_fileFileResource' ||
    definition.type === 'media_pdfFileResource' ||
    definition.type === 'media_videoFileResource' ||
    definition.type === 'media_tweets' ||
    definition.type === 'util_dateObject' ||
    definition.type === 'util_dateEvent' ||
    definition.type === 'entity_aliases'
  ) {
    return undefined
  } else {
    console.error('not implemented 3452')
    return undefined
  }
}

type PropertyTransformerHelper = {
  getLabelSet: (outDef: LabelPropertyDefinition) => LabelItem[]
  addNewLabelItem: ((labelText: string) => void) | undefined
}

export type PropertyTransformerObject = {
  lossLess: boolean
  transformer: (
    inPropertyId: string,
    inProperties: ComponentFull['properties'],
    inData: ComponentFull['data'],
    outPropertyId: string,
    outProperties: ComponentFull['properties'],
    outData: ComponentFull['data'],
    helper: PropertyTransformerHelper
  ) => Promise<void> | void
}

export type MdToBlocksUtil = (mdText: string, type: 'blocks' | 'textBlock') => Promise<Block[]>

export type PropertyTransformContext = {
  mdToBlocksUtil?: MdToBlocksUtil | undefined
  config?: MdToBlocksConfig | undefined
  context?: MdToBlocksContext | undefined
}

/** Single markdown link only — URL group must not span past the first `)` (avoids swallowing `, [](Next)`). */
const ENTITY_MD_LINK_REGEX = /^!?\[([^\]]*)\]\(([^)]+)\)$/

/**
 * Split a comma-separated entity property string into individual entries.
 * Prefers link-boundary splits so commas inside titles (e.g. `[[Smith, John]]`) are preserved.
 * Naive comma-splitting is only used when the text has no wikilink / markdown-link syntax
 * (plain titles like `Alice, Bob`).
 */
export function splitMultiValueEntityPropertyText(rawText: string): string[] {
  const trimmed = rawText.trim()
  if (!trimmed.length) return []

  // A quoted YAML scalar is one title, even when the title contains commas.
  // Keep punctuation in titles; quotes are syntax, not part of the title.
  const quote = trimmed[0]
  if (
    (quote === '"' || quote === "'" || quote === '“' || quote === '‘') &&
    trimmed.at(-1) === ({ '“': '”', '‘': '’', '"': '"', "'": "'" } as Record<string, string>)[quote]
  ) {
    return [preprocessMarkdownText(trimmed.slice(1, -1).trim()).replace(/#/g, '')].filter(Boolean)
  }

  // `[[A]], [[B]]` or `![[A]], ![[B]]`
  let rawEntries = trimmed.split(/(?<=\]\])\s*,\s*(?=!?\[\[)/)
  // `[](A), [](B)` or `[alias](A), [alias](B)` after wikilink preprocessing
  if (rawEntries.length <= 1) {
    rawEntries = trimmed.split(/(?<=\))\s*,\s*(?=!?\[)/)
  }
  // Plain multi-value titles only — never split inside link syntax
  if (rawEntries.length <= 1 && !/\[\[|\]\(/.test(trimmed)) {
    rawEntries = trimmed.split(',')
  }

  return rawEntries
    .map((el) =>
      preprocessMarkdownText(el.trim())
        .replace(/^(['"“‘])([\s\S]*)\1$/, '$2')
        .replace(/#/g, '')
    )
    .filter((el) => el.length > 0)
}

/**
 * Split imported date text on explicit range separators.
 * Avoids treating the hyphens inside `YYYY-MM-DD` as a start/end delimiter.
 */
export function splitImportedDateRangeText(text: string): { startTimeText: string; endTimeText: string } {
  const parts = text
    .split(/\s*(?:->|→|\s-\s)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  return {
    startTimeText: parts.at(0) || '',
    endTimeText: parts.at(1) || '',
  }
}

export function dateObjectFromImportedText(
  text: string,
  constraints: Partial<DateObjectConstraints> | undefined,
  config: SessionContextConfig
): DateObject | undefined {
  const { startTimeText, endTimeText } = splitImportedDateRangeText(text)
  if (!startTimeText.length) return undefined

  const parsedStartTime = config.useTimeObject.parseISOStringFromText(startTimeText)
  if (!parsedStartTime) return undefined

  let parsedEndTime = endTimeText.length > 0 ? config.useTimeObject.parseISOStringFromText(endTimeText) : undefined
  if (parsedEndTime && new Date(parsedEndTime.date).getTime() < new Date(parsedStartTime.date).getTime()) {
    parsedEndTime = undefined
  }

  const clonedConstraints = cloneDeep(constraints || {})
  const resolutionPreference: DateResolution =
    clonedConstraints.resolutionConstraint ||
    clonedConstraints.resolutionPreference ||
    (parsedStartTime.precision === 'day' && (parsedEndTime?.precision ?? parsedStartTime.precision) === 'day'
      ? 'day'
      : 'time')

  const endTimePreference: 'initialize' | undefined =
    clonedConstraints.endTimeSettings === 'notAllowed'
      ? undefined
      : clonedConstraints.endTimeSettings === 'required'
        ? 'initialize'
        : parsedEndTime
          ? 'initialize'
          : undefined

  return config.useTimeObject.generateDateObject(
    merge(clonedConstraints, {
      resolutionPreference,
      startTimeDefault: parsedStartTime.date,
      endTimeDefault: parsedEndTime?.date,
      endTimePreference,
    })
  )
}

async function createWebMediaImageForTransform(
  mdContext: MdToBlocksContext,
  imageUrl: string
): Promise<MediaImageFull | undefined> {
  let created = await mdContext.generateNewEntity?.('MediaImage')
  if (!created || created.type !== 'MediaImage') {
    const structure = mdContext.getStructure('MediaImage')
    if (structure?.loadingState !== LoadingStates.Full || structure.type !== 'RootStructure') return undefined
    created = await mdContext.generateEntity(structure, undefined, mdContext.spaceId, [], true, undefined)
  }
  if (created.type !== 'MediaImage') return undefined

  stampWebReferencedMediaImage(created, imageUrl)
  mdContext.makeEntityFindableViaCache?.(created)
  mdContext.mutationWrapperSync([{ id: created.id, type: created.type }], () => {})
  return created
}

async function createUtilDateForTransform(
  mdContext: MdToBlocksContext,
  inC: ComponentFull | { properties: ComponentFull['properties']; data: ComponentFull['data'] } | undefined
): Promise<ComponentFull | undefined> {
  if (mdContext.generateNewEntity) {
    const created = await mdContext.generateNewEntity('UtilDate')
    if (created?.type === 'UtilDate') return created
  }

  const structure = mdContext.getStructure('UtilDate')
  if (structure?.loadingState !== LoadingStates.Full || structure.type !== 'RootStructure') return undefined

  const policiesToInherit = inC && 'policies' in inC ? inC.policies : []
  const created = await mdContext.generateEntity(
    structure,
    undefined,
    mdContext.spaceId,
    policiesToInherit,
    true,
    undefined
  )
  return created?.type === 'UtilDate' ? created : undefined
}

/** Parse a single-entity markdown link produced by preprocessMarkdownText / authors. */
export function parseEntityMarkdownLink(text: string): { text: string; url: string } | undefined {
  const mdLink = text.match(ENTITY_MD_LINK_REGEX)
  if (!mdLink) return undefined

  const linkText = safeDecodeURIComponent(mdLink[1] || '').trim()
  const linkUrl = safeDecodeURIComponent(mdLink[2] || '')
    .trim()
    .split(/[#?]/)
    .at(0)

  if (!linkUrl?.length) return undefined
  return { text: linkText, url: linkUrl }
}

async function textToBlocksProperty(
  inDef: PropertyDefinition,
  text: string | undefined,
  type: 'blocks' | 'textBlock',
  outPropertyId: string,
  outProperties: ComponentFull['properties'],
  outData: ComponentFull['data'],
  context?: PropertyTransformContext | undefined,
  options?: { blocksOutDefUsageCount?: Map<string, number>; overwriteExisting?: boolean }
) {
  if (!text || !text.length) return

  outProperties[outPropertyId] = { val: outPropertyId }
  outData.blocks[outPropertyId] ??= []

  const blocks: Block[] = []

  const mdBlocks = context?.mdToBlocksUtil ? await context.mdToBlocksUtil(text, type) : []
  blocks.push(...mdBlocks)

  if (outData.blocks[outPropertyId].length <= 0 && blocks.length <= 0) {
    const block = generateBlock<TextBlock>('TextBlock', undefined)
    const token = generateToken<TextToken>('TextToken')
    token.text = text.startsWith('---\n') && text.endsWith('---') ? '' : text
    block.tokens = [token]

    blocks.push(block)
  }

  if (type === 'textBlock') {
    if (
      !options?.overwriteExisting &&
      (outData.blocks[outPropertyId].length > 1 ||
        (outData.blocks[outPropertyId].at(0) && !isEmptyBlock(outData.blocks[outPropertyId].at(0)!, true)))
    ) {
      return
    }

    const firstTextBlock = blocks.find(({ type }) => type === 'TextBlock')
    if (!firstTextBlock) return

    outData.blocks[outPropertyId] = [firstTextBlock]
  } else if (type === 'blocks') {
    if (options?.overwriteExisting) {
      outData.blocks[outPropertyId] = []
    }

    const isOutDefUsedExclusively = (options?.blocksOutDefUsageCount?.get(outPropertyId) ?? 0) <= 1

    if (!isOutDefUsedExclusively && blocks.length > 0 && inDef.name?.val?.length) {
      const propertyNameBlock = generateBlock<TextBlock>('TextBlock', undefined)
      const token = generateToken<TextToken>('TextToken')
      token.style.bold = true
      token.text = inDef.name?.val
      propertyNameBlock.tokens = [token]

      outData.blocks[outPropertyId].push(propertyNameBlock)
    }

    outData.blocks[outPropertyId].push(...blocks)
  }
}

export function getPropertyTransformerBackbone(
  inDef: PropertyDefinition,
  outDef: PropertyDefinition,
  inC: ComponentFull | { properties: ComponentFull['properties']; data: ComponentFull['data'] } | undefined,
  additionalInfo: PropertyTransformationAdditionalInfo,
  loadAndGetC: (id: string) => Promise<Component | undefined>,
  config: SessionContextConfig,
  context?: PropertyTransformContext | undefined,
  options?: { blocksOutDefUsageCount?: Map<string, number> }
): PropertyTransformerObject | undefined {
  const textToBlocksOpts = {
    blocksOutDefUsageCount: options?.blocksOutDefUsageCount,
    overwriteExisting: additionalInfo.overwriteExistingProperties,
  }
  const direktTransformationPossibleTypes: PropertyTypes[] = [
    'entity_icon',
    'entity_tags',
    'entity_aliases',
    'number',
    'boolean',
    'url',
    'datetime',
    'datetimeSimple',
  ]

  function getLabelFromLabelProperty(
    outDef: LabelPropertyDefinition,
    existingLabel: LabelItem,
    helper: PropertyTransformerHelper
  ) {
    const labelSet = helper?.getLabelSet(outDef)
    let label = labelSet ? findLabelInSetByTextOrId(labelSet, existingLabel.text) : undefined
    if (!label && helper?.addNewLabelItem) {
      helper.addNewLabelItem(existingLabel.text)
      label = labelSet ? findLabelInSetByTextOrId(labelSet, existingLabel.text) : undefined
      if (!label) console.warn('label not found after adding new label item')
    }
    return label
  }

  if (inDef.dataType === 'string') {
    const isFrontmatterProperty = additionalInfo?.inFrontmatterPropertyIds?.includes(inDef.id)
    function getPropertyText(inPropertyId: string, inProperties: ComponentFull['properties']) {
      if (isFrontmatterProperty) {
        if (!inC) console.error('no component for frontmatter property')
        const frontmatterProperties = inC?.data?.frontmatterProperties || []
        return frontmatterProperties.find((el) => el.name === inDef.name?.val)?.val || ''
      }
      return (inProperties[inPropertyId] as TextProperty)?.val
    }

    if (outDef.dataType === 'string') {
      return {
        lossLess: true,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          outProperties[outPropertyId] = { val: getPropertyText(inPropertyId, inProperties) }
        },
      }
    } else if (outDef.type === 'blocks' || outDef.type === 'textBlock') {
      return {
        lossLess: true,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, outData) => {
          const text = getPropertyText(inPropertyId, inProperties)
          await textToBlocksProperty(inDef, text, outDef.type, outPropertyId, outProperties, outData, context, {
            ...textToBlocksOpts,
          })
        },
      }
    } else if (outDef.dataType === 'number') {
      return {
        lossLess: false,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          let number: number | undefined = undefined
          try {
            number = !isNaN(Number(getPropertyText(inPropertyId, inProperties)))
              ? Number(getPropertyText(inPropertyId, inProperties))
              : undefined
          } catch {}
          outProperties[outPropertyId] = { val: number }
        },
      }
    } else if (outDef.dataType === 'boolean') {
      return {
        lossLess: false,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          outProperties[outPropertyId] = {
            val:
              getPropertyText(inPropertyId, inProperties)?.toLowerCase() === 'true' ||
              getPropertyText(inPropertyId, inProperties)?.toLowerCase() === 'yes',
          }
        },
      }
    } else if (outDef.dataType === 'url') {
      return {
        lossLess: false,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          const url = isValidHttpUrl(getPropertyText(inPropertyId, inProperties) || '')
          outProperties[outPropertyId] = { val: url ? url.href : undefined }
        },
      }
    } else if (outDef.dataType === 'entity' && context?.config && context?.context) {
      return {
        lossLess: false,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          if (!context?.config || !context?.context) {
            throw new Error('no context, should not happen adsknagewiu')
          }

          let rawText = getPropertyText(inPropertyId, inProperties)
          if (!rawText) return

          rawText = rawText.trim()
          const propertyTextEntries: string[] = []

          const allowedStructureId = outDef.allowedStructures[0]
          const isArray = outDef.isArray
          const fixedSet = outDef.hasFixedSet ? outDef.fixedSet : undefined

          if (!allowedStructureId) {
            console.error('no allowed structure id')
            return
          }

          if (rawText && typeof rawText === 'string') {
            const localImportProperty = additionalInfo.localImportProperties?.get(inPropertyId)

            if (localImportProperty && Array.isArray(localImportProperty.raw)) {
              propertyTextEntries.push(
                ...localImportProperty.raw
                  .map((value) => {
                    if (typeof value !== 'string') return undefined
                    let _value = value.trim()

                    if (
                      _value.length >
                      (additionalInfo.localImportConstants?.bulk.BULK_IMPORT_MAX_PROPERTY_CHARS ?? 524_288)
                    ) {
                      _value =
                        _value.slice(
                          0,
                          additionalInfo.localImportConstants?.bulk.BULK_IMPORT_MAX_PROPERTY_CHARS ?? 524_288
                        ) + '\n\n...'
                    }

                    return preprocessMarkdownText(_value)
                      .replace(/^(['"“‘])([\s\S]*)\1$/, '$2')
                      .replace(/#/g, '')
                  })
                  .filter((value) => typeof value === 'string')
              )
            } else {
              propertyTextEntries.push(...splitMultiValueEntityPropertyText(rawText))
            }
          }

          if (propertyTextEntries.length <= 0) return

          if (!Array.isArray((outProperties[outPropertyId] as EntityProperty | undefined)?.val)) {
            outProperties[outPropertyId] = { val: [] }
          }
          const property = outProperties[outPropertyId] as EntityProperty

          if (additionalInfo.overwriteExistingProperties) {
            property.val = []
          }

          for (const propertyTextEntry of propertyTextEntries) {
            try {
              if (!propertyTextEntry.length) continue
              if (property.val.length > 0 && !isArray && !additionalInfo.overwriteExistingProperties) continue

              let entityCandidate:
                | {
                    id: string
                    structureId: string
                  }
                | undefined = undefined

              const imageUrl = isMediaImageLinkProperty(outDef)
                ? extractHttpUrlFromPropertyValue(propertyTextEntry)
                : undefined
              if (imageUrl) {
                const createdImage = await createWebMediaImageForTransform(context.context, imageUrl)
                if (createdImage) entityCandidate = createdImage
              }

              const mdLink = parseEntityMarkdownLink(propertyTextEntry)
              const mdLinkText = mdLink?.text || ''
              const mdLinkUrl = mdLink?.url

              matching: try {
                if (!mdLink) break matching
                if (!mdLinkUrl || mdLinkUrl.length <= 0) break matching

                const urlInfo = getUrlInformation(
                  mdLinkUrl,
                  context.context.spaceId,
                  context.context.userPersonalId,
                  context.context.frontendUrl
                )

                if (urlInfo && urlInfo.type === 'internal' && urlInfo.info.componentId) {
                  const resolved = await context.context.loadAndGetC(urlInfo.info.componentId)
                  if (resolved && resolved.structureId) {
                    entityCandidate = { id: resolved.id, structureId: resolved.structureId }
                  }
                  break matching
                }

                if (typeof urlInfo !== 'undefined') break matching

                entityCandidate ??= await context.context.findEntityViaPath?.(mdLinkUrl)
                entityCandidate ??=
                  mdLinkText.length > 0
                    ? await context.context.findEntity(mdLinkText, {
                        filterStructureIds: [allowedStructureId],
                      })
                    : undefined

                if (entityCandidate) break matching

                for (const basename of markdownLinkBasenameCandidates(mdLinkUrl)) {
                  entityCandidate ??= await context.context.findEntity(basename, {
                    filterStructureIds: [allowedStructureId],
                  })
                  if (entityCandidate) break
                }
              } catch {}

              entityCandidate ??= await context.context.findEntityViaPath?.(propertyTextEntry)
              entityCandidate ??= await context.context.findEntity(propertyTextEntry, {
                filterStructureIds: [allowedStructureId],
              })

              const matchingInfo =
                allowedStructureId === 'RootTag' ? context.config.tagMatching : context.config.entityMatching

              if (!entityCandidate && matchingInfo?.strategy === 'existingAndNew' && !fixedSet) {
                // Refuse to mint an entity from an unsplit multi-link blob
                // (e.g. `[](A), [](B)` if splitting failed upstream).
                if (/\]\]\s*,\s*!?\[\[/.test(propertyTextEntry) || /\]\([^)]*\)\s*,\s*!?\[/.test(propertyTextEntry)) {
                  continue
                }

                if (
                  !structureFilterFnBackbone(
                    allowedStructureId,
                    'canBeCreatedWithoutCustomSetup',
                    context.context.getStructureHeuristicConfig()
                  )
                ) {
                  continue
                }

                const structure = context.context.getStructure(allowedStructureId)
                if (structure?.loadingState !== LoadingStates.Full || structure.type !== 'RootStructure') continue

                const createdEntity = await context.context.generateEntity(
                  structure,
                  undefined,
                  context.context.spaceId,
                  matchingInfo.policiesToInherit,
                  true,
                  undefined
                )

                if (!createdEntity.properties.title) createdEntity.properties.title = { val: '' }
                createdEntity.properties.title.val = titleForCreatedMarkdownLinkTarget(
                  mdLinkText,
                  mdLinkUrl || propertyTextEntry
                )
                context.context.mutationWrapperSync([{ id: createdEntity.id, type: createdEntity.type }], () => {})

                entityCandidate = createdEntity
              }

              if (
                entityCandidate &&
                !property.val.find(({ id }) => id === entityCandidate?.id) &&
                (!fixedSet || fixedSet.includes(entityCandidate.id)) &&
                entityCandidate.structureId === allowedStructureId
              ) {
                property.val.push(
                  generateLinkNode(
                    { id: entityCandidate.id, structureId: entityCandidate.structureId },
                    'Dependency',
                    undefined
                  )
                )
              }
            } catch {
              continue
            }
          }
        },
      }
    } else if (outDef.type === 'label') {
      return {
        lossLess: false,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData, helper) => {
          const text = getPropertyText(inPropertyId, inProperties)
          const labelTexts = text?.split(',').map((el) => el.trim().replace(/"/g, '').replace(/#/g, ''))
          if (!labelTexts?.length) return

          if (additionalInfo.overwriteExistingProperties) {
            outProperties[outPropertyId] = { val: [] }
          }

          for (const labelText of labelTexts) {
            const label = getLabelFromLabelProperty(outDef, { id: '', text: labelText }, helper)
            if (!label) continue

            if (!outProperties[outPropertyId]) outProperties[outPropertyId] = { val: [] }
            const outProperty = outProperties[outPropertyId] as LabelProperty

            if (outProperty?.val?.length && !outDef.isArray && !additionalInfo.overwriteExistingProperties) continue
            if (!outProperty?.val?.find((el) => el === label.id)) {
              outProperty.val.push(label.id)
            }
          }
        },
      }
    } else if (outDef.dataType === 'icon') {
      return {
        lossLess: false,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          const text = getPropertyText(inPropertyId, inProperties)
          if (!text) return

          const isEmoji = /\p{Emoji}/u.test(text)

          if (isEmoji) {
            outProperties[outPropertyId] = { val: { type: 'emoji', val: text } }
          } else {
            const isIcon = /ph-[\w-]{1,20}/g.test(text)
            if (!isIcon) return

            const variant = text.split('-').at(-1)
            if (!variant || !isPhosphorVariant(variant)) return

            outProperties[outPropertyId] = {
              val: { type: 'iconify', val: `${text.slice(0, -variant.length - 1)}-regular` },
            }
          }
        },
      }
    } else if (outDef.type === 'entity_aliases') {
      return {
        lossLess: false,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          let text = getPropertyText(inPropertyId, inProperties)?.trim()
          if (!text || !text.length) return

          if (text.startsWith('[') && text.endsWith(']')) {
            text = text.slice(1, -1)
          }

          const aliases = text
            .split(',')
            .map((alias) => alias.trim().replace(/"/g, '').replace(/'/g, '').replace(/#/g, ''))
            .filter((alias) => alias.length)
            .slice(0, ALIASES_MAX_LENGTH)

          if (!aliases.length) return
          outProperties[outPropertyId] = { val: aliases.map((alias) => ({ name: alias })) }
        },
      }
    } else if (outDef.type === 'datetimeSimple') {
      return {
        lossLess: false,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          try {
            const text = getPropertyText(inPropertyId, inProperties)?.trim()
            if (!text?.length) return

            const dateObject = dateObjectFromImportedText(
              text,
              (outDef as DatetimeSimplePropertyDefinition).constraints,
              config
            )
            if (!dateObject) return

            outProperties[outPropertyId] = { val: dateObject }
          } catch {}
        },
      }
    } else if (outDef.type === 'datetime') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          try {
            const text = getPropertyText(inPropertyId, inProperties)?.trim()
            if (!context?.context) return

            // Empty string signals "clear this property".
            // (The actual clear-by-frontmatter path runs in mdToComponentFillBackbone after the
            // inObj loop, but the transformer handles any in-band empty value defensively.)
            if (!text?.length) {
              const existingUtilDateId = (outProperties[outPropertyId] as DatetimeProperty | undefined)?.val?.[0]?.id
              if (existingUtilDateId) {
                const utilDate = await context.context.loadAndGetC(existingUtilDateId)
                if (utilDate) {
                  context.context.mutationWrapperSync([{ id: utilDate.id, type: utilDate.type }], () => {
                    utilDate.deleteRequested = true
                    utilDate.lastUpdated = new Date().toISOString()
                  })
                }
              }
              outProperties[outPropertyId] = { val: [] } satisfies DatetimeProperty
              return
            }

            const dateObject = dateObjectFromImportedText(text, outDef.constraints, config)
            if (!dateObject) return

            const existingUtilDateId = (outProperties[outPropertyId] as DatetimeProperty | undefined)?.val?.[0]?.id
            if (existingUtilDateId) {
              // Try to update the existing UtilDate in place.
              const existing = await context.context.loadAndGetC(existingUtilDateId)
              if (existing?.loadingState === LoadingStates.Full && existing.type === 'UtilDate') {
                context.context.mutationWrapperSync([{ id: existing.id, type: existing.type }], () => {
                  existing.properties.date = { val: dateObject }
                })
                // Link already points at the updated entity — no change to outProperties needed.
                return
              }
              // UtilDate not in memory (e.g. fresh store after the creating request was synced).
              // Fall through and create a new one.
            }

            const utilDate = await createUtilDateForTransform(context.context, inC)
            if (!utilDate || utilDate.type !== 'UtilDate') return
            context.context.mutationWrapperSync([{ id: utilDate.id, type: utilDate.type }], () => {
              utilDate.properties.date = { val: dateObject }
            })
            outProperties[outPropertyId] = {
              val: [
                generateLinkNode({ id: utilDate.id, structureId: utilDate.structureId }, 'Dependency', outPropertyId),
              ],
            }
          } catch (e) {
            console.error(e)
          }
        },
      }
    }
  } else if (inDef.type === 'entity') {
    if (
      outDef.type === 'entity' &&
      outDef.allowedStructures.length === 1 &&
      inDef.allowedStructures.length === 1 &&
      outDef.allowedStructures[0] === inDef.allowedStructures[0]
    ) {
      return {
        lossLess: (outDef.isArray || !inDef.isArray) && !outDef.hasFixedSet,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          const sourceProp = inProperties[inPropertyId] as EntityProperty | undefined
          outProperties[outPropertyId] = Array.isArray(sourceProp?.val) ? sourceProp : { val: [] }
        },
      }
    } else if (outDef.type === 'label') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData, helper) => {
          const property = inProperties[inPropertyId] as EntityProperty | undefined
          if (!property?.val?.length) return
          if (additionalInfo.overwriteExistingProperties) {
            outProperties[outPropertyId] = { val: [] }
          }
          for (const { id } of property.val) {
            const entity = await loadAndGetC(id)
            if (!entity) continue
            const entityTitle = getEntityTitle(entity, { ...config, untitledHandling: 'empty' })
            if (!entityTitle?.length) continue

            const label = getLabelFromLabelProperty(outDef, { id: '', text: entityTitle }, helper)
            if (!label) continue

            if (!outProperties[outPropertyId]) outProperties[outPropertyId] = { val: [] }
            const outProperty = outProperties[outPropertyId] as LabelProperty

            if (outProperty.val.length && !outDef.isArray && !additionalInfo.overwriteExistingProperties) continue
            if (!outProperty.val.find((el) => el === label.id)) {
              outProperty.val.push(label.id)
            }
          }
        },
      }
    } else if (outDef.type === 'textBlock') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, inProperties, inData, outPropertyId, outProperties, outData, helper) => {
          const property = inProperties[inPropertyId] as EntityProperty | undefined
          if (!property?.val?.length) return
          const block = generateBlock<TextBlock>('TextBlock', undefined)

          for (const { id } of property.val) {
            const entity = await loadAndGetC(id)
            if (!entity || entity.loadingState === LoadingStates.Error) continue
            const token = generateToken<LinkToken>('LinkToken')
            token.entity = generateLinkNode({ id: entity.id, structureId: entity.structureId }, 'Dependency', undefined)
            block.tokens.push(token)
            const textToken = generateToken<TextToken>('TextToken')
            textToken.text = ', '
            block.tokens.push(textToken)
          }
          // remove last comma
          if (block.tokens.length > 1) {
            block.tokens.pop()
            block.tokens.push(generateToken<TextToken>('TextToken'))
          }

          const outBlocks = outData.blocks[outPropertyId]
          const inBlocks = inData.blocks[inPropertyId]
          if (!inBlocks || !inBlocks.length || (inBlocks.length === 1 && isEmptyBlock(inBlocks[0], true))) {
            // no in text, initialize if empty
            if (!outBlocks?.length || (outBlocks.length === 1 && isEmptyBlock(outBlocks[0], true)))
              outData.blocks[outPropertyId] = [block]
          } else {
            outData.blocks[outPropertyId] = [inBlocks[0]]
          }
        },
      }
    }
  } else if (inDef.type === 'blocks') {
    if (outDef.type === 'blocks') {
      return {
        lossLess: true,
        transformer: (inPropertyId, _inProperties, inData, outPropertyId, outProperties, outData) => {
          outProperties[outPropertyId] = { val: outPropertyId }
          if (!outData.blocks[outPropertyId]) outData.blocks[outPropertyId] = []
          outData.blocks[outPropertyId]!.push(...(inData.blocks[inPropertyId] || []))
        },
      }
    } else if (outDef.type === 'textBlock') {
      return {
        lossLess: false,
        transformer: (inPropertyId, _inProperties, inData, outPropertyId, outProperties, outData) => {
          outProperties[outPropertyId] = { val: outPropertyId }
          const block = generateBlock<TextBlock>('TextBlock', undefined)
          const token = generateToken<TextToken>('TextToken')
          block.tokens = [token]

          const outBlocks = outData.blocks[outPropertyId]
          const inBlocks = inData.blocks[inPropertyId]
          if (!inBlocks || !inBlocks.length || (inBlocks.length === 1 && isEmptyBlock(inBlocks[0], true))) {
            // no in text, initialize if empty
            if (!outBlocks?.length || (outBlocks.length === 1 && isEmptyBlock(outBlocks[0], true)))
              outData.blocks[outPropertyId] = [block]
          } else {
            outData.blocks[outPropertyId] = [inBlocks[0]]
          }
        },
      }
    } else if (outDef.dataType === 'string') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, _inProperties, inData, outPropertyId, outProperties, _outData) => {
          let text
          const inBlocks = inData.blocks[inPropertyId]
          if (
            !inBlocks ||
            !inBlocks.length ||
            (inBlocks.length === 1 && isEmptyBlock(inBlocks[0], true)) ||
            inBlocks[0].type !== 'TextBlock'
          ) {
            text = ''
          } else {
            text = await parseTokensToPlainTextBackbone(inBlocks[0].tokens, [], loadAndGetC, config)
          }
          outProperties[outPropertyId] = { val: text }
        },
      }
    }
  } else if (inDef.type === 'textBlock') {
    if (outDef.type === 'textBlock') {
      return {
        lossLess: true,
        transformer: (inPropertyId, _inProperties, inData, outPropertyId, outProperties, outData) => {
          outProperties[outPropertyId] = { val: outPropertyId }
          outData.blocks[outPropertyId] = inData.blocks[inPropertyId]
        },
      }
    } else if (outDef.type === 'blocks') {
      return {
        lossLess: true,
        transformer: (inPropertyId, _inProperties, inData, outPropertyId, outProperties, outData) => {
          outProperties[outPropertyId] = { val: outPropertyId }
          const outBlocks = outData.blocks[outPropertyId]

          const inBlocks = inData.blocks[inPropertyId]
          if (!inBlocks || !inBlocks.length || (inBlocks.length === 1 && isEmptyBlock(inBlocks[0], true))) {
            // no in text, initialize if empty
            if (!outBlocks?.length || (outBlocks.length === 1 && isEmptyBlock(outBlocks[0], true))) {
              const block = generateBlock<TextBlock>('TextBlock', undefined)
              const token = generateToken<TextToken>('TextToken')
              block.tokens = [token]
              outData.blocks[outPropertyId] = [block]
            }
          } else {
            let propertyNameBlock: TextBlock | undefined
            if (inDef.name?.val?.length) {
              propertyNameBlock = generateBlock<TextBlock>('TextBlock', undefined)
              const token = generateToken<TextToken>('TextToken')
              token.style.bold = true
              token.text = inDef.name?.val
              propertyNameBlock.tokens = [token]
            }
            if (!outBlocks?.length || (outBlocks.length === 1 && isEmptyBlock(outBlocks[0], true))) {
              outData.blocks[outPropertyId] = propertyNameBlock ? [propertyNameBlock, inBlocks[0]] : [inBlocks[0]]
            } else if (outData.blocks[outPropertyId]) {
              outData.blocks[outPropertyId].unshift(inBlocks[0])
              if (propertyNameBlock) outData.blocks[outPropertyId].unshift(propertyNameBlock)
            }
          }
        },
      }
    } else if (outDef.dataType === 'string') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, _inProperties, inData, outPropertyId, outProperties, _outData) => {
          let text
          const inBlocks = inData.blocks[inPropertyId]
          if (
            !inBlocks ||
            !inBlocks.length ||
            (inBlocks.length === 1 && isEmptyBlock(inBlocks[0], true)) ||
            inBlocks[0].type !== 'TextBlock'
          ) {
            text = ''
          } else {
            text = await parseTokensToPlainTextBackbone(inBlocks[0].tokens, [], loadAndGetC, config)
          }
          outProperties[outPropertyId] = { val: text }
        },
      }
    } else if (outDef.dataType === 'number') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, _inProperties, inData, outPropertyId, outProperties, _outData) => {
          let text
          const inBlocks = inData.blocks[inPropertyId]
          if (
            !inBlocks ||
            !inBlocks.length ||
            (inBlocks.length === 1 && isEmptyBlock(inBlocks[0], true)) ||
            inBlocks[0].type !== 'TextBlock'
          ) {
            text = ''
          } else {
            text = await parseTokensToPlainTextBackbone(inBlocks[0].tokens, [], loadAndGetC, config)
          }
          let number: number | undefined = undefined
          try {
            number = !isNaN(Number(text)) ? Number(text) : undefined
          } catch {}
          if (number === undefined) return
          outProperties[outPropertyId] = { val: number }
        },
      }
    } else if (outDef.type === 'label') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, _inProperties, inData, outPropertyId, outProperties, _outData, helper) => {
          let text
          const inBlocks = inData.blocks[inPropertyId]
          if (
            !inBlocks ||
            !inBlocks.length ||
            (inBlocks.length === 1 && isEmptyBlock(inBlocks[0], true)) ||
            inBlocks[0].type !== 'TextBlock'
          ) {
            text = ''
          } else {
            text = await parseTokensToPlainTextBackbone(inBlocks[0].tokens, [], loadAndGetC, config)
          }

          const labelTexts = text
            ?.split(',')
            .map((el) => el.trim().replace(/"/g, '').replace(/'/g, '').replace(/#/g, ''))
          if (!labelTexts?.length) return

          if (additionalInfo.overwriteExistingProperties) {
            outProperties[outPropertyId] = { val: [] }
          }

          for (const labelText of labelTexts) {
            const label = getLabelFromLabelProperty(outDef, { id: '', text: labelText }, helper)
            if (!label) continue

            if (!outProperties[outPropertyId]) outProperties[outPropertyId] = { val: [] }
            const outProperty = outProperties[outPropertyId] as LabelProperty

            if (outProperty.val.length && !outDef.isArray && !additionalInfo.overwriteExistingProperties) continue
            if (!outProperty.val.find((el) => el === label.id)) {
              outProperty.val.push(label.id)
            }
          }
        },
      }
    }
  } else if (inDef.dataType === 'number') {
    if (outDef.dataType === 'string') {
      return {
        lossLess: true,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          const text = (inProperties[inPropertyId] as NumberProperty | undefined)?.val?.toString()
          outProperties[outPropertyId] = { val: text }
        },
      }
    } else if (outDef.type === 'blocks' || outDef.type === 'textBlock') {
      return {
        lossLess: true,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, outData) => {
          const text = (inProperties[inPropertyId] as NumberProperty | undefined)?.val?.toString()
          await textToBlocksProperty(
            inDef,
            text,
            outDef.type,
            outPropertyId,
            outProperties,
            outData,
            context,
            textToBlocksOpts
          )
        },
      }
    } else if (outDef.type === 'label') {
      return {
        lossLess: false,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData, helper) => {
          const text = (inProperties[inPropertyId] as NumberProperty | undefined)?.val?.toString() || ''
          const labelTexts = text
            ?.split(',')
            .map((el) => el.trim().replace(/"/g, '').replace(/'/g, '').replace(/#/g, ''))
          if (!labelTexts?.length) return

          if (additionalInfo.overwriteExistingProperties) {
            outProperties[outPropertyId] = { val: [] }
          }

          for (const labelText of labelTexts) {
            const label = getLabelFromLabelProperty(outDef, { id: '', text: labelText }, helper)
            if (!label) continue

            if (!outProperties[outPropertyId]) outProperties[outPropertyId] = { val: [] }
            const outProperty = outProperties[outPropertyId] as LabelProperty

            if (outProperty.val.length && !outDef.isArray && !additionalInfo.overwriteExistingProperties) continue
            if (!outProperty.val.find((el) => el === label.id)) {
              outProperty.val.push(label.id)
            }
          }
        },
      }
    }
  } else if (inDef.dataType === 'boolean') {
    if (outDef.dataType === 'string') {
      return {
        lossLess: true,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          const text = (inProperties[inPropertyId] as BooleanProperty | undefined)?.val?.toString()
          outProperties[outPropertyId] = { val: text }
        },
      }
    } else if (outDef.type === 'blocks' || outDef.type === 'textBlock') {
      return {
        lossLess: true,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, outData) => {
          const text = (inProperties[inPropertyId] as BooleanProperty | undefined)?.val?.toString()
          await textToBlocksProperty(
            inDef,
            text,
            outDef.type,
            outPropertyId,
            outProperties,
            outData,
            context,
            textToBlocksOpts
          )
        },
      }
    }
  } else if (inDef.type === 'datetime') {
    if (outDef.dataType === 'string') {
      return {
        lossLess: true,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          let text = ''
          const inProperty = inProperties[inPropertyId] as DatetimeProperty | undefined
          if (inProperty?.val?.length) {
            const entity = await loadAndGetC(inProperty.val[0].id)
            if (entity) text = getEntityTitle(entity, { ...config, untitledHandling: 'empty' })
          }
          outProperties[outPropertyId] = { val: text }
        },
      }
    } else if (outDef.type === 'blocks' || outDef.type === 'textBlock') {
      return {
        lossLess: true,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, outData) => {
          let text = ''
          const inProperty = inProperties[inPropertyId] as DatetimeProperty | undefined
          if (inProperty?.val?.length) {
            const entity = await loadAndGetC(inProperty.val[0].id)
            if (entity) text = getEntityTitle(entity, { ...config, untitledHandling: 'empty' })
          }
          outProperties[outPropertyId] = { val: text }
          await textToBlocksProperty(
            inDef,
            text,
            outDef.type,
            outPropertyId,
            outProperties,
            outData,
            context,
            textToBlocksOpts
          )
        },
      }
    }
  } else if (inDef.type === 'datetimeSimple') {
    if (outDef.dataType === 'string') {
      return {
        lossLess: true,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          const dateObject = (inProperties[inPropertyId] as DatetimeSimpleProperty | undefined)?.val
          const text = dateObject ? config.useTimeObject.getDateObjectComputations(dateObject).absoluteDateTime : ''
          outProperties[outPropertyId] = { val: text }
        },
      }
    } else if (outDef.type === 'blocks' || outDef.type === 'textBlock') {
      return {
        lossLess: true,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, outData) => {
          const dateObject = (inProperties[inPropertyId] as DatetimeSimpleProperty | undefined)?.val
          const text = dateObject ? config.useTimeObject.getDateObjectComputations(dateObject).absoluteDateTime : ''
          outProperties[outPropertyId] = { val: text }
          await textToBlocksProperty(
            inDef,
            text,
            outDef.type,
            outPropertyId,
            outProperties,
            outData,
            context,
            textToBlocksOpts
          )
        },
      }
    }
  } else if (inDef.dataType === 'url') {
    if (outDef.dataType === 'string') {
      return {
        lossLess: true,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          const text = (inProperties[inPropertyId] as UrlProperty | undefined)?.val
          outProperties[outPropertyId] = { val: text }
        },
      }
    } else if (outDef.dataType === 'blocks') {
      return {
        lossLess: true,
        transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, outData) => {
          const text = (inProperties[inPropertyId] as UrlProperty | undefined)?.val
          outProperties[outPropertyId] = { val: outPropertyId }
          const blocks = outData.blocks[outPropertyId]
          const block = generateBlock<TextBlock>('TextBlock', undefined)
          let token
          if (text && isValidHttpUrl(text)) {
            const url = isValidHttpUrl(text)!
            token = generateToken<LinkToken>('LinkToken')
            token.url = url.href
            token.text = url.href
            delete token.inSetup
          } else {
            token = generateToken<TextToken>('TextToken')
            token.text = text || ''
          }
          block.tokens = [token]
          if (
            outDef.type === 'textBlock' ||
            !blocks?.length ||
            (blocks.length === 1 && isEmptyBlock(blocks[0], true))
          ) {
            outData.blocks[outPropertyId] = [block]
          } else {
            blocks.push(block)
          }
        },
      }
    }
  } else if (inDef.dataType === 'label') {
    if (outDef.dataType === 'string') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          const property = inProperties[inPropertyId] as LabelProperty | undefined
          if (!property?.val?.length) return
          const text = labelPropertyToText(property, inDef)
          if (!text?.length) return
          outProperties[outPropertyId] = { val: text }
        },
      }
    } else if (outDef.type === 'blocks' || outDef.type === 'textBlock') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, outData) => {
          const property = inProperties[inPropertyId] as LabelProperty | undefined
          if (!property?.val?.length) return
          const text = labelPropertyToText(property, inDef)
          if (!text?.length) return
          await textToBlocksProperty(
            inDef,
            text,
            outDef.type,
            outPropertyId,
            outProperties,
            outData,
            context,
            textToBlocksOpts
          )
        },
      }
    } else if (outDef.type === 'label') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData, helper) => {
          const property = inProperties[inPropertyId] as LabelProperty | undefined
          if (!property?.val?.length) return
          for (const val of property.val) {
            const existingLabel = inDef.set?.find((el) => el.id === val)
            if (!existingLabel) continue
            const newLabel = getLabelFromLabelProperty(outDef, existingLabel, helper)
            if (newLabel) {
              if (!outProperties[outPropertyId]) outProperties[outPropertyId] = { val: [] } as LabelProperty
              const outProperty = outProperties[outPropertyId] as LabelProperty
              if (!outProperty?.val?.length) {
                outProperty.val = [newLabel.id]
              } else if (!outProperty.val.find((el) => el === newLabel.id)) {
                outProperty.val.push(newLabel.id)
              }
            }
          }
        },
      }
    }
  } else if (inDef.type === 'entity_aliases') {
    if (outDef.dataType === 'string') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
          const property = inProperties[inPropertyId] as AliasesProperty | undefined
          if (!property?.val?.length) return
          const text = property.val.map((alias) => alias.name).join(', ')
          if (!text?.length) return
          outProperties[outPropertyId] = { val: text }
        },
      }
    } else if (outDef.type === 'blocks' || outDef.type === 'textBlock') {
      return {
        lossLess: false,
        transformer: async (inPropertyId, inProperties, _inData, outPropertyId, outProperties, outData) => {
          const property = inProperties[inPropertyId] as AliasesProperty | undefined
          if (!property?.val?.length) return
          const text = property.val.map((alias) => alias.name).join(', ')
          if (!text?.length) return
          await textToBlocksProperty(
            inDef,
            text,
            outDef.type,
            outPropertyId,
            outProperties,
            outData,
            context,
            textToBlocksOpts
          )
        },
      }
    }
  }

  if (outDef.type === inDef.type && direktTransformationPossibleTypes.includes(inDef.type)) {
    return {
      lossLess: true,
      transformer: (inPropertyId, inProperties, _inData, outPropertyId, outProperties, _outData) => {
        outProperties[outPropertyId] = inProperties[inPropertyId]
      },
    }
  }
  return undefined
}

export function propertyIsEmpty(propertyDefinition: PropertyDefinition, entity: ComponentFull | ComponentPreview) {
  let property = entity.properties[propertyDefinition.id]
  if (!property) return true

  if (
    propertyDefinition.type === 'text' ||
    propertyDefinition.type === 'entity_title' ||
    propertyDefinition.type === 'entity_description'
  ) {
    property = property as TextProperty
    return !property.val || !property.val.length
  } else if (propertyDefinition.type === 'entity_aliases') {
    property = property as AliasesProperty
    return !property.val?.length
  } else if (propertyDefinition.type === 'number') {
    property = property as NumberProperty
    return !property.val
  } else if (propertyDefinition.type === 'boolean') {
    property = property as BooleanProperty
    return !property.val
  } else if (propertyDefinition.type === 'label') {
    property = property as LabelProperty
    return !property?.val?.length
  } else if (propertyDefinition.type === 'datetime' || propertyDefinition.dataType === 'entity') {
    property = property as DatetimeProperty | EntityProperty
    return !property.val || !property.val.length
  } else if (propertyDefinition.type === 'datetimeSimple') {
    property = property as DatetimeSimpleProperty
    return !property.val
  } else if (propertyDefinition.type === 'url') {
    property = property as UrlProperty
    return !property.val || !property.val.length
  } else if (
    propertyDefinition.type === 'blocks' ||
    propertyDefinition.type === 'textBlock' ||
    propertyDefinition.type === 'simpleTableBlock'
  ) {
    const blocks = entity.data?.blocks[propertyDefinition.id]
    if (!blocks || !blocks.length) return true
    return blocks.length === 1 && isEmptyBlock(blocks[0], true)
  } else if (propertyDefinition.type === 'entity_createdAt' || propertyDefinition.type === 'entity_lastUpdated') {
    return true
  } else if (propertyDefinition.type === 'entity_icon') {
    property = property as IconProperty
    return !property?.val
  } else if (propertyDefinition.type === 'util_dateObject') {
    property = property as UtilDateObjectProperty
    return !property?.val
  } else if (propertyDefinition.type === 'util_dateEvent') {
    property = property as UtilDateEventProperty
    return !property?.val
  } else if (propertyDefinition.type.startsWith('media_')) {
    if (propertyDefinition.type === 'media_tweets') {
      return (entity.properties.media_tweets as EntityProperty)?.val?.length === 0
    }
    return true
  } else if (propertyDefinition.type === 'util_aiChat') {
    return !!entity?.data?.chat?.length
  } else if (propertyDefinition.type === 'entity_backlinks') {
    return true
  } else {
    console.error('propertyIsEmpty: unknown property type', propertyDefinition.type)
    return true
  }
}

export function blockPropertiesAreEmpty(component: ComponentFull, structure: RootStructureFull) {
  let isEmpty = true
  for (const def of structure.data.propertyDefinitions) {
    if (def.type === 'blocks') {
      if (!isEmpty) break
      if (!propertyIsEmpty(def, component)) {
        isEmpty = false
      }
    }
  }
  return isEmpty
}

export function entityIsEmpty(
  component: ComponentFull | ComponentPreview,
  structure: RootStructureFull,
  ignoreTitle: boolean
) {
  let isEmpty = true
  for (const def of structure.data.propertyDefinitions) {
    if (ignoreTitle && def.id === 'title') continue
    if (!isEmpty) break
    if (!propertyIsEmpty(def, component)) {
      isEmpty = false
    }
  }
  return isEmpty
}

export function updateNumberFormatOfProperty(
  property: NumberPropertyDefinition,
  update: DeepPartial<NumberFormatConfig>
): void {
  property.numberFormat ??= generateDefaultNumberFormatConfig()
  property.numberFormat = merge(property.numberFormat, update)
}

export function removeNumberFormatOfProperty(property: NumberPropertyDefinition): void {
  property.numberFormat = undefined
}

export function removeNumberFormatOptionOfProperty(
  property: NumberPropertyDefinition,
  option: keyof NumberFormatConfig['options']
): void {
  if (property.numberFormat && option !== 'separators') {
    property.numberFormat.options[option] = undefined
  }
}

export function generateSystemPropertyDefinitions(
  config: {
    includeContentTypeDefinition?: boolean
  },
  t: (key: string, details?: any) => string
) {
  const definitions: PropertyDefinition[] = [generatePropertyDefinition('entity_title', undefined, t)]

  if (config.includeContentTypeDefinition) {
    definitions.push(generatePropertyDefinition('entity_type', undefined, t))
  }

  definitions.push(
    generatePropertyDefinition('entity_collections', undefined, t),
    generatePropertyDefinition('entity_description', undefined, t),
    generatePropertyDefinition('entity_createdAt', undefined, t),
    generatePropertyDefinition('entity_lastUpdated', undefined, t),
    generatePropertyDefinition('entity_tags', undefined, t),
    generatePropertyDefinition('entity_icon', undefined, t),
    generatePropertyDefinition('entity_aliases', undefined, t)
  )

  return definitions
}

export function labelPropertyToText(property: LabelProperty | undefined, propertyDefinition: LabelPropertyDefinition) {
  return property?.val?.map((el) => propertyDefinition.set?.find((item) => item.id === el)?.text || '').join(', ') || ''
}

export function labelPropertiesAreEqual(label1: LabelItem, label2: LabelItem, strict: boolean) {
  return label1.id === label2.id || (!strict && label1.text.trim().toLowerCase() === label2.text.trim().toLowerCase())
}

/** Match YAML/frontmatter label text against set items by display text or id (case-insensitive). */
export function findLabelInSetByTextOrId(labelSet: LabelItem[] | undefined, labelText: string): LabelItem | undefined {
  const normalized = labelText.trim()
  if (!normalized.length || !labelSet?.length) return undefined

  const normalizedLower = normalized.toLowerCase()
  return labelSet.find(
    (label) =>
      labelPropertiesAreEqual(label, { id: '', text: normalized }, false) || label.id.toLowerCase() === normalizedLower
  )
}

type TranslationFunction = (key: string) => string
type TranslationExistsFunction = (key: string) => boolean | undefined

export function getLabelItemText(label: LabelItem, t: TranslationFunction, te?: TranslationExistsFunction): string {
  if (!label.localizationKey) return label.text
  if (te && !te(label.localizationKey)) return label.text
  return t(label.localizationKey)
}

export function getLocalizedLabelItem(
  label: LabelItem,
  t: TranslationFunction,
  te?: TranslationExistsFunction
): LabelItem {
  if (!label.localizationKey) return label
  return {
    ...label,
    text: getLabelItemText(label, t, te),
  }
}

export function getLocalizedLabelSet(
  labelSet: LabelItem[],
  t: TranslationFunction,
  te?: TranslationExistsFunction
): LabelItem[] {
  return labelSet.map((label) => getLocalizedLabelItem(label, t, te))
}

export function generateNewLabelItem(labelText: string, isStatusProperty: boolean): LabelItem {
  return {
    id: uuid(),
    text: labelText?.length < LABEL_TEXT_MAX_LENGTH ? labelText : labelText.slice(0, LABEL_TEXT_MAX_LENGTH) + '...',
    icon: undefined,
    color: themeColors[Math.floor(Math.random() * themeColors.length)],
    statusCategory: isStatusProperty ? 'not-started' : undefined,
  }
}

function generateBaseOutDefinition(
  inDefinition: PropertyDefinition,
  outType: PropertyTypes,
  t: (key: string, details?: any) => string
) {
  inDefinition = cloneDeep(inDefinition)
  const outDefinition = generatePropertyDefinition(outType, undefined, t) as LabelPropertyDefinition
  outDefinition.name = inDefinition.name
  outDefinition.name.val = inDefinition.name.val
  outDefinition.icon = inDefinition.icon
  outDefinition.description = inDefinition.description
  outDefinition.readOnly = inDefinition.readOnly
  outDefinition.aiSettings = inDefinition.aiSettings
  return outDefinition
}

export const getPropertyDefinitionTransformations = (
  t: (key: string, details?: any) => string
): Partial<
  Record<PropertyTypes, Partial<Record<PropertyTypes, (inDefinition: PropertyDefinition) => PropertyDefinition>>>
> => ({
  entity: {
    label: (inDefinition: PropertyDefinition) => {
      const outDefinition = generateBaseOutDefinition(inDefinition, 'label', t)
      if (inDefinition.type !== 'entity') throw new Error('inDefinition.type !== entity')
      outDefinition.isArray = inDefinition.isArray
      return outDefinition
    },
    textBlock: (inDefinition: PropertyDefinition) => {
      return generateBaseOutDefinition(inDefinition, 'textBlock', t)
    },
  },
  number: {
    textBlock: (inDefinition: PropertyDefinition) => {
      return generateBaseOutDefinition(inDefinition, 'textBlock', t)
    },
  },
  textBlock: {
    number: (inDefinition: PropertyDefinition) => {
      return generateBaseOutDefinition(inDefinition, 'number', t)
    },
  },
})

export function getLabelSet(
  propertyDefinition: LabelPropertyDefinition,
  structure: RootStructureFull,
  space: Component | undefined
) {
  let labelSet: LabelItem[]
  if (structure.id === 'RootTask' && propertyDefinition.id === 'status') {
    labelSet = taskUtils.getStatusSet(structure, onlyRootSpaceFull(space))
  } else {
    labelSet = propertyDefinition.set
  }
  return labelSet
}
