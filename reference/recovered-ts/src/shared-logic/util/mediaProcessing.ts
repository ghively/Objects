import { v4 as uuid } from 'uuid'
import { ComponentPolicy } from '../models/access.model.js'
import { UrlMetadata } from '../models/api/api.js'
import { FileResourceUrls } from '../models/api/resources.api.js'
import {
  Component,
  ComponentFull,
  ComponentPreview,
  ComponentPreviewElement,
  CTypes,
  LoadingStates,
  MediaAudio,
  MediaAudioFull,
  MediaAudioPreview,
  MediaFile,
  MediaFileFull,
  MediaFilePreview,
  MediaImage,
  MediaImageFull,
  MediaImagePreview,
  MediaPDF,
  MediaPDFFull,
  MediaPDFPreview,
  MediaTweet,
  MediaTweetFull,
  MediaTweetPreview,
  MediaVideo,
  MediaVideoFull,
  MediaVideoPreview,
  MediaWebResource,
  MediaWebResourceFull,
  MediaWebResourcePreview,
  RootDatabaseFull,
  RootStructureFull,
} from '../models/component.model.js'
import { MutationWrapperSync } from '../models/general.model.js'
import {
  getContentTypeFromExtension,
  mediaTypeConfig,
  mediaTypesWithLinkSupport,
  MediaTypesWithLinkSupport,
} from '../models/media.model.js'
import { TweetElement, TweetInfo } from '../models/twitter.model.js'
import { generateLinkDown } from './componentHelper.js'
import { isValidEmail, isValidHttpUrl } from './general.js'
import { staticRoutes } from './name.js'
import { addTagsToEntity, onlyRootStructureFull } from './componentChecks.js'
import { htmlToMd } from './htmlToMd.js'
import { getWeblinkNormalizedHtmlParagraphSegments } from './weblinkNormalizedHtml.js'
import type { MediaContentRow } from '../models/media-content.model.js'
import type { ImageAnalysisResponseDto } from '../models/api/image.api.js'
import type { AudioAnalysisResponseDto } from '../models/api/audio.api.js'
import type { WeblinkAnalysisResponseDto } from '../models/api/weblink.api.js'
import type { PdfAnalysisResponseDto } from '../models/api/pdf.api.js'

export const mediaIconMappings = {
  md: 'vscode-icons-file-type-markdown',
  mp3: 'ph-waveform',
  mpeg: 'ph-waveform',
  mpg: 'ph-waveform',
  wav: 'ph-waveform',
  ogg: 'ph-waveform',
  tex: 'vscode-icons-file-type-light-tex',
  pdf: 'vscode-icons-file-type-pdf2',
  html: 'vscode-icons-file-type-html',
  doc: 'vscode-icons-file-type-word',
  docx: 'vscode-icons-file-type-word',
  ppt: 'vscode-icons-file-type-powerpoint',
  pptx: 'vscode-icons-file-type-powerpoint',
  xls: 'vscode-icons-file-type-excel',
  xlsx: 'vscode-icons-file-type-excel',
  zip: 'vscode-icons-file-type-zip',
  js: 'vscode-icons-file-type-js-official',
  json: 'vscode-icons-file-type-light-json',
  ts: 'vscode-icons-file-type-typescript-official',
  txt: 'ph-file-text',
  csv: 'ph-file-csv',
  epub: 'vscode-icons-file-type-epub',
} as const

export type MediaHandledComponentFull =
  | MediaImageFull
  | MediaPDFFull
  | MediaAudioFull
  | MediaVideoFull
  | MediaFileFull
  | MediaWebResourceFull
  | MediaTweetFull

export type MediaHandledComponentPreview =
  | MediaImagePreview
  | MediaPDFPreview
  | MediaAudioPreview
  | MediaVideoPreview
  | MediaFilePreview
  | MediaWebResourcePreview
  | MediaTweetPreview

export type MediaComponent = MediaImage | MediaPDF | MediaAudio | MediaVideo | MediaFile | MediaWebResource | MediaTweet

type EntityObj = {
  addToSpace: boolean
  initialDependencyId: string | undefined
  entity: ComponentFull
  wasSet: boolean
}

export type MediaProcessingObject = {
  id: string
  confirmed: boolean
  processingDone: boolean
  entities: EntityObj[]
  previewImageUrl?: string | undefined
}

export type MediaProcessingResponseObject = {
  entity: ComponentFull
  previewImageUrl: string | undefined
  handleCancel: () => void
  handleConfirm: () => Promise<void>
}

export function estimateHttpUrlContentType(urlString: string) {
  const response: {
    estimatedContentType: MediaTypesWithLinkSupport
    ending?: string | undefined
    mimeType?: string | undefined
  } = { estimatedContentType: 'MediaWebResource' }
  if (inferTweetInfo(urlString)) {
    response.estimatedContentType = 'MediaTweet'
    return response
  }
  for (const type of mediaTypesWithLinkSupport) {
    const endings = mediaTypeConfig[type].fileEndings
    let url: URL
    try {
      url = new URL(urlString)
    } catch (e) {
      return response
    }
    for (const ending of endings) {
      if (url.pathname.endsWith('.' + ending)) {
        response.estimatedContentType = type
        response.ending = ending
        response.mimeType = getContentTypeFromExtension(ending)
        return response
      }
    }
  }
  return response
}

const BLOCKED_DEEP_LINK_SCHEMES = new Set(['http', 'https', 'javascript', 'data', 'vbscript', 'blob', 'mailto', 'tel'])

/**
 * Custom OS URL schemes (e.g. obsidian://, marginnote4app://).
 * Uses RFC 3986 scheme syntax; blocks dangerous / handled-elsewhere schemes.
 * `file://` remains a deep link so the editor can open local paths on desktop.
 */
