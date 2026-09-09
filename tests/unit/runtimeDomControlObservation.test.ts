import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeRuntimeDomControls } from '@/renderer/authoring/generation/runtimeDomControlObservation'

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
