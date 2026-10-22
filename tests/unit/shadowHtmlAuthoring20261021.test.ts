import { afterEach, expect, it, vi } from 'vitest'
import { domAuthoringFactorySource, createDomAuthoring } from '../../src/components/web/authoringDom'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform/runtime'

const adapters: ReturnType<typeof createDomAuthoring>[] = []
afterEach(() => { for (const adapter of adapters.splice(0)) adapter.dispose(); document.body.replaceChildren(); vi.restoreAllMocks() })
const flush = async () => { for (let index = 0; index < 4; index++) await new Promise(resolve => setTimeout(resolve, 0)) }

it('edits and rebinds one shadow text through a host replacement while preserving identical normal and shadow siblings', () => {
  document.body.innerHTML = '<p>Original</p><div id="left"></div><div id="right"></div>'
  let left = document.querySelector('#left')!
  let shadow = left.attachShadow({ mode: 'open' }); shadow.innerHTML = '<p>Original</p>'
  const sibling = document.querySelector('#right')!.attachShadow({ mode: 'open' }); sibling.innerHTML = '<p>Original</p>'
  let records: Record<string, ComponentAuthorRecord> = {}
  const adapter = createDomAuthoring(document.documentElement, { records: () => records }); adapters.push(adapter)
  const target = adapter.scan().find(value => value.node.getRootNode() === shadow)!
  expect(target.bindingStatus).toBe('bound')
  expect(target.record.binding.path.some(step => step.tag === '#shadow-root')).toBe(true)
  records = { [target.authorKey]: { ...target.record, overrides: { text: 'Edited' } } }
  adapter.refresh()
  expect(shadow.textContent).toBe('Edited')
  expect(sibling.textContent).toBe('Original')
  expect(document.querySelector('p')!.textContent).toBe('Original')
  const replacement = document.createElement('div'); replacement.id = 'left'; left.replaceWith(replacement); left = replacement
  shadow = left.attachShadow({ mode: 'open' }); shadow.innerHTML = '<p>Original</p>'
  adapter.refresh()
  expect(shadow.textContent).toBe('Edited')
  expect(adapter.describe(shadow.querySelector('p')!.firstChild!)!.authorKey).toBe(target.authorKey)
})

it('uses a retained closed root for direct text and image records without opening the root', () => {
  document.body.innerHTML = '<div id="closed"></div>'
  const host = document.querySelector('#closed')!, shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = 'Direct text<img src="data:image/png;base64,T0xE">'
  const roots = new WeakMap<Element, ShadowRoot>([[host, shadow]])
  let records: Record<string, ComponentAuthorRecord> = {}
  const adapter = createDomAuthoring(document.documentElement, { records: () => records, shadowRoot: element => roots.get(element) }); adapters.push(adapter)
  const targets = adapter.scan()
  expect(targets).toHaveLength(2)
  expect(targets.every(value => value.bindingStatus === 'bound')).toBe(true)
  const text = targets.find(value => value.record.kind === 'text')!, image = targets.find(value => value.record.kind === 'image')!
  records = { [text.authorKey]: { ...text.record, overrides: { text: 'Saved text' } },
    [image.authorKey]: { ...image.record, overrides: { src: 'data:image/png;base64,TkVX' } } }
  adapter.refresh()
  expect(shadow.firstChild!.textContent).toBe('Saved text')
  expect(shadow.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,TkVX')
  expect(host.shadowRoot).toBeNull()
  expect(adapter.roots()).toContain(shadow)
  records = {}; adapter.refresh()
  expect(shadow.firstChild!.textContent).toBe('Direct text')
  expect(shadow.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,T0xE')
})

it('observes a program redraw inside shadow DOM and releases removed roots', async () => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.querySelector('#host')!, shadow = host.attachShadow({ mode: 'open' }); shadow.innerHTML = '<p>Original</p>'
  let records: Record<string, ComponentAuthorRecord> = {}
  const onChange = vi.fn(), adapter = createDomAuthoring(document.documentElement, { records: () => records, onChange }); adapters.push(adapter)
  const target = adapter.scan()[0]!
  records = { [target.authorKey]: { ...target.record, overrides: { text: 'Edited' } } }; adapter.refresh(); await flush()
  shadow.innerHTML = '<p>Original</p>'; await flush()
  expect(shadow.textContent).toBe('Edited')
  host.remove(); await flush()
  expect(adapter.roots()).not.toContain(shadow)
  onChange.mockClear(); shadow.innerHTML = '<p>Detached</p>'; await flush()
  expect(onChange).not.toHaveBeenCalled()
})

it('replays a nested-shadow record from the serialized shared adapter', () => {
  document.body.innerHTML = '<div id="outer"></div>'
  const outer = document.querySelector('#outer')!.attachShadow({ mode: 'open' }); outer.innerHTML = '<section id="inner"></section>'
  const inner = outer.querySelector('#inner')!.attachShadow({ mode: 'open' }); inner.innerHTML = '<p>Original</p>'
  let records: Record<string, ComponentAuthorRecord> = {}
  const factory = new Function(`return ${domAuthoringFactorySource()}`)() as typeof createDomAuthoring
  const adapter = factory(document.documentElement, { records: () => records }); adapters.push(adapter)
  const target = adapter.scan()[0]!
  expect(target.record.binding.path.filter(step => step.tag === '#shadow-root')).toHaveLength(2)
  records = { [target.authorKey]: { ...target.record, overrides: { text: 'Reopened' } } }; adapter.refresh()
  expect(inner.textContent).toBe('Reopened')
})
