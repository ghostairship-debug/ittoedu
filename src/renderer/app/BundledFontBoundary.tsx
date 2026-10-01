import { useEffect, useState, type ReactNode } from 'react'
import { ensureBundledFonts } from '../../shared/fonts/ensureBundledFonts'

/** Only metric-sensitive surfaces wait; file navigation and the assistant mount immediately. */
export function BundledFontBoundary({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => { let active = true; void ensureBundledFonts().then(() => { if (active) setReady(true) }); return () => { active = false } }, [])
  return ready ? children : <div className="editor-center" role="status">正在准备画布字体；文件与 AI 助手可先使用。</div>
}
