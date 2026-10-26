import { dialog, shell } from 'electron'
import log from 'electron-log'
import { fileTypeFromFile } from 'file-type'
import { once } from 'node:events'
import { createWriteStream, lstatSync, unlinkSync, type WriteStream } from 'node:fs'
import { copyFile, lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { v4 as uuid } from 'uuid'
import { z } from 'zod'
import { useStore } from '../composables/useStore.js'
import type {
  ElectronCommunicationRendererToMainRequest,
  StoreExportErrorCode,
  StoreExportFailure,
  StoreExportResult,
} from '../electron-shared/electron-communication.model.js'
import { exportsToDrop, readExportKeep } from '../electron-shared/exportKeep.js'
import { sleep } from '../shared-logic/util/general.js'
import mime from '../shared-logic/util/mime.js'
import { ipcMainHandle, ipcMainOn } from './electron-communication.js'
import { NodeEncrypter } from './electron-encrypter.js'
import { ElectronStorage } from './electron-storage.js'
import { sanitizeFileName } from './electron-utils.js'

export const { store } = useStore(
  'export',
  z
    .object({
      paths: z.record(/* scheduleId */ z.string(), /* directory */ z.string()).default({}),
      history: z.record(/* scheduleId */ z.string(), z.array(/* location */ z.string()).default([])).default({}),
    })
    .default({
      paths: {},
      history: {},
    }),
  {
    storage: new ElectronStorage(),
    // The encryption is only being used to obfuscate the data, not to secure it.
    encrypter: new NodeEncrypter('a056db7de026ba38f19368db9e983b2e'),
  },
  true
)

type Schedule = {
  id: string
  title: string
  keep: number | null
}

type Stream = {
  stream: WriteStream
  directory: string
  locations: {
    temporary: string
    actual: string
  }
  readonly type: string
  size: { readonly expected: number; received: number }
  parts: { readonly expected: number; received: number }
  isWriting: boolean
  schedule: Schedule
}

const MAXIMUM_PARALLEL_STREAMS = 1

const ID_LENGTH = 36
const SCHEDULE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAXIMUM_BUFFER_SIZE = 1024 * 1024 * 1024 * 20 // 20 GB
const BUFFER_CHUNK_SIZE = 1024 * 1024 // 1 MB
const BUFFER_TIMEOUT = 1000 * 60 * 5 // 5 minutes
const REQUEST_THROTTLE = 1000 * 1 // 1 second
const RENAME_RETRY_ATTEMPTS = process.platform === 'win32' ? 5 : 1

const MAXIMUM_NAME_LENGTH = 255
const MAXIMUM_TYPE_LENGTH = 255

const ALLOWED_BUFFER_TYPES = ['application/zip']
const ALLOWED_BUFFER_EXTENSIONS = ['zip']

const TEMPORARY_EXTENSION = 'captemp'

let isInitalized = false

const timeouts: Map<string, NodeJS.Timeout> = new Map()
const active = new Set<string>()

const streams: Map<string, Stream> = new Map()

let isAllowingBufferRequests = true

function getErrorCode(error: unknown): StoreExportErrorCode {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') return 'folder_missing'
  if (code === 'EACCES' || code === 'EPERM') return 'folder_not_writable'
  if (code === 'EBUSY') return 'busy'
  return 'write_failed'
}

function isScheduleId(value: unknown): value is string {
  return typeof value === 'string' && value.length === ID_LENGTH && SCHEDULE_ID_PATTERN.test(value)
}

function isPathInside(parent: string, child: string): boolean {
  let resolvedParent = path.resolve(parent)
  let resolvedChild = path.resolve(child)
  if (process.platform === 'win32') {
    resolvedParent = resolvedParent.toLowerCase()
    resolvedChild = resolvedChild.toLowerCase()
  }
  return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${path.sep}`)
}

async function resolveExistingDirectory(location: string): Promise<string | undefined> {
  try {
    const resolved = await realpath(path.normalize(location))
    const stats = await lstat(resolved)
    if (!stats.isDirectory()) return undefined
    return resolved
  } catch {
    return undefined
  }
}

function cancel(id: string, { isUnlinking = true }: { isUnlinking?: boolean } = { isUnlinking: true }) {
  const request = streams.get(id)
  if (request) {
    if (request.stream) request.stream.destroy()

    if (isUnlinking) {
      for (const location of [request.locations.temporary, request.locations.actual]) {
        if (!isPathInside(request.directory, location)) continue
        try {
          if (typeof lstatSync(location, { throwIfNoEntry: false }) !== 'undefined') {
            unlinkSync(location)
          }
        } catch {}
      }
    }
  }

  const timeout = timeouts.get(id)
  if (timeout) clearTimeout(timeout)

  streams.delete(id)
  timeouts.delete(id)
  active.delete(id)
}

export async function chooseExportFolder({
  scheduleId,
}: ElectronCommunicationRendererToMainRequest['chooseExportFolder']['inData']): Promise<
  ElectronCommunicationRendererToMainRequest['chooseExportFolder']['outData']
> {
  if (!isScheduleId(scheduleId)) return { path: null }

  try {
    const { filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })

    const selected = filePaths.at(0)
    if (!selected) return { path: null }

    const directory = await resolveExistingDirectory(selected)
    if (!directory) return { path: null, error: { ok: false, code: 'folder_missing' } }

    store.value.paths[scheduleId] = directory

    const probe = path.join(directory, `.capacities-write-probe-${uuid().slice(0, 8)}`)
    if (!isPathInside(directory, probe)) return { path: directory, error: { ok: false, code: 'invalid_request' } }

    try {
      await writeFile(probe, 'ok')
      await rm(probe, { force: true })
    } catch (probeError) {
      try {
        await rm(probe, { force: true })
      } catch {}
      return { path: directory, error: { ok: false, code: getErrorCode(probeError) } }
    }

    return { path: directory }
  } catch (error) {
    log.error('[export] choose folder failed', { code: getErrorCode(error) })
    return { path: null, error: { ok: false, code: getErrorCode(error) } }
  }
}

export async function openExportFolder({
  scheduleId,
}: ElectronCommunicationRendererToMainRequest['openExportFolder']['inData']) {
  if (!isScheduleId(scheduleId)) return

  const stored = store.value.paths[scheduleId]
  if (typeof stored !== 'string') return
  const parent = await resolveExistingDirectory(stored)
  if (!parent) return

  const lastExport = store.value.history[scheduleId]?.at(-1)
  let target = parent
  if (typeof lastExport === 'string' && isPathInside(parent, lastExport)) {
    const folder = await resolveExistingDirectory(path.dirname(lastExport))
    if (folder && isPathInside(parent, folder)) target = folder
  }

  try {
    await shell.openPath(target)
  } catch {}
}

export function useExportHandling() {
  if (isInitalized) return

  ipcMainOn('store-export-cancel', (_event, { id }) => {
    if (typeof id !== 'string' || id.length > ID_LENGTH) return
    cancel(id)
  })

  ipcMainHandle(
    'store-export-request',
    async (
      _event,
      {
        schedule,
        name,
        size,
        type,
      }: {
        schedule: Schedule
        name: string
        size: number
        type: string
      }
    ): Promise<{ ok: true; id: string; parts: number } | StoreExportFailure> => {
      if (!isAllowingBufferRequests) return { ok: false, code: 'busy' }
      isAllowingBufferRequests = false

      setTimeout(() => {
        isAllowingBufferRequests = true
      }, REQUEST_THROTTLE)

      if (active.size >= MAXIMUM_PARALLEL_STREAMS) return { ok: false, code: 'busy' }

      if (typeof name !== 'string' || name.length > MAXIMUM_NAME_LENGTH) return { ok: false, code: 'invalid_request' }
      if (typeof size !== 'number' || isNaN(size) || !isFinite(size) || size <= 0 || size > MAXIMUM_BUFFER_SIZE) {
        return { ok: false, code: 'invalid_request' }
      }
      if (typeof type !== 'string' || type.length > MAXIMUM_TYPE_LENGTH) return { ok: false, code: 'invalid_request' }

      const resolvedType =
        type && type.length > 0 ? type : name.toLowerCase().endsWith('.zip') ? 'application/zip' : type
      if (!ALLOWED_BUFFER_TYPES.some((current) => resolvedType === current))
        return { ok: false, code: 'invalid_request' }

      const parts = name.split(/(?=\.[0-9a-zA-Z]+$)/g, 2).slice(0, 2)
      const title = parts.at(0)
      const extension = parts.at(1)?.slice(1)

      if (!title || !extension || !/^[0-9a-zA-Z]+$/g.test(extension)) return { ok: false, code: 'invalid_request' }

      const extensions = mime.getExtensions(resolvedType)
      if (!Array.isArray(extensions) || extensions.length === 0) return { ok: false, code: 'invalid_request' }

      if (
        !ALLOWED_BUFFER_EXTENSIONS.some((current) => current === extension) ||
        !extensions.some((current) => current === extension)
      ) {
        return { ok: false, code: 'invalid_request' }
      }

      const id = uuid()

      if (typeof schedule !== 'object') return { ok: false, code: 'invalid_request' }
      if (!isScheduleId(schedule.id) || typeof schedule.title !== 'string') {
        return { ok: false, code: 'invalid_request' }
      }
      const keep = readExportKeep(schedule.keep)
      if (keep === undefined) return { ok: false, code: 'invalid_request' }

      const storedDirectory = store.value.paths[schedule.id]
      if (typeof storedDirectory !== 'string') return { ok: false, code: 'folder_missing' }
      const resolvedDirectory = await resolveExistingDirectory(storedDirectory)
      if (!resolvedDirectory) return { ok: false, code: 'folder_missing' }

      const folderName = sanitizeFileName(schedule.title)
      if (!folderName) return { ok: false, code: 'invalid_request' }

      const folder = path.join(resolvedDirectory, folderName)
      if (!isPathInside(resolvedDirectory, folder)) return { ok: false, code: 'invalid_request' }

      try {
        await mkdir(folder, { recursive: true })
      } catch (error) {
        return { ok: false, code: getErrorCode(error) }
      }

      const realFolder = await resolveExistingDirectory(folder)
      if (!realFolder || !isPathInside(resolvedDirectory, realFolder)) {
        return { ok: false, code: 'invalid_request' }
      }

      const names = {
        temporary: sanitizeFileName(`${id}.${TEMPORARY_EXTENSION}`),
        actual: sanitizeFileName(`${title}.${extension}`),
      }

      if (!names.temporary || !names.actual) return { ok: false, code: 'invalid_request' }

      const locations = {
        temporary: path.join(realFolder, names.temporary),
        actual: path.join(realFolder, names.actual),
      }

      if (!isPathInside(realFolder, locations.temporary) || !isPathInside(realFolder, locations.actual)) {
        return { ok: false, code: 'invalid_request' }
      }

      if (typeof lstatSync(locations.temporary, { throwIfNoEntry: false }) !== 'undefined')
        return { ok: false, code: 'busy' }
      if (typeof lstatSync(locations.actual, { throwIfNoEntry: false }) !== 'undefined')
        return { ok: false, code: 'busy' }

      timeouts.set(
        id,
        setTimeout(() => cancel(id), BUFFER_TIMEOUT)
      )

      active.add(id)

      const request: Stream = {
        stream: createWriteStream(locations.temporary),
        directory: resolvedDirectory,
        locations,
        type: resolvedType,
        size: { expected: size, received: 0 },
        parts: { expected: Math.ceil(size / BUFFER_CHUNK_SIZE), received: 0 },
        isWriting: false,
        schedule: {
          id: schedule.id,
          title: schedule.title,
          keep,
        },
      }

      request.stream.on('error', (error) => {
        log.error('[export] write stream error', { code: getErrorCode(error), scheduleId: schedule.id })
        cancel(id)
      })

      streams.set(id, request)

      return {
        ok: true,
        id,
        parts: request.parts.expected,
      }
    }
  )

  ipcMainHandle(
    'store-export-part',
    async (_event, { id, buffer }: { id: string; buffer: Uint8Array | Buffer }): Promise<StoreExportResult> => {
      try {
        if (typeof id !== 'string' || id.length !== ID_LENGTH) return { ok: false, code: 'invalid_request' }
        if (!(buffer instanceof Buffer) && !(buffer instanceof Uint8Array))
          return { ok: false, code: 'invalid_request' }
        if (!active.has(id)) return { ok: false, code: 'write_failed' }

        const request = streams.get(id)
        if (!request) return { ok: false, code: 'write_failed' }

        if (request.parts.received >= request.parts.expected) {
          cancel(id)
          return { ok: false, code: 'invalid_request' }
        }
        if (buffer.length > BUFFER_CHUNK_SIZE) {
          cancel(id)
          return { ok: false, code: 'invalid_request' }
        }
        if (request.stream.destroyed || request.stream.closed) {
          cancel(id)
          return { ok: false, code: 'write_failed' }
        }
        if (request.isWriting) return { ok: false, code: 'busy' }

        const remaining = request.size.expected - request.size.received
        if (buffer.length > remaining) {
          cancel(id)
          return { ok: false, code: 'invalid_request' }
        }

        const timeout = timeouts.get(id)
        if (!timeout) {
          cancel(id)
          return { ok: false, code: 'timeout' }
        }

        clearTimeout(timeout)
        timeouts.delete(id)

        timeouts.set(
          id,
          setTimeout(() => cancel(id), BUFFER_TIMEOUT)
        )

        request.isWriting = true
        if (request.stream.destroyed || request.stream.errored) {
          throw request.stream.errored ?? new Error('stream destroyed')
        }
        const canContinue = request.stream.write(buffer)
        if (!canContinue) await once(request.stream, 'drain')
        request.isWriting = false

        request.parts.received += 1
        request.size.received += buffer.length

        return { ok: true }
      } catch (error) {
        cancel(id)
        return { ok: false, code: getErrorCode(error) }
      }
    }
  )

  ipcMainHandle('store-export-done', async (_event, { id }: { id: string }): Promise<StoreExportResult> => {
    try {
      if (typeof id !== 'string' || id.length !== ID_LENGTH) return { ok: false, code: 'invalid_request' }
      if (!active.has(id)) return { ok: false, code: 'write_failed' }

      const request = streams.get(id)
      if (!request) return { ok: false, code: 'write_failed' }

      if (request.parts.received !== request.parts.expected) {
        cancel(id)
        return { ok: false, code: 'write_failed' }
      }
      if (request.size.received !== request.size.expected) {
        cancel(id)
        return { ok: false, code: 'write_failed' }
      }
      if (request.isWriting || request.stream.closed) {
        cancel(id)
        return { ok: false, code: 'write_failed' }
      }

      const stream = request.stream
      if (stream.errored) throw stream.errored
      if (!stream.closed && !stream.destroyed) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            stream.off('error', onError)
            stream.off('close', onClose)
          }
          const onError = (error: Error) => {
            cleanup()
            reject(error)
          }
          const onClose = () => {
            cleanup()
            resolve()
          }

          stream.once('error', onError)
          stream.once('close', onClose)
          stream.end()
        })
      }

      const { locations, schedule, directory } = request

      if (!locations.temporary.endsWith(`.${TEMPORARY_EXTENSION}`)) {
        cancel(id)
        return { ok: false, code: 'invalid_request' }
      }

      const statsOfTemporary = await lstat(locations.temporary).catch(() => undefined)
      if (!statsOfTemporary) {
        cancel(id)
        return { ok: false, code: 'write_failed' }
      }

      if (statsOfTemporary.size <= 0 || statsOfTemporary.size !== request.size.expected) {
        cancel(id)
        return { ok: false, code: 'write_failed' }
      }

      try {
        let lastError: unknown
        let renamed = false

        for (let attempt = 0; attempt < RENAME_RETRY_ATTEMPTS; attempt++) {
          try {
            await rename(locations.temporary, locations.actual)
            renamed = true
            break
          } catch (error) {
            lastError = error
            const code = (error as NodeJS.ErrnoException).code
            if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') throw error
            await sleep(100 * (attempt + 1))
          }
        }

        if (!renamed) {
          try {
            await copyFile(locations.temporary, locations.actual)
            await rm(locations.temporary, { force: true })
          } catch {
            throw lastError
          }
        }
      } catch (error) {
        cancel(id)
        return { ok: false, code: getErrorCode(error) }
      }

      const statsOfActual = await lstat(locations.actual).catch(() => undefined)
      if (!statsOfActual || statsOfActual.size <= 0 || statsOfActual.size !== request.size.expected) {
        cancel(id)
        return { ok: false, code: 'write_failed' }
      }

      try {
        const type = await fileTypeFromFile(locations.actual)
        if (
          !type ||
          type.mime !== request.type ||
          !ALLOWED_BUFFER_TYPES.some((current) => type.mime === current) ||
          !ALLOWED_BUFFER_EXTENSIONS.some((current) => type.ext === current)
        ) {
          log.warn('[export] file type sniff failed after write; keeping file', { scheduleId: schedule.id })
        }
      } catch {
        log.warn('[export] file type sniff failed after write; keeping file', { scheduleId: schedule.id })
      }

      cancel(id, { isUnlinking: false })

      store.value.history[schedule.id] ??= []
      const history = store.value.history[schedule.id]

      if (isPathInside(directory, locations.actual)) history.push(locations.actual)

      const drop = exportsToDrop(history.length, schedule.keep)
      if (drop > 0) {
        const remove = history.splice(0, drop)

        remove.forEach((location) => {
          if (typeof location !== 'string' || !isPathInside(directory, location)) return
          try {
            unlinkSync(location)
          } catch {}
        })
      }

      return { ok: true }
    } catch (error) {
      cancel(id)
      return { ok: false, code: getErrorCode(error) }
    }
  })

  isInitalized = true
}
