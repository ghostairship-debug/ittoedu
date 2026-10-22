import { afterEach, expect, it, vi } from 'vitest'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { createNestedDomAuthoring } from '../../src/components/web/nestedAuthoringDom'
import { installHtmlFrameAuthoring } from '../../src/shared/html/htmlFrameAuthoring'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform/runtime'

const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
const flush = async () => { for (let index = 0; index < 3; index++) await new Promise(resolve => setTimeout(resolve, 0)) }

it('keeps unchanged frame source and records out of mode, visibility and refresh messages', () => {
  document.body.innerHTML = '<iframe></iframe>'
  const frame = document.querySelector('iframe')!, sent = vi.spyOn(frame.contentWindow!, 'postMessage')
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, document)
  disposers.push(() => bridge.dispose())
  const sources = { 'child.html': { html: '<p>Keep program source</p>', base: 'child.html' } }
  bridge.setSources(sources)
  const hello = (token: string) => window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow!, data: { protocol: 'cw-html-frame-authoring', type: 'hello', token, deltaState: true },
  }))
  hello('first')
  const states = () => sent.mock.calls.map(call => call[0]).filter(value => value.type === 'state')
  expect(states().at(-1)).toMatchObject({ records: {}, sources })
  sent.mockClear()
  bridge.setEditMode(true); bridge.setVisibility(false); bridge.setVisibility(true); bridge.refresh()
  expect(states().length).toBeGreaterThan(0)
  for (const message of states()) {
    expect(message).not.toHaveProperty('records')
    expect(message).not.toHaveProperty('sources')
  }
  bridge.setRecords({})
  expect(states().at(-1)).toHaveProperty('records')
  expect(states().at(-1)).not.toHaveProperty('sources')
  hello('next-realm')
  expect(states().at(-1)).toMatchObject({ records: {}, sources })
  window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow!, data: { protocol: 'cw-html-frame-authoring', type: 'hello', token: 'saved-older-realm' },
  }))
  bridge.setEditMode(false); bridge.setVisibility(false)
  // Persisted software bootstraps without delta support still consume full state.
  expect(states().at(-1)).toMatchObject({ records: {}, sources, editMode: false, visible: false })
})

it('retains software replay URL until its replacement loads, then releases removed and disposed frames', async () => {
  const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  let serial = 0
  const create = vi.fn(() => `blob:software-replay-${++serial}`), revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoke })
  disposers.push(() => {
    if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate); else Reflect.deleteProperty(URL, 'createObjectURL')
    if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke); else Reflect.deleteProperty(URL, 'revokeObjectURL')
  })
  document.body.innerHTML = '<iframe></iframe><iframe></iframe>'
  const [frame, other] = [...document.querySelectorAll('iframe')]
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, document)
  disposers.push(() => bridge.dispose())
  bridge.setSources({ 'one.html': { html: '<p>One</p>', base: 'one.html' }, 'two.html': { html: '<p>Two</p>', base: 'two.html' } })
  frame!.src = 'one.html'
  const first = frame!.getAttribute('src')!
  frame!.src = 'two.html'
  const second = frame!.getAttribute('src')!
  expect(first).not.toBe(second)
  expect(revoke).not.toHaveBeenCalledWith(first)
  frame!.dispatchEvent(new Event('load'))
  expect(revoke).toHaveBeenCalledWith(first)
  expect(revoke).not.toHaveBeenCalledWith(second)
  bridge.setVisibility(false)
  frame!.remove()
  await flush()
  expect(revoke).toHaveBeenCalledWith(second)
  other!.src = 'one.html'
  const last = other!.getAttribute('src')!
  bridge.dispose()
  expect(revoke).toHaveBeenCalledWith(last)
})

