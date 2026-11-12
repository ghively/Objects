import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerBeforeClose } from './desktop/beforeClose.ts'
import { DesktopChrome } from './desktop/DesktopChrome.tsx'
import { GlobalOverlays } from './shell/GlobalOverlays.tsx'
import { installChunkReload } from './lib/lazyReload'
import { WorkMini } from './work/session/WorkMini.tsx'

// A chunk of an older build that fails to load reloads the window once (see lib/lazyReload).
installChunkReload()

// M33: in the desktop window, closing saves first (nothing in a browser tab or the pywebview window).
registerBeforeClose()

// M23: `/?mini=work` is Keep on top's small window (the Object window opens it on top).
const mini = new URLSearchParams(window.location.search).get('mini') === 'work'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {mini ? (
      <WorkMini standalone />
    ) : (
      <>
        <App />
        <GlobalOverlays />
        {/* M33: the desktop window's chrome; nothing in a browser tab or the pywebview window. */}
        <DesktopChrome />
      </>
    )}
  </StrictMode>,
)
