import { afterEach, expect, it, vi } from 'vitest'
import { ComponentRegistry } from '../../src/player/ComponentRegistry'
import { mountPublishedComponent, type ComponentHostNode } from '../../src/player/surfaces/publishedComponentMount'
import type { ComponentAuthoringTargetUpdate } from '../../src/shared/componentTypes'
import type { PublishedCourseComponent } from '../../src/shared/publishedCourseTypes'

// M15: a component's own text and pictures are found by the host and edited as rules; its source never registers anything.
function encodeUtf16LeBase64(source: string): { encoding: 'base64-utf16le'; data: string } {
  const bytes = new Uint8Array(source.length * 2)
  for (let i = 0; i < source.length; i++) { const code = source.charCodeAt(i); bytes[i * 2] = code & 0xff; bytes[i * 2 + 1] = code >>> 8 }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { encoding: 'base64-utf16le', data: btoa(binary) }
}
const SOURCE = `
window.CoursewareComponent.define({
  id: 'card-component',
  runtimeApiVersion: 4,
  create(context) {
    var root = context.dom.root
    root.innerHTML = '<section><h2>标题</h2><p>说明文字</p><img alt=""><span data-courseware-edit-key="note">声明的文字</span></section>'
    root.querySelector('img').setAttribute('src', context.assetUrl('pic'))
    return { destroy: function () { root.innerHTML = '' } }
  },
})
`
const component = {
  id: 'card-component', name: '卡片', version: '1.0.0', contentSha256: 'sha', apiVersion: 4, scopes: ['scene'], renderMode: 'dom',
  code: encodeUtf16LeBase64(SOURCE), assets: { pic: { mimeType: 'image/png', url: 'data:image/png;base64,T0xE' } },
} as unknown as PublishedCourseComponent
const node = (): ComponentHostNode => ({
  id: 'card', name: '卡片', type: 'external-component', x: 100, y: 80, width: 200, height: 100, rotation: 0, opacity: 1, visible: true,
  playbackInitialVisibility: 'inherit', locked: false, component: { packageId: 'card-component', version: '1.0.0' }, props: {},
} as unknown as ComponentHostNode)
const rect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve() }

afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect'); document.body.innerHTML = '' })

it('M15 applies a component item’s text rules and replaced pictures, publishes what it renders as targets, and updates rules in place', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect(0, 0, 200, 100))
  // jsdom has no text layout; every text measures one fixed box here.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(20, 10, 80, 24) })
  const container = document.createElement('div')
  document.body.append(container)
  const updates: ComponentAuthoringTargetUpdate[] = []
  const handle = mountPublishedComponent(container, {
    container, componentId: 'card-component', version: '1.0.0', instanceId: 'card', width: 200, height: 100,
    components: { 'card-component@1.0.0': component }, registry: new ComponentRegistry(), mode: 'edit', scope: 'scene', sceneId: 'scene-1',
    textOverrides: [{ original: '标题', text: '新标题' }],
    assetOverrides: { pic: { assetId: 'asset-new' } },
    resolveAsset: assetId => assetId === 'asset-new' ? 'data:image/png;base64,TkVX' : undefined,
    authoring: { node: node(), onTargetsChanged: update => updates.push(update) },
  })
  expect(handle.ok).toBe(true)
  const root = container.querySelector('.published-component-mount')!.shadowRoot!
  expect(root.querySelector('h2')!.textContent).toBe('新标题')
  expect(root.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,TkVX')

  await settle()
  const targets = updates.at(-1)!.targets
  expect(targets).toEqual([
    expect.objectContaining({ kind: 'component-text', source: 'auto', key: '', label: '新标题', nodeId: 'card',
      bounds: { x: 120, y: 90, width: 80, height: 24 }, lightEdit: { original: '标题', region: expect.any(String), text: '新标题' } }),
    expect.objectContaining({ kind: 'component-text', source: 'auto', label: '说明文字', lightEdit: expect.objectContaining({ original: '说明文字', text: '说明文字' }) }),
    // Declared text keeps its own path; the picture is found by its manifest asset.
    expect.objectContaining({ kind: 'component-image', source: 'auto', assetKey: 'pic', nodeId: 'card' }),
  ])

  // Undo of the rule: the component shows its own text again, without being recreated.
  handle.setTextOverrides?.([])
  expect(root.querySelector('h2')!.textContent).toBe('标题')
  await settle()
  expect(updates.at(-1)!.targets[0]).toMatchObject({ label: '标题', lightEdit: { original: '标题', text: '标题' } })
  handle.destroy()
})

it('M15 in the editor a component package shows its own pictures from its files and offers them as targets', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect(0, 0, 200, 100))
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(20, 10, 80, 24) })
  const container = document.createElement('div')
  document.body.append(container)
  const encode = (value: string) => new TextEncoder().encode(value)
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
  // The editor's package is its files; it has no published asset URLs.
  const pkg = {
    manifest: { schemaVersion: 4, runtimeApiVersion: 4, id: 'card-component', version: '1.0.0', name: '卡片', entry: 'runtime.js', renderMode: 'dom',
      supportedScopes: ['scene'], defaultSize: { width: 200, height: 100 }, assets: { pic: 'pic.png' }, defaultProps: {}, editor: { properties: [] } },
    runtimeSource: SOURCE, files: { 'manifest.json': encode('{}'), 'runtime.js': encode(SOURCE), 'pic.png': png },
  }
  const updates: ComponentAuthoringTargetUpdate[] = []
  const handle = mountPublishedComponent(container, {
    container, componentId: 'card-component', version: '1.0.0', instanceId: 'card', width: 200, height: 100,
    components: { 'card-component@1.0.0': pkg as never }, registry: new ComponentRegistry(), mode: 'edit', scope: 'scene', sceneId: 'scene-1',
    authoring: { node: node(), onTargetsChanged: update => updates.push(update) },
  })
  expect(handle.ok).toBe(true)
  const root = container.querySelector('.published-component-mount')!.shadowRoot!
  expect(root.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,iVBORw==')
  await settle()
  expect(updates.at(-1)!.targets).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'component-image', assetKey: 'pic' })]))
  handle.destroy()
})
