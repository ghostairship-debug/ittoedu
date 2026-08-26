import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { useEditorStore } from './store/editorStore'
import { AppErrorBoundary } from './ui/AppErrorBoundary'
import { installRendererDiagnostics } from './diagnostics/installRendererDiagnostics'
import { ensureBundledFonts } from '../shared/fonts/ensureBundledFonts'
import { installBundledFontFaces } from '../shared/fonts/installBundledFontFaces'

installRendererDiagnostics()

window.__COURSEWARE_EDITOR_DIRTY__ = useEditorStore.getState().dirty
useEditorStore.subscribe((state) => {
  window.__COURSEWARE_EDITOR_DIRTY__ = state.dirty
})

const root = document.getElementById('root')
if (!root) throw new Error('应用根节点不存在')

// Slide text is measured synchronously into canvases the moment a surface
// mounts, and the Player freezes that measurement into a texture. Register and
// load the bundled faces before the first render so nothing is ever laid out
// against fallback metrics. `ensureBundledFonts()` never rejects.
installBundledFontFaces()
await ensureBundledFonts()

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
