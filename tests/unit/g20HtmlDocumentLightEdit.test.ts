import { expect, it } from 'vitest'
import { DomTextOverrides } from '@/player/lightEdit/domTextOverrides'
import { bridgeManagedHtmlEvents } from '@/player/lightEdit/htmlDocumentRoots'
import { RuntimeAuthoringTargetRegistry } from '@/player/RuntimeAuthoringTargetRegistry'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'

const rect = (left: number, top: number, width: number, height: number) => ({
  left, top, right: left + width, bottom: top + height, x: left, y: top, width, height,
  toJSON: () => ({}),
}) as DOMRect

const flush = async () => { for (let index = 0; index < 8; index += 1) await new Promise(resolve => setTimeout(resolve, 0)) }

it('edits only a managed HTML document and maps its text and image into the outer canvas', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  root.getBoundingClientRect = () => rect(0, 0, 640, 360)
  const iframe = document.createElement('iframe')
  iframe.dataset.htmlDocumentRuntime = 'true'
  root.append(iframe)
  const inner = iframe.contentDocument!
  Object.defineProperty(inner.defaultView, 'innerWidth', { configurable: true, value: 400 })
  Object.defineProperty(inner.defaultView, 'innerHeight', { configurable: true, value: 200 })
  iframe.getBoundingClientRect = () => rect(100, 50, 400, 200)
  let textTop = 10
  Object.defineProperty(inner.defaultView!.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(20, textTop, 80, 24) })
  inner.body.innerHTML = '<main><h2>听力练习</h2><img src="data:image/png;base64,SEVSTw=="></main>'
  inner.querySelector('img')!.getBoundingClientRect = () => rect(20, 60, 100, 80)
  const hidden = document.createElement('iframe')
  root.append(hidden)
  hidden.contentDocument!.body.innerHTML = '<h2>不受管内容</h2>'

  const dom = new DomTextOverrides([root], [{ original: '听力练习', text: '听力训练' }])
  dom.applyAll()
  expect(inner.querySelector('h2')!.textContent).toBe('听力训练')
  expect(dom.samples().map(sample => sample.original)).not.toContain('不受管内容')
  const updates: RuntimeAuthoringTargetUpdate[] = []
  const registry = new RuntimeAuthoringTargetRegistry({ scope: 'scene', width: 640, height: 360, canvas: { width: 640, height: 360 },
    content: { values: {} }, assets: { hero: { assetId: 'hero' } },
    domRoots: { underlay: document.createElement('div'), overlay: root },
    lightEdit: { dom, assetKeyForUrl: url => url === 'data:image/png;base64,SEVSTw==' ? 'hero' : undefined },
    onTargetsChanged: update => updates.push(update),
  })
  await flush()
  const targets = updates.at(-1)!.targets
  expect(targets).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'text', label: '听力训练', bounds: { x: 120, y: 60, width: 80, height: 24 } }),
    expect.objectContaining({ kind: 'asset', key: 'hero', bounds: expect.objectContaining({ x: 120, width: 100, height: 80 }) }),
  ]))
  expect(targets.find(target => target.kind === 'asset')!.bounds.y).toBeCloseTo(110)
  textTop = 30
  inner.querySelector('main')!.dispatchEvent(new Event('scroll'))
  await flush()
  expect(updates.at(-1)!.targets.find(target => target.kind === 'text')!.bounds.y).toBe(80)
  const received: MouseEvent[] = []
  root.addEventListener('dblclick', event => received.push(event))
  const stopBridge = bridgeManagedHtmlEvents(root)
  inner.querySelector('h2')!.dispatchEvent(new inner.defaultView!.MouseEvent('dblclick', { bubbles: true, clientX: 20, clientY: 10 }))
  expect(received).toHaveLength(1)
  expect(received[0]!.clientX).toBe(120)
  expect(received[0]!.clientY).toBe(60)
  hidden.contentDocument!.querySelector('h2')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  expect(received).toHaveLength(1)

  inner.body.innerHTML = '<main><h2>听力练习</h2><img src="data:image/png;base64,SEVSTw=="></main>'
  inner.querySelector('img')!.getBoundingClientRect = () => rect(20, 60, 100, 80)
  await flush()
  expect(inner.querySelector('h2')!.textContent).toBe('听力训练')
  expect(updates.at(-1)!.targets.some(target => target.kind === 'asset' && target.key === 'hero')).toBe(true)
  dom.setRules([])
  expect(inner.querySelector('h2')!.textContent).toBe('听力练习')
  stopBridge()
  inner.querySelector('h2')!.dispatchEvent(new inner.defaultView!.MouseEvent('dblclick', { bubbles: true }))
  expect(received).toHaveLength(1)
  iframe.remove()
  await flush()
  expect(updates.at(-1)!.targets).toEqual([])
  const removedRevision = updates.length
  inner.dispatchEvent(new Event('scroll'))
  inner.defaultView!.dispatchEvent(new Event('scroll'))
  await flush()
  expect(updates).toHaveLength(removedRevision)
  registry.destroy(); dom.destroy()
  root.remove()
})

