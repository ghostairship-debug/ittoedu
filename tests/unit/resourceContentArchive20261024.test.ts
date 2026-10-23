// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8 } from 'fflate'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { unzipFlatArchive, zipFlatArchive } from '../../src/core/drivers/codecs/flatArchive'
import { createResourceContentIndex, resourceContentSha256, resourceContentSha256Async } from '../../src/shared/resourceContent'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { DocumentOperation } from '../../src/shared/workbench/document'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../src/core/components/library/archive'

function fixture() {
  const project = createBlankCourseProjectV10('Shared content; independent editing identities')
  project.assets.first = { id: 'first', path: 'assets/first.webp', mimeType: 'image/webp', filename: 'First source' }
  project.assets.second = { id: 'second', path: 'assets/second.webp', mimeType: 'image/webp', filename: 'Second source' }
  const image = new Uint8Array([82, 73, 70, 70, 1, 7, 11])
  const source = strToU8('export default { mount() {} }')
  const resources = { assets: { first: image, second: Uint8Array.from(image) }, components: {
    ownerA: { 'main.js': source, 'assets/picture.webp': Uint8Array.from(image) },
    ownerB: { 'main.js': Uint8Array.from(source), 'assets/other.webp': Uint8Array.from(image) },
  } }
  return { project, resources }
}

