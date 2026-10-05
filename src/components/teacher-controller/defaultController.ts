import type { ComponentInstance, MountedComponent } from '../../shared/contracts/component-platform'
import type { TeacherControllerAction } from '../../shared/teacherControllerConfig'
import type { TeacherControllerData, TeacherControllerRuntimeContext } from './types'

/** The mature editable UI and the preloaded implementation share this module. */
export function mount(context: TeacherControllerRuntimeContext): MountedComponent<TeacherControllerData> {
  const root = context.root
  if (!root) throw new Error('教师控制台需要全局 Overlay 容器')
  const doc = root.ownerDocument, host = context.teacherController
  let current = context.instance, disposed = false, open: 'directory' | 'zoom' | null = null
  const css = doc.createElement('style'), panel = doc.createElement('nav')
  panel.setAttribute('aria-label', '教师控制台')
  css.textContent = `
    .guoling-controller{position:absolute;right:0;bottom:0;display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:8px;border:1px solid color-mix(in srgb,var(--ink) 15%,transparent);border-radius:var(--radius);background:var(--paper);color:var(--ink);box-shadow:0 12px 36px #0f172a26,0 2px 6px #0f172a14;font:500 13px/1.4 system-ui,"Microsoft YaHei",sans-serif;pointer-events:auto;cursor:grab;touch-action:none;isolation:isolate;box-sizing:border-box}
    .guoling-controller[hidden]{display:none}.guoling-controller *{box-sizing:border-box}.guoling-controller button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:40px;height:40px;flex-shrink:0;padding:0 11px;border:1px solid transparent;border-radius:11px;background:transparent;color:inherit;font:inherit;cursor:pointer;pointer-events:auto;white-space:nowrap;transition:background .15s,box-shadow .15s}
    .guoling-controller button:hover:not(:disabled){background:color-mix(in srgb,var(--ink) 10%,transparent)}.guoling-controller button:active:not(:disabled){background:color-mix(in srgb,var(--ink) 16%,transparent)}
    .guoling-controller button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.guoling-controller button:disabled{opacity:.32;cursor:default}.guoling-controller svg{width:19px;height:19px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .guoling-controller .launcher{width:46px;height:46px;padding:0;border-radius:50%;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
    .guoling-controller .identity{display:flex;flex-direction:column;justify-content:center;gap:3px;min-width:90px;max-width:180px;cursor:grab;touch-action:none;pointer-events:auto}.guoling-controller .identity strong{font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.guoling-controller .progress{font-size:11px;opacity:.65;font-variant-numeric:tabular-nums}.guoling-controller .track{height:2px;border-radius:2px;background:color-mix(in srgb,var(--ink) 12%,transparent);overflow:hidden}.guoling-controller .track i{display:block;height:100%;background:var(--accent);border-radius:2px}
    .guoling-controller .group{display:flex;align-items:center;gap:4px}.guoling-controller .steps{margin-left:4px;padding-left:12px;border-left:1px solid color-mix(in srgb,var(--ink) 14%,transparent)}.guoling-controller .tools{margin-left:auto;flex-wrap:wrap;justify-content:flex-end}
    .guoling-controller .primary{background:var(--accent);color:var(--accent-ink);padding:0 18px;font-weight:650}.guoling-controller .primary:hover:not(:disabled){background:var(--accent);box-shadow:inset 0 0 0 100px #ffffff1f}.guoling-controller button[aria-expanded=true]{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
    .guoling-controller .launcher{order:4;margin-left:auto}.guoling-controller.collapsed{width:52px;height:52px;min-height:52px;padding:2px;gap:0;border-radius:50%}.guoling-controller.collapsed .launcher{width:46px;height:46px}.guoling-controller.compact .identity{display:none}
    .guoling-controller .popover{position:absolute;bottom:calc(100% + 12px);right:0;width:320px;max-width:calc(100vw - 24px);padding:12px;border-radius:16px;border:1px solid color-mix(in srgb,var(--ink) 16%,transparent);background:var(--paper-solid);color:var(--ink);box-shadow:0 16px 48px #0f172a33;pointer-events:auto}.guoling-controller .popover header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 0 8px 8px;font-weight:650}.guoling-controller .popover header small{font-size:11px;opacity:.55;font-weight:400;margin-left:8px}.guoling-controller .popover header button{width:30px;min-width:30px;height:30px;padding:0}.guoling-controller .scene-list{display:flex;flex-direction:column;gap:3px;max-height:300px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}.guoling-controller .scene-row{width:100%;justify-content:flex-start;min-height:42px;height:auto;padding:9px 10px;white-space:normal;text-align:left}.guoling-controller .scene-row span{overflow:hidden;text-overflow:ellipsis}.guoling-controller .scene-row em{min-width:25px;font-style:normal;font-size:11px;opacity:.55;font-variant-numeric:tabular-nums}.guoling-controller .scene-row[aria-current=page]{background:color-mix(in srgb,var(--accent) 17%,transparent);color:var(--accent)}.guoling-controller .zoom-row{display:flex;align-items:center;justify-content:space-between;gap:8px}.guoling-controller .zoom-value{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}.guoling-controller .reset{width:100%;margin-top:8px;background:color-mix(in srgb,var(--ink) 6%,transparent)}
    @container controller (max-width:760px){.guoling-controller{gap:6px}.guoling-controller .identity{max-width:110px}.guoling-controller .steps{padding-left:6px;margin-left:0}.guoling-controller .tools{gap:0}.guoling-controller button{padding:0 8px;min-width:36px}.guoling-controller .primary{padding:0 12px}}
    @container controller (max-width:560px){.guoling-controller:not(.collapsed){flex-wrap:wrap}.guoling-controller .identity{max-width:none;flex:1}.guoling-controller .steps{border-left:0;margin-left:auto}.guoling-controller .tools{width:calc(100% - 58px);margin-left:0;justify-content:center;border-top:1px solid color-mix(in srgb,var(--ink) 12%,transparent);padding-top:5px}}
    @media(prefers-reduced-motion:reduce){.guoling-controller button{transition:none}}
  `
  root.append(css, panel)
  // The visible panel anchors inside the saved frame, as the former host's
  // footprint shift did. Collapsing never changes the instance's author geometry.
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', containerType: 'inline-size', containerName: 'controller' })
  if (!host) panel.dataset.navigationDiagnostic = '导航宿主尚未连接'
  const live = () => !disposed && context.scope.isActive() && !context.scope.signal.aborted
  const interactive = () => live() && !!host && host.read().interactive !== false
  const paths: Record<string, string> = { panel: 'M4 5h16v14H4z M9 5v14 M12 9h5 M12 13h5', left: 'm14 6-6 6 6 6', right: 'm9 6 6 6-6 6', previous: 'm12 6-6 6 6 6 M18 6l-6 6 6 6', next: 'm6 6 6 6-6 6 M12 6l6 6-6 6', list: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01', replay: 'M4 10a8 8 0 1 1 1 8 M4 4v6h6', sound: 'm11 5-5 4H3v6h3l5 4z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14', muted: 'm11 5-5 4H3v6h3l5 4z M16 9l5 6 M21 9l-5 6', full: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5', zoom: 'M16 16l5 5 M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12', minus: 'M5 12h14', plus: 'M5 12h14 M12 5v14', close: 'm6 6 12 12 M18 6 6 18' }
  function icon(name: string) {
    const element = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = doc.createElementNS(element.namespaceURI, 'path')
    element.setAttribute('viewBox', '0 0 24 24'); element.setAttribute('aria-hidden', 'true'); path.setAttribute('d', paths[name] ?? paths.panel!)
    element.append(path); return element
  }
  function button(label: string, glyph: string | null, run: () => void, text?: string, id = label) {
    const node = doc.createElement('button')
    node.type = 'button'; node.title = label; node.setAttribute('aria-label', label); node.dataset.control = id
    if (glyph) node.append(icon(glyph))
    if (text) { const caption = doc.createElement('span'); caption.textContent = text; node.append(caption) }
    node.disabled = !host
    node.onclick = () => { if (interactive()) run() }
    return node
  }
  function perform(action: TeacherControllerAction) {
    if (!interactive() || !host?.canExecute(action)) return
    void host.execute(action).then(ok => { if (!live()) return; if (ok) open = null; render() }, error => {
      if (live()) panel.dataset.navigationDiagnostic = error instanceof Error ? error.message : '导航未完成'
    })
  }
  function closePopup() { open = null; render() }
  function toggle(name: 'directory' | 'zoom') { open = open === name ? null : name; render() }
  function fitPopup() {
    const popup = panel.querySelector<HTMLElement>('.popover')
    if (!popup) return
    popup.style.left = ''; popup.style.right = '0'; popup.style.top = ''; popup.style.bottom = 'calc(100% + 12px)'
    const scale = root.getBoundingClientRect().width / Math.max(1, root.offsetWidth), frame = panel.getBoundingClientRect()
    const view = host?.viewportBounds?.() ?? { left: 0, top: 0, right: doc.documentElement.clientWidth, bottom: doc.documentElement.clientHeight }
    popup.style.maxWidth = `${Math.max(0, view.right - view.left - 24) / Math.max(.01, scale)}px`
    const bounds = popup.getBoundingClientRect()
    const shift = Math.max(view.left + 12 - bounds.left, Math.min(0, view.right - 12 - bounds.right))
    popup.style.right = `${-shift / Math.max(.01, scale)}px`
    const above = frame.top - view.top - 24, below = view.bottom - frame.bottom - 24, useBelow = above < 160 && below > above
    if (useBelow) { popup.style.top = 'calc(100% + 12px)'; popup.style.bottom = 'auto' }
    const list = popup.querySelector<HTMLElement>('.scene-list')
    if (list) list.style.maxHeight = `${Math.max(60, Math.min(300, (useBelow ? below : above) / Math.max(.01, scale) - 64))}px`
  }
  let drag: { pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null, suppressClick = false
  const endDrag = () => { drag = null }
  const down = (event: PointerEvent) => {
    if (!interactive() || event.button !== 0 || (event.target as Element | null)?.closest('.popover')) return
    suppressClick = false
    ;((event.target as Element | null)?.closest('button') ?? panel).setPointerCapture?.(event.pointerId)
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false }
  }
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (!interactive()) { endDrag(); return }
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
    drag.moved = true; suppressClick = true; panel.setPointerCapture?.(event.pointerId)
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y
    drag.x = event.clientX; drag.y = event.clientY; host!.moveBy(dx, dy)
  }
  const suppressDragClick = (event: MouseEvent) => { if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false } }
  panel.addEventListener('pointerdown', down); panel.addEventListener('pointermove', move); panel.addEventListener('click', suppressDragClick, true)
  doc.addEventListener('pointerup', endDrag); doc.addEventListener('pointercancel', endDrag)
  function render() {
    if (!live()) return
    const props = current.data, state = host?.read()
    panel.hidden = props.enabled === false
    if (panel.hidden) { open = null; endDrag(); panel.replaceChildren(); return }
    if (!interactive()) { open = null; endDrag() }
    const active = doc.activeElement?.shadowRoot?.activeElement ?? doc.activeElement, focus = panel.contains(active) ? (active as HTMLElement).dataset.control : undefined
    const variant = props.sceneStyles?.[state?.locationId ?? ''] ?? {}, data = { ...props, ...variant }, style = { ...props.style, ...variant.style }
    const collapsed = Boolean(data.collapsible && (state?.collapsed ?? data.defaultCollapsed))
    if (collapsed) open = null
    panel.className = `guoling-controller${collapsed ? ' collapsed' : ''}${data.compact ? ' compact' : ''}`
    const themed = (name: string, fallback: string) => doc.defaultView?.getComputedStyle(root).getPropertyValue(name).trim() || fallback
    const ink = style.textColor || themed('--color-text', '#f3eee0'), paper = style.backgroundColor || themed('--color-background', '#252c3d'), accent = style.accentColor || themed('--color-accent', '#d9bf73')
    panel.style.setProperty('--ink', ink); panel.style.setProperty('--paper-solid', paper); panel.style.setProperty('--accent', accent)
    panel.style.setProperty('--accent-ink', /^#[0-9a-f]{6}$/i.test(accent) && (parseInt(accent.slice(1, 3), 16) * 299 + parseInt(accent.slice(3, 5), 16) * 587 + parseInt(accent.slice(5, 7), 16) * 114) / 1000 < 145 ? '#fff' : '#172033')
    panel.style.setProperty('--paper', `color-mix(in srgb,${paper} ${Math.round((style.backgroundOpacity ?? 1) * 100)}%,transparent)`)
    panel.style.setProperty('--radius', `${Math.max(0, style.cornerRadius ?? 16)}px`)
    const image = data.backgroundAssetId ? context.resources?.url(data.backgroundAssetId) : undefined
    panel.style.backgroundImage = image ? `url(${JSON.stringify(image)})` : 'none'; panel.style.backgroundSize = 'cover'
    panel.replaceChildren()
    const launcher = button(collapsed ? '展开教师控制器' : '收起教师控制器', null, () => { open = null; host!.setCollapsed(!collapsed); render() }, collapsed ? '展' : '收', 'collapse')
    launcher.className = 'launcher'; launcher.setAttribute('aria-expanded', String(!collapsed))
    if (data.collapsible || collapsed) panel.append(launcher)
    if (collapsed) return
    const identity = doc.createElement('div'); identity.className = 'identity'; identity.title = '拖动教师控制台'
    const title = doc.createElement('strong'); title.textContent = data.title || '教师控制台'; identity.append(title)
    if (data.showSceneProgress && state?.progress) {
      const value = state.progress, progress = doc.createElement('span'); progress.className = 'progress'
      progress.textContent = `${value.sceneIndex + 1} / ${value.sceneCount} 页 · ${value.stepIndex + 1} / ${value.stepCount} 步`
      const track = doc.createElement('div'), fill = doc.createElement('i'); track.className = 'track'; fill.style.width = `${(value.sceneIndex + 1) / Math.max(1, value.sceneCount) * 100}%`; track.append(fill); identity.append(progress, track)
    }
    panel.append(identity)
    const steps = doc.createElement('div'), tools = doc.createElement('div'); steps.className = 'group steps'; tools.className = 'group tools'; panel.append(steps, tools)
    const specs = [...data.buttons]
    if (!specs.some(spec => spec.action.type === 'step.next' || spec.action.type === 'step.previous')) specs.unshift({ id: 'step-previous', label: '上一步', visible: true, action: { type: 'step.previous' } }, { id: 'step-next', label: '下一步', visible: true, action: { type: 'step.next' } })
    const glyphs: Record<string, string> = { 'step.previous': 'left', 'step.next': 'right', 'scene.previous': 'previous', 'scene.next': 'next', 'scene.open-picker': 'list', 'scene.replay': 'replay', 'course.restart': 'replay', 'audio.toggle-mute': state?.muted ? 'muted' : 'sound', 'player.fullscreen.toggle': 'full' }
    for (const spec of specs) {
      if (!spec.visible) continue
      const type = spec.action.type, picker = type === 'scene.open-picker'
      const node = button(spec.label, glyphs[type] ?? null, () => picker ? toggle('directory') : perform(spec.action), type.startsWith('step.') ? spec.label : picker ? '目录' : !glyphs[type] ? spec.label : undefined, spec.id)
      node.dataset.controllerButtonId = spec.id; node.disabled ||= !host?.canExecute(spec.action)
      if (type === 'step.next') node.className = 'primary'
      if (picker) node.setAttribute('aria-expanded', String(open === 'directory'))
      if (type === 'audio.toggle-mute') node.setAttribute('aria-pressed', String(state?.muted ?? false))
      if (type === 'player.fullscreen.toggle') node.setAttribute('aria-pressed', String(state?.fullscreen ?? false))
      ;(type.startsWith('step.') ? steps : tools).append(node)
    }
    const zoom = button('缩放', null, () => toggle('zoom'), `${Math.round((state?.zoom ?? 1) * 100)}%`, 'zoom')
    zoom.setAttribute('aria-expanded', String(open === 'zoom')); tools.append(zoom)
    if (open && host && state) {
      const popup = doc.createElement('section'); popup.className = 'popover'; popup.setAttribute('role', 'dialog'); popup.dataset.coursewareKeyboardCapture = 'true'
      popup.setAttribute('aria-label', open === 'directory' ? '场景目录' : '缩放设置')
      const header = doc.createElement('header'), caption = doc.createElement('span'); caption.textContent = open === 'directory' ? '场景目录' : '视图缩放'; header.append(caption, button('关闭面板', 'close', closePopup, undefined, 'close-popup')); popup.append(header)
      if (open === 'directory') {
        const count = doc.createElement('small'); count.textContent = `${state.scenes.length} 页`; caption.append(count)
        const list = doc.createElement('div'); list.className = 'scene-list'
        for (const [index, scene] of state.scenes.entries()) {
          const node = button(scene.name, null, () => perform({ type: 'scene.go', sceneId: scene.id }), undefined, `scene-${scene.id}`); node.className = 'scene-row'; node.disabled ||= !host.canExecute({ type: 'scene.go', sceneId: scene.id })
          const number = doc.createElement('em'), label = doc.createElement('span'); number.textContent = String(index + 1).padStart(2, '0'); label.textContent = scene.name; node.append(number, label)
          if (scene.id === state.locationId) node.setAttribute('aria-current', 'page')
          list.append(node)
        }
        popup.append(list)
      } else {
        popup.style.width = '240px'
        const row = doc.createElement('div'), value = doc.createElement('span'); row.className = 'zoom-row'; value.className = 'zoom-value'; value.textContent = `${Math.round(state.zoom * 100)}%`
        row.append(button('缩小', 'minus', () => host.setZoom(state.zoom - .25), undefined, 'zoom-out'), value, button('放大', 'plus', () => host.setZoom(state.zoom + .25), undefined, 'zoom-in'))
        const reset = button('恢复默认视图', null, () => host.resetView(), '恢复默认视图', 'reset-view'); reset.className = 'reset'; popup.append(row, reset)
      }
      panel.append(popup); fitPopup()
    }
    if (focus) for (const node of panel.querySelectorAll<HTMLButtonElement>('button')) if (node.dataset.control === focus) node.focus({ preventScroll: true })
  }
  const outside = (event: PointerEvent) => { if (open && !event.composedPath().includes(root)) closePopup() }
  const escape = (event: KeyboardEvent) => { if (open && event.key === 'Escape') { event.preventDefault(); closePopup() } }
  doc.addEventListener('pointerdown', outside, true); root.addEventListener('keydown', escape); doc.defaultView?.addEventListener('resize', fitPopup)
  const Observer = doc.defaultView?.ResizeObserver, observer = Observer ? new Observer(fitPopup) : undefined
  observer?.observe(root)
  const unsubscribe = host?.subscribe(render), unsubscribeLayout = context.layout?.subscribe(render)
  const dispose = () => {
    if (disposed) return
    disposed = true; endDrag(); unsubscribe?.(); unsubscribeLayout?.(); observer?.disconnect()
    panel.removeEventListener('pointerdown', down); panel.removeEventListener('pointermove', move); panel.removeEventListener('click', suppressDragClick, true)
    doc.removeEventListener('pointerup', endDrag); doc.removeEventListener('pointercancel', endDrag); doc.removeEventListener('pointerdown', outside, true)
    root.removeEventListener('keydown', escape); doc.defaultView?.removeEventListener('resize', fitPopup); panel.remove(); css.remove()
  }
  context.scope.cleanup(dispose)
  render()
  return { update(instance: ComponentInstance<TeacherControllerData>) { current = instance; render() }, updatePlacement() { render() }, dispose }
}

export default { mount }
