import nodeMachineId from 'node-machine-id'
import path from 'node:path'
import * as os from 'os'
const { machineIdSync } = nodeMachineId
// import * as Sentry from '@sentry/electron'
import { fileURLToPath, URL } from 'node:url'
import { DeviceInfo, InAppState, type Nullable } from '../shared-logic/models/general.model.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const errorFilters = ['net::']

export function getEnvironment(): 'development' | 'staging' | 'nightly' | 'production' {
  return (
    (<const>['development', 'staging', 'nightly', 'production']).find(
      (environment) => environment === process.env.NODE_ENV
    ) ?? 'production'
  )
}

type JSONValue = string | number | boolean | JSONObject | JSONArray

interface JSONObject {
  [x: string]: JSONValue
}

type JSONArray = Array<JSONValue>

export function reportError(error: Error, details: JSONObject | undefined = undefined) {
  try {
    details = { errorMessage: error.message, ...details }

    if ((details?.errorMessage as string | undefined)?.startsWith('net::')) {
      console.error(error)
      return
    }
    const environment = getEnvironment()
    if (environment !== 'development') {
      let send = true
      for (const filter of errorFilters) if (error.message.startsWith(filter)) send = false
      // if (send)
      // Sentry.captureException(error, {
      //   extra: details,
      // })
    }

    if (environment !== 'production' && environment !== 'nightly') {
      console.error('--- HIDDEN ERROR --------------')
      console.error(error)
      if (details) {
        console.error('')
        console.error('DETAILS: ')
        console.error(details)
      }
      console.error('------------------------')
    }
  } catch (e) {
    throw e
  }
}

export function getBaseUrl() {
  return getEnvironment() === 'development' ? 'https://localhost:3333' : 'app://capacities'
}

export function isInternalUrl(urlString: string) {
  return urlString.startsWith(getBaseUrl())
}

export function getWebAppPath(urlString: string) {
  try {
    const url = new URL(urlString)
    if (url.hostname === 'app.capacities.io' && url.protocol === 'https:') {
      return urlString.replace('https://app.capacities.io', '')
    }
  } catch (e) {}
  return undefined
}

// device based sync
export let inAppState: InAppState | undefined = undefined

export function setInAppState(value: InAppState) {
  inAppState = value
}

export function getDeviceInfo() {
  const deviceInfo: DeviceInfo = {
    deviceId: machineIdSync(),
    platform: os.platform(),
    release: os.release(),
  }
  return deviceInfo
}

export function getByteUnit(number: number) {
  if (number >= 1024 ** 3) {
    return 'GB'
  } else if (number >= 1024 ** 2) {
    return 'MB'
  } else if (number >= 1024 ** 1) {
    return 'KB'
  } else {
    return 'B'
  }
}

export function toByteUnit(number: number, unit: 'B' | 'KB' | 'MB' | 'GB'): number {
  switch (unit) {
    case 'GB':
      return number / 1073741824
    case 'MB':
      return number / 1048576
    case 'KB':
      return number / 1024
    default:
      return number
  }
}

export function getFormattedFileSize(value: number): string {
  const unit = getByteUnit(value)
  const size = toByteUnit(value, unit)

  return `${size.toFixed(2)} ${unit}`
}

function decodeUriSafe(value: string): string {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function fileUrlToFilesystemPath(fileUrl: string): string {
  try {
    return fileURLToPath(fileUrl)
  } catch {
    // Capacities documents `file://Users/...` (two slashes). Node treats the
    // first path segment as the URL host and rejects it on POSIX, so fall back
    // to stripping the scheme while preserving case (`URL.hostname` lowercases).
    let stripped = decodeUriSafe(fileUrl).replace(/^file:\/\//i, '')
    if (/^localhost\//i.test(stripped)) {
      stripped = stripped.replace(/^localhost/i, '')
    }
    if (process.platform === 'win32') {
      return stripped.startsWith('/') ? stripped.slice(1) : stripped
    }
    return stripped.startsWith('/') ? stripped : `/${stripped}`
  }
}

export function getPathFromFileURL(url: string): string {
  let location = url.trim()
  if (!location) return ''

  // macOS / POSIX: users paste backslash-escaped spaces
  // (`file:///Users/foo/My\ Documents/a.pdf`). Decode those before URL parsing
  // or they get treated as path separators.
  if (process.platform !== 'win32') {
    location = location.replace(/\\(.)/g, '$1')
  }

  if (/^file:/i.test(location)) {
    location = fileUrlToFilesystemPath(location)
  } else if (process.platform === 'win32' && location.startsWith('/')) {
    location = location.slice(1)
  } else {
    location = decodeUriSafe(location)
  }

  return path.normalize(location)
}

export const RESERVED_FILE_NAMES = Object.freeze([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

export function sanitizeFileName(unsafe: Nullable<string>): string | null {
  if (typeof unsafe !== 'string') return null

  let name = unsafe.split(/[\\/]/).at(-1)
  if (!name || name.length === 0) return null

  try {
    name = decodeURIComponent(name)
  } catch {
    return null
  }

  name = name.normalize('NFC')

  name = name
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\0/g, '')
    .replace(/\.\./g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\.$/, '')
    .replace(/[^\x00-\x7F]/g, '')
    .trim()
    .slice(0, 255)

  const parts = name.split('.', 2)

  const basename = parts.at(0)?.toUpperCase()
  if (!basename) return null

  if (RESERVED_FILE_NAMES.includes(basename.toUpperCase())) return null
  return name.length === 0 ? null : path.basename(name)
}
