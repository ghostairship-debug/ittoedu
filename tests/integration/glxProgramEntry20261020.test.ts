// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { componentContainerBuiltinKey, componentSurfaces, createComponentContainerInstance } from '../../src/shared/contracts/component-platform/project'
import { createCourseSurface } from '../../src/core/course/courseSurfaceStructure'
import { TEXT_DEFINITION, textDataEdit } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ToolResult } from '../../src/shared/workbench/tools'

const html = '<!doctype html><html><head><style>body{margin:0}</style></head><body><h1>原程序</h1><button id="add">增加</button><output id="count">0</output><script>let count=0;document.querySelector("#add").onclick=()=>document.querySelector("#count").textContent=String(++count)</script></body></html>'
function model(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected component project')
  return snapshot.model
}
const data = (result: ToolResult) => {
  if (result.kind !== 'read') throw new Error(JSON.stringify(result))
  return result.data as { content: string }
}

it('creates a complete Source program through project.apply, then edits the same owner, undoes and cold reopens without a Slide or frame', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-program-entry-')), host = new DocumentHostService(path.join(root, 'state'))
  try {
    const initial = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('完整程序'), resources: { assets: {}, components: {} } }, 'program.glx')
    await host.tools.beginRun({ runId: 'program', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: root } })
    let serial = 0
    const tool = (name: string, input: unknown) => host.tools.execute('program', `program-${++serial}`, { name, input })
    const current = () => host.internalAPI.read(initial.documentId)
    expect(await tool('project.apply', { path: 'entry.html', intent: 'program.set', content: html })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const created = await current(), project = model(created).project, id = project.entry!.rootInstanceId
    expect(created.undoDepth).toBe(1)
    expect(project.rootIds).toEqual([id]); expect(componentSurfaces(project)).toEqual([])
    expect(project.instances[id]).not.toHaveProperty('frame'); expect(project.instances[id]).not.toHaveProperty('container')
    expect(project.definitions[project.instances[id]!.definitionId]!.implementation.kind).toBe('source')
    expect(data(await tool('project.read', { path: 'entry.html' })).content).toContain('String(++count)')
    const textEdit = await tool('project.apply', { path: 'entry.html', edits: [{ old: '原程序', new: '新程序' }] })
    expect(textEdit, JSON.stringify(textEdit)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    let snapshot = await current(), files = componentProjectFiles(model(snapshot).project, model(snapshot).resources)
    const params = files.find(file => file.kind === 'data' && file.target?.kind === 'instance' && file.target.instanceId === id && !file.binding)!
    const value = JSON.parse(data(await tool('project.read', { path: params.path })).content)
    expect(await tool('project.apply', { path: params.path, content: JSON.stringify({ ...value, css: 'h1{color:blue}' }) })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    snapshot = await current(); files = componentProjectFiles(model(snapshot).project, model(snapshot).resources)
    const source = files.find(file => file.kind === 'source' && file.target?.kind === 'instance' && file.target.instanceId === id)!
    const code = data(await tool('project.read', { path: source.path })).content
    const anchor = code.slice(0, 200)
    const sourceEdit = await tool('project.apply', { path: source.path, edits: [{ old: anchor, new: `// saved program source\n${anchor}` }] })
    expect(sourceEdit, JSON.stringify(sourceEdit)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const changed = await current()
    expect(model(changed).project.entry!.rootInstanceId).toBe(id)
    expect(changed.undoDepth).toBe(4)
    expect(await host.internalAPI.dispatch({ documentId: changed.documentId, epoch: changed.epoch, baseRevision: changed.revision, actor: 'human', operationId: 'undo-source', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    const undone = await current()
    expect(await host.internalAPI.dispatch({ documentId: undone.documentId, epoch: undone.epoch, baseRevision: undone.revision, actor: 'human', operationId: 'redo-source', mutation: { type: 'redo' } })).toMatchObject({ status: 'applied' })
    const filename = path.join(root, 'saved.glx'); await host.internalAPI.save(initial.documentId, filename)
    const cold = await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename)
    expect(model(cold)).toEqual(model(await current()))
    expect(model(cold).project.instances[id].data).toMatchObject({ html: expect.stringContaining('新程序'), css: 'h1{color:blue}' })
    expect(componentProjectFiles(model(cold).project, model(cold).resources).some(file => file.kind === 'source' && file.content?.includes('// saved program source'))).toBe(true)
  } finally { await host.tools.stop('program'); await fs.rm(root, { recursive: true, force: true }) }
})

it('keeps source admission failure atomic and preserves authored roots when establishing a program entry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-program-preserve-')), host = new DocumentHostService(path.join(root, 'state'))
  try {
    const project = createBlankCourseProjectV10('已有作品'), oldId = project.rootIds[0]!
    project.instances[oldId].name = '人工命名'; project.revision = 1
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'existing.glx')
    await host.tools.beginRun({ runId: 'preserve', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: root } })
    const failed = await host.tools.execute('preserve', 'missing', { name: 'project.apply', input: { path: 'entry.html', intent: 'program.set', from: 'missing.html' } })
    expect(failed).toMatchObject({ kind: 'read', data: { commit: 'not_committed' } })
    expect(model(await host.internalAPI.read(initial.documentId))).toEqual(model(initial))
    await fs.writeFile(path.join(root, 'program.html'), html)
    expect(await host.tools.execute('preserve', 'set', { name: 'project.apply', input: { path: 'entry.html', intent: 'program.set', from: 'program.html' } })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const after = await host.internalAPI.read(initial.documentId)
    expect(model(after).project.instances[oldId]).toEqual(model(initial).project.instances[oldId])
    expect(model(after).project.rootIds).toContain(oldId)
    expect(model(after).project.entry!.rootInstanceId).not.toBe(oldId)
    const otherRoot = await host.tools.issueTarget('preserve', initial.documentId, { kind: 'course-surface', surfaceId: oldId })
    expect(await host.tools.execute('preserve', 'selected-other-root', { name: 'project.apply', input: {
      project: otherRoot, path: 'entry.html', intent: 'program.set', content: '<p>不得修改全局入口</p>',
    } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
    expect(await host.internalAPI.read(initial.documentId)).toEqual(after)
  } finally { await host.tools.stop('preserve'); await fs.rm(root, { recursive: true, force: true }) }
})

it('exposes a nested Flow through its existing body projection and edits its children without changing the outer container', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-nested-flow-file-')), host = new DocumentHostService(path.join(root, 'state'))
  try {
    const project = createBlankCourseProjectV10('嵌套正文'), outerId = project.rootIds[0]!, definitionId = componentContainerBuiltinKey('flow')
    project.definitions[definitionId] = { id: definitionId, role: 'mixed', title: '正文容器', implementation: { kind: 'builtin', key: definitionId } }
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    const flow = createCourseSurface(project, { kind: 'flow', title: '内层正文' }, () => 'nested-flow')
    flow.childIds = ['text']
    project.instances[flow.id] = createComponentContainerInstance(flow, definitionId)
    project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: textDataEdit('text', createTextComponentData('旧正文')).value }
    project.instances[outerId].childIds = [flow.id]
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'nested.glx')
    await host.tools.beginRun({ runId: 'nested', actor: 'agent', documents: [{ documentId: initial.documentId,
      writable: [{ kind: 'course-instance', surfaceId: outerId, instanceId: flow.id }] }] })
    const files = componentProjectFiles(project, model(initial).resources)
    const body = files.find(file => file.binding?.kind === 'flow' && file.binding.surfaceId === flow.id && file.binding.format === 'html')!
    expect(body).toBeDefined()
    const selected = await host.tools.issueTarget('nested', initial.documentId, { kind: 'course-instance', surfaceId: outerId, instanceId: flow.id })
    expect(await host.tools.execute('nested', 'read-body', { name: 'project.read', input: { project: selected, path: body.path } })).toMatchObject({ kind: 'read', data: { content: expect.stringContaining('旧正文') } })
    const result = await host.tools.execute('nested', 'edit-body', { name: 'project.apply', input: { project: selected, path: body.path, edits: [{ old: '旧正文', new: '新正文' }] } })
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const after = await host.internalAPI.read(initial.documentId)
    expect(after.undoDepth).toBe(1)
    expect(model(after).project.instances[outerId]).toEqual(project.instances[outerId])
    expect(componentProjectFiles(model(after).project, model(after).resources).find(file => file.path === body.path)!.content).toContain('新正文')
  } finally { await host.tools.stop('nested').catch(() => undefined); await fs.rm(root, { recursive: true, force: true }) }
})
