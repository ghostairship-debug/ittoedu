import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { useEditorStore } from './store/editorStore'
import { AppErrorBoundary } from './ui/AppErrorBoundary'
import { installRendererDiagnostics } from './diagnostics/installRendererDiagnostics'
import { BUNDLED_FONT_MANIFEST } from '../shared/fonts/bundledFontAssets'
import { ensureBundledFonts } from '../shared/fonts/ensureBundledFonts'
import { installBundledFontFaces } from '../shared/fonts/installBundledFontFaces'
import { installFetchBundledFontEmbedSource } from './export/bundledFontEmbedSourceFetch'

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

// Teach the export path where the editor's font bytes are. This is a
// registration, not a read: nothing is fetched until an export asks for it, so
// a session that only authors pays nothing. Without it the properties panel's
// "导出时嵌入" label would be a promise the export button does not keep.
installFetchBundledFontEmbedSource({ manifest: BUNDLED_FONT_MANIFEST })

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
