import { app, dialog, shell } from 'electron'
import { fileTypeFromFile } from 'file-type'
import crypto from 'node:crypto'
import { createReadStream, createWriteStream, lstatSync, unlinkSync, type WriteStream } from 'node:fs'
import path from 'node:path'
import { v4 as uuid } from 'uuid'
import { mediaTypeConfig } from '../shared-logic/models/media.model.js'
import { sleep } from '../shared-logic/util/general.js'
import mime from '../shared-logic/util/mime.js'
import i18n from './i18n/i18next.config.js'
import { ipcMainHandle, ipcMainOn } from './electron-communication.js'
import { getFormattedFileSize, sanitizeFileName } from './electron-utils.js'

type Stream = {
  stream: WriteStream
  readonly checksum: string
  readonly location: string
  readonly type: string
  size: { readonly expected: number; received: number }
  parts: { readonly expected: number; received: number }
  isWriting: boolean
}

const MAXIMUM_PARALLEL_STREAMS = 1

const CHECKSUM_ALGORITHM = 'SHA512'
const CHECKSUM_LENGTH = 128

const ID_LENGTH = 36

const MAXIMUM_BUFFER_SIZE = 1024 * 1024 * 1024 // 1 GB
const BUFFER_CHUNK_SIZE = 1024 * 1024 // 1 MB
const BUFFER_TIMEOUT = 1000 * 60 * 1 // 1 minute
const REQUEST_THROTTLE = 1000 * 5 // 5 seconds

const MAXIMUM_NAME_LENGTH = 255
const MAXIMUM_TITLE_DISPLAY_LENGTH = 50
const MAXIMUM_TYPE_LENGTH = 255

const ALLOWED_BUFFER_TYPES = [
  mediaTypeConfig.MediaPDF.fileTypes,
  mediaTypeConfig.MediaAudio.fileTypes,
  mediaTypeConfig.MediaImage.fileTypes,
].flat()

const ALLOWED_BUFFER_EXTENSIONS = [
  mediaTypeConfig.MediaPDF.fileEndings,
  mediaTypeConfig.MediaAudio.fileEndings,
  mediaTypeConfig.MediaImage.fileEndings,
].flat()

let isInitalized = false
let controller = new AbortController()

const timeouts: Map<string, NodeJS.Timeout> = new Map()
const active = new Set<string>()

const streams: Map<string, Stream> = new Map()

let isAllowingBufferRequests = true

function cancel(id: string, { isUnlinking = true }: { isUnlinking?: boolean } = { isUnlinking: true }) {
  const request = streams.get(id)
  if (request) {
    if (request.stream) request.stream.destroy()

    if (isUnlinking) {
      try {
        unlinkSync(request.location)
      } catch {}
    }
  }

  const timeout = timeouts.get(id)
  if (timeout) clearTimeout(timeout)

  streams.delete(id)
  timeouts.delete(id)
  active.delete(id)
}