it('a consumed outer gesture cancels the original inner event while ordinary interaction survives', () => {
  const root = document.createElement('div')
  document.body.append(root)
  const iframe = document.createElement('iframe')
  iframe.dataset.htmlDocumentRuntime = 'true'
  root.append(iframe)
  const inner = iframe.contentDocument!
  inner.body.innerHTML = '<button>继续</button>'
  const button = inner.querySelector('button')!
  let innerDoubleClicks = 0
  let innerMenus = 0
  let innerPointers = 0
  button.addEventListener('dblclick', () => { innerDoubleClicks += 1 })
  button.addEventListener('contextmenu', () => { innerMenus += 1 })
  button.addEventListener('pointerdown', () => { innerPointers += 1 })
  root.addEventListener('dblclick', event => event.preventDefault(), true)
  root.addEventListener('contextmenu', event => event.stopPropagation(), true)
  const stop = bridgeManagedHtmlEvents(root)
  const doubleClick = new inner.defaultView!.MouseEvent('dblclick', { bubbles: true, cancelable: true })
  button.dispatchEvent(doubleClick)
  expect(doubleClick.defaultPrevented).toBe(true)
  expect(innerDoubleClicks).toBe(0)
  const menu = new inner.defaultView!.MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  button.dispatchEvent(menu)
  expect(menu.defaultPrevented).toBe(true)
  expect(innerMenus).toBe(0)
  button.dispatchEvent(new inner.defaultView!.MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
  expect(innerPointers).toBe(1)
  stop(); root.remove()
})

it('bridges the full consumed pointer stream and cleans up after up, cancel and teardown', () => {
  const root = document.createElement('div')
  document.body.append(root)
  const iframe = document.createElement('iframe')
  iframe.dataset.htmlDocumentRuntime = 'true'
  root.append(iframe)
  iframe.getBoundingClientRect = () => rect(100, 50, 400, 200)
  const inner = iframe.contentDocument!
  Object.defineProperty(inner.defaultView, 'innerWidth', { configurable: true, value: 400 })
  Object.defineProperty(inner.defaultView, 'innerHeight', { configurable: true, value: 200 })
  inner.body.innerHTML = '<button>继续</button>'
  const button = inner.querySelector('button')!
  const pointer = (type: string, id: number, x: number, y: number) => {
    const event = new inner.defaultView!.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerId', { value: id })
    return event
  }
  const outerMoves: number[] = []
  const outerEnds: string[] = []
  const innerMoves: number[] = []
  root.addEventListener('pointerdown', event => { if ((event as PointerEvent).pointerId === 1) event.preventDefault() }, true)
  root.addEventListener('pointermove', event => outerMoves.push(event.clientX), true)
  root.addEventListener('pointerup', () => outerEnds.push('up'), true)
  root.addEventListener('pointercancel', () => outerEnds.push('cancel'), true)
  button.addEventListener('pointermove', event => innerMoves.push(event.clientX))
  const stop = bridgeManagedHtmlEvents(root)
  button.dispatchEvent(pointer('pointerdown', 1, 5, 5))
  button.dispatchEvent(pointer('pointermove', 1, 20, 10))
  expect(outerMoves).toEqual([120])
  expect(innerMoves).toEqual([])
  button.dispatchEvent(pointer('pointerup', 1, 20, 10))
  expect(outerEnds).toEqual(['up'])
  button.dispatchEvent(pointer('pointermove', 1, 30, 10))
  expect(outerMoves).toEqual([120])
  expect(innerMoves).toEqual([30])
  button.dispatchEvent(pointer('pointerdown', 1, 5, 5))
  button.dispatchEvent(pointer('pointercancel', 1, 20, 10))
  expect(outerEnds).toEqual(['up', 'cancel'])
  button.dispatchEvent(pointer('pointerdown', 1, 5, 5))
  button.dispatchEvent(pointer('lostpointercapture', 1, 20, 10))
  expect(outerEnds).toEqual(['up', 'cancel', 'cancel'])
  button.dispatchEvent(pointer('pointerdown', 1, 5, 5))
  stop()
  expect(outerEnds).toEqual(['up', 'cancel', 'cancel', 'cancel'])
  button.dispatchEvent(pointer('pointermove', 1, 40, 10))
  expect(innerMoves).toEqual([30, 40])
  root.remove()
})
