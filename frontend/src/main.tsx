import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GlobalOverlays } from './shell/GlobalOverlays.tsx'
import { installChunkReload } from './lib/lazyReload'

// A chunk of an older build that fails to load reloads the window once (see lib/lazyReload).
installChunkReload()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <GlobalOverlays />
  </StrictMode>,
)
