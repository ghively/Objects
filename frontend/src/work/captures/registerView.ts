// M24 Task 10: registers the Captures view; WorkPage's `import.meta.glob` finds this file.
import { registerWorkView } from '../views/registry'
import { WORK_ICONS } from '../workIcons'
import { CAPTURE_TEXT } from './captureText'
import { CapturesView } from './CapturesView'
import { openCaptureCount } from './useCaptures'

registerWorkView({
  id: 'captures',
  label: CAPTURE_TEXT.label,
  icon: WORK_ICONS.capture,
  key: null,
  count: () => openCaptureCount(),
  Component: CapturesView,
})
