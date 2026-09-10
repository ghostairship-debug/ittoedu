import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeRuntimeDomControls, resolveRuntimeDomButton } from '@/renderer/authoring/generation/runtimeDomControlObservation'

const originalHitDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
afterEach(() => {
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (originalHitDescriptor) Object.defineProperty(document, 'elementFromPoint', originalHitDescriptor)
  else Reflect.deleteProperty(document, 'elementFromPoint')
})

function box(element: HTMLElement, x = 40, y = 60, width = 120, height = 40) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x, y, width, height, left: x, top: y,
    right: x + width, bottom: y + height, toJSON: () => ({}) })
}
function mounted(carrier: 'runtime' | 'component' = 'runtime') {
  const root = document.createElement('main'), mount = document.createElement('section')
  mount.setAttribute(`data-${carrier}-instance-id`, 'actual-target'); root.append(mount); document.body.append(root)
  box(root, 0, 0, 700, 500); box(mount, 20, 20, 400, 300)
  return { root, mount }
}
function hit(element: Element | null) {
  const fn = vi.fn(() => element)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: fn })
  return fn
}

describe('current Runtime DOM controls are observations, not interaction verdicts', () => {
  it('resolves one exact scoped button without dispatching input and rejects ambiguity, disabled and occluded controls', () => {
    const { root, mount } = mounted(), button = document.createElement('button')
    button.textContent = '显示答案'; mount.append(button); box(button); hit(button)
    const clicked = vi.fn(); button.addEventListener('click', clicked)
    expect(resolveRuntimeDomButton(root, 'actual-target', '显示答案')).toMatchObject({ element: button, x: 100, y: 80 })
    expect(clicked).not.toHaveBeenCalled()
    expect(() => resolveRuntimeDomButton(root, 'another-instance', '显示答案')).toThrow('实际找到 0 个')
    button.disabled = true
    expect(() => resolveRuntimeDomButton(root, 'actual-target', '显示答案')).toThrow('不可操作')
    button.disabled = false
    const duplicate = button.cloneNode(true) as HTMLButtonElement; mount.append(duplicate); box(duplicate)
    expect(() => resolveRuntimeDomButton(root, 'actual-target', '显示答案')).toThrow('实际找到 2 个')
    duplicate.remove(); hit(mount)
    expect(() => resolveRuntimeDomButton(root, 'actual-target', '显示答案')).toThrow('被遮挡')
    expect(clicked).not.toHaveBeenCalled()
  })
  it('reads only current visible answer text across open shadow roots without CSS or duplicate parent content', () => {
    const { root, mount } = mounted(), host = document.createElement('div')
    mount.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const styles = [document.createElement('style'), document.createElement('style')]
    for (const style of styles) {
      style.textContent = '.non-visible-css { color: red; }'.repeat(100)
      // Chromium exposes style source through style.innerText even though the
      // style element is not rendered; reproduce that boundary in jsdom.
      Object.defineProperty(style, 'innerText', { configurable: true, get: () => style.textContent })
    }
    const content = document.createElement('div'), button = document.createElement('button')
    button.innerHTML = '<span>显示</span><span>答案</span>'
    const answer = document.createElement('p'); answer.innerHTML = '答案：<strong>42</strong>'
    const hidden = document.createElement('span'); hidden.style.display = 'none'; hidden.textContent = '不可见说明'
    const invisible = document.createElement('p'); invisible.style.visibility = 'hidden'; invisible.textContent = '不可见答案'
    const restored = document.createElement('span'); restored.style.visibility = 'visible'; restored.textContent = '重新显示的提示'; invisible.append(restored)
    const details = document.createElement('details'); details.innerHTML = '<summary>解析入口</summary><p>折叠答案：99</p>'
    const script = document.createElement('script'); script.textContent = 'notVisibleScript()'
    const template = document.createElement('template'); template.innerHTML = '<p>模板中的答案</p>'
    const otherOwner = document.createElement('section'); otherOwner.dataset.componentInstanceId = 'another-target'; otherOwner.textContent = '其他实例答案'
    const nestedHost = document.createElement('div'), nestedShadow = nestedHost.attachShadow({ mode: 'open' })
    const slotted = document.createElement('span'); slotted.slot = 'caption'; slotted.textContent = '当前实例说明'
    const unslotted = document.createElement('span'); unslotted.textContent = '没有显示的 light DOM'
    nestedHost.append(slotted, unslotted); nestedShadow.innerHTML = '<slot name="caption">插槽后备文本</slot>'
    content.append(button, answer, hidden, script, template, otherOwner, nestedHost, invisible, details); shadow.append(...styles, content)
    Object.defineProperty(content, 'innerText', { configurable: true, get: () => `显示答案\n${answer.textContent}\n当前实例说明` })
    Object.defineProperty(mount, 'innerText', { configurable: true, get: () => content.innerText })
    box(host, 20, 20, 400, 300); box(button); hit(host)
    Object.defineProperty(shadow, 'elementFromPoint', { configurable: true, value: vi.fn(() => button) })
    const clicked = vi.fn(); button.addEventListener('click', clicked)
    const resolved = resolveRuntimeDomButton(root, 'actual-target', '显示答案')
    expect(resolved.readText()).toEqual({ text: '显示答案\n答案：42\n当前实例说明\n重新显示的提示\n解析入口', truncated: false })
    answer.querySelector('strong')!.textContent = '43'
    details.open = true
    expect(resolved.readText()).toEqual({ text: '显示答案\n答案：43\n当前实例说明\n重新显示的提示\n解析入口\n折叠答案：99', truncated: false })
    root.style.display = 'none'
    expect(resolved.readText()).toEqual({ text: '', truncated: false })
    expect(clicked).not.toHaveBeenCalled()
  })
  it('records a correctly hit target and its descendant without clicking, excludes other targets and bounds the output', () => {
    const { root, mount } = mounted(), button = document.createElement('button'), child = document.createElement('span')
    const shadowHost = document.createElement('div'), shadow = shadowHost.attachShadow({ mode: 'open' })
    shadowHost.dataset.canvasRuntimeDomOverlay = 'actual-target'; mount.append(shadowHost); box(shadowHost, 20, 20, 400, 300)
    child.textContent = '显示答案'; button.append(child); shadow.append(button); box(button)
    button.style.pointerEvents = 'auto'
    const clicked = vi.fn(); button.addEventListener('click', clicked)
    const readHit = hit(shadowHost)
    Object.defineProperty(shadow, 'elementFromPoint', { configurable: true, value: vi.fn(() => child) })
    const unrelated = document.createElement('section'); unrelated.dataset.runtimeInstanceId = 'other-target'
    const otherButton = document.createElement('button'); otherButton.textContent = '不在范围'; box(otherButton); unrelated.append(otherButton); root.append(unrelated)
    const hidden = document.createElement('button'); hidden.textContent = '隐藏按钮'; hidden.hidden = true; box(hidden); mount.append(hidden)
    const before = root.outerHTML
    const result = observeRuntimeDomControls(root, [{ instanceId: 'actual-target', carrier: 'runtime' }])
    expect(result).toMatchObject({ clickPerformed: false, functionalResult: 'not-tested', truncated: false,
      instances: [{ instanceId: 'actual-target', visibleControlCount: 1, controls: [{ label: '显示答案', pointerEvents: 'auto', disabled: false,
        bounds: { x: 40, y: 60, width: 120, height: 40 }, centerHit: { status: 'control', point: { x: 100, y: 80 }, element: { tag: 'span', instanceId: 'actual-target', runtimeLayer: 'dom-overlay' } } }] }] })
    expect(result.actionsPerformed).toEqual([]); expect(clicked).not.toHaveBeenCalled(); expect(root.outerHTML).toBe(before)
    expect(readHit).toHaveBeenCalledWith(100, 80)
    for (let i = 0; i < 40; i++) { const extra = document.createElement('button'); box(extra); mount.append(extra) }
    const bounded = observeRuntimeDomControls(root, [{ instanceId: 'actual-target', carrier: 'runtime' }])
    expect(bounded.instances[0]).toMatchObject({ visibleControlCount: 41, truncated: true })
    expect(bounded.instances[0]!.controls).toHaveLength(bounded.limits.maxControls)
    expect(clicked).not.toHaveBeenCalled()
  })

  it('reports the actual intercepting Phaser element and disabled facts without calling the visible button functional', () => {
    const { root, mount } = mounted(), button = document.createElement('button'), phaser = document.createElement('div')
    button.textContent = '显示答案'; button.style.pointerEvents = 'none'; button.disabled = true; button.setAttribute('aria-disabled', 'true')
    phaser.dataset.canvasRuntimePhaser = 'actual-target'; phaser.style.pointerEvents = 'auto'
    box(button); mount.append(button, phaser); hit(phaser)
    const result = observeRuntimeDomControls(root, [{ instanceId: 'actual-target', carrier: 'runtime' }])
    expect(result.instances[0]!.controls[0]).toMatchObject({ pointerEvents: 'none', disabled: true, ariaDisabled: 'true',
      centerHit: { status: 'other-element', element: { tag: 'div', instanceId: 'actual-target', runtimeLayer: 'phaser', pointerEvents: 'auto' } } })
    expect(result.functionalResult).toBe('not-tested'); expect(result.clickPerformed).toBe(false)
  })

  it('reports no visible DOM controls for a canvas component and preserves explicitly unobserved coverage', () => {
    const { root, mount } = mounted('component'); mount.append(document.createElement('canvas'))
    const readHit = hit(null)
    const result = observeRuntimeDomControls(root, [{ instanceId: 'actual-target', carrier: 'component' }])
    expect(result.instances).toEqual([{ instanceId: 'actual-target', carrier: 'component', status: 'no-visible-dom-controls-observed',
      visibleControlCount: 0, truncated: false, controls: [] }])
    expect(result.unobserved).toContain('canvas-interactions'); expect(result.functionalResult).toBe('not-tested')
    expect(readHit).not.toHaveBeenCalled()
  })
})
