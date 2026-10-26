import { ComponentFull, ComponentPreview, cTypes, CTypes } from '../models/component.model.js'
import { getPublicApiConstrainedUpsertStructureIds } from '../public-api/public-api-object-properties.js'

export type StructureHeuristicConfig = {
  isSubscriber: boolean
  isCapacitiesTeam: boolean
  isDev: boolean
  isNightly: boolean
  isMobileOnly: boolean
  exposeProStructures: boolean
  hideTaskManagement: boolean
  /** Whiteboard rollout flag. See `whiteboardAccess` in store/session.ts. */
  whiteboardAccess: boolean
  /**
   * Public HTTP API / MCP only. Independent of `whiteboardAccess` because
   * `generateGenericStructureHeuristicConfig(true)` forces that flag on server-side.
   * Always false in the factory; leave off until the public API is ready.
   */
  publicApiWhiteboardAccess: boolean
}

export function generateGenericStructureHeuristicConfig(allowAll = false): StructureHeuristicConfig {
  return {
    isSubscriber: allowAll,
    isCapacitiesTeam: allowAll,
    isDev: allowAll,
    isNightly: allowAll,
    isMobileOnly: false,
    exposeProStructures: false,
    hideTaskManagement: false,
    whiteboardAccess: allowAll,
    publicApiWhiteboardAccess: false,
  }
}

const showTaskManagement = (config: StructureHeuristicConfig) => {
  return config.exposeProStructures && !config.hideTaskManagement
}

/**
 * Spreads `RootWhiteboard` into first-class object surfaces (create, search, tree, trash,
 * full-text, export, pin, backlinks, convert, queries, public API) while the app rollout flag is on.
 * Keep out of hierarchy, presentation mode, and bulk-import fallback.
 */
const whiteboard = (config: StructureHeuristicConfig): CTypes[] => {
  return config.whiteboardAccess ? ['RootWhiteboard'] : []
}

/**
 * Public HTTP API / MCP. Not tied to `whiteboardAccess` — that flag is already on for nightly
 * app users, and `generateGenericStructureHeuristicConfig(true)` forces it on server-side.
 */
const whiteboardPublicApi = (config: StructureHeuristicConfig): CTypes[] => {
  return config.publicApiWhiteboardAccess ? ['RootWhiteboard'] : []
}

