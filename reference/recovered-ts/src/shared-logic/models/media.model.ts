import type { FileResourceMetadata } from '../models/resources.model.js'

export const MEDIA_DOWNLOAD_EXPIRATION = 60 * 60 * 12 * 1000
export const MEDIA_UPLOAD_EXPIRATION = 60 * 15 * 1000

export const mediaTypes = [
  'MediaImage',
  'MediaPDF',
  'MediaAudio',
  'MediaVideo',
  'MediaFile',
  'MediaWebResource',
  'MediaTweet',
] as const
export type MediaType = (typeof mediaTypes)[number]

export const mediaCreateOptions = ['upload', 'link', 'unsplash', 'record', 'ai-generate'] as const
export type MediaCreateOptions = (typeof mediaCreateOptions)[number]

export const mediaTypeConfig: {
  [x in MediaType]: {
    fileTypes: readonly string[]
    fileEndings: readonly string[]
    createOptions: readonly MediaCreateOptions[]
  }
} = {
  MediaPDF: {
    fileTypes: ['application/pdf'],
    fileEndings: ['pdf'],
    createOptions: ['upload', 'link'],
  },
  MediaImage: {
    fileTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp'],
    fileEndings: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'],
    createOptions: ['upload', 'link', 'unsplash', 'ai-generate'],
  },
  MediaWebResource: {
    fileTypes: [],
    fileEndings: [],
    createOptions: ['link'],
  },
  MediaAudio: {
    fileTypes: [
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
      'audio/x-wav',
      'audio/vnd.wav',
      'audio/mp4',
      'audio/webm',
      'audio/aac',
    ],
    fileEndings: ['mp3', 'ogg', 'wav', 'm4a', 'oga', 'webm', 'aac'],
    createOptions: ['upload', 'link', 'record'],
  },
  MediaVideo: {
    fileTypes: [],
    fileEndings: [],
    createOptions: ['upload', 'link'],
  },
  MediaFile: {
    fileTypes: [],
    fileEndings: [],
    createOptions: ['upload', 'link'],
  },
  MediaTweet: {
    createOptions: ['link'],
    fileTypes: [],
    fileEndings: [],
  },
} as const

export function getContentTypeFromExtension(extension: string): string {
  const contentTypeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    xml: 'application/xml',
    zip: 'application/zip',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    webm: 'audio/webm',
    aac: 'audio/aac',
    mp4: 'video/mp4',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
  }

  return contentTypeMap[extension.toLowerCase()] || 'application/octet-stream'
}

export const mediaTypesWithLinkSupport = [
  'MediaImage',
  'MediaPDF',
  'MediaAudio',
  'MediaVideo',
  'MediaFile',
  'MediaWebResource',
  'MediaTweet',
] as const

export type MediaTypesWithLinkSupport = (typeof mediaTypesWithLinkSupport)[number]

export const mediaTypesWithUploadSupport = ['MediaPDF', 'MediaImage', 'MediaAudio', 'MediaVideo', 'MediaFile'] as const
export type MediaTypesWithUploadSupport = (typeof mediaTypesWithUploadSupport)[number]

export type FileNameParts = {
  name: string | undefined
  extension: string | undefined
  type: string | undefined
}

export type MediaLayerMetadata = FileResourceMetadata & {
  contentType: Exclude<MediaType, 'MediaTweet' | 'MediaWebResource' | 'MediaVideo'>
}
