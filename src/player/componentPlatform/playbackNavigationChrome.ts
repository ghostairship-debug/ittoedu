import type { TeacherControllerPort } from '../../shared/contracts/component-platform'

const navigationHeight = 52

/** Host space outside the authored presentation; the original fit owner uses this viewport. */
export function createPlaybackNavigationContent(root: HTMLElement): HTMLElement {
  const content = root.ownerDocument.createElement('div')
  content.dataset.playbackNavigationContent = ''
  Object.assign(content.style, { position: 'absolute', inset: '0', bottom: `${navigationHeight}px`, overflow: 'hidden', minWidth: '0', minHeight: '0' })
  if (root.ownerDocument.defaultView?.getComputedStyle(root).position === 'static') root.style.position = 'relative'
  root.append(content)
  return content
}

/** Pointer chrome consumes the existing student navigation port; it owns no page/step state. */
export function mountPlaybackNavigationChrome(root: HTMLElement, navigation: TeacherControllerPort,
  options: { content: HTMLElement; active?(): boolean; report?(message: string): void }) {
  const dom = root.ownerDocument, bar = dom.createElement('nav'), progress = dom.createElement('span')
  bar.dataset.playbackChrome = 'navigation'
  bar.setAttribute('aria-label', '演示导航')
  Object.assign(bar.style, { position: 'absolute', left: '0', right: '0', bottom: '0', height: `${navigationHeight}px`, boxSizing: 'border-box',
    display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '4px 12px', background: '#f8fafc', color: '#0f172a',
    borderTop: '1px solid #cbd5e1', font: '14px system-ui, sans-serif', zIndex: '10' })
  progress.setAttribute('aria-live', 'polite')
  progress.style.fontVariantNumeric = 'tabular-nums'
  let busy = false, disposed = false
  const makeButton = (type: 'step.previous' | 'step.next', label: string) => {
    const button = dom.createElement('button')
    button.type = 'button'; button.textContent = label; button.setAttribute('aria-label', label)
    Object.assign(button.style, { minWidth: '92px', minHeight: '44px', border: '1px solid #94a3b8', borderRadius: '8px',
      background: '#fff', color: '#0f172a', font: 'inherit', cursor: 'pointer', touchAction: 'manipulation' })
    button.addEventListener('click', () => {
      if (disposed || busy || !navigation.canExecute({ type })) return
      busy = true; sync()
      void navigation.execute({ type }).catch(error => options.report?.(String(error))).finally(() => { busy = false; if (!disposed) sync() })
    })
    return button
  }
  const previous = makeButton('step.previous', '上一步'), next = makeButton('step.next', '下一步')
  bar.append(previous, progress, next); root.append(bar)
  const sync = () => {
    if (disposed) return
    const snapshot = navigation.read(), current = snapshot.progress
    const visible = options.active?.() !== false && Boolean(current && (current.sceneCount > 1 || current.stepCount > 1))
    bar.hidden = !visible; bar.style.display = visible ? 'flex' : 'none'
    options.content.style.bottom = visible ? `${navigationHeight}px` : '0'
    progress.textContent = current ? `${current.sceneIndex + 1} / ${current.sceneCount}` : ''
    for (const [button, type] of [[previous, 'step.previous'], [next, 'step.next']] as const) {
      button.disabled = busy || !navigation.canExecute({ type })
      button.style.opacity = button.disabled ? '.45' : '1'
      button.style.cursor = button.disabled ? 'default' : 'pointer'
    }
  }
  const off = navigation.subscribe(sync); sync()
  return { sync, destroy() { if (disposed) return; disposed = true; off(); bar.remove(); options.content.style.bottom = '0' } }
}
