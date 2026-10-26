import mime from '../../shared-logic/util/mime.js'
import { MediaAudioFull, MediaFileFull, MediaImageFull, MediaPDFFull } from '../models/component.model.js'
import { MediaType, mediaTypeConfig, type FileNameParts } from '../models/media.model.js'

export function isAllowedFileType(mimeType: string | undefined): string | undefined {
  // TODO: finish function?
  return mimeType
}

export function getAllowedFileTypes(structureId: string, enforceType: boolean) {
  if (!enforceType) return undefined
  // MediaFile has no mime allowlist (catch-all for non-specialized files).
  // Callers must still require detected content type === MediaFile when enforcing.
  if (structureId === 'MediaFile') return undefined
  return [...mediaTypeConfig[structureId as MediaType].fileTypes]
}

export function normalizeMediaMimeType(mimeType: string | undefined): string | undefined {
  const baseMimeType = mimeType?.split(';')[0]?.trim().toLowerCase()
  if (baseMimeType === 'audio/x-m4a' || baseMimeType === 'audio/m4a') return 'audio/mp4'
  return baseMimeType
}

export function isAllowedFileUpload(
  fileType: string | undefined,
  fileEnding: string | undefined,
  entityType: UploadQueueTypeFull['type']
) {
  const normalizedFileType = normalizeMediaMimeType(fileType)

  return (
    (entityType === 'MediaFile' && fileEnding) ||
    (fileType && mediaTypeConfig[entityType].fileTypes.includes(fileType)) ||
    (normalizedFileType && mediaTypeConfig[entityType].fileTypes.includes(normalizedFileType)) ||
    (fileEnding && mediaTypeConfig[entityType].fileEndings.includes(fileEnding))
  )
}

export function mimeTypeToMediaContentType(mimeType: string | undefined, fileEnding: string | undefined) {
  const normalizedMimeType = normalizeMediaMimeType(mimeType)

  for (const [key, val] of Object.entries(mediaTypeConfig)) {
    if (val.fileTypes.find((el) => el === mimeType || el === normalizedMimeType)) return key as MediaType
    if (val.fileEndings.find((el) => el === fileEnding)) return key as MediaType
  }
  return 'MediaFile'
}

export function fileToContentType(file: File) {
  return mimeTypeToMediaContentType(file.type, getFileNameParts(file.name).extension)
}

export function isTextLikeFile(file: File) {
  if (file.type === 'text/markdown' || file.type === 'text/plain') return true

  const { extension } = getFileNameParts(file.name)
  if (extension === 'md' || extension === 'txt') return true

  return false
}

export function getFileNameParts(value: string | undefined): FileNameParts {
  const parts = value?.split('.')
  if (parts?.length === 1) return { name: value, extension: undefined, type: undefined }

  const extension = parts?.at(-1)
  const name = parts?.slice(0, -1)?.join('.')
  const type = extension ? mime.getType(extension) : undefined

  return { name, extension, type }
}

export function getFileEndingFromMimeType(mimeType: string) {
  return mime.getExtension(mimeType)
}

export const MAXIMUM_GENERAL_FILE_SIZE = 1024 * 1024 * 100 // 100MB
export const REMOVE_FROM_QUEUE_TIMEOUT = 1000 * 60

export const MAXIMUM_DATA_URL_SIZES = {
  CHROMIUM: 1024 * 1024 * 512, // 512MB
  FIREFOX: 1024 * 1024 * 32, // 32MB
  SAFARI: 1024 * 1024 * 2048, // 2048MB
  OTHER: 1024 * 1024 * 32, // 32MB
}

export const uploadQueueTypes = ['MediaImage', 'MediaFile', 'MediaAudio', 'MediaPDF'] as const
export type UploadQueueType = (typeof uploadQueueTypes)[number]
export type UploadQueueTypeFull = MediaImageFull | MediaFileFull | MediaAudioFull | MediaPDFFull
