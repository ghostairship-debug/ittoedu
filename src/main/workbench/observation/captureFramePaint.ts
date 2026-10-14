import type { WebFrameMain } from 'electron'

/** Serialized into each current frame; no host API or persistent bridge is exposed. */
export function captureFramePaintInRealm(token: string, action: 'install' | 'start' | 'wait' | 'dispose'): void | Promise<void> {
  const property = `__guoling_capture_paint_${token.replaceAll('-', '_')}`
  type State = { start(): void; wait(): Promise<void>; dispose(): void }
  const states = window as unknown as Record<string, State | undefined>
  if (action !== 'install') {
    const state = states[property]
    if (action === 'dispose') { state?.dispose(); return }
    if (!state) throw new Error('捕获帧准备上下文已改变')
    return action === 'start' ? state.start() : state.wait()
  }
  let resolveVisible!: (visible: boolean) => void
  const visible = new Promise<boolean>(resolve => { resolveVisible = resolve })
  const receive = (event: MessageEvent) => {
    if (event.source !== parent || event.data?.type !== 'guoling.capture.paint' || event.data.token !== token) return
    resolveVisible(event.data.visible === true)
    window.removeEventListener('message', receive)
  }
  window.addEventListener('message', receive)
  const ready = visible.then(async visible => {
    // The parent owns its iframe's actual CSS box. A hidden child document can
    // still report a full viewport and visible document while its rAF is paused.
    const frames: Array<HTMLIFrameElement | HTMLFrameElement> = []
    const collect = (root: Document | ShadowRoot) => {
      for (const element of root.querySelectorAll('*')) {
        if (element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement) frames.push(element)
        if (element.shadowRoot) collect(element.shadowRoot)
      }
    }
    collect(document)
    for (const frame of frames) {
      const rect = frame.getBoundingClientRect()
      const paints = visible && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
        && rect.left < innerWidth && rect.top < innerHeight && frame.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      frame.contentWindow?.postMessage({ type: 'guoling.capture.paint', token, visible: paints }, '*')
    }
    if (!visible) return
    await document.fonts.ready
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  const dispose = () => {
    window.removeEventListener('message', receive)
    resolveVisible(false)
    Reflect.deleteProperty(states, property)
  }
  Object.defineProperty(states, property, { configurable: true, value: { start: () => resolveVisible(true), wait: () => ready, dispose } satisfies State })
}

/** Only frames with pixels in their ancestor's viewport acknowledge a painted frame. */
export async function waitForCaptureFramePaint(mainFrame: WebFrameMain, token: string): Promise<void> {
  const frames = mainFrame.framesInSubtree.filter(frame => !frame.detached)
  const run = (frame: WebFrameMain, action: Parameters<typeof captureFramePaintInRealm>[1]) =>
    frame.executeJavaScript(`(${captureFramePaintInRealm.toString()})(${JSON.stringify(token)},${JSON.stringify(action)})`)
  try {
    await Promise.all(frames.map(frame => run(frame, 'install')))
    await run(mainFrame, 'start')
    await Promise.all(frames.map(async frame => {
      try { if (!frame.detached) await run(frame, 'wait') }
      catch (error) { if (!frame.detached) throw error }
    }))
  } finally {
    await Promise.all(frames.map(async frame => {
      try { if (!frame.detached) await run(frame, 'dispose') }
      catch { /* Destroying the capture window also releases its frame contexts. */ }
    }))
  }
}
