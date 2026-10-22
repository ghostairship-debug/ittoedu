import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/** A real PDF.js rendering, including persisted annotations. Page coordinates stay independent of device pixels. */
export function PdfPagePreview({ bytes, page, onReady }: { bytes: Uint8Array; page: number; onReady?(ready: boolean): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [renderWidth, setRenderWidth] = useState(0)
  const [loaded, setLoaded] = useState<{ bytes: Uint8Array; document: PDFDocumentProxy } | null>(null)
  const ready = useRef(onReady); ready.current = onReady
  const rendered = useRef<Promise<void>>(Promise.resolve())
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
    let live = true
    let destroy: (() => Promise<void>) | undefined
    setLoaded(null); ready.current?.(false); setError(null)
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        if (!live) return
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
        const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true })
        destroy = () => task.destroy()
        const document = await task.promise
        if (live) setLoaded({ bytes, document })
      } catch (reason) { if (live) setError(reason instanceof Error ? reason.message : String(reason)) }
    })()
    return () => { live = false; void destroy?.().catch(() => {}) }
  }, [bytes])
  useEffect(() => {
    if (!renderWidth || loaded?.bytes !== bytes) return
    let live = true
    let render: RenderTask | undefined
    ready.current?.(false); setError(null)
    void (async () => {
      try {
        // PDF.js owns this canvas until its cancelled render settles. A quick
        // page/width change must not start a competing render on the same one.
        await rendered.current
        if (!live) return
        const source = await loaded.document.getPage(page + 1)
        const initial = source.getViewport({ scale: 1 })
        const viewport = source.getViewport({ scale: Math.min(renderWidth * window.devicePixelRatio / initial.width,
          3600 / Math.max(initial.width, initial.height)) })
        if (!live || !canvas.current) return
        canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height)
        render = source.render({ canvas: canvas.current, viewport })
        rendered.current = render.promise.then(() => {}, () => {})
        await render.promise
        if (live) ready.current?.(true)
      } catch (reason) { if (live) setError(reason instanceof Error ? reason.message : String(reason)) }
    })()
    return () => { live = false; render?.cancel() }
  }, [bytes, page, loaded, renderWidth])
  return <>{error && <p role="alert">PDF 显示失败：{error}</p>}<canvas ref={canvas} aria-label={`PDF 第 ${page + 1} 页`} /></>
}