it('coalesces hidden DOM observations and catches up once when activity returns', async () => {
  document.body.innerHTML = '<p>Original</p>'
  const records = vi.fn(() => ({})), changed = vi.fn()
  const adapter = createDomAuthoring(document.documentElement, { records, onChange: changed })
  disposers.push(() => adapter.dispose())
  const baseline = records.mock.calls.length
  adapter.setActive(false)
  window.dispatchEvent(new CustomEvent('__runtime.activity', { detail: { active: true, visible: true, playing: true } }))
  document.querySelector('p')!.firstChild!.nodeValue = 'First'
  await flush()
  document.querySelector('p')!.firstChild!.nodeValue = 'Second'
  await flush()
  expect(records).toHaveBeenCalledTimes(baseline)
  expect(changed).not.toHaveBeenCalled()
  adapter.setActive(true)
  await flush()
  expect(records).toHaveBeenCalledTimes(baseline + 1)
  expect(changed).toHaveBeenCalledTimes(1)
  expect(adapter.describe(document.querySelector('p')!.firstChild!)?.initialValue).toBe('Second')
})

it('applies formal records while hidden and keeps them when returning in run mode', () => {
  document.body.innerHTML = '<iframe></iframe>'
  const frame = document.querySelector('iframe')!, child = frame.contentDocument!, view = child.defaultView as Window & typeof globalThis
  child.open(); child.write('<p id="title">Original</p>'); child.close()
  const scope = { 'html:frame': '/managed', 'html:sources': '[]' }
  const descriptor = createDomAuthoring(child.documentElement, { records: () => ({}), scope })
  const target = descriptor.describe(child.querySelector('#title')!.firstChild!)!
  descriptor.dispose()
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, child)
  disposers.push(() => bridge.dispose())
  const sendState = (records: Record<string, ComponentAuthorRecord>, visible: boolean) => view.dispatchEvent(new view.MessageEvent('message', {
    source: view.parent, data: { protocol: 'cw-html-frame-authoring', type: 'state', route: '/managed', base: 'https://example.test/entry.html',
      sourcesChain: [], records, sources: {}, observe: true, editMode: false, visible },
  }))
  sendState({}, false)
  const records = { [target.authorKey]: { ...target.record, overrides: { text: 'Accepted while hidden' } } }
  bridge.setRecords(records)
  expect(child.querySelector('#title')!.textContent).toBe('Accepted while hidden')
  sendState({ [target.authorKey]: { ...target.record, overrides: { text: 'Accepted from parent' } } }, false)
  expect(child.querySelector('#title')!.textContent).toBe('Accepted from parent')
  bridge.setVisibility(true)
  expect(child.querySelector('#title')!.textContent).toBe('Accepted from parent')
})

it('defers hidden nested-document discovery without stopping the authored document', async () => {
  const priorActivity = Object.getOwnPropertyDescriptor(window, '__guolingRuntimeActivity')
  Object.defineProperty(window, '__guolingRuntimeActivity', { configurable: true, value: { active: false, visible: false } })
  disposers.push(() => {
    if (priorActivity) Object.defineProperty(window, '__guolingRuntimeActivity', priorActivity)
    else Reflect.deleteProperty(window, '__guolingRuntimeActivity')
  })
  const documentsChanged = vi.fn(), changed = vi.fn()
  const adapter = createNestedDomAuthoring(document.documentElement, createDomAuthoring, { records: () => ({}), onChange: changed, onDocumentsChanged: documentsChanged })
  disposers.push(() => adapter.dispose())
  documentsChanged.mockClear()
  const frame = document.createElement('iframe'); document.body.append(frame)
  const child = frame.contentDocument!
  child.open(); child.write('<p>Still running</p>'); child.close()
  await flush()
  expect(documentsChanged).not.toHaveBeenCalled()
  expect(child.querySelector('p')!.textContent).toBe('Still running')
  adapter.setActive(false)
  window.dispatchEvent(new CustomEvent('__runtime.activity', { detail: { active: true, visible: true, playing: true } }))
  await flush()
  expect(documentsChanged).not.toHaveBeenCalled()
  adapter.setActive(true)
  await flush()
  expect(adapter.documents()).toContain(child)
  expect(documentsChanged).toHaveBeenCalledTimes(1)
})


it('keeps run-mode and adapter-free mutations out of the author-scan animation-frame queue', async () => {
  const scheduled = vi.spyOn(window, 'requestAnimationFrame')
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, document)
  disposers.push(() => bridge.dispose())
  scheduled.mockClear()
  bridge.setRecords({}); bridge.refresh()
  document.body.append(document.createElement('p'))
  await flush()
  bridge.setEditMode(true) // Parent-only bridges delegate child targets; no local adapter exists.
  expect(scheduled).not.toHaveBeenCalled()
})
