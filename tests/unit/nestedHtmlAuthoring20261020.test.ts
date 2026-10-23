import { afterEach, expect, it, vi } from 'vitest'
import { domAuthoringFactorySource, createDomAuthoring } from '../../src/components/web/authoringDom'
import { createNestedDomAuthoring, type NestedDomAuthoring } from '../../src/components/web/nestedAuthoringDom'
import { createAuthoringFrameGeometry } from '../../src/components/web/authoringFrame'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform/runtime'

const adapters: NestedDomAuthoring[] = []
afterEach(() => { for (const adapter of adapters.splice(0)) adapter.dispose(); document.body.replaceChildren(); document.head.querySelectorAll('base').forEach(value => value.remove()); vi.restoreAllMocks() })
const write = (frame: HTMLIFrameElement, source = '<p id="title">Original</p>') => {
  const child = frame.contentDocument!
  child.open(); child.write(source); child.close()
  return child
}
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect

it('retains one parent-owned edit through a child document reload without changing an identical sibling', () => {
  document.body.innerHTML = '<iframe id="left"></iframe><iframe id="right"></iframe>'
  const left = document.querySelector<HTMLIFrameElement>('#left')!, right = document.querySelector<HTMLIFrameElement>('#right')!
  let child = write(left); const sibling = write(right)
  let records: Record<string, ComponentAuthorRecord> = {}
  const onDocumentsChanged = vi.fn()
  const adapter = createNestedDomAuthoring(document.documentElement, createDomAuthoring, { records: () => records, onDocumentsChanged })
  adapters.push(adapter)
  const targets = adapter.scan().filter(value => value.node.ownerDocument !== document)
  expect(targets).toHaveLength(2)
  expect(targets[0]!.record.scope).not.toEqual(targets[1]!.record.scope)
  const target = targets.find(value => value.node.ownerDocument === child)!
  records = { [target.authorKey]: { ...target.record, overrides: { text: 'Edited' } } }
  adapter.refresh()
  expect(child.querySelector('#title')!.textContent).toBe('Edited')
  expect(sibling.querySelector('#title')!.textContent).toBe('Original')
  child = write(left)
  adapter.refresh()
  expect(child.querySelector('#title')!.textContent).toBe('Edited')
  expect(adapter.describe(child.querySelector('#title')!.firstChild!)!.authorKey).toBe(target.authorKey)
  expect(adapter.documents()).toHaveLength(3)
  left.remove(); adapter.refresh()
  expect(adapter.documents()).toHaveLength(2)
  expect(onDocumentsChanged).toHaveBeenCalledTimes(3)
  expect(sibling.querySelector('#title')!.textContent).toBe('Original')
})

it('maps nested viewport bounds through the frame scale and border', () => {
  document.body.innerHTML = '<iframe id="child"></iframe>'
  const frame = document.querySelector('iframe')!, child = write(frame)
  frame.getBoundingClientRect = () => box(100, 50, 400, 200)
  Object.defineProperties(frame, { offsetWidth: { value: 200 }, offsetHeight: { value: 100 }, clientLeft: { value: 4 }, clientTop: { value: 6 } })
  Object.defineProperty(child.defaultView!.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => box(20, 10, 80, 24) })
  const adapter = createNestedDomAuthoring(document.documentElement, createDomAuthoring, { records: () => ({}) }); adapters.push(adapter)
  expect(adapter.rect(child.querySelector('#title')!.firstChild!)).toEqual({ x: 148, y: 82, width: 160, height: 48 })
})

it('resolves child image baselines in the child directory and saved replacements in the entry directory', () => {
  const base = document.createElement('base'); base.href = 'https://example.test/main/entry.html'; document.head.append(base)
  document.body.innerHTML = '<iframe id="child"></iframe>'
  const child = write(document.querySelector('iframe')!, '<base href="https://example.test/main/nested/child.html"><img src="old.png">')
  let records: Record<string, ComponentAuthorRecord> = {}
  const adapter = createNestedDomAuthoring(document.documentElement, createDomAuthoring, { records: () => records,
    resourceReference: () => undefined, resolveResource: () => undefined, matchesResource: () => false }); adapters.push(adapter)
  const image = child.querySelector('img')!, target = adapter.describe(image)!
  expect(image.getAttribute('src')).toBe('old.png')
  expect(target.record.binding.baseline).toBe('nested/old.png')
  records = { [target.authorKey]: { ...target.record, overrides: { src: 'entry.assets/new.png' } } }
  adapter.refresh()
  expect(image.src).toBe('https://example.test/main/entry.assets/new.png')
  records = {}; adapter.refresh()
  expect(image.getAttribute('src')).toBe('old.png')
})

it('runs the serialized helper and original adapter without module dependencies', () => {
  document.body.innerHTML = '<iframe id="child"></iframe>'
  const child = write(document.querySelector('iframe')!)
  const serialized = new Function(`return (${createNestedDomAuthoring.toString()})`)() as typeof createNestedDomAuthoring
  const factory = new Function(`return ${domAuthoringFactorySource()}`)() as typeof createDomAuthoring
  let records: Record<string, ComponentAuthorRecord> = {}
  const frames = new Function(`return (${createAuthoringFrameGeometry.toString()})`)() as typeof createAuthoringFrameGeometry
  const adapter = serialized(document.documentElement, factory, { records: () => records }, frames); adapters.push(adapter)
  const target = adapter.describe(child.querySelector('#title')!.firstChild!)!
  records = { [target.authorKey]: { ...target.record, overrides: { text: 'From saved source' } } }
  adapter.refresh()
  expect(child.querySelector('#title')!.textContent).toBe('From saved source')
})
