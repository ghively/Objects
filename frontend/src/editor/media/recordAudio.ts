/**
 * "Record audio" (`CreateDropdown.recordAudio.*`): record from the microphone
 * into an attachment and embed it at the cursor (no transcription). Stub:
 * Task 25 fixes the names (the `/` menu item and the `recordAudio` command
 * call `recordAudio(editor)`); Task 30 fills the body, keeping them.
 */
import { Extension, type Editor } from '@tiptap/core'
import { NOT_AVAILABLE, NotBuiltYet } from '@/lib/notBuilt'
import { showToast } from './upload'

/** Start recording for `editor`; the recording lands as a media block at the cursor. */
export async function recordAudio(_editor: Editor): Promise<void> {
  throw new NotBuiltYet('recordAudio')
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    recordAudio: {
      /** Start an audio recording that is embedded at the cursor when it stops. */
      recordAudio: () => ReturnType
    }
  }
}

/** The `recordAudio` command: hands the editor to `recordAudio` ("Not available yet" until Task 30). */
export const RecordAudio = Extension.create({
  name: 'recordAudio',
  addCommands() {
    return {
      recordAudio:
        () =>
        ({ editor }) => {
          if (!editor.isEditable) return false
          void recordAudio(editor).catch((err) => {
            if (err instanceof NotBuiltYet) showToast(NOT_AVAILABLE)
          })
          return true
        },
    }
  },
})