describe('content-addressed GLX storage over existing logical resources', () => {
  it('uses the same content identity for independent byte views without equating mutable logical IDs', async () => {
    const index = createResourceContentIndex(), source = strToU8('abc')
    expect(resourceContentSha256(source)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await resourceContentSha256Async(source)).toBe(resourceContentSha256(source))
    expect(index.add(source)).toBe(index.add(Uint8Array.from(source)))
    expect([...index.values()]).toHaveLength(1)
    source[0] = 100
    // No persistent object-identity hash cache: a later snapshot sees changed content.
    expect(resourceContentSha256(source)).not.toBe([...index.values()][0].sha256)
  })

  it('stores a project/each component resource binary once while retaining all metadata and local paths', () => {
    const initial = fixture(), archive = createCourseProjectV10Archive(initial), files = unzipFlatArchive(archive)
    const index = JSON.parse(strFromU8(files['resource-index.json']))
    expect(index).toMatchObject({ format: 'guoling-resource-index', version: 1 })
    expect(Object.keys(index.paths)).toHaveLength(6)
    expect(Object.keys(files).filter(path => path.startsWith('resources/sha256/'))).toHaveLength(2)
    const opened = openCourseProjectV10Archive(archive)
    expect(opened.project).toEqual(initial.project)
    expect(opened.resources).toEqual(initial.resources)
    opened.resources.assets.first[0] = 255
    expect(opened.resources.assets.second[0]).toBe(82)
    expect(opened.resources.components.ownerA['assets/picture.webp'][0]).toBe(82)
    expect(initial.resources.assets.first[0]).toBe(82)
  })

  it('reads existing path archives and preserves an asset whose logical name is the index filename', () => {
    const initial = fixture(), files: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(initial.project)) }
    for (const [id, asset] of Object.entries(initial.project.assets)) files[asset.path] = initial.resources.assets[id as 'first' | 'second']
    for (const [id, component] of Object.entries(initial.resources.components)) for (const [path, bytes] of Object.entries(component)) files[`components/${id}/${path}`] = bytes
    expect(openCourseProjectV10Archive(zipFlatArchive(files))).toEqual(initial)
    initial.project.assets.first.path = 'resource-index.json'
    delete files['assets/first.webp']
    files['project.json'] = strToU8(JSON.stringify(initial.project))
    files['resource-index.json'] = initial.resources.assets.first
    expect(openCourseProjectV10Archive(zipFlatArchive(files))).toEqual(initial)
    expect(openCourseProjectV10Archive(createCourseProjectV10Archive(initial))).toEqual(initial)
  })

  it('diagnoses missing, altered and unowned stored content instead of silently substituting a neighbor', () => {
    const archive = createCourseProjectV10Archive(fixture()), files = unzipFlatArchive(archive)
    const path = Object.keys(files).find(path => path.startsWith('resources/sha256/'))!
    const missing = { ...files }; delete missing[path]
    expect(() => openCourseProjectV10Archive(zipFlatArchive(missing))).toThrow('资源实体缺失')
    const changed = { ...files, [path]: new Uint8Array([99]) }
    expect(() => openCourseProjectV10Archive(zipFlatArchive(changed))).toThrow('内容与索引不符')
    expect(() => openCourseProjectV10Archive(zipFlatArchive({ ...files, 'unowned.bin': new Uint8Array([3]) }))).toThrow('未归属文件')
  })

  it('uses the same physical content pool for extracted library assets and each source-owner file', () => {
    const initial = fixture(), entry = { schemaVersion: 2 as const, id: 'shared-library', title: 'Shared library',
      definitions: initial.project.definitions, example: { instances: initial.project.instances, rootIds: initial.project.rootIds },
      assets: initial.project.assets, resources: initial.resources }
    const archive = exportComponentLibraryArchive(entry), files = unzipFlatArchive(archive)
    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest.resources.assets.first).toBe(manifest.resources.assets.second)
    expect(manifest.resources.assets.first).toBe(manifest.resources.components.ownerA['assets/picture.webp'])
    expect(Object.keys(files).filter(path => path.startsWith('resources/sha256/'))).toHaveLength(2)
    const opened = importComponentLibraryArchive(archive).entry
    expect(opened.assets).toEqual(initial.project.assets)
    expect(opened.resources).toEqual(initial.resources)
    opened.resources.assets.first[0] = 99
    expect(opened.resources.assets.second[0]).toBe(82)
    expect(opened.resources.components.ownerA['assets/picture.webp'][0]).toBe(82)
  })

  it('keeps canonical replacement, Undo/Redo and a saved cold reopen independent for shared binaries', async () => {
    const driver = new CourseV10Driver(), model = driver.load(createCourseProjectV10Archive(fixture()))
    const session = await DocumentSession.create({ documentId: 'cas-resources', epoch: 'epoch',
      binding: { kind: 'untitled', suggestedName: 'shared.glx' }, model }, driver,
    { append: async () => {}, save: async () => { throw new Error('saved codec verified directly') } })
    const read = () => {
      const current = session.read().model
      if (current.kind !== 'course-v10') throw new Error('Expected work project')
      return current
    }
    const execute = (mutation: DocumentOperation['mutation']) => session.execute({ documentId: session.documentId, epoch: 'epoch',
      baseRevision: session.read().revision, operationId: crypto.randomUUID(), actor: 'human', mutation })
    const original = read(), changedBytes = new Uint8Array([9, 8, 7])
    const command = captureComponentOperation(original.project, [{ type: 'asset.replace', asset: original.project.assets.first,
      bytes: changedBytes, expectedBytes: original.resources.assets.first }])
    expect(await execute({ type: 'command', command })).toMatchObject({ status: 'applied' })
    expect(read().resources.assets.first).toEqual(changedBytes)
    expect(read().resources.assets.second).toEqual(original.resources.assets.second)
    expect(read().resources.components).toEqual(original.resources.components)
    expect(await execute({ type: 'undo' })).toMatchObject({ status: 'applied' })
    expect(read().resources).toEqual(original.resources)
    expect(await execute({ type: 'redo' })).toMatchObject({ status: 'applied' })
    const cold = driver.load(driver.serialize(read()))
    expect(cold).toEqual(read())
    expect(cold.resources.assets.first).toEqual(changedBytes)
    expect(cold.resources.assets.second).toEqual(original.resources.assets.second)
    expect(cold.resources.components).toEqual(original.resources.components)
  })
})
