/**
 * System Audio Capture Module for Electron Main Process
 *
 * This module manages the native Swift helper binary that captures system audio
 * using macOS ScreenCaptureKit. It spawns the helper process, parses the PCM
 * audio stream from stdout, and forwards chunks to the renderer via IPC.
 *
 * Requires: macOS 13.0+ (Ventura)
 */

import { ChildProcess, execSync, spawn } from 'child_process'
import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import type {
  SystemAudioBackend,
  SystemAudioDiagnostics,
  SystemAudioErrorType,
  SystemAudioUnavailableReason,
} from '../electron-shared/electron-communication.model.js'

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ============================================================================
// Types
// ============================================================================

interface SystemAudioState {
  process: ChildProcess | null
  isCapturing: boolean
  headerReceived: boolean
  sampleRate: number
  bitDepth: number
  channelCount: number
  expectedChunkSize: number
  dataBuffer: Buffer
}

interface SystemAudioCallbacks {
  onChunk: (data: Buffer, size: number) => void
  onError: (error: SystemAudioErrorType, message: string) => void
  onStatus: (status: 'initializing' | 'capturing' | 'stopped' | 'error') => void
}

// ============================================================================
// Constants
// ============================================================================

const PCM_HEADER_MAGIC = 0x484d4350 // "PCMH" in little-endian
const PCM_HEADER_SIZE = 12

// ============================================================================
// Module State
// ============================================================================

const state: SystemAudioState = {
  process: null,
  isCapturing: false,
  headerReceived: false,
  sampleRate: 0,
  bitDepth: 0,
  channelCount: 0,
  expectedChunkSize: 0,
  dataBuffer: Buffer.alloc(0),
}

let callbacks: SystemAudioCallbacks | null = null

// ============================================================================
// Helper Path Resolution
// ============================================================================

/**
 * Get the path to the SystemAudioCapture helper binary
 */
function getHelperPath(): string {
  if (app.isPackaged) {
    // Production: binary is in Resources/bin/ inside the app bundle
    return path.join(process.resourcesPath, 'bin', 'SystemAudioCapture')
  } else {
    // Development: binary is in electron-assets/bin/
    // __dirname is electron-dist/, so we go up one level to project root
    return path.join(__dirname, '..', 'electron-assets', 'bin', 'SystemAudioCapture')
  }
}

/**
 * Check if the helper binary exists and is executable
 */
