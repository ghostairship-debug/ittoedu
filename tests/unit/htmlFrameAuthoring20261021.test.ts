import { afterEach, expect, it, vi } from 'vitest'
import { domAuthoringFactorySource, createDomAuthoring } from '../../src/components/web/authoringDom'
import { decorateHtmlFrameAuthoring, installHtmlFrameAuthoring, neededHtmlFrameSources, type HtmlFrameAuthoringBridge } from '../../src/shared/html/htmlFrameAuthoring'
import { extractHtmlAuthoringRecords, patchHtmlAuthoringRecords, readHtmlAuthoringRecords, readHtmlFrameSources } from '../../src/shared/html/htmlAuthoringRecords'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform/runtime'
import { installAuthoringInputArbitration } from '../../src/components/web/ownedDocumentAuthoring'
import { installHtmlBlobCapture } from '../../src/components/web/htmlBlobCapture'

const bridges: HtmlFrameAuthoringBridge[] = []
afterEach(() => { for (const bridge of bridges.splice(0)) bridge.dispose(); document.body.replaceChildren(); vi.restoreAllMocks() })

it('selects the precise available static source ancestors, excluding unrelated pages', () => {
  const available = { 'folder/child.html': { html: '<p>Child</p>', base: 'folder/child.html' },
    'grand.html': { html: '<p>Grand</p>', base: 'grand.html' }, 'unrelated.html': { html: '<p>Keep</p>', base: 'unrelated.html' } }
  expect(neededHtmlFrameSources({ 'html:sources': '["folder/child.html","grand.html","unknown.html"]' }, available))
    .toEqual({ 'folder/child.html': available['folder/child.html'], 'grand.html': available['grand.html'] })
})

it('instruments actual static srcdoc and leaves a fake marker inside authored JavaScript inert', () => {
  const source = '<!doctype html><html><head><script>const fake="cw-html-frame-bootstrap";</script></head><body><iframe sandbox="allow-scripts" srcdoc="&lt;p&gt;Child&lt;/p&gt;"></iframe></body></html>'
  const result = decorateHtmlFrameAuthoring(source, 'window.bridgeInstalled=true;')
  const parsed = new DOMParser().parseFromString(result, 'text/html')
  expect(parsed.head.querySelector('#cw-html-frame-bootstrap')!.textContent).toBe('window.bridgeInstalled=true;')
  expect(parsed.querySelector('iframe')!.srcdoc).toContain('<script id="cw-html-frame-bootstrap">')
  expect(result).toContain('<script>const fake="cw-html-frame-bootstrap";</script>')
  const upgraded = new DOMParser().parseFromString(decorateHtmlFrameAuthoring(result, 'second'), 'text/html')
  expect(upgraded.head.querySelector('#cw-html-frame-bootstrap')!.textContent).toBe('second')
  expect(upgraded.querySelector('iframe')!.srcdoc).toContain('<script id="cw-html-frame-bootstrap">second</script><p>Child</p>')
  expect(upgraded.head.querySelector('script:not([id])')!.textContent).toBe('const fake="cw-html-frame-bootstrap";')
})

it('stores edited-child source in the parent software region and prepares it before its original iframe loads', () => {
  const source = '<!doctype html><html><head></head><body><iframe sandbox="allow-scripts" src="sub/child.html"></iframe></body></html>'
  const record: ComponentAuthorRecord = { kind: 'text', scope: { 'html:frame': '/html:0/body:1/iframe:0@sub/child.html', 'html:sources': '["sub/child.html"]' },
    binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0 }], textIndex: 0, baseline: 'Original' }, overrides: { text: 'Edited' } }
  const sources = { 'sub/child.html': { html: '<p>Original</p><button onclick="this.textContent=String(+this.textContent+1)">0</button>', base: 'sub/child.html' } }
  const saved = patchHtmlAuthoringRecords(source, { selected: record }, { sources })
  const parsed = new DOMParser().parseFromString(saved, 'text/html'), frame = parsed.querySelector('iframe')!
  expect(frame.getAttribute('src')).toBe('sub/child.html')
  expect(frame.dataset.cwFrameSource).toBe('sub/child.html')
  expect(frame.srcdoc).toContain('<p>Original</p>')
  expect(frame.srcdoc).toContain('<base href="sub/child.html">')
  expect(parsed.head.firstElementChild!.id).toBe('cw-html-authoring-records')
  expect(readHtmlAuthoringRecords(saved)).toEqual({ selected: record })
  expect(readHtmlFrameSources(saved)).toEqual(sources)
  const next = patchHtmlAuthoringRecords(saved, { selected: { ...record, overrides: { text: 'Again' } } })
  expect(readHtmlFrameSources(next)).toEqual(sources)
  expect(extractHtmlAuthoringRecords(next).frameSources).toEqual(sources)
})

