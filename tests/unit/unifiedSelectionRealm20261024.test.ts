import { afterEach, expect, it, vi } from 'vitest'
import { installAuthoringInputArbitration, installOwnedDocumentAuthoring } from '../../src/components/web/ownedDocumentAuthoring'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { createAuthoringFrameGeometry } from '../../src/components/web/authoringFrame'

const releases: Array<() => void> = []
afterEach(() => { for (const release of releases.splice(0).reverse()) release(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function property(owner: object, key: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key)
  Object.defineProperty(owner, key, { configurable: true, value })
  releases.push(() => { if (descriptor) Object.defineProperty(owner, key, descriptor); else Reflect.deleteProperty(owner, key) })
}

function pointer(target: EventTarget, type: string, x = 10, y = 20, pointerId = 7) {
  const event = new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true, shiftKey: true })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  target.dispatchEvent(event)
  return event
}

it('selects at the first press, forwards the same gesture through release, and edits only on dblclick before business listeners', () => {
  document.body.innerHTML = '<button>Business action</button>'
  const button = document.querySelector('button')!, select = vi.fn(), edit = vi.fn(), extend = vi.fn(), gesture = vi.fn(), business = vi.fn()
  let authoring = true
  // Parser realms execute this exact serialized function without module scope.
  const install = new Function(`return (${installAuthoringInputArbitration.toString()})`)() as typeof installAuthoringInputArbitration
  releases.push(install(document, { editing: () => authoring, select, edit, extend, gesture }))
  button.addEventListener('pointerdown', business); button.addEventListener('click', business); button.addEventListener('dblclick', business)
  const down = pointer(button, 'pointerdown')
  pointer(button, 'mousedown'); pointer(button, 'pointermove', 18, 23); pointer(button, 'pointerup', 30, 40); pointer(button, 'mouseup'); pointer(button, 'click')
  expect(select).toHaveBeenCalledTimes(1)
  expect(down.defaultPrevented).toBe(true)
  expect(gesture.mock.calls.map(call => [call[2], call[0]])).toEqual([
    ['start', { x: 10, y: 20 }], ['update', { x: 18, y: 23 }], ['end', { x: 30, y: 40 }],
  ])
  pointer(button, 'pointerdown'); pointer(button, 'pointerup'); pointer(button, 'click')
  expect(edit).not.toHaveBeenCalled(); expect(extend).not.toHaveBeenCalled()
  pointer(button, 'dblclick')
  expect(edit).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledTimes(2); expect(business).not.toHaveBeenCalled()
  authoring = false
  pointer(button, 'pointerdown'); pointer(button, 'click')
  expect(business).toHaveBeenCalledTimes(2)
})

it('extends text only inside the current content input and allows another target to start a geometry gesture', () => {
  const select = vi.fn(), edit = vi.fn(), extend = vi.fn(), gesture = vi.fn()
  releases.push(installAuthoringInputArbitration(document, {
    editing: () => true, contentEditing: point => point.x < 50, select, edit, extend, gesture,
  }))
  pointer(document.body, 'pointerdown', 10); pointer(document.body, 'pointermove', 30); pointer(document.body, 'pointerup', 40); pointer(document.body, 'click')
  expect(extend.mock.calls.map(call => call[0].x)).toEqual([30, 40]); expect(gesture).not.toHaveBeenCalled()
  pointer(document.body, 'pointerdown', 60); pointer(document.body, 'pointermove', 80); pointer(document.body, 'pointerup', 90)
  expect(gesture.mock.calls.map(call => call[2])).toEqual(['start', 'update', 'end'])
  expect(extend).toHaveBeenCalledTimes(2)
})

it('forwards an author context menu at its exact point without starting input or a drag', () => {
  const select = vi.fn(), edit = vi.fn(), gesture = vi.fn(), contextMenu = vi.fn(), business = vi.fn()
  releases.push(installAuthoringInputArbitration(document, { editing: () => true, select, edit, gesture, contextMenu }))
  document.body.addEventListener('contextmenu', business)
  releases.push(() => document.body.removeEventListener('contextmenu', business))
  const event = new MouseEvent('contextmenu', { button: 2, clientX: 45, clientY: 67, bubbles: true, cancelable: true })
  document.body.dispatchEvent(event)
  expect(contextMenu).toHaveBeenCalledWith({ x: 45, y: 67 }, event)
  expect(select).not.toHaveBeenCalled(); expect(edit).not.toHaveBeenCalled(); expect(gesture).not.toHaveBeenCalled()
  expect(business).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(true)
})

it.each(['pointercancel', 'lostpointercapture', 'Escape'])('cancels %s without forwarding a later successful release', reason => {
  const gesture = vi.fn(), setCapture = vi.fn(), releaseCapture = vi.fn()
  property(document.documentElement, 'setPointerCapture', setCapture)
  property(document.documentElement, 'releasePointerCapture', releaseCapture)
  releases.push(installAuthoringInputArbitration(document, { editing: () => true, select: vi.fn(), gesture }))
  pointer(document.body, 'pointerdown'); pointer(document.body, 'pointermove', 30)
  if (reason === 'Escape') document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  else pointer(document.body, reason)
  pointer(document.body, 'pointerup', 40)
  expect(gesture.mock.calls.map(call => call[2])).toEqual(['start', 'update', 'cancel'])
  expect(gesture.mock.calls[2]?.[0]).toEqual({ x: 30, y: 20 })
  expect(setCapture).toHaveBeenCalledWith(7); expect(releaseCapture).toHaveBeenCalledWith(7)
})

it('preserves author identity and pointer lifecycle while mapping a nested owned document to its parent', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  property(document, 'fonts', new EventTarget())
  document.body.innerHTML = '<iframe srcdoc="<p>Child</p>"></iframe>'
  const frame = document.querySelector('iframe')!, onPointer = vi.fn(), onDoubleClick = vi.fn()
  const frameFactory = () => ({ ...createAuthoringFrameGeometry(), frameMatrix: (): [number, number, number, number, number, number] => [2, 0, 0, 3, 100, 200] })
  const owner = installOwnedDocumentAuthoring('realm-test', '', createDomAuthoring, { observe: true, onPointer, onDoubleClick }, frameFactory)
  releases.push(owner.dispose)
  const send = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
    data: { token: 'realm-test', ...data } }))
  send({ type: 'guoling.authoring.observe', reports: [], width: 300, height: 200 })
  for (const phase of ['start', 'update', 'end', 'cancel']) send({ type: 'guoling.authoring.pointer', phase, pointerId: 12,
    authorKey: 'stable-child-key', caretOffset: 3, x: 10, y: 20, button: 0, shiftKey: true })
  expect(onPointer.mock.calls.map(call => call[0])).toEqual(['start', 'update', 'end', 'cancel'].map(phase => ({
    phase, pointerId: 12, authorKey: 'stable-child-key', caretOffset: 3, x: 120, y: 260,
    button: 0, shiftKey: true, altKey: false, ctrlKey: false, metaKey: false,
  })))
  expect(onDoubleClick).not.toHaveBeenCalled()
  send({ type: 'guoling.authoring.double-click', authorKey: 'stable-child-key', x: 10, y: 20 })
  expect(onDoubleClick).toHaveBeenCalledWith(expect.objectContaining({ authorKey: 'stable-child-key', x: 120, y: 260 }))
})