function helperExists(): boolean {
  const helperPath = getHelperPath()
  try {
    fs.accessSync(helperPath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function getDarwinMajorVersion(): number | undefined {
  if (process.platform !== 'darwin') return undefined
  return parseInt(os.release().split('.')[0], 10)
}

function chromiumFeatureIsEnabled(feature: string): boolean {
  return app.commandLine
    .getSwitchValue('enable-features')
    .split(',')
    .map((enabledFeature) => enabledFeature.trim())
    .includes(feature)
}

function isElectronLoopbackAvailable(): boolean {
  if (process.platform === 'win32') return true
  if (process.platform === 'linux') return chromiumFeatureIsEnabled('PulseaudioLoopbackForScreenShare')

  const darwinMajorVersion = getDarwinMajorVersion()
  return process.platform === 'darwin' && !!darwinMajorVersion && darwinMajorVersion >= 23
}

function inspectHelperSignature(
  helperPath: string
): Pick<SystemAudioDiagnostics, 'helperIdentifier' | 'helperSigned' | 'helperTeamId'> {
  try {
    const output = execSync(`codesign -dvv "${helperPath}" 2>&1`, { encoding: 'utf8', stdio: 'pipe' })
    const diagnostics = execSync(`"${helperPath}" --diagnose 2>&1`, { encoding: 'utf8', stdio: 'pipe', timeout: 3000 })
    const helperTeamId = output.match(/TeamIdentifier=(.+)/)?.[1]?.trim()
    const helperIdentifier = diagnostics.match(/bundleIdentifier=(.+)/)?.[1]?.trim()
    const helperSigned = !!helperTeamId && !output.includes('Signature=adhoc')

    return {
      helperIdentifier,
      helperSigned,
      helperTeamId,
    }
  } catch (error) {
    console.warn('[SystemAudio] Unable to inspect helper signature:', error)
    return { helperSigned: false }
  }
}

function preflightHelperScreenPermission(helperPath: string): boolean | undefined {
  try {
    execSync(`"${helperPath}" --preflight 2>&1`, { encoding: 'utf8', stdio: 'pipe', timeout: 3000 })
    return true
  } catch (error) {
    console.info('[SystemAudio] Helper Screen Recording preflight did not pass:', error)
    return false
  }
}

function getSystemAudioDiagnostics(): SystemAudioDiagnostics {
  const darwinMajorVersion = getDarwinMajorVersion()
  const helperPath = process.platform === 'darwin' ? getHelperPath() : undefined
  const helperAvailable = !!helperPath && helperExists()
  const helperSignature = helperAvailable && helperPath ? inspectHelperSignature(helperPath) : {}
  const helperScreenPermissionGranted =
    helperAvailable && helperPath ? preflightHelperScreenPermission(helperPath) : undefined

  return {
    platform: process.platform,
    darwinMajorVersion,
    // Electron loopback is the primary backend on Windows/Linux and macOS 14+.
    electronLoopbackAvailable: isElectronLoopbackAvailable(),
    electronLoopbackExperimental: process.platform === 'linux',
    helperAvailable,
    helperPath,
    helperScreenPermissionGranted,
    ...helperSignature,
  }
}

// ============================================================================
// System Audio Availability
// ============================================================================

/**
 * Check if system audio capture is available on this platform
 */
export function getSystemAudioAvailability(): {
  available: boolean
  backend?: SystemAudioBackend
  reason?: SystemAudioUnavailableReason
  diagnostics?: SystemAudioDiagnostics
} {
  const diagnostics = getSystemAudioDiagnostics()

  if (process.platform === 'win32') {
    console.info('[SystemAudio] Available: Windows Electron loopback backend')
    return { available: true, backend: 'electron-loopback', diagnostics }
  }

  if (process.platform === 'linux') {
    if (diagnostics.electronLoopbackAvailable) {
      console.info('[SystemAudio] Available: experimental Linux Electron loopback backend')
      return { available: true, backend: 'electron-loopback', diagnostics }
    }

    console.info('[SystemAudio] Not available: Linux loopback unavailable')
    return { available: false, reason: 'linux_loopback_unavailable', diagnostics }
  }

  if (process.platform !== 'darwin') {
    console.info('[SystemAudio] Not available: unsupported platform')
    return { available: false, reason: 'unsupported_platform', diagnostics }
  }

  // Check macOS version (requires 13.0+)
  const majorVersion = diagnostics.darwinMajorVersion ?? 0
  console.info(`[SystemAudio] Darwin major version: ${majorVersion}`)
  // Darwin 22.x = macOS 13 (Ventura)
  if (majorVersion < 22) {
    console.info('[SystemAudio] Not available: macOS version too old (requires 13+)')
    return { available: false, reason: 'macos_too_old', diagnostics }
  }

  if (diagnostics.electronLoopbackAvailable) {
    console.info('[SystemAudio] Available: Electron loopback backend')
    return { available: true, backend: 'electron-loopback', diagnostics }
  }

  if (diagnostics.helperAvailable) {
    console.info('[SystemAudio] Available: Swift helper fallback')
    return { available: true, backend: 'swift-helper', diagnostics }
  }

  console.info('[SystemAudio] Not available: helper binary not found at', diagnostics.helperPath)
  return { available: false, reason: 'helper_not_found', diagnostics }
}

// ============================================================================
// PCM Stream Parsing
// ============================================================================

/**
 * Parse the PCM header from the data buffer
 */
function parseHeader(buffer: Buffer): boolean {
  if (buffer.length < PCM_HEADER_SIZE) {
    return false
  }

  // Read magic number
  const magic = buffer.readUInt32LE(0)
  if (magic !== PCM_HEADER_MAGIC) {
    console.error('[SystemAudio] Invalid header magic:', magic.toString(16))
    callbacks?.onError('UNKNOWN', 'Invalid PCM header magic number')
    return false
  }

  // Read format info
  state.sampleRate = buffer.readUInt32LE(4)
  state.bitDepth = buffer.readUInt16LE(8)
  state.channelCount = buffer.readUInt16LE(10)

  console.info(`[SystemAudio] PCM format: ${state.sampleRate}Hz, ${state.bitDepth}-bit, ${state.channelCount}ch`)

  return true
}

/**
 * Process incoming data from the helper's stdout
 */
function processStdoutData(chunk: Buffer): void {
  // Append to buffer
  state.dataBuffer = Buffer.concat([state.dataBuffer, chunk])

  // Parse header if not yet received
  if (!state.headerReceived) {
    if (state.dataBuffer.length >= PCM_HEADER_SIZE) {
      if (parseHeader(state.dataBuffer)) {
        state.headerReceived = true
        state.dataBuffer = state.dataBuffer.subarray(PCM_HEADER_SIZE)
      } else {
        // Invalid header, stop capture
        stopSystemAudioCapture()
        return
      }
    } else {
      // Need more data for header
      return
    }
  }

  // Process audio chunks
  while (state.dataBuffer.length >= 4) {
    // Read chunk size if we don't have one
    if (state.expectedChunkSize === 0) {
      state.expectedChunkSize = state.dataBuffer.readUInt32LE(0)
      state.dataBuffer = state.dataBuffer.subarray(4)
    }

    // Check if we have enough data for the full chunk
    if (state.dataBuffer.length >= state.expectedChunkSize) {
      const audioChunk = state.dataBuffer.subarray(0, state.expectedChunkSize)
      state.dataBuffer = state.dataBuffer.subarray(state.expectedChunkSize)
      state.expectedChunkSize = 0

      // Forward chunk to callback
      callbacks?.onChunk(audioChunk, audioChunk.length)
    } else {
      // Need more data
      break
    }
  }
}

/**
 * Process stderr messages from the helper
 */
function processStderrData(data: Buffer): void {
  const lines = data
    .toString()
    .split('\n')
    .filter((l) => l.trim())

  for (const line of lines) {
    if (line.startsWith('STATUS:')) {
      const status = line.substring(7).split(':')[0].toLowerCase()
      console.info('[SystemAudio] Status:', status)

      if (status === 'capturing') {
        callbacks?.onStatus('capturing')
      } else if (status === 'stopped') {
        callbacks?.onStatus('stopped')
      } else if (status === 'initializing') {
        callbacks?.onStatus('initializing')
      }
    } else if (line.startsWith('ERROR:')) {
      const parts = line.substring(6).split(':')
      const errorType = parts[0] as SystemAudioErrorType
      const message = parts.slice(1).join(':') || errorType

      console.error('[SystemAudio] Error:', errorType, message)
      callbacks?.onError(errorType, message)
      callbacks?.onStatus('error')
    } else if (line.startsWith('WARNING:')) {
      console.warn('[SystemAudio]', line.substring(8))
    } else {
      console.info('[SystemAudio]', line)
    }
  }
}

// ============================================================================
// Capture Control
// ============================================================================

/**
 * Start system audio capture
 */
export async function startSystemAudioCapture(
  mainWindow: BrowserWindow
): Promise<{ success: boolean; error?: string }> {
  // Check if already capturing
  if (state.isCapturing) {
    console.warn('[SystemAudio] Already capturing')
    return { success: false, error: 'Already capturing' }
  }

  // Check availability
  const availability = getSystemAudioAvailability()
  if (!availability.available) {
    const error = availability.reason === 'helper_not_found' ? 'HELPER_NOT_FOUND' : availability.reason
    return { success: false, error }
  }

  if (!availability.diagnostics?.helperAvailable) {
    return { success: false, error: 'HELPER_NOT_FOUND' }
  }

  // Reset state
  state.headerReceived = false
  state.expectedChunkSize = 0
  state.dataBuffer = Buffer.alloc(0)

  // Set up callbacks to forward to renderer
  callbacks = {
    onChunk: (data, size) => {
      // Send chunk to renderer as base64
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('main-to-render-request', {
          id: `system-audio-chunk-${Date.now()}`,
          key: 'systemAudioChunk',
          data: {
            data: data.toString('base64'),
            size,
          },
        })
      }
    },
    onError: (error, message) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('main-to-render-request', {
          id: `system-audio-error-${Date.now()}`,
          key: 'systemAudioError',
          data: { error, message },
        })
      }
    },
    onStatus: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('main-to-render-request', {
          id: `system-audio-status-${Date.now()}`,
          key: 'systemAudioStatus',
          data: { status },
        })
      }
    },
  }

  // Spawn the helper process
  const helperPath = getHelperPath()
  console.info('[SystemAudio] Spawning helper:', helperPath)

  try {
    state.process = spawn(helperPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    state.isCapturing = true

    // Handle stdout (PCM data)
    state.process.stdout?.on('data', processStdoutData)

    // Handle stderr (status/errors)
    state.process.stderr?.on('data', processStderrData)

    // Handle process exit
    state.process.on('exit', (code, signal) => {
      console.info(`[SystemAudio] Helper exited with code ${code}, signal ${signal}`)
      state.isCapturing = false
      state.process = null

      if (code !== 0 && code !== null) {
        callbacks?.onError('HELPER_CRASHED', `Helper exited with code ${code}`)
      }

      callbacks?.onStatus('stopped')
    })

    // Handle process error
    state.process.on('error', (err) => {
      console.error('[SystemAudio] Helper spawn error:', err)
      state.isCapturing = false
      state.process = null
      callbacks?.onError('UNKNOWN', err.message)
      callbacks?.onStatus('error')
    })

    return { success: true }
  } catch (error) {
    console.error('[SystemAudio] Failed to spawn helper:', error)
    state.isCapturing = false
    return { success: false, error: String(error) }
  }
}

/**
 * Stop system audio capture
 */
export function stopSystemAudioCapture(): void {
  if (state.process) {
    console.info('[SystemAudio] Stopping capture...')

    // Send SIGTERM for graceful shutdown
    state.process.kill('SIGTERM')

    // Force kill after timeout
    setTimeout(() => {
      if (state.process) {
        console.warn('[SystemAudio] Force killing helper')
        state.process.kill('SIGKILL')
        state.process = null
      }
    }, 2000)
  }

  state.isCapturing = false
  callbacks = null
}

/**
 * Check if currently capturing
 */
export function isSystemAudioCapturing(): boolean {
  return state.isCapturing
}

/**
 * Get current audio format info (after capture started)
 */
export function getSystemAudioFormat(): {
  sampleRate: number
  bitDepth: number
  channelCount: number
} | null {
  if (!state.headerReceived) {
    return null
  }

  return {
    sampleRate: state.sampleRate,
    bitDepth: state.bitDepth,
    channelCount: state.channelCount,
  }
}
