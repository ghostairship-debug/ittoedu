import { expect, it, vi } from 'vitest'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { JSDOM } from 'jsdom'
import { resolveWebResourceBindings, refreshWebResourceReferences } from '../../src/components/web/resources'
import { authoredDocumentBootstrap } from '../../src/components/web/authoredDocumentBootstrap'
import type { WebRuntimeData } from '../../src/components/web/moduleGraph'
import { webDataSchema } from '../../src/components/web/data'
import { mountWebContent } from '../../src/components/web/contentRealmImplementation'
import type { ComponentRuntimeContext } from '../../src/shared/contracts/component-platform'

it('replaces same-ID image bytes in the live DOM and theme, then restores old bytes without remounting', async () => {
  let sequence = 0
  const create = vi.fn(() => `blob:asset-${++sequence}`), revoke = vi.fn()
  const OriginalURL = globalThis.URL
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; static revokeObjectURL = revoke })
  const root = document.createElement('div'); document.body.append(root)
  const world = new ComponentPlatformRuntime('asset-replace', { mode: 'edit' })
  const project: CourseProjectV10 = { schemaVersion: 10, revision: 0, id: 'asset-replace', title: '图片替换',
    definitions: { image: { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } } },
    instances: { image: { id: 'image', definitionId: 'image', data: { assetId: 'picture', originalAssetId: 'picture' },
      frame: { width: 100, height: 100, transform: [1, 0, 0, 1, 20, 30] } },
      peer: { id: 'peer', definitionId: 'image', data: { assetId: 'peer', originalAssetId: 'peer' } } },
    surfaces: [{ id: 'page', kind: 'slide', title: '页', childIds: ['image', 'peer'] }], global: { underlay: [], overlay: [] },
    assets: { picture: { id: 'picture', path: 'assets/same.svg', mimeType: 'image/svg+xml' }, peer: { id: 'peer', path: 'assets/peer.svg', mimeType: 'image/svg+xml' } },
    theme: { css: '.picture {background-image:url(assets/same.svg)}', assets: { 'assets/same.svg': { assetId: 'picture' } } } }
  const before = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/></svg>')
  const after = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="blue"/></svg>')
  try {
    const pictureRoot = document.createElement('div'), peerRoot = document.createElement('div'); root.append(pictureRoot, peerRoot)
    world.bind('image', pictureRoot); world.bind('peer', peerRoot)
    await world.sync(project, { assets: { picture: before, peer: before }, components: {} })
    const image = pictureRoot.querySelector('img')!, first = image.getAttribute('src'), contentBefore = world.contentAssetUrl('picture')!
    const peer = peerRoot.querySelector('img')!, peerUrl = peer.getAttribute('src')
    await world.sync({ ...project, revision: 1 }, { assets: { picture: after, peer: before }, components: {} })
    const next = world.assetUrl('picture'), contentAfter = world.contentAssetUrl('picture')!
    expect(next).not.toBe(first)
    expect(pictureRoot.querySelector('img')).toBe(image)
    expect(image.getAttribute('src')).toBe(next)
    expect(atob(contentAfter.split(',')[1])).toContain('blue')
    expect(document.head.textContent).toContain(contentAfter)
    expect(revoke).toHaveBeenCalledWith(first)
    expect(peer.getAttribute('src')).toBe(peerUrl)
    const unchanged = next
    await world.sync({ ...project, revision: 2 }, { assets: { picture: Uint8Array.from(after), peer: before }, components: {} })
    expect(world.assetUrl('picture')).toBe(unchanged)
    await world.sync({ ...project, revision: 3 }, { assets: { picture: before, peer: before }, components: {} })
    expect(image.getAttribute('src')).toBe(world.assetUrl('picture'))
    expect(world.contentAssetUrl('picture')).toBe(contentBefore)
    expect(pictureRoot.querySelector('img')).toBe(image)
    expect(project.instances.image.data).toEqual({ assetId: 'picture', originalAssetId: 'picture' })
  } finally { await world.dispose(); root.remove(); vi.unstubAllGlobals() }
})

it('keeps replaced fragment CSS current when placement rewrites its style', async () => {
  const root = document.createElement('div'); document.body.append(root)
  const controller = new AbortController(), resources: Record<string, string> = { a: 'data:image/svg+xml;base64,cmVk' }
  const source = { id: 'fragment', definitionId: 'guoling.web', data: { html: '<div style="background-image:url(cw-resource:a);width:120px;margin:12px"><input></div>', css: '.asset {background:url(cw-resource:a)}', resourceBindings: { 'cw-resource:a': 'a' } },
    frame: { width: 120, height: 80, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] } }
  const projected = resolveWebResourceBindings(source, id => resources[id])
  const context: ComponentRuntimeContext<WebRuntimeData> & { resourceCss: string } = { instance: { ...projected, data: webDataSchema.parse(projected.data) }, root, resourceCss: source.data.css,
    resources: { url: id => resources[id] }, scope: { runScopeId: 'fragment-resource', instanceId: source.id, generation: 1, signal: controller.signal, isActive: () => !controller.signal.aborted,
      cleanup() {}, target: () => null, events: { emit() {}, subscribe: () => () => {} }, state: { get: () => undefined, set() {}, subscribe: () => () => {} } } }
  const mounted = await mountWebContent(context)
  try {
    const input = root.querySelector('input')!; input.value = '保留答案'
    resources.a = 'data:image/svg+xml;base64,Ymx1ZQ=='
    refreshWebResourceReferences(document, resources)
    expect((root.firstElementChild as HTMLElement).style.backgroundImage).toContain(resources.a)
    await mounted.updatePlacement?.(undefined)
    const style = [...document.head.querySelectorAll('style')].find(style => style.textContent?.includes('.asset'))!
    expect(style.textContent).toContain(resources.a)
    expect(style.textContent).not.toContain('cmVk')
    expect((root.firstElementChild as HTMLElement).style.backgroundImage).toContain(resources.a)
    expect(root.querySelector('input')).toBe(input); expect(input.value).toBe('保留答案')
    const element = root.firstElementChild as HTMLElement
    element.style.backgroundImage = 'url(data:image/svg+xml;base64,cHJvZ3JhbQ==)'
    resources.a = 'data:image/svg+xml;base64,bmV3'
    refreshWebResourceReferences(document, resources)
    await mounted.updatePlacement?.(undefined)
    expect(element.style.backgroundImage).toContain('cHJvZ3JhbQ==')
  } finally { controller.abort(); await mounted.dispose(); root.remove() }
})

