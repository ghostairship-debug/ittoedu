import { afterEach, expect, it, vi } from 'vitest'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { installOwnedDocumentAuthoring } from '../../src/components/web/ownedDocumentAuthoring'
import { installAuthoredDocumentPrograms } from '../../src/components/web/authoredDocumentBootstrap'
import { createWebResourceUrlLease } from '../../src/components/web/resourceUrlLease'
import { refreshWebResourceReferences, webResourceReferenceMarker } from '../../src/components/web/resources'

const releases: Array<() => void> = []
afterEach(() => { releases.splice(0).forEach(release => release()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })

it('registers the real parser resource directory without decoding unused assets', () => {
  const decode = vi.spyOn(window, 'atob')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:parser-used') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  const resources = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`asset-${index}`, 'data:image/png;base64,YQ==']))
  const parser = installAuthoredDocumentPrograms({ prefix: 'guoling-test:', property: '__lazy_parser_test', classic: {}, resources }, undefined,
    createWebResourceUrlLease)
  releases.push(parser.release)
  expect(decode).not.toHaveBeenCalled()
  expect(Object.keys(parser.resourceLease.urls)).toHaveLength(100)
  expect(parser.resourceLease.resolve('asset-7')).toBe('blob:parser-used')
  expect(decode).toHaveBeenCalledOnce()
  expect(parser.resourceLease.reverse('blob:parser-used')).toBe('asset-7')
  expect(decode).toHaveBeenCalledOnce()
})

it('uses the owned parser resource reverse callback without enumerating unrelated live URLs', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
  const urls: Record<string, string> = { used: 'blob:used' }
  Object.defineProperty(urls, 'unused', { enumerable: true, get() { throw new Error('Unused resource was materialized') } })
  const resourceReference = vi.fn(() => 'used')
  let reference: string | undefined
  const factory: typeof createDomAuthoring = (root, options) => {
    reference = options?.resourceReference?.('blob:used')
    return createDomAuthoring(root, options)
  }
  const owner = installOwnedDocumentAuthoring('lazy-owned', 'frame:0', factory, {
    runtimeResources: () => urls, resourceReference,
  })
  releases.push(owner.dispose)
  document.dispatchEvent(new Event('DOMContentLoaded'))
  expect(reference).toBe('used')
  expect(resourceReference).toHaveBeenCalledWith('blob:used', {})
})

function ownedResourceFixture() {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() })
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
  const reference = 'cw-resource:picture', resources = { picture: 'blob:picture' }, bindings = { [reference]: 'picture' }
  const image = document.createElement('img')
  image.src = resources.picture
  image.setAttribute('data-component-resource-bindings', webResourceReferenceMarker({ src: reference }, bindings, id => resources[id as keyof typeof resources])!)
  const frame = document.createElement('iframe'); frame.srcdoc = '<p>Owned descendant</p>'
  document.body.append(image, frame)
  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  const token = 'owned-resource-state'
  const owner = installOwnedDocumentAuthoring(token, 'frame:0', createDomAuthoring, {
    runtimeResources: () => resources, refreshResources: refreshWebResourceReferences,
  })
  releases.push(owner.dispose)
  const state = (nextBindings: Record<string, string>) => ({ records: {}, resources, bindings: nextBindings, observe: false })
  const update = (value: ReturnType<typeof state>) => window.dispatchEvent(new MessageEvent('message', {
    source: window.parent, data: { type: 'guoling.authoring.update', token, state: value },
  }))
  const ready = () => window.dispatchEvent(new MessageEvent('message', {
    source: frame.contentWindow, data: { type: 'guoling.authoring.ready', token },
  }))
  const marker = () => JSON.parse(image.getAttribute('data-component-resource-bindings')!)
  return { image, frame, post, token, reference, resources, bindings, state, update, ready, marker }
}

it('preserves parser resource identity until a parent state arrives, while honoring explicit empty bindings and restoration', () => {
  const f = ownedResourceFixture()
  f.ready()
  document.dispatchEvent(new Event('DOMContentLoaded'))
  f.ready()
  expect(f.image.getAttribute('src')).toBe(f.resources.picture)
  expect(f.marker().assets).toEqual(f.bindings)
  expect(f.post).not.toHaveBeenCalled()

  const empty = f.state({})
  f.update(empty)
  expect(f.image.getAttribute('src')).toBe(f.reference)
  expect(f.marker().assets).toEqual({ [f.reference]: f.reference })
  expect(f.post).toHaveBeenLastCalledWith({ type: 'guoling.authoring.update', token: f.token, state: empty }, '*')

  const restored = f.state(f.bindings)
  f.update(restored)
  expect(f.image.getAttribute('src')).toBe(f.resources.picture)
  expect(f.marker().assets).toEqual(f.bindings)
  expect(f.post).toHaveBeenLastCalledWith({ type: 'guoling.authoring.update', token: f.token, state: restored }, '*')
})

it('retains a parent update received before DOM readiness and sends it to subsequently ready descendants', () => {
  const f = ownedResourceFixture(), current = f.state(f.bindings)
  f.update(current)
  expect(f.post).toHaveBeenLastCalledWith({ type: 'guoling.authoring.update', token: f.token, state: current }, '*')
  document.dispatchEvent(new Event('DOMContentLoaded'))
  expect(f.image.getAttribute('src')).toBe(f.resources.picture)
  expect(f.marker().assets).toEqual(f.bindings)
  f.ready()
  expect(f.post).toHaveBeenLastCalledWith({ type: 'guoling.authoring.update', token: f.token, state: current }, '*')

  const added = document.createElement('iframe'); added.srcdoc = '<p>Later descendant</p>'
  document.body.append(added)
  const post = vi.spyOn(added.contentWindow!, 'postMessage').mockImplementation(() => {})
  window.dispatchEvent(new MessageEvent('message', {
    source: added.contentWindow, data: { type: 'guoling.authoring.ready', token: f.token },
  }))
  expect(post).toHaveBeenLastCalledWith({ type: 'guoling.authoring.update', token: f.token, state: current }, '*')
})
