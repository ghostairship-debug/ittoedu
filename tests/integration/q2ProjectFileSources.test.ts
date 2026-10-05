// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const encode = (value: string) => new TextEncoder().encode(value)
const source = 'export default { mount(){return {update(){},dispose(){}}} };'
const frame = { width: 170, height: 70, transform: [1, 0, 0, 1, 42, 31] as [number, number, number, number, number, number] }
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="blue"/></svg>'
function model(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
  return snapshot.model
}

it('uses live project tools for shared/private source, confined relative imports, conflict ACK and resource save/cold reopen', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-q2-source-'))
  try {
    const project = createBlankCourseProjectV10('Source files')
    project.definitions.custom = { id: 'custom', title: '程序', role: 'content', version: 'one', dataSchema: { type: 'object' },
      implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'shared', entry: 'main.js' } } }
    for (const id of ['a', 'b']) project.instances[id] = { id, definitionId: 'custom', data: { value: id }, frame }
    project.surfaces[0].childIds = ['a', 'b']
    const host = new DocumentHostService(path.join(root, 'recovery'))
    const initial = await host.internalAPI.create({ kind: 'course-v10', project,
      resources: { assets: {}, components: { shared: { 'main.js': encode(source), 'helper.js': encode('export const value=1;'), 'a.bin': Uint8Array.of(255, 1), 'b.bin': Uint8Array.of(255, 2), 'opaque.bin': Uint8Array.of(255, 0, 128) } } } }, 'sources.h5lesson')
    await host.tools.beginRun({ runId: 'source', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await host.tools.loadToolFamilies('source', ['content'])
    let serial = 0
    const tool = (name: string, input: unknown) => host.tools.execute('source', `call-${++serial}`, { name, input })
    const shared = componentProjectFiles(project, model(initial).resources).find(file => file.binding?.kind === 'definition-source' && file.binding.definitionId === 'custom' && file.sourceFile?.path === 'main.js')!
    await tool('project.read', { path: shared.path })
    const edited = source.replace('mount()', 'value:2,mount()')
    expect(await tool('project.apply', { path: shared.path, content: edited })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    let current = await host.internalAPI.read(initial.documentId)
    expect(model(current).project.definitions.custom).toMatchObject({ version: 'one', dataSchema: { type: 'object' } })
    expect(model(current).resources.components.shared['opaque.bin']).toEqual(Uint8Array.of(255, 0, 128))
    expect(model(current).resources.components.shared['main.js']).toEqual(encode(edited))
    const sharedBinary = componentProjectFiles(model(current).project, model(current).resources).find(file => file.binding?.kind === 'definition-source' && file.sourceFile?.path === 'b.bin')!
    await tool('project.read', { path: sharedBinary.path })
    expect(await tool('project.apply', { path: 'theme.css', content: '.lesson{color:blue}' })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    await fs.writeFile(path.join(root, 'b.bin'), Uint8Array.of(255, 3))
    expect(await tool('project.apply', { path: sharedBinary.path, from: 'b.bin' })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    current = await host.internalAPI.read(initial.documentId)
    expect(model(current).resources.components.shared['a.bin']).toEqual(Uint8Array.of(255, 1))
    expect(model(current).resources.components.shared['b.bin']).toEqual(Uint8Array.of(255, 3))
    const helper = componentProjectFiles(model(current).project, model(current).resources).find(file => file.binding?.kind === 'definition-source' && file.sourceFile?.path === 'helper.js')!
    await tool('project.read', { path: helper.path })
    await fs.mkdir(path.join(root, 'edit'))
    await fs.writeFile(path.join(root, 'edit/helper.js'), 'export const value=5;')
    expect(await tool('project.apply', { path: helper.path, from: 'edit/helper.js' })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    current = await host.internalAPI.read(initial.documentId)
    expect(model(current).project.definitions.custom.implementation).toMatchObject({ workspace: { entry: 'main.js' } })
    expect(model(current).resources.components.shared['main.js']).toEqual(encode(edited))
    expect(model(current).resources.components.shared['helper.js']).toEqual(encode('export const value=5;'))
    expect(model(current).resources.components.shared['opaque.bin']).toEqual(Uint8Array.of(255, 0, 128))
    const privateFile = componentProjectFiles(model(current).project, model(current).resources).find(file => file.target?.kind === 'instance' && file.target.instanceId === 'a' && file.sourceFile?.path === 'main.js')!
    await tool('project.read', { path: privateFile.path })
    expect(await tool('project.apply', { path: privateFile.path, content: edited.replace('value:2', 'value:3') })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    current = await host.internalAPI.read(initial.documentId)
    const privateImplementation = model(current).project.instances.a.implementationOverride
    if (privateImplementation?.kind !== 'source' || !privateImplementation.workspace) throw new Error('Private source workspace missing')
    expect(privateImplementation.workspace.ownerId).not.toBe('shared')
    expect(model(current).resources.components[privateImplementation.workspace.ownerId]['opaque.bin']).toEqual(Uint8Array.of(255, 0, 128))
    expect(model(current).project.instances.b.implementationOverride).toBeUndefined()
    const privateBinary = componentProjectFiles(model(current).project, model(current).resources).find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'a' && file.sourceFile?.path === 'b.bin')!
    await tool('project.read', { path: privateBinary.path })
    await fs.writeFile(path.join(root, 'private.bin'), Uint8Array.of(255, 4))
    expect(await tool('project.apply', { path: privateBinary.path, from: 'private.bin' })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    current = await host.internalAPI.read(initial.documentId)
    expect(model(current).resources.components[privateImplementation.workspace.ownerId]['b.bin']).toEqual(Uint8Array.of(255, 4))
    expect(model(current).resources.components.shared['b.bin']).toEqual(Uint8Array.of(255, 3))
    await tool('project.read', { path: shared.path })
    await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, actor: 'human', operationId: 'shared-human',
      mutation: { type: 'command', command: captureComponentOperation(model(current).project, [{ type: 'definition.set', definition: { ...model(current).project.definitions.custom, title: '人工名称' } }]) } })
    expect(await tool('project.apply', { path: shared.path, content: edited.replace('value:2', 'value:9') })).toMatchObject({ kind: 'read', data: { commit: 'not_committed', receipt: { status: 'conflict' } } })
    await fs.mkdir(path.join(root, 'modules'))
    await fs.writeFile(path.join(root, 'modules/entry.cjs'), 'const helper=require("./helper.js"); module.exports={value:helper.value,mount(){return {update(){},dispose(){}}}};')
    await fs.writeFile(path.join(root, 'modules/helper.js'), 'exports.value=7;')
    await tool('project.list', {})
    const fresh = componentProjectFiles(model(await host.internalAPI.read(initial.documentId)).project, model(current).resources).find(file => file.binding?.kind === 'definition-source' && file.binding.definitionId === 'custom' && file.sourceFile?.path === 'main.js')!
    expect(await tool('project.apply', { path: fresh.path, from: 'modules/entry.cjs' })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    await fs.writeFile(path.join(root, 'paper.svg'), svg)
    await fs.writeFile(path.join(root, 'theme.css'), '.lesson{background-image:url("./paper.svg")}')
    const themeResult = await tool('project.apply', { path: 'theme.css', from: 'theme.css' })
    expect(themeResult, JSON.stringify(themeResult.kind === 'read' ? (themeResult.data as { diagnostics?: unknown; receipt?: unknown }).diagnostics : themeResult)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    current = await host.internalAPI.read(initial.documentId)
    const themeAssetId = Object.values(model(current).project.theme!.assets!)[0].assetId
    const asset = model(current).project.assets[themeAssetId]
    await tool('project.read', { path: asset.path })
    const replacedSvg = svg.replace('blue', 'green').replaceAll('30', '60')
    expect(await tool('project.apply', { path: asset.path, content: replacedSvg })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const history = async (type: 'undo' | 'redo') => {
      const snapshot = await host.internalAPI.read(initial.documentId)
      return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
        operationId: `asset-${type}`, actor: 'human', mutation: { type } })
    }
    expect((await history('undo')).status).toBe('applied')
    expect(model(await host.internalAPI.read(initial.documentId)).resources.assets[themeAssetId]).toEqual(encode(svg))
    expect((await history('redo')).status).toBe('applied')
    const filename = path.join(root, 'saved.h5lesson')
    await host.internalAPI.save(initial.documentId, filename)
    const reopened = model(await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename))
    const sharedImplementation = reopened.project.definitions.custom.implementation
    if (sharedImplementation.kind !== 'source' || !sharedImplementation.workspace) throw new Error('Shared source entry missing')
    expect(sharedImplementation.workspace.entry).toBe('main.js')
    expect(Object.keys(reopened.resources.components[sharedImplementation.workspace.ownerId]).sort()).toEqual(['a.bin', 'b.bin', 'entry.cjs', 'helper.js', 'main.js', 'opaque.bin'])
    expect(reopened.resources.components[sharedImplementation.workspace.ownerId]['main.js']).toEqual(encode('const helper=require("./helper.js"); module.exports={value:helper.value,mount(){return {update(){},dispose(){}}}};'))
    expect(reopened.project.instances.a.frame).toEqual(frame)
    expect(reopened.project.instances.b.data).toEqual({ value: 'b' })
    const assetId = Object.values(reopened.project.theme!.assets!)[0].assetId
    expect(assetId).toBe(themeAssetId)
    expect(reopened.resources.assets[assetId]).toEqual(encode(replacedSvg))
    expect(reopened.project.assets[assetId]).toMatchObject({ width: 60, height: 20 })
    expect(reopened.resources.components[privateImplementation.workspace.ownerId]['b.bin']).toEqual(Uint8Array.of(255, 4))
    expect(reopened.project.definitions.custom.title).toBe('人工名称')
    await host.tools.stop('source')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('round-trips HTML/Markdown professional body and software-owned spatial targets without touching floats or private files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-q2-body-'))
  try {
    const project = createBlankCourseProjectV10('Body files'), text = createTextComponentData()
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
    project.instances.paragraph = { id: 'paragraph', definitionId: TEXT_DEFINITION.id, data: { ...text, content: { inlines: [{ type: 'text', text: '旧正文' }] } } }
    project.instances.opaque = { id: 'opaque', definitionId: 'web', data: { html: '<button>原互动</button>' }, frame }
    project.instances.float = { id: 'float', definitionId: TEXT_DEFINITION.id, data: text, frame, flowPlacement: { space: 'paper', plane: 'overlay' } }
    project.instances.spatial = { id: 'spatial', definitionId: TEXT_DEFINITION.id, data: text, frame }
    project.surfaces.push({ id: 'flow', kind: 'flow', title: '讲义', childIds: ['paragraph', 'opaque', 'float'], flow: { layout: { readingWidth: 800, wideContentWidth: 1000 } } },
      { id: 'spatial', kind: 'spatial', title: '空间', childIds: ['spatial'], spatial: { home: { x: 0, y: 0, zoom: 1 },
        frames: [{ id: 'camera', pose: { x: 50, y: 40, zoom: 1 }, targetInstanceId: 'spatial' }] } })
    const host = new DocumentHostService(path.join(root, 'recovery'))
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'body.h5lesson')
    await host.tools.beginRun({ runId: 'body', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await host.tools.loadToolFamilies('body', ['content'])
    let serial = 0
    const tool = (name: string, input: unknown) => host.tools.execute('body', `call-${++serial}`, { name, input })
    let files = componentProjectFiles(project, model(initial).resources)
    const html = files.find(file => file.binding?.kind === 'flow' && file.binding.format === 'html')!
    await tool('project.read', { path: html.path })
    await fs.writeFile(path.join(root, 'photo.svg'), svg)
    await fs.writeFile(path.join(root, 'body.html'), html.content!.replace('旧正文', 'HTML正文').replace('</body>', '<img src="./photo.svg" alt="照片"></body>'))
    const bodyResult = await tool('project.apply', { path: html.path, from: 'body.html' })
    const failure = bodyResult.kind === 'read' ? (bodyResult.data as { diagnostics?: unknown }).diagnostics : bodyResult
    expect(bodyResult, JSON.stringify(failure)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    let current = await host.internalAPI.read(initial.documentId)
    expect(model(current).project.instances.float).toEqual(project.instances.float)
    expect(model(current).project.instances.opaque).toEqual(project.instances.opaque)
    expect(model(current).project.instances.paragraph.data).toMatchObject({ content: { inlines: [{ type: 'text', text: 'HTML正文' }] } })
    files = componentProjectFiles(model(current).project, model(current).resources)
    const markdown = files.find(file => file.binding?.kind === 'flow' && file.binding.format === 'markdown')!
    await tool('project.read', { path: markdown.path })
    await fs.writeFile(path.join(root, 'second.svg'), svg.replace('blue', 'red'))
    await fs.writeFile(path.join(root, 'body.md'), `${markdown.content!.replace('HTML正文', 'Markdown正文')}\n\n![第二图片](./second.svg)\n`)
    expect(await tool('project.apply', { path: markdown.path, from: 'body.md' })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const spatial = files.find(file => file.binding?.kind === 'spatial')!
    const camera = JSON.parse(spatial.content!)
    expect(camera.stops[0].id).toBeUndefined()
    expect(camera.stops[0].target).toContain('pages/')
    camera.stops[0].pose.zoom = 2
    camera.stops.push({ title: '新镜头', pose: { x: 0, y: 0, zoom: 1 } })
    await tool('project.read', { path: spatial.path })
    expect(await tool('project.apply', { path: spatial.path, content: JSON.stringify(camera) })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const filename = path.join(root, 'body.h5lesson')
    await host.internalAPI.save(initial.documentId, filename)
    const reopened = model(await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename))
    expect(reopened.project.instances.paragraph.data).toMatchObject({ content: { inlines: [{ type: 'text', text: 'Markdown正文' }] } })
    expect(reopened.project.instances.float).toEqual(project.instances.float)
    expect(reopened.project.instances.opaque.frame).toEqual(frame)
    expect(reopened.project.surfaces.find(surface => surface.id === 'spatial')!.spatial!.frames).toMatchObject([
      { id: 'camera', targetInstanceId: 'spatial', pose: { zoom: 2 } }, { title: '新镜头' }])
    expect(Object.values(reopened.project.assets).filter(asset => asset.mimeType === 'image/svg+xml')).toHaveLength(2)
    await host.tools.stop('body')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

it('admits usable HTML body with a missing local media diagnostic and keeps its recoverable source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-q2-partial-'))
  try {
    const project = createBlankCourseProjectV10('Partial body')
    project.surfaces.push({ id: 'flow', kind: 'flow', title: '讲义', childIds: [] })
    const host = new DocumentHostService(path.join(root, 'recovery'))
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'partial.h5lesson')
    await host.tools.beginRun({ runId: 'partial', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await host.tools.loadToolFamilies('partial', ['content'])
    const file = componentProjectFiles(project, model(initial).resources).find(file => file.binding?.kind === 'flow' && file.binding.format === 'html')!
    const html = '<p>可用正文</p><img src="../assets/missing.svg" alt="待补图片">'
    await fs.writeFile(path.join(root, 'partial.html'), html)
    const result = await host.tools.execute('partial', 'apply', { name: 'project.apply', input: { path: file.path, from: 'partial.html' } })
    expect(result).toMatchObject({ kind: 'read', data: { commit: 'committed', usability: 'partial', diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'flow-missing-asset' })]) } })
    const current = model(await host.internalAPI.read(initial.documentId))
    expect(Object.values(current.project.instances)).toEqual(expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ content: { inlines: [{ type: 'text', text: '可用正文' }] } }) })]))
    const original = Object.values(current.project.assets).find(asset => asset.mimeType === 'text/html')!
    expect(current.resources.assets[original.id]).toEqual(encode(html))
    await host.tools.stop('partial')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