it('does not mistake software IDs inside an author script for actual record regions', () => {
  const source = '<script>const example = \'<script id="cw-html-authoring-records">\';</script><p>Keep</p>'
  expect(readHtmlAuthoringRecords(source)).toEqual({})
  expect(readHtmlFrameSources(source)).toEqual({})
})

it('inserts the saved consumer at the actual body close and preserves authored closing-tag literals', () => {
  const source = '<!doctype html><html><head><script>window.example="</body>";</script></head><body><p>Original</p></BoDy  ></html>'
  const saved = patchHtmlAuthoringRecords(source, {})
  const parsed = new DOMParser().parseFromString(saved, 'text/html')
  expect(parsed.head.querySelector('script:not([id])')!.textContent).toBe('window.example="</body>";')
  expect(parsed.body.lastElementChild!.id).toBe('cw-html-authoring-consumer')
  expect(extractHtmlAuthoringRecords(saved).source).toBe(source)
  const second = patchHtmlAuthoringRecords(saved, {})
  expect(second).toBe(saved)
})

it('serializes a page-privilege bootstrap and captures closed roots without opening them', () => {
  const serialized = new Function(`return (${installHtmlFrameAuthoring.toString()})`)() as typeof installHtmlFrameAuthoring
  const factory = new Function(`return ${domAuthoringFactorySource()}`)() as typeof createDomAuthoring
  const input = new Function(`return (${installAuthoringInputArbitration.toString()})`)() as typeof installAuthoringInputArbitration
  const capture = new Function(`return (${installHtmlBlobCapture.toString()})`)() as typeof installHtmlBlobCapture
  const bridge = serialized(factory, document, input, false, capture); bridges.push(bridge)
  const host = document.createElement('article'); document.body.append(host)
  const shadow = host.attachShadow({ mode: 'closed' }); shadow.innerHTML = '<p>Closed text</p>'
  expect(host.shadowRoot).toBeNull()
  expect(bridge.shadowRoot(host)).toBe(shadow)
})

it('captures query-bearing child references and preserves authored resource bases through a second local level', () => {
  const available = {
    'sub/child.html': { html: '<!doctype html><base href="assets/"><iframe src="grand.html"></iframe>', base: 'sub/child.html' },
    'sub/assets/grand.html': { html: '<p>Grand</p>', base: 'sub/assets/grand.html' },
  }
  const sources = neededHtmlFrameSources({ 'html:sources': '["sub/child.html?v=1#scene","sub/assets/grand.html"]' }, available)
  expect(Object.keys(sources)).toEqual(['sub/child.html?v=1#scene', 'sub/assets/grand.html'])
  const result = decorateHtmlFrameAuthoring('<iframe src="sub/child.html?v=1#scene"></iframe>', '/* bridge */', { sources })
  const outer = new DOMParser().parseFromString(result, 'text/html').querySelector('iframe')!
  const child = new DOMParser().parseFromString(outer.srcdoc, 'text/html')
  expect(child.querySelector('base')!.getAttribute('href')).toBe('sub/assets/')
  expect(child.querySelector('iframe')!.dataset.cwFrameSource).toBe('sub/assets/grand.html')
  expect(child.querySelector('iframe')!.srcdoc).toContain('<p>Grand</p>')
})

it('uses entry-relative software source keys after a nested parent handshake', () => {
  document.body.innerHTML = '<iframe></iframe>'
  const parent = document.querySelector('iframe')!, child = parent.contentDocument!
  child.open(); child.write('<base href="https://example.test/nested/child.html"><iframe src="grand.html" data-cw-frame-source="nested/grand.html" srcdoc="Grand"></iframe>'); child.close()
  const frame = child.querySelector('iframe')!, view = child.defaultView as Window & typeof globalThis
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage')
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, child); bridges.push(bridge)
  view.dispatchEvent(new view.MessageEvent('message', { source: view.parent, data: { protocol: 'cw-html-frame-authoring', type: 'state', route: '/parent', base: 'https://example.test/entry.html',
    sourcesChain: ['nested/child.html'], records: {}, sources: {}, observe: false, editMode: false, visible: true } }))
  view.dispatchEvent(new view.MessageEvent('message', { source: frame.contentWindow!, data: { protocol: 'cw-html-frame-authoring', type: 'hello' } }))
  const state = sent.mock.calls.map(call => call[0]).find(value => value.type === 'state')
  expect(state.sourcesChain).toEqual(['nested/child.html', 'nested/grand.html'])
  expect(state.route).toContain('@nested/grand.html')
  expect(state.route).not.toContain('nested/nested')
})

