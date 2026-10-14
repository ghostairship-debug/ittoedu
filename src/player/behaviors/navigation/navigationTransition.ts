import type { ComponentNavigationTransition } from '../../../shared/contracts/component-platform/navigationMotion'

interface NativeTransition { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void>; skipTransition(): void }
type TransitionDocument = Document & { startViewTransition?: (update: () => Promise<void>) => NativeTransition }
let sequence = 0
const active = new WeakMap<Document, () => void>()

/** Presentation only: the supplied navigation owner performs the single fact commit. */
export async function presentNavigationTransition(
  root: HTMLElement, transition: ComponentNavigationTransition,
  commit: () => Promise<boolean>, signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false
  const document = root.ownerDocument as TransitionDocument
  if (!document.startViewTransition) throw new Error('当前浏览器不能运行页面快照转场；请使用支持 View Transitions 的浏览器。页面尚未切换。')
  if (document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) return commit()
  const outgoing = transition.outgoing ?? { keyframes: [{ opacity: 1 }, { opacity: 0 }] }
  const incoming = transition.incoming ?? { keyframes: [{ opacity: 0 }, { opacity: 1 }] }
  const timing = (value: typeof outgoing) => ({ duration: 300, ...value.timing, fill: 'both' as const })
  // Parse submitted keyframes/easing before committing a destination.
  for (const track of [outgoing, incoming]) new KeyframeEffect(null, track.keyframes.map(frame => ({ ...frame })), timing(track))
  active.get(document)?.()
  const name = `guoling-navigation-${++sequence}`, html = document.documentElement
  const previousRoot = [root.style.getPropertyValue('view-transition-name'), root.style.getPropertyPriority('view-transition-name')]
  const previousHtml = [html.style.getPropertyValue('view-transition-name'), html.style.getPropertyPriority('view-transition-name')]
  const style = document.createElement('style')
  style.textContent = `::view-transition { pointer-events:none } ::view-transition-group(${name}), ::view-transition-old(${name}), ::view-transition-new(${name}) { animation:none !important; mix-blend-mode:normal !important }`
  document.head.append(style)
  html.style.setProperty('view-transition-name', 'none', 'important')
  root.style.setProperty('view-transition-name', name, 'important')
  const animations: Animation[] = []
  let native: NativeTransition | undefined, cleaned = false, accepted = false
  const cleanup = () => {
    if (cleaned) return; cleaned = true
    animations.forEach(animation => animation.cancel()); style.remove()
    root.style.setProperty('view-transition-name', previousRoot[0]!, previousRoot[1])
    html.style.setProperty('view-transition-name', previousHtml[0]!, previousHtml[1])
    if (active.get(document) === abort) active.delete(document)
  }
  const abort = () => { native?.skipTransition(); cleanup() }
  active.set(document, abort); signal.addEventListener('abort', abort, { once: true })
  try {
    native = document.startViewTransition(async () => {
      if (signal.aborted) return
      accepted = await commit()
    })
    // Observe every native promise even if cancellation races readiness.
    void native.finished.catch(() => {}); void native.updateCallbackDone.catch(() => {})
    await native.ready
    if (!accepted || signal.aborted) { native.skipTransition(); return false }
    for (const [kind, track] of [['old', outgoing], ['new', incoming]] as const) {
      animations.push(html.animate(track.keyframes.map(frame => ({ ...frame })), { ...timing(track), pseudoElement: `::view-transition-${kind}(${name})` }))
    }
    const completed = await Promise.all(animations.map(animation => animation.finished.then(() => true, () => false)))
    native.skipTransition()
    await native.finished
    return completed.every(Boolean) && !signal.aborted
  } catch (error) {
    native?.skipTransition()
    if (signal.aborted) return false
    throw error
  } finally { signal.removeEventListener('abort', abort); cleanup() }
}
