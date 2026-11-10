/**
 * Offline & Sync's media rows (M31, catalog section 1): "Media loading (Everything | Required only)"
 * and "Clear media cache".
 *
 * - `mediaLoading: 'required'` (a device setting): media waits behind a placeholder with "Load"
 *   until clicked (`components/SpaceImage.tsx`'s `MediaPlaceholder`): the page's image, video,
 *   audio and PDF blocks (`editor/media/MediaView.tsx`), cover images, card and gallery pictures,
 *   image property cells and whiteboard media. `everything` loads them at once, as before.
 * - The media token (`settings/mediaToken.ts`, re-exported here): "Clear media cache" bumps it and
 *   every space file URL (`api.fileUrl`) carries it, so every image loads afresh.
 */
import { useSettings } from './useSettings'

export { bumpMediaToken, getMediaToken, resetMediaToken, useMediaToken, withMediaToken } from './mediaToken'

// our strings
export const MEDIA_TEXT = {
  load: 'Load',
  notLoaded: 'Not loaded yet (Media loading: Required only).',
} as const

/** Whether "Media loading" is "Required only". */
export function useMediaOnRequest(): boolean {
  return useSettings((s) => s.settings.mediaLoading === 'required')
}