export function useMediaHandling() {
  if (isInitalized) return

  ipcMainOn('open-media-cancel', (_event, { id }) => {
    if (typeof id !== 'string' || id.length > ID_LENGTH) return
    cancel(id)
  })

  ipcMainHandle(
    'open-media-request',
    async (_event, { name, size, type, checksum }: { name: string; size: number; type: string; checksum: string }) => {
      if (!isAllowingBufferRequests) return false
      isAllowingBufferRequests = false

      setTimeout(() => {
        isAllowingBufferRequests = true
      }, REQUEST_THROTTLE)

      if (active.size >= MAXIMUM_PARALLEL_STREAMS) return false

      if (typeof name !== 'string' || name.length > MAXIMUM_NAME_LENGTH) return
      if (typeof size !== 'number' || isNaN(size) || !isFinite(size) || size > MAXIMUM_BUFFER_SIZE) return false
      if (typeof type !== 'string' || type.length > MAXIMUM_TYPE_LENGTH) return
      if (typeof checksum !== 'string' || checksum.length !== CHECKSUM_LENGTH) return

      if (!ALLOWED_BUFFER_TYPES.some((current) => type === current)) return false

      const parts = name.split(/(?=\.[0-9a-zA-Z]+$)/g, 2)
      const title = parts.at(0)
      const extension = parts.at(1)?.slice(1)

      if (!title || !extension || !/^[0-9a-zA-Z]+$/g.test(extension)) return false

      const extensions = mime.getExtensions(type)
      if (!Array.isArray(extensions) || extensions.length === 0) return false

      if (
        !ALLOWED_BUFFER_EXTENSIONS.some((current) => current === extension) ||
        !extensions.some((current) => current === extension)
      ) {
        return false
      }

      const id = uuid()

      const locationName = sanitizeFileName(`${id}.${extension}`)
      if (!locationName) return false

      const location = path.join(app.getPath('temp'), locationName)

      if (typeof lstatSync(location, { throwIfNoEntry: false }) !== 'undefined') return false

      controller.abort()
      controller = new AbortController()

      const { response } = await dialog.showMessageBox({
        title: i18n.t('Electron.OpenBufferRequest.title'),
        message: i18n.t('Electron.OpenBufferRequest.message'),
        detail: i18n.t('Electron.OpenBufferRequest.details', {
          name: `${title.slice(0, MAXIMUM_TITLE_DISPLAY_LENGTH)}${title.length > MAXIMUM_TITLE_DISPLAY_LENGTH ? '[...]' : ''}.${extension}`,
          size: getFormattedFileSize(size),
        }),
        buttons: [i18n.t('general.open'), i18n.t('general.cancel')],
        type: 'info',
        signal: controller.signal,
        cancelId: 1,
      })

      if (response !== 0) return false

      timeouts.set(
        id,
        setTimeout(() => cancel(id), BUFFER_TIMEOUT)
      )

      active.add(id)

      const request: Stream = {
        stream: createWriteStream(location),
        checksum,
        location,
        type,
        size: { expected: size, received: 0 },
        parts: { expected: Math.ceil(size / BUFFER_CHUNK_SIZE), received: 0 },
        isWriting: false,
      }

      streams.set(id, request)

      return {
        id,
        parts: request.parts.expected,
      }
    }
  )

  ipcMainHandle('open-media-part', (_event, { id, buffer }: { id: string; buffer: Uint8Array | Buffer }) => {
    flow: {
      if (typeof id !== 'string' || id.length !== ID_LENGTH) break flow
      if (!(buffer instanceof Buffer) && !(buffer instanceof Uint8Array)) break flow

      if (!active.has(id)) break flow

      const request = streams.get(id)
      if (!request) break flow

      if (request.parts.received >= request.parts.expected) break flow
      if (buffer.length > BUFFER_CHUNK_SIZE) break flow
      if (request.stream.destroyed || request.stream.closed) break flow
      if (request.isWriting) break flow

      const remaining = request.size.expected - request.size.received
      if (buffer.length > remaining) break flow

      const timeout = timeouts.get(id)
      if (!timeout) break flow

      clearTimeout(timeout)
      timeouts.delete(id)

      timeouts.set(
        id,
        setTimeout(() => cancel(id), BUFFER_TIMEOUT)
      )

      request.isWriting = true

      try {
        request.stream.write(buffer)
      } catch {
        break flow
      }

      request.isWriting = false

      request.parts.received += 1
      request.size.received += buffer.length

      return true
    }

    cancel(id)
    return false
  })

  ipcMainHandle('open-media-done', async (_event, { id }: { id: string }) => {
    flow: {
      await sleep(10)

      if (typeof id !== 'string' || id.length !== ID_LENGTH) break flow
      if (!active.has(id)) break flow

      const request = streams.get(id)
      if (!request) break flow

      if (request.parts.received !== request.parts.expected) break flow
      if (request.size.received !== request.size.expected) break flow
      if (request.isWriting || request.stream.closed) break flow

      request.stream.end()
      const { location } = request

      const type = await fileTypeFromFile(location)

      if (!type || type.mime !== request.type) break flow
      if (
        !ALLOWED_BUFFER_TYPES.some((current) => type.mime === current) ||
        !ALLOWED_BUFFER_EXTENSIONS.some((current) => type.ext === current)
      ) {
        break flow
      }

      try {
        const checksum = await new Promise((resolve, reject) => {
          const hash = crypto.createHash(CHECKSUM_ALGORITHM)
          const stream = createReadStream(location)

          stream.on('data', (chunk) => hash.update(chunk))
          stream.on('end', () => resolve(hash.digest('hex')))
          stream.on('error', reject)
        })

        if (checksum !== request.checksum) break flow

        cancel(id, { isUnlinking: false })
        await shell.openPath(location)

        return true
      } catch {
        break flow
      }
    }

    cancel(id)
    return false
  })

  isInitalized = true
}
