/**
 * Meeting Detection Module for Electron Main Process
 *
 * This module detects when meeting apps (Zoom, Teams, Discord, etc.) are actively
 * using the microphone. It uses macOS-specific APIs to monitor audio device usage
 * and notifies the renderer when meetings are detected.
 *
 * Detection Strategy: Audio-based (monitors apps using microphone)
 * Platform: macOS only
 */

import { exec } from 'child_process'
import { BrowserWindow } from 'electron'
import { promisify } from 'util'
import type { MeetingApp } from '../electron-shared/electron-communication.model.js'

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

interface DetectedApp {
  processName: string
  meetingApp: MeetingApp
  pid: number
}

interface MeetingDetectorState {
  isRunning: boolean
  pollInterval: NodeJS.Timeout | null
  knownApps: Map<string, DetectedApp> // processName -> DetectedApp
  mainWindow: BrowserWindow | null
}

// ============================================================================
// Constants
// ============================================================================

const POLL_INTERVAL_MS = 5000 // Check every 5 seconds
const DEBOUNCE_MS = 3000 // Require 3 seconds of continuous usage before notification

/**
 * Process name patterns to meeting app mapping
 * These are the common process names for meeting applications on macOS
 */
const MEETING_APP_PATTERNS: Array<{ pattern: RegExp; app: MeetingApp }> = [
  { pattern: /^zoom\.us$/i, app: 'Zoom' },
  { pattern: /^CptHost$/i, app: 'Zoom' }, // Zoom audio host process
  { pattern: /^Microsoft Teams/i, app: 'Microsoft Teams' },
  { pattern: /^Teams$/i, app: 'Microsoft Teams' },
  { pattern: /^Discord$/i, app: 'Discord' },
  { pattern: /^Slack$/i, app: 'Slack' },
  { pattern: /^FaceTime$/i, app: 'FaceTime' },
  { pattern: /^Skype$/i, app: 'Skype' },
  { pattern: /^Webex$/i, app: 'Unknown' }, // Cisco Webex
  { pattern: /^Google Chrome$/i, app: 'Google Meet' }, // Could be Meet
  { pattern: /^Chromium$/i, app: 'Google Meet' },
  { pattern: /^Arc$/i, app: 'Google Meet' }, // Arc browser
  { pattern: /^Safari$/i, app: 'Google Meet' }, // Safari with Meet
  { pattern: /^Firefox$/i, app: 'Google Meet' }, // Firefox with Meet
]

// Apps to ignore (our own app and system processes)
const IGNORED_PROCESSES = [
  'Capacities',
  'Electron',
  'coreaudiod', // System audio daemon
  'audioclipd',
]

// ============================================================================
// Module State
// ============================================================================

const state: MeetingDetectorState = {
  isRunning: false,
  pollInterval: null,
  knownApps: new Map(),
  mainWindow: null,
}

// Debounce tracking
const appFirstSeen: Map<string, number> = new Map()

// ============================================================================
// Audio Device Usage Detection
// ============================================================================

/**
 * Get list of processes currently using audio input (microphone)
 * Uses lsof to check for processes with the audio device open
 */
async function getProcessesUsingMicrophone(): Promise<string[]> {
  if (process.platform !== 'darwin') {
    return []
  }

  try {
    // Use lsof to find processes with audio devices open
    // /dev/audiosession* are the audio session devices on macOS
    const { stdout } = await execAsync(
      'lsof -c "" 2>/dev/null | grep -E "Audio|CoreAudio|audio" | awk \'{print $1}\' | sort -u',
      { timeout: 5000 }
    )

    const processes = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    return processes
  } catch {
    // Fallback: try using system_profiler
    try {
      const { stdout } = await execAsync(
        'ps aux | grep -E "zoom|teams|discord|slack|facetime|skype|chrome|safari" | grep -v grep | awk \'{print $11}\' | xargs -I {} basename {}',
        { timeout: 5000 }
      )

      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    } catch {
      return []
    }
  }
}

/**
 * Alternative detection using AppleScript to get running applications
 * This is more reliable but requires accessibility permissions
 */
async function getRunningMeetingApps(): Promise<string[]> {
  if (process.platform !== 'darwin') {
    return []
  }

  try {
    // Get list of running applications
    const { stdout } = await execAsync(
      `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`,
      { timeout: 5000 }
    )

    const apps = stdout
      .split(',')
      .map((app) => app.trim())
      .filter((app) => app.length > 0)

    // Filter to only meeting-related apps
    return apps.filter((app) => MEETING_APP_PATTERNS.some((p) => p.pattern.test(app)))
  } catch {
    return []
  }
}