function isDeeplinkUrl(urlString: string) {
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(urlString)
  if (!schemeMatch) return false

  const scheme = schemeMatch[1].toLowerCase()
  if (BLOCKED_DEEP_LINK_SCHEMES.has(scheme)) return false

  // Require // or /// so we don't treat bare "scheme:opaque" as a deep link
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/{2,3}\S+$/.test(urlString)
}

function _getLocationFromPath(path: string, searchString: string, userPersonalId: string) {
  if (path === '/') {
    return { spaceId: userPersonalId, componentId: userPersonalId }
  }

  let componentLocation: string | undefined
  const locationArray = path.split('/')
  locationArray.shift()

  if (!locationArray || (locationArray.length !== 1 && locationArray.length !== 2)) {
    return undefined
  }
  const spaceLocation = locationArray[0]
  if (locationArray.length === 2) {
    componentLocation = locationArray[1]
  }

  let spaceId: string
  if (spaceLocation === 'home') {
    spaceId = userPersonalId
  } else spaceId = spaceLocation

  let componentId: string
  if (!componentLocation) componentId = spaceId
  else componentId = componentLocation

  const searchParams = new URLSearchParams(searchString)

  return { spaceId, componentId, bId: searchParams.get('bid') || undefined }
}

export function isInternalUrl(urlString: string, spaceId: string, userPersonalId: string, frontendUrl: string) {
  if (urlString.startsWith('capacities://')) urlString = urlString.replace('capacities://', frontendUrl + '/')
  const url = isValidHttpUrl(urlString, true)
  if (!url) return undefined
  if (url.host !== new URL(frontendUrl).host) return undefined
  if (staticRoutes().find((el) => url.pathname.startsWith(el))) return 'internalStatic'
  const location = _getLocationFromPath(url.pathname, url.search, userPersonalId)
  if (!location) return 'internalStatic'
  return location
}

function isSpecialUrl(
  urlString: string | undefined
): { type: 'mailto' | 'tel'; value: string; text?: string | undefined } | undefined {
  if (urlString && urlString.startsWith('mailto:') && isValidEmail(urlString.replace('mailto:', '')))
    return {
      type: 'mailto',
      value: urlString.replace('mailto:', ''),
      text: urlString.replace('mailto:', ''),
    }
  else if (urlString && urlString.startsWith('tel:'))
    return {
      type: 'tel',
      value: urlString.replace('tel:', ''),
      text: urlString.replace('tel:', ''),
    }
  else return undefined
}

export function getUrlInformation(
  urlString: string,
  spaceId: string,
  userPersonalId: string,
  frontendUrl: string
):
  | { type: 'special'; info: { type: 'mailto' | 'tel'; value: string; text?: string | undefined } }
  | {
      type: 'internal'
      info: { spaceId: string; componentId: string; bId?: string | undefined }
    }
  | { type: 'internalStatic'; url: string }
  | { type: 'deepLink'; url: string }
  | {
      type: 'http'
      url: string
      estimatedContentType: MediaTypesWithLinkSupport
      ending?: string | undefined
      mimeType?: string | undefined
    }
  | undefined {
  const specialUrlInfo = isSpecialUrl(urlString)
  if (specialUrlInfo) return { type: 'special', info: specialUrlInfo }
  const internalInfo = isInternalUrl(urlString, spaceId, userPersonalId, frontendUrl)
  if (internalInfo === 'internalStatic') return { type: 'internalStatic', url: urlString }
  if (internalInfo) return { type: 'internal', info: internalInfo }
  if (isDeeplinkUrl(urlString)) return { type: 'deepLink', url: urlString }
  if (isValidHttpUrl(urlString, true)) {
    return { type: 'http', url: urlString, ...estimateHttpUrlContentType(urlString) }
  }
  return undefined
}

export type MediaImageObject = {
  mimeType: string | undefined
  width: number | null | undefined
  height: number | null | undefined
  imageSource: 'web' | 'unsplash' | 'upload'
  urls: FileResourceUrls
  isFileUrl: boolean
  entity?: MediaImageFull | MediaImagePreview
}

export async function getMediaImageObj(
  entity: MediaImageFull | MediaImagePreview,
  fileUrl?: string
): Promise<MediaImageObject | undefined> {
  const urlReference = entity.properties?.media_URLReference?.val
  const imageSource = entity.properties?.media_imageSource?.val
  const unsplash = entity.data?.unsplash

  const base = {
    imageSource: entity.properties.media_imageSource?.val as MediaImageObject['imageSource'],
    width: entity.properties.media_imageWidth?.val,
    height: entity.properties.media_imageHeight?.val,
    mimeType: entity.properties?.media_MIMEType?.val,
    isFileUrl: typeof fileUrl === 'string',
  }

  if (fileUrl) {
    return {
      ...base,
      urls: {
        raw: fileUrl,
        small: fileUrl,
        regular: fileUrl,
        thumb: fileUrl,
        full: fileUrl,
      },
    }
  }

  if (imageSource === 'web' && urlReference) {
    return {
      ...base,
      urls: {
        raw: urlReference,
        small: urlReference,
        regular: urlReference,
        thumb: urlReference,
        full: urlReference,
      },
    }
  }

  if (imageSource === 'unsplash' && unsplash) {
    return {
      ...base,
      urls: { ...unsplash.urls },
    }
  }

  if (
    imageSource === 'upload' &&
    entity.fileResource &&
    typeof entity.fileResource === 'object' &&
    entity.fileResource?.urls
  ) {
    return {
      urls: entity.fileResource.urls,
      mimeType: entity.properties?.media_MIMEType?.val,
      imageSource: entity.properties.media_imageSource?.val as MediaImageObject['imageSource'],
      width: entity.properties.media_imageWidth?.val,
      height: entity.properties.media_imageHeight?.val,
      isFileUrl: false,
    }
  }

  return undefined
}

