// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { normalizeEffectiveLayerPropertyPatch, writeBasePropertyPatch } from '../../src/core/drivers/course/layerProperties'
import { layerItemSchema } from '../../src/shared/courseProjectSchema'
import type { DocumentModel } from '../../src/shared/workbench/document'

const md = new MarkdownDriver()
const v9 = new CourseV9Driver()
function fixture(name = 'slide-native'): Extract<DocumentModel, { kind: 'course-v9' }> {
  return v9.load(new Uint8Array(readFileSync(resolve('tests/fixtures/course-project-v9', `${name}.h5lesson`)))) as Extract<DocumentModel, { kind: 'course-v9' }>
}

describe('G20 pure document drivers', () => {
  it('preserves Markdown BOM, CRLF, references, HTML and unsupported syntax without rendering', () => {
    const source = '\uFEFF# 中文 😀\r\n\r\n[ref]: assets/a.png\r\n![a][ref]\r\n<div>raw</div>\r\n\r\n$$unfinished\r\n'
    const bytes = new TextEncoder().encode(source)
    const model = md.load(bytes)
    expect(model).toMatchObject({ kind: 'markdown', source })
    expect(md.serialize(model)).toEqual(bytes)
    expect(() => md.load(new Uint8Array([0xc3, 0x28]))).toThrow()
  })

  it('applies UTF-16 splices with owned attachment bytes and refuses stale or split-scalar ranges', () => {
    const initial = md.load(new TextEncoder().encode('甲😀乙'))
    const attachment = new Uint8Array([1, 2, 3])
    const result = md.apply(initial, { type: 'markdown.splice', from: 1, to: 3, text: '丙', resources: { assets: { 'images/a.png': attachment }, components: {} } })
    attachment[0] = 9
    expect(result).toMatchObject({ source: '甲丙乙' })
    expect(result.resources.assets['images/a.png']).toEqual(new Uint8Array([1, 2, 3]))
    expect(initial).toMatchObject({ source: '甲😀乙' })
    for (const [from, to] of [[-1, 0], [0, 8], [1, 2], [1.5, 3]]) {
      expect(() => md.apply(initial, { type: 'markdown.splice', from, to, text: '' })).toThrow()
    }
    expect(() => md.apply(initial, { type: 'markdown.replace', source: 'ok', resources: { assets: { '../x': new Uint8Array([1]) }, components: {} } })).toThrow()
    expect(() => md.apply(initial, { type: 'markdown.replace', source: 'ok', resources: { assets: { 'images/a.png': attachment, images: attachment }, components: {} } })).toThrow('冲突')
  })

  it.each(['slide-native', 'component', 'mixed'])('round trips %s through the production strict archive and resource closure', name => {
    const model = fixture(name)
    const reopened = v9.load(v9.serialize(model))
    expect(reopened).toEqual(model)
    const broken = structuredClone(model)
    const asset = Object.keys(broken.resources.assets)[0]
    const component = Object.keys(broken.resources.components)[0]
    if (asset) delete broken.resources.assets[asset]
    else if (component) delete broken.resources.components[component]
    else throw new Error('Closure fixture requires a real resource')
    expect(() => v9.serialize(broken)).toThrow()
  })

  it('patches an explicit background page without changing another page or requiring a view', async () => {
    const model = fixture()
    const surface = model.project.surfaces.find(value => value.type === 'slide')!
    if (surface.type !== 'slide') throw new Error('fixture')
    const first = surface.scenes[0]!
    const third = structuredClone(first)
    third.id = 'third-scene'
    third.layerItems = third.layerItems.map(item => ({ ...item, layerItemId: `${item.layerItemId}-third` }))
    surface.scenes.push(third)
    model.project.locations.push({ id: 'third-location', label: '第三页', kind: 'slide-scene', surfaceId: surface.id, sceneId: third.id })
    const startLocationId = model.project.startLocationId
    const itemId = third.layerItems[0]!.layerItemId
    const pending = v9.apply(model, { type: 'course.object.patch', locationId: 'third-location', itemId, patch: { frame: { x: 211 }, opacity: 0.6 } })
    expect(pending).not.toBeInstanceOf(Promise) // No text measurement is needed.
    const next = await pending
    if (next.kind !== 'course-v9' || next.project.surfaces[0]!.type !== 'slide') throw new Error('kind')
    expect(next.project.surfaces[0].scenes[0]).toEqual(first)
    expect(next.project.surfaces[0].scenes[1]!.layerItems[0]).toMatchObject({ frame: { x: 211 }, opacity: 0.6 })
    expect(next.project.startLocationId).toBe(startLocationId)
    expect(next.project.revision).toBe(model.project.revision)
    expect(() => v9.apply(model, { type: 'course.object.patch', locationId: startLocationId, itemId, patch: { visible: false } })).toThrow('不属于')
    const updated = v9.withRevision(next, model.project.revision + 1)
    expect(v9.load(v9.serialize(updated))).toEqual(updated)
    expect(() => v9.withRevision(updated, model.project.revision)).toThrow('单调')
  })

  it('rejects replacement identity/revision changes and preserves the input on failed property edits', () => {
    const model = fixture(), original = structuredClone(model)
    expect(() => v9.apply(model, { type: 'course.replace', project: { ...model.project, id: 'other' } })).toThrow('身份')
    expect(() => v9.apply(model, { type: 'course.replace', project: { ...model.project, revision: 20 } })).toThrow('基准')
    const location = model.project.locations[0]!, surface = model.project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('fixture')
    const itemId = surface.scenes[0]!.layerItems[0]!.layerItemId
    for (const patch of [{ frame: { width: -1 } }, { unknownField: true }, { opacity: NaN }]) {
      expect(() => v9.apply(model, { type: 'course.object.patch', locationId: location.id, itemId, patch })).toThrow()
    }
    expect(model).toEqual(original)
  })

  it('shares renderer property rules while keeping optional text measurement outside the pure planner', () => {
    const item = layerItemSchema.parse({ layerItemId: 'shape', label: 'Line', frame: { mode: 'absolute', x: 0, y: 0, width: 100, height: 100 }, rotation: 0, opacity: 1, visible: true, locked: false, order: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
      kind: 'native', content: { nativeType: 'shape', data: { shapeType: 'line', style: { fillColor: '#000000', fillOpacity: 1, borderColor: '#000000', borderOpacity: 1, borderWidth: 1, cornerRadius: 0, lineStyle: 'solid', startArrow: 'none', endArrow: 'none' }, lineGeometry: { kind: 'straight', start: [0, 0], end: [1, 1] } } } })
    const { patch } = normalizeEffectiveLayerPropertyPatch(item, 'scene', { nativeData: { shapeType: 'rectangle' } }, { allowOwnedNativeData: true })
    writeBasePropertyPatch(item, patch)
    expect(item).toMatchObject({ content: { data: { shapeType: 'rectangle' } } })
    expect('lineGeometry' in (item.kind === 'native' ? item.content.data : {})).toBe(false)
    expect(() => normalizeEffectiveLayerPropertyPatch({ ...item, locked: true }, 'scene', { opacity: 0.2 })).toThrow('locked')
    expect(normalizeEffectiveLayerPropertyPatch({ ...item, locked: true }, 'scene', { locked: false }).changed).toBe(true)
  })
})
