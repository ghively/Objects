import { z } from 'zod'
import type {
  ActionQueueElementResponseWorkerDto,
  ActionQueueElementWorkerDto,
} from '../shared-logic/models/api/actionQueue.api.js'
import type { DeviceInfo, InAppState, LanguageKey } from '../shared-logic/models/general.model.js'
import type { ThemeKey } from '../shared-logic/models/themeOptions.js'
import type { LocalApiRouteKey } from './localApiDefinition.js'

const createNewObjectSearchParamsSchema = z.object({
  spaceId: z.string().optional(),
  type: z.string().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  content: z.string().optional(),
})
type CreateNewObjectSearchParams = z.infer<typeof createNewObjectSearchParamsSchema>

const appendToDailyNoteSearchParamsSchema = z.object({
  spaceId: z.string().optional(),
  content: z.string().optional(),
})
type AppendToDailyNoteSearchParams = z.infer<typeof appendToDailyNoteSearchParamsSchema>

export const actionFromXCallbackSchema = z.object({
  successUrl: z.string().optional(),
  errorUrl: z.string().optional(),
  processId: z.string(),
  data: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('createNewObject'),
      searchParamsObj: createNewObjectSearchParamsSchema,
    }),
    z.object({
      type: z.literal('appendToDailyNote'),
      searchParamsObj: appendToDailyNoteSearchParamsSchema,
    }),
    z.object({
      type: z.literal('getCurrentObject'),
      searchParamsObj: z.object({ spaceId: z.undefined().optional() }),
    }),
  ]),
})

export type ActionFromXCallback = z.infer<typeof actionFromXCallbackSchema>

export const STORE_EXPORT_ERROR_CODES = [
  'busy',
  'folder_missing',
  'folder_not_writable',
  'export_build_failed',
  'write_failed',
  'invalid_request',
  'timeout',
] as const

export type StoreExportErrorCode = (typeof STORE_EXPORT_ERROR_CODES)[number]

export type StoreExportSuccess = { ok: true }
export type StoreExportFailure = { ok: false; code: StoreExportErrorCode }
export type StoreExportResult = StoreExportSuccess | StoreExportFailure

export function isStoreExportErrorCode(value: string): value is StoreExportErrorCode {
  return (STORE_EXPORT_ERROR_CODES as readonly string[]).includes(value)
}

export type ReturnActionFromXCallback = {
  successUrl: string | undefined
  errorUrl: string | undefined
  processId: string
  data:
    | {
        type: 'createNewObject'
        searchParamsObj: CreateNewObjectSearchParams
        returnData: {
          componentId: string | undefined
          spaceId: string | undefined
          title: string | undefined
          name: string | undefined // legacy but needed for hookmark
        }
      }
    | {
        type: 'appendToDailyNote'
        searchParamsObj: AppendToDailyNoteSearchParams
        returnData: {
          spaceId: string | undefined
          componentId: string | undefined
        }
      }
    | {
        type: 'getCurrentObject'
        searchParamsObj: {}
        returnData: {
          componentId: string | undefined
          spaceId: string | undefined
          title: string | undefined
          name: string | undefined // legacy but needed for hookmark
        }
      }
}