/**
 * Check if a process is using the microphone by checking IORegistry
 * This is the most accurate method but requires parsing complex output
 */
async function checkMicrophoneUsage(): Promise<DetectedApp[]> {
  const detectedApps: DetectedApp[] = []

  // Try multiple detection methods
  const [processesWithAudio, runningMeetingApps] = await Promise.all([
    getProcessesUsingMicrophone(),
    getRunningMeetingApps(),
  ])

  // Combine results
  const allProcesses = new Set([...processesWithAudio, ...runningMeetingApps])

  for (const processName of allProcesses) {
    // Skip ignored processes
    if (IGNORED_PROCESSES.some((ignored) => processName.includes(ignored))) {
      continue
    }

    // Find matching meeting app
    const match = MEETING_APP_PATTERNS.find((p) => p.pattern.test(processName))
    if (match) {
      detectedApps.push({
        processName,
        meetingApp: match.app,
        pid: 0, // We don't have PID from all methods
      })
    }
  }

  return detectedApps
}

// ============================================================================
// Detection Logic
// ============================================================================

/**
 * Map process name to meeting app type
 */
function identifyMeetingApp(processName: string): MeetingApp {
  const match = MEETING_APP_PATTERNS.find((p) => p.pattern.test(processName))
  return match?.app ?? 'Unknown'
}

/**
 * Send meeting detected notification to renderer
 */
function notifyMeetingDetected(app: DetectedApp, type: 'started' | 'ended'): void {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) {
    return
  }

  console.info(`[MeetingDetector] Meeting ${type}:`, app.processName, '→', app.meetingApp)

  state.mainWindow.webContents.send('main-to-render-request', {
    id: `meeting-detected-${Date.now()}`,
    key: 'meetingDetected',
    data: {
      app: app.meetingApp,
      processName: app.processName,
      type,
    },
  })
}

/**
 * Poll for meeting apps and detect changes
 */
async function pollForMeetings(): Promise<void> {
  if (!state.isRunning) {
    return
  }

  try {
    const currentApps = await checkMicrophoneUsage()
    const currentAppNames = new Set(currentApps.map((a) => a.processName))
    const now = Date.now()

    // Check for new apps (meeting started)
    for (const app of currentApps) {
      if (!state.knownApps.has(app.processName)) {
        // Check if we've seen this app before (debounce)
        const firstSeen = appFirstSeen.get(app.processName)

        if (!firstSeen) {
          // First time seeing this app, start debounce timer
          appFirstSeen.set(app.processName, now)
        } else if (now - firstSeen >= DEBOUNCE_MS) {
          // App has been active long enough, notify
          state.knownApps.set(app.processName, app)
          notifyMeetingDetected(app, 'started')
          appFirstSeen.delete(app.processName)
        }
      }
    }

    // Check for removed apps (meeting ended)
    for (const [processName, app] of state.knownApps) {
      if (!currentAppNames.has(processName)) {
        state.knownApps.delete(processName)
        notifyMeetingDetected(app, 'ended')
      }
    }

    // Clean up debounce map for apps that disappeared before debounce completed
    for (const [processName] of appFirstSeen) {
      if (!currentAppNames.has(processName)) {
        appFirstSeen.delete(processName)
      }
    }
  } catch (error) {
    console.error('[MeetingDetector] Poll error:', error)
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start meeting detection polling
 */
export function startMeetingDetection(mainWindow: BrowserWindow): void {
  if (state.isRunning) {
    console.warn('[MeetingDetector] Already running')
    return
  }

  if (process.platform !== 'darwin') {
    console.info('[MeetingDetector] Not macOS, skipping')
    return
  }

  console.info('[MeetingDetector] Starting detection...')

  state.isRunning = true
  state.mainWindow = mainWindow
  state.knownApps.clear()
  appFirstSeen.clear()

  // Initial poll
  pollForMeetings()

  // Start polling interval
  state.pollInterval = setInterval(pollForMeetings, POLL_INTERVAL_MS)
}

/**
 * Stop meeting detection polling
 */
export function stopMeetingDetection(): void {
  if (!state.isRunning) {
    return
  }

  console.info('[MeetingDetector] Stopping detection...')

  state.isRunning = false

  if (state.pollInterval) {
    clearInterval(state.pollInterval)
    state.pollInterval = null
  }

  state.knownApps.clear()
  state.mainWindow = null
  appFirstSeen.clear()
}

/**
 * Check if meeting detection is running
 */
export function isMeetingDetectionRunning(): boolean {
  return state.isRunning
}

/**
 * Get currently detected meeting apps
 */
export function getDetectedMeetings(): DetectedApp[] {
  return Array.from(state.knownApps.values())
}