it('updates only asset A in a live authored Web document, preserving equal-content B, input and script state through undo', async () => {
  let realm: JSDOM | undefined, world: ComponentPlatformRuntime
  let readLayout: NonNullable<ComponentRuntimeContext['layout']>['read'] | undefined
  const before = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/></svg>')
  const after = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="blue"/></svg>')
  const instance = { id: 'web', definitionId: 'web', frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 20, 30] as [number, number, number, number, number, number] }, data: {
    html: '<!doctype html><html><head><style>#a {background-image:url(cw-resource:a)}</style></head><body><img id="a" src="cw-resource:a"><img id="b" src="cw-resource:b"><input id="answer"><script>window.mountCount=(window.mountCount||0)+1</script></body></html>',
    css: '.css-asset {background-image:url(cw-resource:a)}', resourceBindings: { 'cw-resource:a': 'a', 'cw-resource:b': 'b' } } }
  const project: CourseProjectV10 = { schemaVersion: 10, revision: 0, id: 'web-assets', title: 'Web替换',
    definitions: { web: { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } } }, instances: { web: instance },
    surfaces: [{ id: 'page', kind: 'slide', title: '页', childIds: ['web'] }], global: { underlay: [], overlay: [] },
    assets: { a: { id: 'a', path: 'assets/a.svg', mimeType: 'image/svg+xml' }, b: { id: 'b', path: 'assets/b.svg', mimeType: 'image/svg+xml' } } }
  const OriginalURL = globalThis.URL; let sequence = 0
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL() { return `blob:web-${++sequence}` } static revokeObjectURL() {} })
  world = new ComponentPlatformRuntime('web-live-assets', { mode: 'edit', builtins: new Map([['guoling.web', { mount(context) {
    readLayout = context.layout!.read
    const projected = resolveWebResourceBindings(context.instance, id => world.contentAssetUrl(id))
    const html = authoredDocumentBootstrap(webDataSchema.parse(projected.data), { nonce: 'resources', instanceId: 'web', resources: world.resourceUrls(), resourceCss: instance.data.css,
      bridge: () => `window.refreshResources=(${refreshWebResourceReferences.toString()});` })
    realm = new JSDOM(html, { runScripts: 'dangerously' })
    context.scope.events.subscribe('__runtime.resources', resources => realm!.window.refreshResources(realm!.window.document, resources))
    return { update() {}, dispose() { realm!.window.close() } }
  } }]]) })
  const root = document.createElement('div'); document.body.append(root); world.bind('web', root)
  try {
    await world.sync(project, { assets: { a: before, b: before }, components: {} })
    const doc = realm!.window.document, a = doc.getElementById('a')!, b = doc.getElementById('b')!, input = doc.getElementById('answer') as HTMLInputElement
    input.value = '教师填写'; const old = a.getAttribute('src')
    expect(b.getAttribute('src')).toBe(old)
    await world.sync({ ...project, revision: 1, instances: { web: { ...instance, frame: { ...instance.frame, width: 460, transform: [1, 0, 0, 1, 70, 90] } } } }, { assets: { a: after, b: before }, components: {} })
    const next = a.getAttribute('src')!
    expect(next).not.toBe(old); expect(atob(next.split(',')[1])).toContain('blue')
    expect(b.getAttribute('src')).toBe(old)
    expect(doc.querySelector('style')!.textContent).toContain(next)
    expect([...doc.querySelectorAll('style')].some(style => style.textContent?.includes('.css-asset') && style.textContent.includes(next))).toBe(true)
    expect(doc.getElementById('answer')).toBe(input); expect(input.value).toBe('教师填写')
    expect(realm!.window.mountCount).toBe(1)
    expect(readLayout?.()).toMatchObject({ mode: 'free-frame', inlineSize: 460, blockSize: 180 })
    await world.sync({ ...project, revision: 2 }, { assets: { a: before, b: before }, components: {} })
    expect(a.getAttribute('src')).toBe(old); expect(b.getAttribute('src')).toBe(old)
    expect(input.value).toBe('教师填写'); expect(realm!.window.mountCount).toBe(1)
    expect(readLayout?.()).toMatchObject({ mode: 'free-frame', inlineSize: 320, blockSize: 180 })
    expect(instance.data.html).not.toContain('data-component-resource-bindings')
  } finally { await world.dispose(); root.remove(); vi.unstubAllGlobals() }
})