it('releases only software replay srcdoc when the author navigates src', () => {
  document.body.innerHTML = '<iframe id="managed" data-cw-frame-source="a.html" src="a.html" srcdoc="A"></iframe><iframe id="authored" srcdoc="Keep"></iframe>'
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, document); bridges.push(bridge)
  const managed = document.querySelector<HTMLIFrameElement>('#managed')!, authored = document.querySelector<HTMLIFrameElement>('#authored')!
  managed.src = 'b.html'; authored.src = 'b.html'
  expect(managed.getAttribute('src')).toBe('b.html')
  expect(managed.hasAttribute('srcdoc')).toBe(false)
  expect(managed.hasAttribute('data-cw-frame-source')).toBe(false)
  expect(authored.getAttribute('srcdoc')).toBe('Keep')
})

const formalAssets = (assets: Record<string, { url: string }>, owner = document) => {
  const element = owner.createElement('script'); element.id = 'course-data'; element.type = 'application/json'
  element.textContent = JSON.stringify({ format: 'compiled-course-v1', course: { assets } }); owner.body.append(element)
  return element
}

it('lazily reads a completed formal asset script once and keeps ordinary HTML resource behavior', () => {
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, document); bridges.push(bridge)
  const original = 'data:image/png;base64,YQ=='
  expect(bridge.resourceReference(original)).toBeUndefined()
  const data = formalAssets({ image: { url: original } }); data.textContent = ''
  expect(bridge.resourceReference(original)).toBeUndefined()
  data.textContent = JSON.stringify({ format: 'compiled-course-v1', course: { assets: { image: { url: original } } } })
  expect(bridge.resourceReference(original)).toBe('cw-resource:image')
  data.textContent = 'not JSON anymore'
  expect(bridge.resolveResource('cw-resource:image')).toBe(original)
  expect(bridge.resourceReference('pictures/ordinary.png')).toBeUndefined()
  expect(bridge.matchesResource('pictures/ordinary.png', 'pictures/ordinary.png')).toBe(false)
})

it('rebinds one stable image record from projected preview URLs to original duplicate data URLs', () => {
  const preview = 'courseware-preview://lease/token/_embedded/asset-a', original = 'data:image/png;base64,YQ=='
  formalAssets({ z: { url: preview }, a: { url: preview } })
  const image = document.createElement('img'); image.src = preview; document.body.append(image)
  let bridge = installHtmlFrameAuthoring(createDomAuthoring, document); bridges.push(bridge)
  let records: Record<string, ComponentAuthorRecord> = {}
  const options = () => ({ records: () => records, resourceReference: (value: string) => bridge.resourceReference(value),
    resolveResource: (value: string) => bridge.resolveResource(value), matchesResource: (value: string, live: string) => bridge.matchesResource(value, live) })
  let adapter = createDomAuthoring(document.documentElement, options())
  const target = adapter.describe(image)!
  expect(target.record.binding.baseline).toBe('cw-resource:a')
  records = { [target.authorKey]: { ...target.record, overrides: { src: 'replacement.png' } } }
  adapter.refresh(); expect(image.getAttribute('src')).toBe('replacement.png')
  adapter.dispose(); bridge.dispose(); document.body.replaceChildren()
  formalAssets({ z: { url: original }, a: { url: original } })
  const reopened = document.createElement('img'); reopened.src = original; document.body.append(reopened)
  bridge = installHtmlFrameAuthoring(createDomAuthoring, document); bridges.push(bridge)
  expect(bridge.resourceReference(original)).toBe('cw-resource:a')
  expect(bridge.matchesResource('cw-resource:a', original)).toBe(true)
  adapter = createDomAuthoring(document.documentElement, options())
  expect(reopened.getAttribute('src')).toBe('replacement.png')
  records = {}; adapter.refresh(); expect(reopened.getAttribute('src')).toBe(original)
  adapter.dispose()
})

