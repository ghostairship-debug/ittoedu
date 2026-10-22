// @vitest-environment node
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'
import { jsonValueSchema, componentOperationBatchSchema } from '../../src/shared/contracts/component-platform/schema'
import { ownRecordSchema } from '../../src/shared/ownRecordSchema'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { readFileClipboardContext, fileClipboardResourcePort } from '../../src/renderer/documentFiles/fileDocumentClipboard'
import { createDefaultTeacherControllerPackage } from '../../src/shared/defaultTeacherControllerComponent'
import { documentComponentKey, readDocumentClipboardContext } from '../../src/renderer/document/documentClipboardContext'
import { documentResourceReferences } from '../../src/shared/document/resources'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { serializeDocumentMarkdown } from '../../src/shared/document/markdown'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { unzipFlatArchive, zipFlatArchive } from '../../src/core/drivers/codecs/flatArchive'
import { importComponentPackage, importComponentPackageAsync } from '../../src/core/drivers/codecs/importComponentPackage'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture root')
  await fs.rm(root, { recursive: true, force: true })
} })

describe('Audit JSON and file attachment consumers', () => {
  it('CA330 carries Ogg and M4A MIME through disk, canonical read, saved bytes and cold reopen', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-all-audio-')); roots.push(root)
    const blocks = ['ogg', 'm4a'].map(extension => ({ id: extension, type: 'media' as const, assetId: extension, mediaKind: 'audio' as const, layout: 'content-width' as const }))
    const resources = { assets: ['ogg', 'm4a'].map(extension => ({ assetId: extension, source: { kind: 'relative' as const, path: `sound.${extension}` } })), components: [] }
    const source = serializeDocumentMarkdown({ content: { blocks }, resources }, 'file'), filename = path.join(root, 'sound.md')
    await fs.writeFile(filename, source); await fs.writeFile(path.join(root, 'sound.ogg'), new Uint8Array([1])); await fs.writeFile(path.join(root, 'sound.m4a'), new Uint8Array([2]))
    const { documents } = createMarkdownTestHost(path.join(root, 'journal')), port = { ...createLessonDocumentFiles({ recoveryDirectory: path.join(root, 'recovery'), documents, validateTarget: async () => {} }), documents }
    const session = new DocumentFileSession({ kind: 'file', path: filename }, port)
    try {
      await session.open()
      expect((await session.readResource('sound.ogg')).mime).toBe('audio/ogg')
      expect((await port.readResource(session.ref, 'sound.m4a')).mime).toBe('audio/mp4')
      const context = await readFileClipboardContext(resources, relativePath => session.readResource(relativePath), { blocks })
      expect(Object.values(context.assets).map(asset => asset.meta.kind)).toEqual(['audio', 'audio'])
      session.edit(`${source}\n\n已保存音频`); expect(await session.flush()).toBe(true)
      const cold = createMarkdownTestHost(path.join(root, 'cold-journal')), opened = await cold.documents.open(filename)
      expect(opened.model.resources.assets['sound.ogg']).toEqual(new Uint8Array([1])); expect(opened.model.resources.assets['sound.m4a']).toEqual(new Uint8Array([2]))
    } finally { session.dispose() }
  })
  it('CA317 preserves nested own JSON keys and rejects an invalid own value at its real path', () => {
    const raw = JSON.parse('{"__proto__":{"constructor":{"prototype":[1,"ok"]}},"constructor":2}')
    const parsed = jsonValueSchema.parse(raw)
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(raw))
    expect(Object.hasOwn(parsed as object, '__proto__')).toBe(true)
    const invalid = ownRecordSchema(z.string(), z.number()).safeParse(JSON.parse('{"__proto__":"bad"}'))
    expect(invalid.success).toBe(false)
    if (!invalid.success) expect(invalid.error.issues[0].path).toEqual(['__proto__'])
    const inherited = Object.create({ inherited: 1 }); inherited.own = 2
    expect(Object.keys(ownRecordSchema(z.string(), z.number()).parse(inherited))).toEqual(['own'])
    expect(({} as any).polluted).toBeUndefined()
    expect(componentOperationBatchSchema.parse({ type: 'component-platform.apply', edits: [{ type: 'data.set', instanceId: 'item', path: ['constructor', '__proto__'], value: raw }], expected: [] }).edits).toHaveLength(1)
    expect(z.toJSONSchema(z.object({ value: jsonValueSchema }), { io: 'input', reused: 'ref' })).toMatchObject({ type: 'object' })
    expect(z.toJSONSchema(jsonValueSchema)).toHaveProperty('anyOf')
  })

  it('CA189/285/317/326 saves and cold-opens legal own identities, literal directories and case-distinct virtual modules', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-all-own-')); roots.push(root)
    const project = createBlankCourseProjectV10()
    Object.defineProperty(project.definitions, '__proto__', { value: { id: '__proto__', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: '__proto__', entry: 'main.js' } } }, enumerable: true })
    Object.defineProperty(project.instances, 'constructor', { value: { id: 'constructor', definitionId: '__proto__', data: JSON.parse('{"__proto__":{"prototype":"kept"}}') }, enumerable: true })
    testContainerInstance(project, 0).childIds.push('constructor')
    Object.defineProperty(project.assets, '__proto__', { value: { id: '__proto__', path: '__proto__', kind: 'image' }, enumerable: true })
    project.assets.literal = { id: 'literal', path: 'prototype/constructor/__proto__/image.png', kind: 'image' }
    const resources = { assets: Object.fromEntries([['__proto__', new Uint8Array([1, 2])], ['literal', new Uint8Array([4])]]), components: Object.fromEntries([['__proto__', Object.fromEntries(Object.entries({
      'main.js': new TextEncoder().encode('import "./Helper.js"; import "./helper.js"; export const render=()=>{}'),
      'Helper.js': new TextEncoder().encode('export const upper=1'), 'helper.js': new TextEncoder().encode('export const lower=2'),
    }).concat([['__proto__', new Uint8Array([3])]]))]]) }
    const bytes = createCourseProjectV10Archive({ project, resources }), filename = path.join(root, 'own.glx')
    await fs.writeFile(filename, bytes)
    const opened = openCourseProjectV10Archive(new Uint8Array(await fs.readFile(filename)))
    expect(Object.hasOwn(opened.project.definitions, '__proto__')).toBe(true)
    expect(Object.hasOwn(opened.project.assets, '__proto__')).toBe(true)
    expect(JSON.stringify(Object.values(opened.project.instances).find(instance => instance.id === 'constructor')!.data)).toBe('{"__proto__":{"prototype":"kept"}}')
    expect(Object.keys(opened.resources.components.__proto__)).toEqual(['main.js', 'Helper.js', 'helper.js', '__proto__'])
    const host = new DocumentHostService(path.join(root, 'journal')), live = await host.operate({ type: 'create', model: { kind: 'course-v10', project, resources }, suggestedName: 'owned.glx' }) as any
    expect(Object.hasOwn(live.model.resources.assets, '__proto__')).toBe(true)
    expect(Object.hasOwn(live.model.resources.components, '__proto__')).toBe(true)
    expect(Object.hasOwn(live.model.resources.components.__proto__, '__proto__')).toBe(true)
    const changed = await host.operate({ type: 'dispatch', operation: { documentId: live.documentId, epoch: live.epoch, baseRevision: live.revision,
      operationId: 'own-field', actor: 'human', mutation: { type: 'command', command: captureComponentOperation(live.model.project,
        [{ type: 'data.set', instanceId: 'constructor', path: ['__proto__', 'prototype'], value: 'changed' }]) } } }) as any
    expect(changed.status).toBe('applied')
    const savedFilename = path.join(root, 'owned.glx')
    await host.operate({ type: 'save', documentId: live.documentId, path: savedFilename })
    const cold = new DocumentHostService(path.join(root, 'other-journal')), snapshot = await cold.operate({ type: 'open', path: savedFilename }) as any
    expect(Object.hasOwn(snapshot.model.project.instances, 'constructor')).toBe(true)
    expect(Object.hasOwn(snapshot.model.resources.assets, '__proto__')).toBe(true)
    expect(snapshot.model.project.instances.constructor.data.__proto__.prototype).toBe('changed')
    expect(({} as any).prototype).toBeUndefined()
    const collision = structuredClone(project); collision.assets.other = { id: 'other', path: 'PROTOTYPE/constructor/__proto__/image.png' }
    expect(() => createCourseProjectV10Archive({ project: collision, resources: { ...resources, assets: { ...resources.assets, other: new Uint8Array([3]) } } })).toThrow('路径重复')
    const exactCollision = structuredClone(project); exactCollision.assets.__proto__.path = 'components/__proto__/Helper.js'
    expect(() => createCourseProjectV10Archive({ project: exactCollision, resources })).toThrow('路径重复')
  })

  it('CA345/330/317 reads only used resources and copies own-key audio with its formal kind', async () => {
    const blocks = [{ id: 'sound', type: 'media' as const, assetId: '__proto__', mediaKind: 'audio' as const, layout: 'content-width' as const }]
    const resources = { assets: [{ assetId: '__proto__', source: { kind: 'relative' as const, path: 'sound.mp4' } }, { assetId: 'unused', source: { kind: 'relative' as const, path: 'missing.png' } }], components: [] }
    const readPaths: string[] = []
    const context = await readFileClipboardContext(resources, async relativePath => { readPaths.push(relativePath); if (relativePath !== 'sound.mp4') throw new Error('missing'); return { bytes: new Uint8Array([1]), mime: 'video/mp4', filename: 'sound.mp4' } }, { blocks })
    expect(readPaths).toEqual(['sound.mp4']); expect(context.assets.__proto__.meta).toMatchObject({ kind: 'audio', mimeType: 'audio/mp4' })
    const actual = readDocumentClipboardContext(context), resolved = await actual.resolveAsset(resources.assets[0])
    expect(resolved.bytes).toEqual(new Uint8Array([1]))
    const prepared = await fileClipboardResourcePort(context).prepareResources({ resources: { assets: [resources.assets[0]], components: [] } } as any)
    expect(Object.hasOwn(prepared.assetIds, '__proto__')).toBe(true)
    expect(prepared.prepared.attachments).toHaveLength(1)
    expect(documentResourceReferences(blocks).assets).toEqual(['__proto__'])
  })

  it('CA362 keeps both package versions in the clipboard and file attachment preparation', async () => {
    const first = createDefaultTeacherControllerPackage()
    Object.defineProperty(first.manifest.assets, '__proto__', { value: '__proto__', enumerable: true })
    Object.defineProperty(first.files, '__proto__', { value: new Uint8Array([7, 8]), enumerable: true })
    first.files['manifest.json'] = new TextEncoder().encode(JSON.stringify(first.manifest))
    const second = structuredClone(first)
    second.manifest.version = '2.0.0'; second.files['manifest.json'] = new TextEncoder().encode(JSON.stringify(second.manifest))
    const resources = { assets: [], components: [first, second].map((data, index) => ({ packageId: data.manifest.id, version: data.manifest.version, source: { kind: 'relative' as const, path: `package${index}.h5component` } })) }
    const contexts = [first, second].map(data => zipFlatArchive(data.files))
    expect(Object.hasOwn(unzipFlatArchive(contexts[0]), '__proto__')).toBe(true)
    expect((await importComponentPackageAsync(contexts[0])).files.__proto__).toEqual(new Uint8Array([7, 8]))
    const context = await readFileClipboardContext(resources, async relativePath => ({ bytes: contexts[relativePath === 'package0.h5component' ? 0 : 1], mime: 'application/octet-stream', filename: relativePath }))
    expect(Object.keys(context.components)).toEqual(resources.components.map(documentComponentKey))
    const prepared = await fileClipboardResourcePort(context).prepareResources({ resources } as any)
    expect(prepared.resources.components.map(resource => resource.version)).toEqual([first.manifest.version, '2.0.0'])
    expect(prepared.prepared.attachments).toHaveLength(2)
    expect(importComponentPackage(prepared.prepared.attachments[0].bytes).files.__proto__).toEqual(new Uint8Array([7, 8]))
  })
})