/** Extracts a bare http(s) URL from a frontmatter/image property value or markdown image/link. */
export function extractHttpUrlFromPropertyValue(value: string): string | undefined {
  const trimmed = value.trim().replace(/^['"]+|['"]+$/g, '')
  if (!trimmed) return undefined

  const direct = isValidHttpUrl(trimmed, true)
  if (direct) return direct.href

  const angled = trimmed.match(/^<(https?:\/\/[^>]+)>$/i)
  if (angled) {
    const url = isValidHttpUrl(angled[1], true)
    if (url) return url.href
  }

  const markdown = trimmed.match(/^!?\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/)
  if (markdown) {
    const url = isValidHttpUrl(markdown[2], true)
    if (url) return url.href
  }

  return undefined
}

export function stampWebReferencedMediaImage(
  entity: MediaImageFull,
  imageUrl: string,
  title?: string | undefined
): void {
  let resolvedTitle = title
  if (!resolvedTitle) {
    try {
      const base = new URL(imageUrl).pathname.split('/').filter(Boolean).at(-1)
      resolvedTitle = base ? decodeURIComponent(base).replace(/\.[a-z0-9]{2,5}$/i, '') : undefined
    } catch {
      resolvedTitle = undefined
    }
  }
  entity.properties.title = { val: resolvedTitle }
  entity.properties.media_imageSource = { val: 'web' }
  entity.properties.media_URLReference = { val: imageUrl }
  delete entity.data.setup
  delete entity.data.mediaProcessingState
}

export function getMediaUrl(el: ComponentFull | ComponentPreview | ComponentPreviewElement) {
  if (!mediaTypesWithLinkSupport.includes(el.structureId as MediaTypesWithLinkSupport)) return undefined

  return (
    el.properties as
      | MediaImageFull['properties']
      | MediaPDFFull['properties']
      | MediaAudioFull['properties']
      | MediaWebResourceFull['properties']
      | MediaTweetFull['properties']
      | undefined
  )?.media_URLReference?.val
}

export async function addUrlMetadataToEntity(
  entity: MediaImageFull | MediaAudioFull | MediaWebResourceFull | MediaPDFFull,
  urlInfo: UrlMetadata,
  calculateImageDimensions: (urlString: string) => Promise<{ width: number; height: number } | undefined>
) {
  if (urlInfo.url) entity.properties.media_URLReference = { val: urlInfo.url }

  if (entity.type === 'MediaImage' || entity.type === 'MediaPDF' || entity.type === 'MediaAudio') {
    entity.properties.media_fileSize = { val: +(urlInfo?.contentLength || 0) }
    entity.properties.media_MIMEType = { val: urlInfo.contentType ? urlInfo.contentType : undefined }
  }

  if (!entity.properties?.title?.val?.length) entity.properties.title = { val: urlInfo.title || '' }

  if (entity.type === 'MediaImage') {
    entity.properties.media_imageSource = { val: 'web' }
    if (urlInfo.url) {
      const dimensions = await calculateImageDimensions(urlInfo.url)
      if (dimensions) {
        entity.properties.media_imageWidth = { val: dimensions.width }
        entity.properties.media_imageHeight = { val: dimensions.height }
      }
    }
  }
  if (entity.type === 'MediaAudio') {
    entity.properties.media_audioSource = { val: 'web' }
    entity.properties.icon = { val: { type: 'iconify', val: mediaIconMappings.mp3 } }
  }

  if (entity.type === 'MediaWebResource') {
    if (urlInfo.description) entity.properties.description = { val: urlInfo.description }
    if (urlInfo.url) entity.properties.media_URLReference = { val: urlInfo.url }
    if (urlInfo.iframe && isValidHttpUrl(urlInfo.iframe, true))
      entity.properties.media_iframeReference = { val: urlInfo.iframe }
    if (urlInfo.host) entity.properties.media_host = { val: urlInfo.host }
    entity.data.urlMetadata = urlInfo
  }

  if (entity.type === 'MediaPDF') {
    // if (metadata.description) entity.properties.description.val = metadata.description
    entity.properties.media_pdfSource = { val: 'web' }
    // media_pdfHasTOC: BooleanProperty
    // media_pdfNumberOfPages: NumberProperty
  }
  // leave setup
  delete entity.data.setup
}

export function addTweetMetadataToEntity(tweetObject: TweetInfo, entity: MediaTweetFull) {
  const mainTweet = tweetObject.tweets.find((el) => el.tweetId === tweetObject.tweetId)
  if (mainTweet)
    entity.properties.title = {
      val: mainTweet.text.replace(/\n/g, ' ').slice(0, 80) + (mainTweet.text.length > 80 ? '...' : ''),
    }

  entity.properties.media_URLReference = { val: generateTweetUrl(tweetObject) }
  entity.properties.twitter_userName = { val: tweetObject?.userName || '' }
  entity.properties.is_thread = { val: tweetObject.isThread }
  entity.properties.tweet_language = { val: tweetObject.language || '' }
  entity.properties.media_tweets = { val: tweetObject.tweets }
  entity.data.twitterMetadata = {
    tweetId: tweetObject.tweetId,
    conversationId: tweetObject.conversationId,
  }
}

// TWITTER
export function generateTweetUrl(tweetInfo: { tweetId: string; userName: string | undefined; [x: string]: any }) {
  return `https://twitter.com/${tweetInfo.userName || 'xxx'}/status/${tweetInfo.tweetId}`
}

function inferTweetInfo(urlString: string) {
  const url = isValidHttpUrl(urlString)
  if (!url) return undefined
  if (url.host !== 'twitter.com' && url.host !== 'x.com') return undefined
  if (url.host === 'x.com') urlString.replace('x.com', 'twitter.com')
  const pathSplit = url.pathname.split('/')
  if (pathSplit.length < 4 || pathSplit[2] !== 'status') return undefined
  const tweetId = pathSplit[3].split('?')[0]
  const userName = pathSplit[1]
  return {
    tweetId,
    urlString,
    userName,
  }
}

export function useMediaProcessingBackbone(
  processingObjects: { value: MediaProcessingObject[] },
  enableBackgroundProcessing: boolean,
  spaceId: string,
  getC: (id: string) => Component | undefined,
  generateDetachedEntity: (
    structure: RootStructureFull,
    policiesToInherit: ComponentPolicy[]
  ) => Promise<ComponentFull>,
  getMetaInfo: (url: string) => Promise<UrlMetadata | undefined>,
  getTweetObject: (tweetId: string) => Promise<TweetInfo | undefined>,
  setDetachedEntity: (
    entity: ComponentFull,
    structure: RootStructureFull,
    database: RootDatabaseFull | undefined,
    spaceId: string,
    policiesToInherit: ComponentPolicy[],
    addToSpace: boolean,
    initialDependencyId: string | undefined
  ) => Promise<ComponentFull>,
  mutationWrapperSync: MutationWrapperSync<any>,
  calculateImageDimensions: (url: string) => Promise<{ width: number; height: number } | undefined>,
  mediaType: MediaTypesWithLinkSupport,
  enforceType: boolean,
  initialDependencyId: string | undefined,
  addToSpace: boolean,
  database: RootDatabaseFull | undefined,
  policiesToInherit: ComponentPolicy[],
  id: string | undefined = undefined,
  isValidUrlForType: (type: MediaTypesWithLinkSupport, url: string) => Promise<boolean> | boolean = () => true,
  fileUploadingBehavior:
    | {
        uploadCoverImages: boolean
        uploadMediaFiles: boolean
        processFileUploadFromUrl: (
          fileUrl: string,
          component: ComponentFull | undefined,
          addToSpace: boolean
        ) => Promise<ComponentFull | undefined>
      }
    | undefined = undefined
) {
  // set processingObject
  let initSession = false
  if (!id) {
    initSession = true
    id = uuid()
  }
  if (!processingObjects.value.find((el) => el.id === id)) {
    processingObjects.value.push({
      id,
      confirmed: false,
      processingDone: false,
      entities: [],
    })
  }
  const processingObject: MediaProcessingObject = processingObjects.value.find((el) => el.id === id)!

  async function generateDetachedEntityFromType() {
    const structure = getC(mediaType)
    if (!structure || structure.loadingState !== LoadingStates.Full || structure.type !== 'RootStructure')
      return undefined
    return (await generateDetachedEntity(structure, policiesToInherit)) as MediaHandledComponentFull
  }

  async function addPreviewImage(entity: MediaWebResourceFull, previewImageUrl: string) {
    // handle exceptions
    if (['https://de.wikipedia.org/static/images/footer/wikimedia-button.png'].includes(previewImageUrl))
      return undefined
    let imageEntity: ComponentFull | undefined = undefined
    if (fileUploadingBehavior?.uploadCoverImages) {
      imageEntity = await fileUploadingBehavior.processFileUploadFromUrl(previewImageUrl, entity, false)
    } else {
      const { handleUrl } = useMediaProcessingBackbone(
        processingObjects,
        enableBackgroundProcessing,
        spaceId,
        getC,
        generateDetachedEntity,
        getMetaInfo,
        getTweetObject,
        setDetachedEntity,
        mutationWrapperSync,
        calculateImageDimensions,
        'MediaImage',
        true,
        entity.id,
        false,
        undefined,
        policiesToInherit,
        id
      )

      const resp = await handleUrl(previewImageUrl)

      const imageEntityObj = processingObject.entities.find((el) => el.entity.id === resp?.rootId)
      if (
        imageEntityObj?.entity.type === 'MediaImage' &&
        ((imageEntityObj.entity.properties.media_imageHeight?.val &&
          imageEntityObj.entity.properties.media_imageHeight.val < 50) ||
          (imageEntityObj.entity.properties.media_imageWidth?.val &&
            imageEntityObj.entity.properties.media_imageWidth.val < 50))
      ) {
        imageEntityObj.entity.deleteRequested = true
        imageEntity = undefined
      } else {
      }
      if (imageEntityObj && !imageEntityObj.entity.data.mediaProcessingState) {
        imageEntity = imageEntityObj?.entity
      }
    }

    if (!imageEntity) return undefined
    if (!entity.properties.media_previewImage) {
      entity.properties.media_previewImage = { val: [] }
    }
    const link = generateLinkDown(imageEntity, 'media_previewImage', entity.id)
    entity.properties.media_previewImage = { val: [link] }
    return imageEntity
  }

  async function analyseUrl(urlString: string): Promise<{
    preferredType: MediaTypesWithLinkSupport
    backupType: MediaTypesWithLinkSupport
    urlInfo: UrlMetadata | undefined
    tweetObject: TweetInfo | undefined
    urlString: string
  }> {
    let preferredType: MediaTypesWithLinkSupport
    const backupType = 'MediaWebResource'
    let urlInfo: UrlMetadata | undefined = undefined
    let tweetObject: TweetInfo | undefined = undefined

    // HANDLE TWEET
    const tweetInfo = inferTweetInfo(urlString)
    if (tweetInfo) {
      urlString = tweetInfo.urlString

      tweetObject = {
        tweetId: tweetInfo.tweetId,
        conversationId: tweetInfo.tweetId,
        isThread: false,
        userName: tweetInfo.userName,
        language: undefined,
        tweets: [],
      }
      preferredType = 'MediaTweet'
      return { preferredType, backupType, urlInfo, tweetObject, urlString }
    }

    urlInfo = await getMetaInfo(urlString)

    // HANDLE FALLBACK
    if (!urlInfo) {
      preferredType = 'MediaWebResource'
      return { preferredType, backupType, urlInfo, tweetObject, urlString }
    }

    if (urlInfo.isVideoUrl) preferredType = 'MediaVideo'
    else if (urlInfo.isPDFUrl) preferredType = 'MediaPDF'
    else if (urlInfo.isAudioUrl) preferredType = 'MediaAudio'
    else if (urlInfo.isImageUrl) preferredType = 'MediaImage'
    else preferredType = 'MediaWebResource'

    // Make sure the given URLs content is actually the type we expect.
    if (!(await isValidUrlForType(preferredType, urlString))) preferredType = 'MediaWebResource'

    return { preferredType, backupType, urlInfo, tweetObject, urlString }
  }

  async function setEntity(entityObj: EntityObj) {
    const structure = getC(entityObj.entity.structureId)
    if (structure?.loadingState !== LoadingStates.Full || structure.type !== 'RootStructure') return

    // only use database if types still match
    let selectedDatabase: RootDatabaseFull | undefined = undefined
    if (
      database &&
      database.properties.structures?.val?.length &&
      mediaTypesWithLinkSupport.includes(database.properties.structures.val[0].id as MediaTypesWithLinkSupport) &&
      database.properties.structures.val[0].id === structure.id
    )
      selectedDatabase = database

    await setDetachedEntity(
      entityObj.entity,
      structure,
      selectedDatabase,
      spaceId,
      policiesToInherit,
      entityObj.addToSpace,
      entityObj.initialDependencyId
    )
    mutationWrapperSync([], (createdComponentIdentifiers: { id: string; type: CTypes | undefined }[]) => {
      createdComponentIdentifiers.push({ id: entityObj.entity.id, type: entityObj.entity.type })
    })
  }

  async function setMediaMetadata(
    url: string,
    urlInfo: UrlMetadata | undefined,
    entity: ComponentFull,
    selectedType: MediaTypesWithLinkSupport | undefined,
    tweetObject: TweetInfo | undefined,
    tagEntities: (ComponentFull | ComponentPreview)[]
  ) {
    if (!selectedType) {
      entity.data.mediaProcessingState = 'error'
      return
    }

    const structure = getC(selectedType)
    if (structure?.loadingState !== LoadingStates.Full || structure.type !== 'RootStructure') {
      console.error('should not happen12344332')
      entity.data.mediaProcessingState = 'error'
      return
    }

    if (mediaType !== selectedType) {
      // replace entity without loosing reactivity
      const newEntity = await generateDetachedEntity(structure, policiesToInherit)
      entity.data = newEntity.data
      entity.databases = []
      delete entity.fileResource
      entity.linkNodes = []
      entity.loading = newEntity.loading
      entity.local = newEntity.local
      entity.policies = newEntity.policies
      entity.properties = newEntity.properties
      entity.structureId = newEntity.structureId
      entity.type = newEntity.type
      if (processingObject.confirmed) {
        // get most recent lastUpdated in case syncer ran in meanwhile
        const lastUpdated = getC(entity.id)?.lastUpdated
        if (lastUpdated && new Date(lastUpdated).getTime() > new Date(entity.lastUpdated).getTime()) {
          console.warn('last updated overwritten', lastUpdated)
          entity.lastUpdated = lastUpdated
        }
        await setEntity({ addToSpace, initialDependencyId, entity, wasSet: false })
      }
    }

    if (entity.type !== selectedType) {
      console.error('should not happen1234')
      entity.data.mediaProcessingState = 'error'
      return
    }

    if (entity.type === 'MediaImage') {
      if (urlInfo && urlInfo.host && urlInfo.url && urlInfo.isImageUrl) {
        await addUrlMetadataToEntity(entity, urlInfo, calculateImageDimensions)
      } else {
        entity.data.mediaProcessingState = 'error'
        return
      }
    } else if (entity.type === 'MediaAudio') {
      if (urlInfo && urlInfo.host && urlInfo.url && urlInfo.isAudioUrl) {
        await addUrlMetadataToEntity(entity, urlInfo, calculateImageDimensions)
      } else {
        entity.data.mediaProcessingState = 'error'
        return
      }
    } else if (entity.type === 'MediaPDF') {
      if (urlInfo && urlInfo.host && urlInfo.url && urlInfo.isPDFUrl) {
        await addUrlMetadataToEntity(entity, urlInfo, calculateImageDimensions)
      } else {
        entity.data.mediaProcessingState = 'error'
        return
      }
    } else if (entity.type === 'MediaTweet') {
      if (!tweetObject) {
        entity.properties.media_URLReference = { val: url }
      } else {
        addTweetMetadataToEntity(tweetObject, entity)
      }
    } else if (entity.type === 'MediaWebResource') {
      if (urlInfo && urlInfo.host && urlInfo.url) {
        await addUrlMetadataToEntity(entity, urlInfo, calculateImageDimensions)
        if (urlInfo.image) {
          const previewImage = await addPreviewImage(entity, urlInfo.image)
          if (previewImage) processingObject.previewImageUrl = urlInfo.image
        }
      } else {
        // FAllback
        try {
          const fallbackUrlInfo = isValidHttpUrl(url)
          if (!fallbackUrlInfo) return
          const fallbackMetaInfo = {
            host: fallbackUrlInfo.host,
            url: fallbackUrlInfo.href,
            title: undefined,
            description: undefined,
          }

          if (fallbackMetaInfo.title) {
            if (!entity.properties.title) entity.properties.title = { val: '' }
            entity.properties.title.val = fallbackMetaInfo.title
          }
          if (fallbackMetaInfo.description) entity.properties.description = { val: fallbackMetaInfo.description }
          if (fallbackMetaInfo.url) entity.properties.media_URLReference = { val: fallbackMetaInfo.url }
          if (fallbackMetaInfo.host) entity.properties.media_host = { val: fallbackMetaInfo.host }
          if (entity.data) {
            entity.data.urlMetadata = fallbackMetaInfo
          }
        } catch (e) {
          console.error(e)
          entity.data.mediaProcessingState = 'error'
          return
        }
      }
    } else {
      throw new Error('not implemented')
    }

    addTagsToEntity(entity, structure, tagEntities)
  }

  async function runAnalysis(
    urlString: string,
    entity: ComponentFull,
    tagEntities: (ComponentFull | ComponentPreview)[] = [],
    afterProcessingCallback: ((entity: ComponentFull) => void) | undefined = undefined,
    isExistingEntity = false,
    analysisResult: Awaited<ReturnType<typeof analyseUrl>> | undefined = undefined
  ) {
    entity.data.mediaProcessingState = 'loading'

    if (entity.type === 'MediaWebResource') entity.properties.media_URLReference = { val: urlString }

    const {
      preferredType,
      backupType,
      urlInfo,
      tweetObject,
      urlString: newUrlString,
    } = analysisResult || (await analyseUrl(urlString))
    urlString = newUrlString || urlString

    const promises: Promise<any>[] = []

    if (isExistingEntity) processingObject.confirmed = true

    let selectedType: MediaTypesWithLinkSupport | undefined = undefined
    if ((processingObject.confirmed || enforceType) && mediaType === preferredType) selectedType = mediaType
    else if (enforceType && mediaType === backupType) selectedType = backupType
    else if (!enforceType) selectedType = preferredType

    await setMediaMetadata(urlString, urlInfo, entity, selectedType, tweetObject, tagEntities)

    if (processingObject.confirmed) {
      for (const el of processingObject.entities) {
        if (!el.wasSet) {
          await setEntity(el)
          el.wasSet = true
        }
      }
    }

    function afterProcessing() {
      if (afterProcessingCallback) {
        try {
          afterProcessingCallback(entity)
        } catch (e) {
          console.error(e)
        }
      }
      if (entity?.data.mediaProcessingState === 'loading') delete entity?.data.mediaProcessingState

      if (initSession) {
        processingObject.processingDone = true
        if (processingObject.confirmed) {
          for (const entityObj of processingObject.entities) {
            mutationWrapperSync([], (createdComponentIdentifiers: { id: string; type: CTypes | undefined }[]) => {
              createdComponentIdentifiers.push({ id: entityObj.entity.id, type: entityObj.entity.type })
            })
          }

          const index = processingObjects.value.findIndex((el) => el.id === id)
          if (index !== -1) processingObjects.value.splice(index, 1)
        }
      }
    }

    if (initSession && enableBackgroundProcessing) {
      Promise.all(promises).then(() => {
        afterProcessing()
      })
    } else {
      await Promise.all(promises)
      afterProcessing()
    }
  }

  async function handleUrl(
    url: string,
    tagEntities: (ComponentFull | ComponentPreview)[] = [],
    afterProcessingCallback: ((entity: ComponentFull) => void) | undefined = undefined,
    analysisResult: Awaited<ReturnType<typeof analyseUrl>> | undefined = undefined
  ) {
    if (!url || !isValidHttpUrl(url)) return

    const currentStructure = getC(mediaType)
    if (currentStructure?.loadingState !== LoadingStates.Full || currentStructure.type !== 'RootStructure') {
      console.error('should not happen 4357')
      return
    }
    const structure = onlyRootStructureFull(getC(mediaType))
    if (!structure) {
      console.error('should not happen 2309')
      return
    }

    const newEntity = (await generateDetachedEntity(structure, policiesToInherit)) as MediaHandledComponentFull
    processingObject.entities.push({ addToSpace, initialDependencyId, entity: newEntity, wasSet: false })

    const entity = processingObject.entities.find((el) => el.entity.id === newEntity.id)!.entity

    if (initSession && enableBackgroundProcessing)
      runAnalysis(url, entity, tagEntities, afterProcessingCallback, false, analysisResult)
    else await runAnalysis(url, entity, tagEntities, afterProcessingCallback, false, analysisResult)
    return { rootId: entity?.id, processingObject }
  }

  async function handleConfirm() {
    processingObject.confirmed = true
    for (const el of processingObject.entities) {
      if (!el.wasSet) {
        await setEntity(el)
        el.wasSet = true
      }
    }
    if (processingObject.processingDone) {
      for (const entityObj of processingObject.entities) {
        mutationWrapperSync([], (createdComponentIdentifiers: { id: string; type: CTypes | undefined }[]) => {
          createdComponentIdentifiers.push({ id: entityObj.entity.id, type: entityObj.entity.type })
        })
      }

      const index = processingObjects.value.findIndex((el) => el.id === id)
      if (index !== -1) processingObjects.value.splice(index, 1)
    }
  }

  function handleCancel() {
    const index = processingObjects.value.findIndex((el) => el.id === id)
    if (index !== -1) processingObjects.value.splice(index, 1)
  }

  return {
    processingObject,
    analyseUrl,
    handleUrl,
    handleConfirm,
    handleCancel,
    generateDetachedEntityFromType,
    runAnalysis,
  }
}

export function getSortedTweets(entity: MediaTweetFull) {
  if (entity.properties?.media_tweets?.val) {
    const sorted: TweetElement[] = []
    const tweets = [...entity.properties.media_tweets?.val]
    const start = tweets.find((el) => el.tweetId === entity.data.twitterMetadata?.tweetId)

    if (start) {
      sorted.push(start)
      for (const _ of tweets) {
        for (const _ of tweets) {
          const next = tweets.find((el) => el.repliedToId === sorted[sorted.length - 1].tweetId)
          if (next) {
            sorted.push(next)
            break
          }
        }
      }
    }
    return sorted
  }
}

/**
 * Best-effort markdown cleanup for search / embeddings (no parser — safe everywhere).
 * Drops structure noise: headings, tables, fences, list markers, common formatting.
 */
export function stripMarkdownForSearch(input: string): string {
  if (!input) return ''
  let s = input.replace(/\r\n/g, '\n')

  s = s.replace(/^```[^\n]*\n[\s\S]*?^```/gm, ' ')
  s = s.replace(/^~~~[^\n]*\n[\s\S]*?^~~~/gm, ' ')

  const lines = s.split('\n').map((line) => {
    let t = line
    if (/^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(t)) {
      return ''
    }
    if ((t.match(/\|/g) || []).length >= 2) {
      t = t.replace(/\|/g, ' ')
    }
    t = t.replace(/^#{1,6}\s+/, '')
    t = t.replace(/^>\s?/, '')
    if (/^\s*([-*_]\s*){3,}\s*$/.test(t)) return ''
    t = t.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1')
    t = t.replace(/^(\s*)[-*+]\s+/, '$1')
    t = t.replace(/^(\s*)\d+\.\s+/, '$1')
    return t
  })

  s = lines.join('\n')

  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]+)\]\[[^\]]*]/g, '$1')
  s = s.replace(/`([^`]+)`/g, '$1')
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/~~([^~]+)~~/g, '$1')
  s = s.replace(/\*([^*]+)\*/g, '$1')
  s = s.replace(/\b_([^_\n]+)_\b/g, '$1')

  return s.replace(/\s+/g, ' ').trim()
}

const WEBLINK_NORMALIZED_HTML_FTS_CHUNK_TARGET_LENGTH = 12_000
const WEBLINK_NORMALIZED_HTML_MD_MAX_LENGTH = 250_000
const MEDIA_CONTENT_TRUNCATED_MARKER = '\n\n[Content truncated]'

function truncateMediaContentMarkdown(value: string) {
  if (value.length <= WEBLINK_NORMALIZED_HTML_MD_MAX_LENGTH) return value
  const budget = WEBLINK_NORMALIZED_HTML_MD_MAX_LENGTH - MEDIA_CONTENT_TRUNCATED_MARKER.length
  return value.slice(0, Math.max(0, budget)).trimEnd() + MEDIA_CONTENT_TRUNCATED_MARKER
}

type SearchTextChunk = {
  text: string
  start: number
  end: number
}

function splitPlainTextIntoSearchChunks(
  text: string,
  maxLength = WEBLINK_NORMALIZED_HTML_FTS_CHUNK_TARGET_LENGTH
): SearchTextChunk[] {
  if (text.length <= maxLength) return [{ text, start: 0, end: text.length }]

  const chunks: SearchTextChunk[] = []
  const wordPattern = /\S+/g
  let match: RegExpExecArray | null
  let current = ''
  let currentStart = 0
  let currentEnd = 0

  function pushCurrent() {
    if (!current.trim()) return
    chunks.push({ text: current.trim(), start: currentStart, end: currentEnd })
    current = ''
  }

  while ((match = wordPattern.exec(text)) !== null) {
    const word = match[0]
    const wordStart = match.index
    const wordEnd = wordStart + word.length

    if (word.length > maxLength) {
      pushCurrent()
      for (let index = 0; index < word.length; index += maxLength) {
        const slice = word.slice(index, index + maxLength)
        chunks.push({
          text: slice,
          start: wordStart + index,
          end: wordStart + index + slice.length,
        })
      }
      continue
    }

    const next = current ? `${current} ${word}` : word
    if (next.length > maxLength && current.trim()) {
      pushCurrent()
      current = word
      currentStart = wordStart
      currentEnd = wordEnd
    } else {
      if (!current) currentStart = wordStart
      current = next
      currentEnd = wordEnd
    }
  }

  pushCurrent()
  return chunks
}

export type MediaContentTextElement = {
  key: string
  label: string
  value: string
  location?: {
    start?: number
    end?: number
  }
}

export function mediaContentRowToTextElements(
  row: MediaContentRow,
  variant: 'fts' | 'md' | 'embeddings'
): MediaContentTextElement[] | undefined {
  if (row.state !== 'full') return undefined

  function getText(text: string) {
    if (variant === 'fts' || variant === 'embeddings') return stripMarkdownForSearch(text)
    return text
  }

  try {
    if (row.structureId === 'MediaImage') {
      const imageData = row.data as ImageAnalysisResponseDto

      const candidates: {
        key: string
        label: string
        value: string
        variants: ('fts' | 'md' | 'embeddings')[]
      }[] = [
        {
          key: 'image-ocr',
          label: 'OCR text',
          value: getText(imageData.ocr?.fullText ?? ''),
          variants: ['fts', 'md', 'embeddings'],
        },
        {
          key: 'image-short-description',
          label: 'Description',
          value: imageData.shortDescription ?? '',
          variants: ['md', 'embeddings'],
        },
        {
          key: 'image-colors',
          label: 'Colors',
          value: (imageData.colors ?? [])
            .map((c) => c.name || c.category)
            .filter(Boolean)
            .join(', '),
          variants: ['md', 'embeddings'],
        },
      ]

      return candidates
        .filter((el) => el.variants.includes(variant))
        .filter((el) => el.value.trim().length > 0)
        .map(({ key, label, value }) => ({ key, label, value }))
    }

    if (row.structureId === 'MediaAudio') {
      const audioData = row.data as AudioAnalysisResponseDto

      const candidates: {
        key: string
        label: string
        value: string
        variants: ('fts' | 'md' | 'embeddings')[]
      }[] = [
        {
          key: 'audio-transcription',
          label: 'Transcription',
          value: getText(audioData.transcription?.fullText ?? ''),
          variants: ['md', 'embeddings'],
        },

        {
          key: 'audio-summary',
          label: 'Summary',
          value: getText(audioData.summary ?? ''),
          variants: ['md', 'embeddings'],
        },
      ]

      const filteredCandidates = candidates
        .filter((el) => el.variants.includes(variant))
        .filter((el) => el.value.trim().length > 0)
        .map(({ key, label, value }) => ({ key, label, value }))

      if (variant === 'fts' || variant === 'embeddings') {
        const segmentElements =
          audioData.transcription?.segments
            ?.map((segment, index) => ({
              key: `audio-transcription-segment-${index}`,
              label: segment.speaker?.trim().length ? `Transcription (${segment.speaker})` : 'Transcription',
              value: getText(segment.text ?? ''),
              location: {
                start: segment.startTime,
                end: segment.endTime,
              },
            }))
            .filter((segment) => segment.value.trim().length > 0) ?? []

        filteredCandidates.push(...segmentElements)
      }

      return filteredCandidates
    }

    if (row.structureId === 'MediaWebResource') {
      const webData = row.data as WeblinkAnalysisResponseDto
      const normalizedHtml = webData.normalizedHTMLContentOfWeblink?.trim() ?? ''
      const normalizedMarkdown = normalizedHtml ? htmlToMd(normalizedHtml).trim() : ''

      const candidates: {
        key: string
        label: string
        value: string
        variants: ('fts' | 'md' | 'embeddings')[]
      }[] = [
        {
          key: 'web-short-summary',
          label: 'Short summary',
          value: getText(webData.shortSummary ?? ''),
          variants: ['fts', 'md', 'embeddings'],
        },

        {
          key: 'web-keywords',
          label: 'Keywords',
          value: (webData.keywords ?? []).join(', '),
          variants: ['fts', 'md', 'embeddings'],
        },

        {
          key: 'web-author',
          label: 'Author',
          value: webData.author ?? '',
          variants: ['fts', 'md', 'embeddings'],
        },
        {
          key: 'web-published-date',
          label: 'Published date',
          value: webData.publishedDate ?? '',
          variants: ['md', 'embeddings'],
        },
      ]

      const elements: MediaContentTextElement[] = candidates
        .filter((el) => el.variants.includes(variant))
        .filter((el) => el.value.trim().length > 0)
        .map(({ key, label, value }) => ({ key, label, value }))

      if (normalizedHtml) {
        if (variant === 'fts') {
          let articleOffset = 0
          const paragraphSegments = getWeblinkNormalizedHtmlParagraphSegments(normalizedHtml)

          for (const paragraph of paragraphSegments) {
            const paragraphText = stripMarkdownForSearch(paragraph.markdown)
            if (!paragraphText) continue

            const chunks = splitPlainTextIntoSearchChunks(paragraphText)
            for (const [chunkIndex, chunk] of chunks.entries()) {
              elements.push({
                key: chunks.length === 1 ? paragraph.key : `${paragraph.key}-chunk-${chunkIndex}`,
                label: 'Content',
                value: chunk.text,
                location: {
                  start: articleOffset + chunk.start,
                  end: articleOffset + chunk.end,
                },
              })
            }

            articleOffset += paragraphText.length + 2
          }
        } else if (variant === 'md') {
          elements.push({
            key: 'web-normalized-html',
            label: 'Content',
            value: truncateMediaContentMarkdown(normalizedMarkdown),
          })
        } else if (variant === 'embeddings') {
          elements.push({
            key: 'web-normalized-html',
            label: 'Content',
            value: stripMarkdownForSearch(normalizedMarkdown),
          })
        }
      }

      return elements.filter((el) => el.value.trim().length > 0)
    }

    if (row.structureId === 'MediaPDF') {
      const pdfData = row.data as PdfAnalysisResponseDto

      const candidates: {
        key: string
        label: string
        value: string
        variants: ('fts' | 'md' | 'embeddings')[]
      }[] = [
        {
          key: 'pdf-short-description',
          label: 'Description',
          value: getText(pdfData.shortDescription ?? ''),
          variants: ['md', 'embeddings'],
        },
        {
          key: 'pdf-summary',
          label: 'Summary',
          value: getText(pdfData.summary ?? ''),
          variants: ['md', 'embeddings'],
        },
        {
          key: 'pdf-keywords',
          label: 'Keywords',
          value: (pdfData.keywords ?? []).join(', '),
          variants: ['fts', 'md', 'embeddings'],
        },
      ]

      const elements: MediaContentTextElement[] = candidates
        .filter((el) => el.variants.includes(variant))
        .filter((el) => el.value.trim().length > 0)
        .map(({ key, label, value }) => ({ key, label, value }))

      const pages = pdfData.transcript?.pages ?? []

      if (variant === 'md') {
        const joined = pages
          .filter((page) => page.markdown.trim().length > 0)
          .map((page) => `## Page ${page.pageNumber}\n\n${page.markdown}`)
          .join('\n\n')
        if (joined.trim().length > 0) {
          elements.push({ key: 'pdf-transcript', label: 'Transcript', value: truncateMediaContentMarkdown(joined) })
        }
      } else {
        for (const page of pages) {
          const value = getText(page.markdown ?? '')
          if (!value.trim().length) continue
          elements.push({
            key: `pdf-page-${page.pageNumber}`,
            label: `Page ${page.pageNumber}`,
            value,
            location: { start: page.pageNumber, end: page.pageNumber },
          })
        }
      }

      return elements.filter((el) => el.value.trim().length > 0)
    }
  } catch (error) {
    console.error('error parsing media content row', error)
    return undefined
  }

  return undefined
}

export function isUploadMediaObject(entity: ComponentFull) {
  return (
    (entity.type === 'MediaImage' && entity.properties?.media_imageSource?.val === 'upload') ||
    (entity.type === 'MediaAudio' && entity.properties?.media_audioSource?.val === 'upload') ||
    (entity.type === 'MediaPDF' && entity.properties?.media_pdfSource?.val === 'upload') ||
    (entity.type === 'MediaWebResource' && entity.properties?.media_weblinkSource?.val === 'upload')
  )
}
