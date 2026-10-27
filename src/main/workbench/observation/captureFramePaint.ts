import type { WebFrameMain } from 'electron'
import { ObservationDeadline, OBSERVATION_TIMEOUT_MS } from './observationDeadline'

/** Serialized into each current frame; no host API or persistent bridge is exposed. */
export function captureFramePaintInRealm(token: string, action: 'install' | 'start' | 'wait' | 'dispose', lifetimeMs = 20_000): void | Promise<void> {
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
  let disposed = false, animationFrame = 0
  let resolveDisposed!: () => void
  const disposal = new Promise<void>(resolve => { resolveDisposed = resolve })
  const receive = (event: MessageEvent) => {
    if (event.source !== parent || event.data?.type !== 'guoling.capture.paint' || event.data.token !== token) return
    resolveVisible(event.data.visible === true)
    window.removeEventListener('message', receive)
  }
  window.addEventListener('message', receive)
  const visibility = visible.then(visible => {
    if (disposed) return false
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
        && getComputedStyle(frame).clipPath !== 'polygon(0px 0px, 0px 0px, 0px 0px)'
      frame.contentWindow?.postMessage({ type: 'guoling.capture.paint', token, visible: paints }, '*')
    }
    return visible
  })
  let painted: Promise<void> | undefined
  const wait = () => painted ??= Promise.race([disposal, visibility.then(async visible => {
    if (!visible || disposed) return
    await Promise.race([document.fonts.ready, disposal])
    if (disposed) return
    await new Promise<void>(resolve => {
      animationFrame = requestAnimationFrame(() => {
        if (disposed) { resolve(); return }
        animationFrame = requestAnimationFrame(() => { animationFrame = 0; resolve() })
      })
    })
  })])
  const dispose = () => {
    disposed = true
    clearTimeout(expiry)
    if (animationFrame) cancelAnimationFrame(animationFrame)
    window.removeEventListener('message', receive)
    resolveVisible(false)
    resolveDisposed()
    Reflect.deleteProperty(states, property)
  }
  const expiry = setTimeout(dispose, lifetimeMs)
  Object.defineProperty(states, property, { configurable: true, value: { start: () => resolveVisible(true), wait, dispose } satisfies State })
}

/** Only frames with pixels in their ancestor's viewport acknowledge a painted frame. */
export async function waitForCaptureFramePaint(mainFrame: WebFrameMain, token: string,
  observedFrames?: readonly WebFrameMain[], observation?: ObservationDeadline): Promise<void> {
  const deadline = observation ?? new ObservationDeadline()
  const frames = (observedFrames ?? mainFrame.framesInSubtree).filter(frame => !frame.detached)
  const raw = (frame: WebFrameMain, action: Parameters<typeof captureFramePaintInRealm>[1]) =>
    frame.executeJavaScript(`(${captureFramePaintInRealm.toString()})(${JSON.stringify(token)},${JSON.stringify(action)},${OBSERVATION_TIMEOUT_MS})`)
  const dispose = async (frame: WebFrameMain) => {
    try { if (!frame.detached) await raw(frame, 'dispose') }
    catch { /* A frame can close between the detached check and native IPC. */ }
  }
  const run = (frame: WebFrameMain, action: Parameters<typeof captureFramePaintInRealm>[1]) =>
    deadline.wait(`paint-${action}`, () => raw(frame, action), action === 'install' ? () => dispose(frame) : undefined)
  try {
    await Promise.all(frames.map(frame => run(frame, 'install')))
    await run(mainFrame, 'start')
    // A parent rAF alongside its children can still compose their previous
    // surfaces. Let each child finish before the containing frame paints;
    // unrelated frames at the same depth can prepare together.
    const levels = new Map<number, WebFrameMain[]>()
    for (const frame of frames) {
      let depth = 0
      for (let parent = frame.parent; parent; parent = parent.parent) depth++
      levels.set(depth, [...(levels.get(depth) ?? []), frame])
    }
    for (const [, level] of [...levels].sort(([a], [b]) => b - a)) await Promise.all(level.map(async frame => {
      try { if (!frame.detached) await run(frame, 'wait') }
      catch (error) { if (!frame.detached || deadline.signal.aborted) throw error }
    }))
  } finally {
    // Cleanup must not turn a bounded cancellation back into an unbounded IPC
    // wait. Realm expiry and late-install cleanup also own their exact token.
    const cleanup = Promise.all(frames.map(dispose))
    try {
      if (!deadline.signal.aborted) await deadline.wait('paint-cleanup', () => cleanup)
      else void cleanup.catch(() => undefined)
    } finally { if (!observation) deadline.dispose() }
  }
}
