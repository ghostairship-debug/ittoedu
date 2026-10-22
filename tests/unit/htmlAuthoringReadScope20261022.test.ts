import { afterEach, expect, it, vi } from 'vitest'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { createNestedDomAuthoring } from '../../src/components/web/nestedAuthoringDom'

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height,
  left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect
const write = (frame: HTMLIFrameElement, source: string) => {
  const child = frame.contentDocument!
  child.open(); child.write(source); child.close()
  return child
}

it('enumerates a local dirty scope without resolving bindings or measuring every target', () => {
  document.body.innerHTML = '<p id="first">First <em>Nested</em></p><img id="image" src="old.png"><script>Not content</script><div id="shadow"></div>'
  const shadow = document.querySelector('#shadow')!.attachShadow({ mode: 'open' }); shadow.innerHTML = '<p>Shadow text</p>'
  const records = vi.fn(() => ({}))
  const adapter = createDomAuthoring(document.documentElement, { records })
  disposers.push(() => adapter.dispose())
  const style = vi.spyOn(window, 'getComputedStyle'), geometry = vi.spyOn(Element.prototype, 'getBoundingClientRect')
  records.mockClear()
  const first = document.querySelector('#first')!.firstChild!, image = document.querySelector<HTMLImageElement>('#image')!
  expect(adapter.targets(first)).toEqual([first])
  expect(adapter.targets(image)).toEqual([image])
  expect(adapter.targets(shadow).map(node => node.textContent)).toEqual(['Shadow text'])
  expect(adapter.targets().map(node => node.nodeType === 3 ? node.textContent : (node as Element).id)).toEqual(['First ', 'Nested', 'image', 'Shadow text'])
  expect(adapter.targets(document)).toEqual(adapter.targets())
  expect(adapter.targets(document.createTextNode('Detached'))).toEqual([])
  const foreign = document.implementation.createHTMLDocument('Foreign')
  foreign.body.textContent = 'Foreign text'
  expect(adapter.targets(foreign.body)).toEqual([])
  expect(records).not.toHaveBeenCalled()
  expect(style).not.toHaveBeenCalled()
  expect(geometry).not.toHaveBeenCalled()
})

it('enumerates only the requested iframe subtree across its accessible descendant documents', () => {
  document.body.innerHTML = '<p>Outer text</p><iframe id="left"></iframe><iframe id="right"></iframe>'
  const left = document.querySelector<HTMLIFrameElement>('#left')!, right = document.querySelector<HTMLIFrameElement>('#right')!
  const child = write(left, '<p>Child text</p><iframe id="grandchild"></iframe>')
  const grandchild = write(child.querySelector('iframe')!, '<p>Grandchild text</p>')
  write(right, '<p>Sibling text</p>')
  const adapter = createNestedDomAuthoring(document.documentElement, createDomAuthoring, { records: () => ({}) })
  disposers.push(() => adapter.dispose())
  expect(adapter.targets(left).map(node => node.textContent)).toEqual(['Child text', 'Grandchild text'])
  const text = grandchild.querySelector('p')!.firstChild!
  expect(adapter.targets(text)).toEqual([text])
  expect(adapter.targets(document).map(node => node.textContent)).toEqual(['Outer text', 'Child text', 'Grandchild text', 'Sibling text'])
})

it('shares the nested document transform only within one synchronous report batch', () => {
  document.body.innerHTML = '<iframe></iframe>'
  const frame = document.querySelector('iframe')!, child = write(frame, '<p>Text</p>'), text = child.querySelector('p')!.firstChild!
  let frameX = 100
  const measured = vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(() => box(frameX, 50, 200, 100))
  Object.defineProperties(frame, { offsetWidth: { configurable: true, value: 200 }, offsetHeight: { configurable: true, value: 100 } })
  Object.defineProperty(child.defaultView!.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => box(20, 10, 80, 24) })
  const adapter = createNestedDomAuthoring(document.documentElement, createDomAuthoring, { records: () => ({}) })
  disposers.push(() => adapter.dispose())
  const queries = vi.spyOn(document.documentElement, 'querySelectorAll')
  measured.mockClear()
  const first = adapter.withReadScope(() => {
    adapter.documents(); adapter.describe(text); adapter.geometry(text)
    const rect = adapter.rect(text)
    expect(adapter.withReadScope(() => adapter.rect(text))).toEqual(rect)
    return rect
  })
  expect(first.x).toBe(120)
  expect(measured).toHaveBeenCalledTimes(1)
  expect(queries.mock.calls.filter(([selector]) => selector === 'iframe')).toHaveLength(1)
  frameX = 200
  expect(adapter.withReadScope(() => adapter.rect(text)).x).toBe(220)
  expect(measured).toHaveBeenCalledTimes(2)
})

it('does not let an outside ancestor scope pull nested targets out of a local adapter root', () => {
  document.body.innerHTML = '<div id="local"><p>Local</p><iframe></iframe></div><p id="outside">Outside</p>'
  const root = document.querySelector<HTMLElement>('#local')!, outside = document.querySelector('#outside')!
  write(root.querySelector('iframe')!, '<p>Nested local</p>')
  const adapter = createNestedDomAuthoring(root, createDomAuthoring, { records: () => ({}) })
  disposers.push(() => adapter.dispose())
  expect(adapter.targets(document.body)).toEqual([])
  expect(adapter.targets(outside)).toEqual([])
  expect(adapter.targets(root).map(node => node.textContent)).toEqual(['Local', 'Nested local'])
  expect(adapter.targets(document).map(node => node.textContent)).toEqual(['Local', 'Nested local'])
})