it('sends the asset aliases once per child realm and forwards inherited aliases to its opaque adapter', () => {
  const original = 'data:image/png;base64,YQ=='
  formalAssets({ z: { url: original }, a: { url: original } })
  const frame = document.createElement('iframe'); document.body.append(frame)
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage')
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, document); bridges.push(bridge)
  const hello = (token: string) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data: { protocol: 'cw-html-frame-authoring', type: 'hello', token } }))
  hello('one'); bridge.setEditMode(true); bridge.setRecords({}); frame.dispatchEvent(new Event('load')); hello('one')
  let states = sent.mock.calls.map(call => call[0]).filter(value => value.type === 'state')
  expect(states.filter(value => value.aliases)).toHaveLength(1)
  expect(states.find(value => value.aliases).aliases).toEqual({ 'cw-resource:a': original })
  hello('two'); bridge.setEditMode(false)
  states = sent.mock.calls.map(call => call[0]).filter(value => value.type === 'state')
  expect(states.filter(value => value.aliases)).toHaveLength(2)
  const child = frame.contentDocument!, view = child.defaultView as Window & typeof globalThis
  const childBridge = installHtmlFrameAuthoring(createDomAuthoring, child); bridges.push(childBridge)
  view.dispatchEvent(new view.MessageEvent('message', { source: view.parent, data: states[0] }))
  expect(childBridge.resourceReference(original)).toBe('cw-resource:a')
  expect(childBridge.resolveResource('cw-resource:a')).toBe(original)
  expect(childBridge.matchesResource('cw-resource:a', original)).toBe(true)
})

it('refreshes software srcdoc with portable CSS and media while retaining original source and stylesheet attributes', () => {
  const html = '<!doctype html><html><head><link rel="stylesheet" href="../theme.css" integrity="sha256-old" media="screen"></head><body><img src="../old.svg" srcset="../old.svg 1x, ../large.svg 2x"><p style="background:url(../旧 图.svg)">Keep</p></body></html>'
  const original = '<iframe sandbox="allow-scripts" src="sub/child.html"></iframe>'
  const sources = { 'sub/child.html': { html, base: 'sub/child.html' } }
  const first = patchHtmlAuthoringRecords(original, {}, { sources })
  const resources = { 'theme.css': 'data:text/css;base64,Ym9keXtjb2xvcjpyZWR9', 'old.svg': 'data:image/svg+xml;base64,YQ==', 'large.svg': 'data:image/svg+xml;base64,Yg==', '旧 图.svg': 'data:image/svg+xml;base64,YQ==' }
  const saved = patchHtmlAuthoringRecords(first, {}, { sources: { 'sub/child.html': { ...sources['sub/child.html'], resources } } })
  const frame = new DOMParser().parseFromString(saved, 'text/html').querySelector('iframe')!
  const child = new DOMParser().parseFromString(frame.srcdoc, 'text/html'), link = child.querySelector('link')!, image = child.querySelector('img')!
  expect(link.getAttribute('href')).toBe(resources['theme.css'])
  expect(link.hasAttribute('integrity')).toBe(false)
  expect(link.getAttribute('media')).toBe('screen')
  expect(image.getAttribute('src')).toBe(resources['old.svg'])
  expect(image.getAttribute('srcset')).toBe(`${resources['old.svg']} 1x, ${resources['large.svg']} 2x`)
  expect(child.querySelector('p')!.getAttribute('style')).toContain(resources['old.svg'])
  expect(readHtmlFrameSources(saved)['sub/child.html']).toEqual({ html, base: 'sub/child.html', resources })
})

it('keeps existing entry-relative image records bound across passive file projection', () => {
  const base = document.createElement('base'); base.href = 'https://example.test/entry.html'; document.body.append(base)
  const portable = 'data:image/svg+xml;base64,YQ=='
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, document); bridges.push(bridge)
  bridge.setSources({ child: { html: '', base: 'assets/grand.html', resources: { 'old.svg': portable, 'images/旧 图.svg': 'data:image/svg+xml;base64,Yg==' } } })
  expect(bridge.resourceReference(portable)).toBe('old.svg')
  expect(bridge.resolveResource('old.svg')).toBe(portable)
  expect(bridge.matchesResource('old.svg', '../old.svg', 'https://example.test/assets/grand.html')).toBe(true)
  expect(bridge.resourceReference('images/%E6%97%A7%20%E5%9B%BE.svg')).toBe('images/旧 图.svg')
  expect(bridge.resolveResource('images/%E6%97%A7%20%E5%9B%BE.svg')).toBe('data:image/svg+xml;base64,Yg==')
  const image = document.createElement('img'); image.src = portable; document.body.append(image)
  const records: Record<string, ComponentAuthorRecord> = { previous: { kind: 'image', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'img', index: 1 }], baseline: 'old.svg' }, overrides: { src: 'changed.png' } } }
  const adapter = createDomAuthoring(document.documentElement, { records: () => records, resourceReference: value => bridge.resourceReference(value),
    resolveResource: value => bridge.resolveResource(value), matchesResource: (value, live) => bridge.matchesResource(value, live) })
  expect(image.getAttribute('src')).toBe('changed.png')
  adapter.dispose(); base.remove()
})