export type ElectronCommunicationRendererToMainRequest = {
  runMenuCommand: {
    inData: {
      key:
        | 'app-quit'
        | 'app-settings'
        | 'app-about'
        | 'edit-undo'
        | 'edit-redo'
        | 'edit-cut'
        | 'edit-copy'
        | 'edit-paste'
        | 'edit-selectAll'
        | 'view-reload'
        | 'view-minimize'
        | 'view-resetZoom'
        | 'view-zoomIn'
        | 'view-zoomOut'
        | 'help-learn'
        | 'view-devTools'
    }
    outData: undefined
  }
  getLoadingPath: {
    inData: undefined
    outData: string | undefined
  }
  getCookie: {
    inData: Electron.CookiesGetFilter
    outData: Electron.Cookie | undefined
  }
  setCookie: {
    inData: Electron.CookiesSetDetails
    outData: undefined
  }
  deleteCookie: {
    inData: {
      url: string
      name: string
    }
    outData: undefined
  }
  setLocale: {
    inData: LanguageKey
    outData: undefined
  }
  syncSpellCheckerLanguage: {
    inData: {
      requested: string | undefined
    }
    outData: {
      language: string | undefined
    }
  }
  setThemeKey: {
    inData: {
      themeKey: ThemeKey
      inFocusMode?: boolean
    }
    outData: undefined
  }
  runVersionUpdate: {
    inData: undefined
    outData: undefined
  }
  getDeviceInfo: {
    inData: undefined
    outData: DeviceInfo
  }
  focusMainWindow: {
    inData: undefined
    outData: undefined
  }
  updateInAppState: {
    inData: InAppState
    outData: undefined
  }
  downloadFromUrl: {
    inData: {
      url: string
      fileName: string | undefined
      isSilent?: boolean
    }
    outData: undefined
  }
  openFilePathOnDevice: {
    inData: {
      fileURL: string
    }
    outData: boolean
  }
  copyToClipboard: {
    inData: {
      plainText: string
      html?: string
      internalClipboardEntryId?: string
    }
    outData: undefined
  }
  readTextFromClipboard: {
    inData: undefined
    outData: string | undefined
  }
  getWindowSize: {
    inData: undefined
    outData: {
      isFullscreen: boolean
    }
  }
  clearStorageData: {
    inData: undefined
    outData: undefined
  }
  handleActionQueueElement: {
    inData: ActionQueueElementWorkerDto
    outData: ActionQueueElementResponseWorkerDto
  }
  getAppleRemindersAccess: {
    inData: undefined
    outData: boolean
  }
  chooseExportFolder: {
    inData: {
      scheduleId: string
    }
    outData: {
      path: string | null
      error?: StoreExportFailure
    }
  }
  openExportFolder: {
    inData: {
      scheduleId: string
    }
    outData: undefined
  }
  startLocalApi: {
    inData: {
      token: string
    }
    outData: undefined
  }

  // ============================================================================
  // System Audio Capture (macOS 13+ only)
  // ============================================================================

  /** Check if system audio capture is available on this platform */
  getSystemAudioAvailability: {
    inData: undefined
    outData: {
      available: boolean
      backend?: SystemAudioBackend
      reason?: SystemAudioUnavailableReason
      diagnostics?: SystemAudioDiagnostics
    }
  }

  /** Start capturing system audio - spawns the native helper */
  startSystemAudioCapture: {
    inData: undefined
    outData: {
      success: boolean
      error?: string
    }
  }

  /** Stop capturing system audio - terminates the native helper */
  stopSystemAudioCapture: {
    inData: undefined
    outData: undefined
  }

  // ============================================================================
  // Meeting Detection (macOS only)
  // ============================================================================

  /** Start polling for apps using the microphone */
  startMeetingDetection: {
    inData: undefined
    outData: undefined
  }

  /** Stop polling for meeting detection */
  stopMeetingDetection: {
    inData: undefined
    outData: undefined
  }

  getLocalStorageToMigrate: {
    inData: undefined
    outData: Record<string, unknown>
  }

  // ============================================================================
  // OS notification authorization (desktop)
  // ============================================================================

  getOsNotificationAuthStatus: {
    inData: undefined
    outData: {
      status: 'notDetermined' | 'granted' | 'denied' | 'unsupported'
      blockReason?: 'user' | 'application' | 'policy' | 'manifest' | 'unknown'
      canOpenSettings: boolean
      canRequest: boolean
      authorizationStatus?: string
      alertSetting?: string
      notificationCenterSetting?: string
      soundSetting?: string
      bundleId?: string
    }
  }

  requestOsNotificationAuth: {
    inData: undefined
    outData: {
      status: 'notDetermined' | 'granted' | 'denied' | 'unsupported'
      blockReason?: 'user' | 'application' | 'policy' | 'manifest' | 'unknown'
      canOpenSettings: boolean
      canRequest: boolean
      authorizationStatus?: string
      alertSetting?: string
      notificationCenterSetting?: string
      soundSetting?: string
      bundleId?: string
    }
  }

  openOsNotificationSettings: {
    inData: undefined
    outData: boolean
  }

  /** Display a reminder banner via Electron's main-process Notification module. */
  showOsNotification: {
    inData: {
      notificationId: string
      title: string
      body: string
    }
    outData: {
      shown: boolean
      error?: string
      event?: 'show' | 'failed' | 'timeout'
    }
  }
}

