import { useEffect, useRef, useState } from 'react'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/** A real PDF.js rendering, including persisted annotations. Page coordinates stay independent of device pixels. */
export function PdfPagePreview({ bytes, page, onReady }: { bytes: Uint8Array; page: number; onReady?(ready: boolean): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [renderWidth, setRenderWidth] = useState(0)
  useEffect(() => {
    const container = canvas.current?.parentElement
    if (!container) return
    const resize = () => setRenderWidth(Math.round(container.getBoundingClientRect().width))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!renderWidth) return
    let live = true
    let destroy: (() => Promise<void>) | undefined
    let cancel: (() => void) | undefined
    onReady?.(false); setError(null)
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        if (!live) return
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
        const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true })
        destroy = () => task.destroy()
        const document = await task.promise
        if (!live) return
        const source = await document.getPage(page + 1)
        const initial = source.getViewport({ scale: 1 })
        const viewport = source.getViewport({ scale: Math.min(renderWidth * window.devicePixelRatio / initial.width,
          3600 / Math.max(initial.width, initial.height)) })
        if (!live || !canvas.current) return
        canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height)
        const render = source.render({ canvas: canvas.current, viewport })
        cancel = () => render.cancel()
        await render.promise
        if (live) onReady?.(true)
      } catch (reason) { if (live) setError(reason instanceof Error ? reason.message : String(reason)) }
    })()
    return () => { live = false; cancel?.(); void destroy?.().catch(() => {}) }
  }, [bytes, page, onReady, renderWidth])
  return <>{error && <p role="alert">PDF 显示失败：{error}</p>}<canvas ref={canvas} aria-label={`PDF 第 ${page + 1} 页`} /></>
}
