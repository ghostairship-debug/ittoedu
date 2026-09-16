import { describe, expect, it } from 'vitest'
import { createDefaultTeacherControllerPackage } from '../../src/shared/defaultTeacherControllerComponent'
import { createDocumentClipboardContext, readDocumentClipboardContext, selectDocumentClipboardContext } from '../../src/renderer/document/documentClipboardContext'
import type { DocumentResources } from '../../src/shared/document/resources'

function sample() {
  const data = createDefaultTeacherControllerPackage()
  const resources: DocumentResources = { assets: [{ assetId: 'image', source: { kind: 'project' } }], components: [{ packageId: data.manifest.id, version: data.manifest.version, source: { kind: 'project' } }] }
  const bytes = Uint8Array.of(137, 80, 78, 71)
  return { resources, data, context: createDocumentClipboardContext(resources, { assets: { image: { id: 'image', filename: 'image.png', mimeType: 'image/png', path: 'assets/image.png', byteLength: bytes.length, kind: 'image' } }, assetFiles: { image: bytes }, componentPackages: { [data.manifest.id]: data } }) }
}
describe('portable document clipboard resource context', () => {
  it('round trips real component files and asset bytes through JSON and projects only requested references', async () => {
    const { context, data, resources } = sample()
    const read = readDocumentClipboardContext(JSON.parse(JSON.stringify(context)))
    const asset = await read.resolveAsset(resources.assets[0])
    expect(Array.from(asset.bytes)).toEqual([137, 80, 78, 71])
    const component = await read.prepareComponent(resources.components[0])
    expect(component.data.runtimeSource).toBe(data.runtimeSource)
    expect(Object.keys(component.data.files)).toEqual(Object.keys(data.files))
    for (const [name, bytes] of Object.entries(data.files)) expect(Array.from(component.data.files[name])).toEqual(Array.from(bytes))
    expect(selectDocumentClipboardContext(context, { assets: resources.assets, components: [] }).components).toEqual({})
    asset.bytes[0] = 0
    expect((await read.resolveAsset(resources.assets[0])).bytes[0]).toBe(137)
  })
  it('rejects non-byte values, mismatched asset lengths and altered component executable declarations', () => {
    const { context } = sample()
    const fractional = structuredClone(context); fractional.assets.image.bytes[0] = 1.5
    expect(() => readDocumentClipboardContext(fractional)).toThrow()
    const truncated = structuredClone(context); truncated.assets.image.bytes.pop()
    expect(() => readDocumentClipboardContext(truncated)).toThrow('字节长度')
    const altered = structuredClone(context); Object.values(altered.components)[0].data.runtimeSource += '\n// changed'
    expect(() => readDocumentClipboardContext(altered)).toThrow('内容与声明')
  })
})