export type ElectronCommunicationRendererToMainRequestSpecial = {
  openBlob: {
    inData: { blob: Blob; name: string }
    outData: undefined
  }
  storeExport: {
    inData: {
      schedule: { id: string; title: string; keep: number | null }
      blob: Blob
      name: string
    }
    outData: StoreExportResult
  }
}

// ============================================================================
// System Audio Types
// ============================================================================

export type SystemAudioErrorType =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_DISMISSED'
  | 'SYSTEM_TOO_OLD'
  | 'NO_DISPLAY'
  | 'STREAM_CREATION_FAILED'
  | 'STREAM_START_FAILED'
  | 'STREAM_STOPPED'
  | 'HELPER_CRASHED'
  | 'HELPER_NOT_FOUND'
  | 'HELPER_UNSIGNED'
  | 'NO_AUDIO_TRACK'
  | 'UNKNOWN'

export type SystemAudioBackend = 'electron-loopback' | 'swift-helper'

export type SystemAudioUnavailableReason =
  | 'macos_too_old'
  | 'not_macos'
  | 'helper_not_found'
  | 'electron_loopback_unavailable'
  | 'linux_loopback_unavailable'
  | 'screen_permission_denied'
  | 'unsupported_platform'

export type SystemAudioDiagnostics = {
  platform: string
  darwinMajorVersion?: number
  electronLoopbackAvailable: boolean
  electronLoopbackExperimental?: boolean
  helperAvailable: boolean
  helperPath?: string
  helperSigned?: boolean
  helperTeamId?: string
  helperIdentifier?: string
  helperScreenPermissionGranted?: boolean
}

export type MeetingApp =
  'Zoom' | 'Microsoft Teams' | 'Google Meet' | 'Discord' | 'Slack' | 'FaceTime' | 'Skype' | 'Unknown'

export type ElectronCommunicationMainToRendererRequest = {
  handleXCallbackAction: {
    inData: ActionFromXCallback
    outData:
      | {
          processId: string | undefined
          successUrl: string | undefined
          errorUrl: string | undefined
          type: ActionFromXCallback['data']['type']
        }
      | undefined
  }
  redirectToPath: {
    inData: {
      path: string
    }
    outData: undefined
  }
  openSettings: {
    inData: undefined
    outData: undefined
  }
  navigateHistory: {
    inData: { direction: 'back' | 'forward' }
    outData: undefined
  }
  runHardReset: {
    inData: undefined
    outData: undefined
  }
  setNewAppVersion: {
    inData: {
      version: string
    }
    outData: undefined
  }
  setDownloadDone: {
    inData: {
      success: boolean
      savePath: string
      fileName: string
    }
    outData: undefined
  }
  afterWindowResize: {
    inData: {
      isFullscreen: boolean
    }
    outData: undefined
  }
  printElectronInfo: {
    inData: {
      text: string
    }
    outData: undefined
  }
  localApiRequest: {
    inData: {
      routeKey: LocalApiRouteKey
      data: any
    }
    outData: any
  }

  // ============================================================================
  // System Audio Events (Main → Renderer)
  // ============================================================================

  /** System audio PCM chunk received from native helper */
  systemAudioChunk: {
    inData: {
      /** Base64-encoded PCM audio data */
      data: string
      /** Size of the decoded data in bytes */
      size: number
    }
    outData: undefined
  }

  /** System audio capture error occurred */
  systemAudioError: {
    inData: {
      error: SystemAudioErrorType
      message: string
    }
    outData: undefined
  }

  /** System audio capture status changed */
  systemAudioStatus: {
    inData: {
      status: 'initializing' | 'capturing' | 'stopped' | 'error'
    }
    outData: undefined
  }

  // ============================================================================
  // Meeting Detection Events (Main → Renderer)
  // ============================================================================

  /** Meeting app detected using microphone */
  meetingDetected: {
    inData: {
      app: MeetingApp
      processName: string
      type: 'started' | 'ended'
    }
    outData: undefined
  }

  getLocalStorage: {
    inData: undefined
    outData: Record<string, unknown>
  }

  /** User clicked an OS reminder banner — open the matching inbox item. */
  openOsNotification: {
    inData: {
      notificationId: string
    }
    outData: undefined
  }
}

export type ElectronSendMessageCommunication = {}