const structureContextDefinitions = {
  hasContextMenu: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootDailyNote',
      'RootDatabase',
      'RootSimpleTable',
      'RootDatabase',
      'RootStructure',
      'RootQuery',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  appearInObjectStudio: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootTag',
      'MediaImage',
      'MediaWebResource',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootQuery',
      'RootSimpleTable',
      'RootEntity',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  isProInObjectStudio: () => {
    return ['RootAIChat', 'RootQuery', 'RootTask']
  },
  appearOnLandingPage: () => {
    return [
      'RootPage',
      'RootTag',
      'MediaImage',
      'MediaWebResource',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootEntity',
      'RootQuery',
    ]
  },
  guaranteeThatAllContentIsLoaded: () => {
    return ['RootTag', 'RootQuery'] //! not 'RootStructure' because it is loaded separately
  },
  searchOrCreateMenu: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'MediaImage',
      'MediaWebResource',
      'MediaTweet',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'RootEntity',
      'RootTag',
      'UtilDate',
      'RootSimpleTable',
      config.exposeProStructures ? 'RootQuery' : '',
      showTaskManagement(config) ? 'RootTask' : '',
      ...whiteboard(config),
    ]
  },
  createMenu: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'MediaImage',
      'MediaWebResource',
      'MediaTweet',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'RootEntity',
      'RootTag',
      'UtilDate',
      config.exposeProStructures ? 'RootQuery' : '',
      showTaskManagement(config) ? 'RootTask' : '',
      ...whiteboard(config),
    ]
  },
  addFromControlGlobally: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'MediaImage',
      'MediaWebResource',
      'MediaTweet',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'RootEntity',
      'RootTag',
      'RootSimpleTable',
      config.exposeProStructures ? 'RootQuery' : '',
      showTaskManagement(config) ? 'RootTask' : '',
      ...whiteboard(config),
    ]
  },
  spaceOverview: (config: StructureHeuristicConfig) => {
    return [
      'RootEntity',
      'RootTag',
      'RootPage',
      'MediaImage',
      'MediaWebResource',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootStructure',
      'RootDailyNote',
      'UtilDate',
      'RootQuery',
      'RootSimpleTable',
      'RootBlocksTemplate',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  reuse: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootTag',
      'UtilDate',
      'MediaImage',
      'MediaWebResource',
      'MediaTweet',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'RootAIChat',
      'RootDatabase',
      'RootEntity',
      'RootQuery',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  blockBasedLinking: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootTag',
      'MediaImage',
      'MediaWebResource',
      'MediaTweet',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'RootAIChat',
      'RootEntity',
      'RootDailyNote',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  exportAllowed: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootDailyNote',
      'RootDatabase',
      'RootSimpleTable',
      'RootDatabase',
      'RootStructure',
      'RootQuery',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  exportDataView: () => {
    return ['RootDatabase', 'RootStructure', 'RootQuery', 'RootTag']
  },
  exportCopyAsMarkdownUseful: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootDailyNote',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  turnIntoBlocks: (config: StructureHeuristicConfig) => {
    return ['RootPage', 'RootEntity', 'RootTag', showTaskManagement(config) ? 'RootTask' : '', ...whiteboard(config)]
  },
  allowedInContext: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootDailyNote',
      'MediaImage',
      'MediaWebResource',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootDatabase',
      'RootEntity',
      'UtilDate',
      'RootTag',
      'RootQuery',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  canBeReused: (config: StructureHeuristicConfig) => {
    return [
      'RootSpace',
      'User',
      'UserPersonal',
      'RootDatabase',
      'RootPage',
      'RootStructure',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootDailyNote',
      'RootTag',
      'RootQuery',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  cannotBeDuplicatedInUI: () => {
    return [
      'MediaImage',
      'MediaWebResource',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'MediaTweet',
      'RootDailyNote',
      'RootStructure',
      'RootDatabase',
      'RootSpace',
      'User',
      'UserPersonal',
      'RootAIChat',
    ]
  },
  /** Parent types allowed to own `data.secondaryFiles` (e.g. PDF snapshots). Keep aligned with cannotBeDuplicatedInUI. */
  canHaveSecondaryFiles: () => {
    return ['MediaPDF', 'RootAIChat']
  },
  reuseOnDuplicate: () => {
    return [
      'MediaImage',
      'MediaWebResource',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'MediaTweet',
      'RootTag',
      'RootDailyNote',
      'RootStructure',
      'RootDatabase',
      'RootQuery',
    ]
  },
  inFullExport: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootDailyNote',
      'RootQuery',
      'RootSimpleTable',
      'RootDatabase',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  showCardViewOnLinkHover: (config: StructureHeuristicConfig) => {
    return [
      'RootEntity',
      'RootPage',
      'MediaImage',
      'MediaWebResource',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'MediaTweet',
      'RootQuery',
      'RootSimpleTable',
      'RootTask',
      'UtilDate',
      ...whiteboard(config),
    ]
  },
  canBeCreatedWithoutCustomSetup: (config: StructureHeuristicConfig) => {
    return ['RootPage', 'RootEntity', 'RootTag', 'RootTask', ...whiteboard(config)]
  },
  canBeFallbackForBulkImport: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'RootTag',
      'RootDailyNote',
      'MediaWebResource',
      showTaskManagement(config) ? 'RootTask' : '',
    ]
  },
  propertyTransformationAllowed: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'RootTag',
      'RootDailyNote',
      showTaskManagement(config) ? 'RootTask' : '',
      ...whiteboard(config),
    ]
  },
  typeChangeToAllowed: (config: StructureHeuristicConfig) => {
    return ['RootPage', 'RootEntity', 'RootTag', showTaskManagement(config) ? 'RootTask' : '', ...whiteboard(config)]
  },
  typeChangeFromAllowed: (config: StructureHeuristicConfig) => {
    return ['RootPage', 'RootEntity', 'MediaWebResource', 'RootTask', ...whiteboard(config)]
  },
  canBePinned: (config: StructureHeuristicConfig) => {
    return [
      'RootDatabase',
      'RootQuery',
      'RootPage',
      'RootStructure',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  objectTypeCannotBePinned: () => {
    return [
      'RootSpace',
      'User',
      'UserPersonal',
      'RootDatabase',
      'RootStructure',
      'RootBlocksTemplate',
      'UtilDate',
      'RootTask',
    ]
  },
  importFromFileAllowed: () => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootDailyNote',
      'RootTask',
    ]
  },
  bulkImportAllowed: () => {
    return ['RootStructure', 'RootDatabase', 'RootTag']
  },
  singleImportAllowed: () => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaVideo',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootDailyNote',
      'RootTask',
    ]
  },
  hasNoGraphViewSupport: () => {
    // Collections, saved queries, and object types graph their members. Notes and tags use the object graph.
    return ['RootSpace', 'User', 'UserPersonal', 'UtilDate']
  },
  hasObjectsInsideSection: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaVideo',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  allowedInRecentComponents: (config: StructureHeuristicConfig) => {
    return [
      'RootDatabase',
      'RootPage',
      'RootStructure',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootDailyNote',
      'RootAIChat',
      'RootTag',
      'RootQuery',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  isHierarchyElement: (_config: StructureHeuristicConfig) => {
    return ['RootDatabase', 'RootPage', 'RootEntity', 'RootTag', 'RootDailyNote', 'RootQuery', 'RootSimpleTable']
  },
  allowedAsEntityProperty: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootTag',
      'RootEntity',
      ...whiteboard(config),
    ]
  },
  inVisibleDatabaseTree: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootTag',
      'RootDailyNote',
      'RootQuery',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  canHaveCollections: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootQuery',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootTag',
      'RootSimpleTable',
      ...whiteboard(config),
    ]
  },
  fullTextSearchCompatible: (config: StructureHeuristicConfig) => {
    return [
      'RootStructure',
      'RootDatabase',
      'RootTag',
      'RootQuery',
      'RootPage',
      'RootEntity',
      'RootBlocksTemplate',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootDailyNote',
      'RootAIChat',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  aiEmbeddingsCompatible: (config: StructureHeuristicConfig) => {
    return [
      'RootDatabase',
      'RootQuery',
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaVideo',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  ignoreEmptyAiEmbeddings: () => {
    return ['MediaImage', 'MediaPDF', 'MediaAudio', 'MediaVideo', 'RootAIChat', 'RootDailyNote']
  },
  allowedInCalendarQuery: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootTag',
      'RootAIChat',
      'RootQuery',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  templatesAllowed: (config: StructureHeuristicConfig) => {
    return ['RootPage', 'RootEntity', 'RootDailyNote', 'RootSimpleTable', 'RootTask', ...whiteboard(config)]
  },
  allowedInStructureSettings: (config: StructureHeuristicConfig) => {
    return [
      'RootEntity',
      'RootQuery',
      'RootPage',
      'RootBlocksTemplate',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootDailyNote',
      'RootTag',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  pdfExportAllowed: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'RootDailyNote',
      'RootAIChat',
      'RootSimpleTable',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  hasGlobalDelete: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootDailyNote',
      'RootEntity',
      'RootTag',
      'MediaImage',
      'MediaPDF',
      'MediaFile',
      'MediaWebResource',
      'MediaAudio',
      'MediaTweet',
      'RootAIChat',
      'RootQuery',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  /** Object merge. Tags, pages, and custom objects. */
  canBeMerged: () => {
    return ['RootTag', 'RootPage', 'RootEntity']
  },
  hasFileToDownload: () => {
    return ['MediaImage', 'MediaPDF', 'MediaAudio', 'MediaFile']
  },
  isShareable: (config: StructureHeuristicConfig) => {
    return [
      'RootDatabase',
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootTag',
      'RootDailyNote',
      'UtilDate',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  // Dates stay shareable as nested objects. They are not rows on Space → Shared.
  inSharedContentOverview: (config: StructureHeuristicConfig) => {
    return structureContextDefinitions.isShareable(config).filter((id) => id !== 'UtilDate')
  },
  allowedInQueryStructures: (config: StructureHeuristicConfig) => {
    return [
      'RootQuery',
      'RootPage',
      'RootStructure',
      'RootEntity',
      'RootBlocksTemplate',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTag',
      'UtilDate',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  allowedInQueryStructuresFrontend: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  /** All notes dashboard. Content types only — no queries, structures, templates, dates, or daily notes. */
  allNotes: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootTag',
      ...whiteboard(config),
    ]
  },
  presentationModeAllowed: () => {
    return [
      'RootPage',
      'RootEntity',
      'RootDailyNote',
      'RootAIChat',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaTweet',
      'MediaFile',
    ]
  },
  hasTextStats: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootDailyNote',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  entityHasInitialLocalDataViewConfig: () => {
    return ['RootDatabase', 'RootTag']
  },
  entityBlockHasLocalDataViewConfig: () => {
    return ['RootDatabase', 'RootTag']
  },
  neverOpenInPreviewModal: () => {
    return ['RootSpace', 'UserPersonal', 'Root', 'RootStructure']
  },
  canHaveBacklinks: (config: StructureHeuristicConfig) => {
    return [
      'RootQuery',
      'RootDatabase',
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootTag',
      'UtilDate',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  canHaveBacklinksSection: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  canBeAIChatContext: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaWebResource',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'MediaTweet',
      'RootDailyNote',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  mediaTypesWithAutomaticLinkToEntityConversion: () => {
    return ['MediaImage', 'MediaPDF', 'MediaAudio', 'MediaTweet']
  },
  excludeFromGarbageCollector: () => {
    return ['User', 'UserPersonal', 'RootDatabase', 'RootStructure', 'RootSpace']
  },
  doesNotRequireContextCalculation: () => {
    return ['User', 'UserPersonal', 'RootStructure', 'RootSpace']
  },
  permissionHandlerListOrder: (config: StructureHeuristicConfig) => {
    return [
      'RootDatabase',
      'RootSpace',
      'RootEntity',
      'RootPage',
      'RootSimpleTable',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaTweet',
      'RootAIChat',
      'MediaFile',
      'RootTask',
      'RootStructure',
      'User',
      'UserPersonal',
      ...whiteboard(config),
    ]
  },
  createdAtCanBeChanged: (config: StructureHeuristicConfig) => {
    return [
      'RootQuery',
      'RootSimpleTable',
      'RootPage',
      'RootEntity',
      'RootBlocksTemplate',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  allowedInSpaceTrash: (config: StructureHeuristicConfig) => {
    return [
      'RootDatabase',
      'RootQuery',
      'RootPage',
      'RootStructure',
      'RootEntity',
      'RootBlocksTemplate',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  firstWriteWinsOverwrite: () => {
    return ['RootSpace', 'User', 'UserPersonal', 'RootDatabase', 'RootQuery', 'RootStructure', 'RootTag', 'UtilDate']
  },
  ignoreInSyncOverwriteNotification: () => {
    return ['RootSpace', 'User', 'UserPersonal', 'RootDatabase', 'RootStructure', 'UtilDate']
  },
  ignoreInEntityPropertyDeleteTreeDown: () => {
    return ['RootSpace', 'User', 'UserPersonal', 'RootDatabase', 'RootStructure', 'RootBlocksTemplate']
  },
  tagPropertyAutofillAllowed: (config: StructureHeuristicConfig) => {
    return [
      'RootQuery',
      'RootPage',
      'RootEntity',
      'RootBlocksTemplate',
      'MediaWebResource',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTask',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'MediaTweet',
      ...whiteboard(config),
    ]
  },
  descriptionPropertyAutofillAllowed: (config: StructureHeuristicConfig) => {
    return [
      'RootQuery',
      'RootPage',
      'RootEntity',
      'MediaWebResource',
      'RootAIChat',
      'RootSimpleTable',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  entityPropertyAutofillAllowed: (config: StructureHeuristicConfig) => {
    return [
      'RootQuery',
      'RootPage',
      'RootEntity',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  titleCanBeChanged: (config: StructureHeuristicConfig) => {
    return [
      'RootQuery',
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'RootAIChat',
      'RootSimpleTable',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  hasRelatedContent: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaVideo',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  canBeRelatedContent: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaVideo',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  hasUnlinkedMentions: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootTag',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  canBeUnlinkedMention: (config: StructureHeuristicConfig) => {
    return [
      'RootQuery',
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTask',
      ...whiteboard(config),
    ]
  },
  canBeDeletedAutomatically: (config: StructureHeuristicConfig) => {
    return ['RootEntity', 'RootPage', 'RootQuery', 'RootTag', 'RootTask', ...whiteboard(config)]
  },
  /**
   * Small card property layout. Pages, custom object types, and daily notes.
   * An unknown id counts as RootEntity.
   * Tasks, tags, collections, queries, spaces, whiteboards, images, other media,
   * AI chats, tables, and object types stay out.
   */
  canCustomizeSmallCard: () => {
    return ['RootPage', 'RootEntity', 'RootDailyNote']
  },
  allowedAsReadwiseObject: () => {
    return ['RootPage', 'RootEntity']
  },
  canNotMoveBlockTo: () => {
    return [
      'RootSpace',
      'User',
      'UserPersonal',
      'RootDatabase',
      'RootQuery',
      'RootStructure',
      'RootBlocksTemplate',
      'RootTag',
      'UtilDate',
    ]
  },
  publicApiFetchable: (config: StructureHeuristicConfig) => {
    return [
      'RootDatabase',
      'RootQuery',
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaVideo',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTag',
      'RootTask',
      ...whiteboardPublicApi(config),
    ]
  },
  publicApiDeletable: (config: StructureHeuristicConfig) => {
    return [
      'RootQuery',
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaVideo',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootAIChat',
      'RootSimpleTable',
      'RootTag',
      'RootTask',
      ...whiteboardPublicApi(config),
    ]
  },
  publicApiPatchable: (config: StructureHeuristicConfig) => {
    return [
      'RootPage',
      'RootEntity',
      'RootTag',
      'RootTask',
      ...getPublicApiConstrainedUpsertStructureIds(),
      ...whiteboardPublicApi(config),
    ]
  },
  publicApiCreatable: (config: StructureHeuristicConfig) => {
    return ['RootPage', 'RootEntity', 'RootTag', 'RootTask', ...whiteboardPublicApi(config)]
  },
  canHaveTaskPageViewContentTab: () => {
    return [
      'RootPage',
      'RootEntity',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaVideo',
      'MediaWebResource',
      'MediaFile',
      'MediaTweet',
      'RootSimpleTable',
      'RootDailyNote',
      'RootTag',
      'RootTask',
    ]
  },
  shareSheetTarget: (config: StructureHeuristicConfig) => {
    return [
      'RootEntity',
      'RootPage',
      'MediaImage',
      'MediaWebResource',
      'MediaPDF',
      'MediaAudio',
      'MediaFile',
      'MediaTweet',
      'RootDailyNote',
      showTaskManagement(config) ? 'RootTask' : '',
    ]
  },
  versionControlEnabled: () => {
    return [
      'RootDailyNote',
      'RootPage',
      'RootEntity',
      'RootTask',
      'MediaImage',
      'MediaPDF',
      'MediaAudio',
      'MediaVideo',
      'MediaWebResource',
      'MediaFile',
    ]
  },
}

export type StructureContext = keyof typeof structureContextDefinitions

export const controlDropdownOrderBackbone = () => {
  return [
    'block_TextBlock',
    'structure_RootPage',
    'structure_RootTask',
    'structure_MediaImage',
    'structure_MediaWebResource',
    'structure_MediaTweet',
    'structure_MediaPDF',
    'structure_MediaAudio',
    'structure_MediaFile',
    'structure_RootAIChat',
    'structure_RootTag',
    'structure_RootEntity',
    'structure_RootQuery',
    'block_GroupBlock',
    'block_GridBlock',
    'block_SimpleTableBlock',
    'block_HorizontalLineBlock',
    'block_MathBlock',
    'block_CodeBlock',
  ]
}

export function getStructureOrderBackbone(context: StructureContext, config: StructureHeuristicConfig) {
  return structureContextDefinitions[context] ? (structureContextDefinitions[context](config) as CTypes[]) : []
}

export function structureFilterFnBackbone(
  structureId: string,
  context: StructureContext,
  config: StructureHeuristicConfig
) {
  const cOrder = getStructureOrderBackbone(context, config)
  if (!cTypes.includes(structureId as CTypes)) return cOrder.includes('RootEntity')
  return cOrder.includes(structureId as CTypes)
}

function structureIdOrderFnBackbone(
  context: StructureContext,
  structureId: string | undefined,
  config: StructureHeuristicConfig
) {
  if (!structureId) return 110
  const cOrder = getStructureOrderBackbone(context, config)
  let index = cOrder.findIndex((el) => el === structureId)
  if (index === -1) {
    index = cOrder.findIndex((el) => el === 'RootEntity')
    return index === -1 ? 100 : index
  }
  return index
}

export function structureIdSortFnBackbone(
  context: StructureContext,
  structureId1: string | undefined,
  structureId2: string | undefined,
  config: StructureHeuristicConfig
) {
  return (
    structureIdOrderFnBackbone(context, structureId1, config) -
    structureIdOrderFnBackbone(context, structureId2, config)
  )
}

export function structureSortFnBackbone(
  context: StructureContext,
  structure1: ComponentFull | ComponentPreview | undefined,
  structure2: ComponentFull | ComponentPreview | undefined,
  config: StructureHeuristicConfig
) {
  return structureIdSortFnBackbone(context, structure1?.id, structure2?.id, config)
}
