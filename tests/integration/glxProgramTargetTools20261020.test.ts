// @vitest-environment node
import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10, createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { containsTarget, courseInstanceContext, courseInstanceScopeId } from '../../src/core/tools/ToolTargets'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { courseAuthorData } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import type { ToolResult } from '../../src/shared/workbench/tools'

it('edits a scoped source program root through the public Gateway and preserves undo and cold reopen without a surface', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-program-target-'))
  const host = new DocumentHostService(path.join(root, 'state'))
  try {
    const project = createBlankProgramProject('完整程序'), instanceId = project.rootIds[0]
    project.instances[instanceId].data = { html: '<!doctype html><html><body><button>保留互动</button><script>window.value=1</script></body></html>', css: '' }
    project.instances.other = { id: 'other', definitionId: project.instances[instanceId].definitionId, data: { html: '<p>另一作品根</p>' } }
    project.rootIds.push('other')
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'program.glx')
    await host.tools.beginRun({ runId: 'scoped', actor: 'agent', documents: [{ documentId: initial.documentId,
      writable: [{ kind: 'course-instance', surfaceId: instanceId, instanceId }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await host.tools.loadToolFamilies('scoped', ['layout', 'content'])
    let serial = 0
    const tool = (name: string, input: unknown): Promise<ToolResult> => host.tools.execute('scoped', `call-${++serial}`, { name, input })
    const document = await host.tools.issueTarget('scoped', initial.documentId, { kind: 'document' })
    const children = await tool('listChildren', { target: document })
    expect(children).toMatchObject({ kind: 'read', data: [{ kind: 'course-instance' }, { kind: 'course-instance' }] })
    if (children.kind !== 'read' || !Array.isArray(children.data)) throw new Error('Expected root targets')
    const target = children.data[0].target as string, other = children.data[1].target as string
    expect(await tool('read', { target, detail: 'object' })).toMatchObject({ kind: 'read' })
    const update = await tool('object.update', { target, properties: { data: { css: 'button{color:green}' }, label: '正式程序' } })
    expect(update).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const current = await host.internalAPI.read(initial.documentId)
    if (current.model.kind !== 'course-v10') throw new Error('Expected component project')
    expect(current.model.project.instances[instanceId]).toMatchObject({ name: '正式程序', data: { css: 'button{color:green}' } })
    expect(current.model.project.instances[instanceId].data).toHaveProperty('html', (project.instances[instanceId].data as { html: string }).html)
    expect(current.model.project.instances[instanceId].frame).toBeUndefined()
    expect(Object.values(current.model.project.instances).some(instance => instance.container)).toBe(false)
    expect(current.undoDepth).toBe(1)
    expect(await tool('object.update', { target: other, properties: { label: '越权' } })).toMatchObject({ kind: 'error' })
    expect(await host.internalAPI.read(initial.documentId)).toEqual(current)

    expect(await host.internalAPI.dispatch({ documentId: initial.documentId, epoch: current.epoch, baseRevision: current.revision,
      actor: 'human', operationId: 'undo-program-properties', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    const undone = await host.internalAPI.read(initial.documentId)
    if (undone.model.kind !== 'course-v10') throw new Error('Expected component project')
    expect(undone.model.project.instances[instanceId]).toEqual(project.instances[instanceId])
    const scoped = await host.tools.issueTarget('scoped', initial.documentId, { kind: 'course-instance', surfaceId: instanceId, instanceId })
    expect(await tool('project.read', { project: scoped, path: 'entry.html' })).toMatchObject({ kind: 'read', data: { content: expect.stringContaining('保留互动') } })
    const htmlEdit = await tool('project.apply', { project: scoped, path: 'entry.html', edits: [{ old: '保留互动', new: '局部改字' }] })
    expect(htmlEdit, JSON.stringify(htmlEdit)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const files = componentProjectFiles(undone.model.project, undone.model.resources)
    const source = files.find(file => file.kind === 'source' && file.binding?.kind === 'instance-source' && file.target?.kind === 'instance' && file.target.instanceId === instanceId)!
    const sourceRead = await tool('project.read', { project: scoped, path: source.path })
    if (sourceRead.kind !== 'read' || !sourceRead.data || typeof sourceRead.data !== 'object' || !('content' in sourceRead.data)) throw new Error('Expected editable source')
    const anchor = String(sourceRead.data.content).slice(0, 200)
    const sourceEdit = await tool('project.apply', { project: scoped, path: source.path, edits: [{ old: anchor, new: `// scoped-source-edit\n${anchor}` }] })
    expect(sourceEdit, JSON.stringify(sourceEdit)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const programEdit = await tool('project.apply', { project: scoped, path: 'entry.html', intent: 'program.set', content: '<!doctype html><html><body><button>完整程序续改</button><script>window.value=2</script></body></html>' })
    expect(programEdit, JSON.stringify(programEdit)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const edited = await host.internalAPI.read(initial.documentId)
    if (edited.model.kind !== 'course-v10') throw new Error('Expected component project')
    expect(edited.undoDepth).toBe(3)
    expect(edited.model.project.instances[instanceId].data).toHaveProperty('html', expect.stringContaining('完整程序续改'))
    expect(edited.model.project.instances.other).toEqual(project.instances.other)
    const otherFile = files.find(file => file.target?.kind === 'instance' && file.target.instanceId === 'other' && file.kind === 'html')!
    expect(await tool('project.apply', { project: scoped, path: otherFile.path, content: '<p>越权</p>' })).toMatchObject({ kind: 'error' })
    expect(await host.internalAPI.read(initial.documentId)).toEqual(edited)
    const filename = path.join(root, 'saved.glx')
    await host.internalAPI.save(initial.documentId, filename)
    const cold = await new DocumentHostService(path.join(root, 'cold')).internalAPI.open(filename)
    expect(cold.model).toEqual(edited.model)
    if (cold.model.kind !== 'course-v10') throw new Error('Expected component project')
    expect(componentProjectFiles(cold.model.project, cold.model.resources).some(file => file.kind === 'source' && file.target?.kind === 'instance'
      && file.target.instanceId === instanceId && file.content?.includes('// scoped-source-edit'))).toBe(true)
  } finally {
    await host.tools.stop('scoped')
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('keeps nested container descendants in their actual scope and rejects unrelated roots', () => {
  const project = createBlankCourseProjectV10('嵌套组件'), outer = project.rootIds[0]
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.local = { id: 'local', definitionId: project.instances[outer].definitionId,
    data: {}, childIds: ['text'], container: { kind: 'slide' } }
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: courseAuthorData(createTextData('局部内容')) }
  project.instances.other = { id: 'other', definitionId: project.instances[outer].definitionId, data: {}, childIds: [], container: { kind: 'flow' } }
  project.instances[outer].childIds!.push('local'); project.rootIds.push('other')
  const model = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }
  const target = { kind: 'course-instance' as const, surfaceId: 'local', instanceId: 'text' }
  expect(courseInstanceScopeId(project, 'text')).toBe('local')
  expect(courseInstanceContext(model, target).instance.id).toBe('text')
  expect(containsTarget({ kind: 'course-surface', surfaceId: outer }, target, model)).toBe(true)
  expect(containsTarget({ kind: 'course-surface', surfaceId: outer, stateId: null }, target, model)).toBe(true)
  expect(containsTarget({ kind: 'course-instance', surfaceId: outer, instanceId: 'local' }, target, model)).toBe(true)
  expect(containsTarget({ kind: 'course-instance', surfaceId: outer, instanceId: 'local' },
    { kind: 'course-instance', surfaceId: 'local', instanceId: 'local' }, model)).toBe(true)
  expect(containsTarget({ kind: 'course-instance', surfaceId: outer, instanceId: 'local' }, { kind: 'course-surface', surfaceId: 'local' }, model)).toBe(true)
  expect(containsTarget({ kind: 'course-instance', surfaceId: outer, instanceId: 'local' }, { kind: 'course-surface', surfaceId: 'other' }, model)).toBe(false)
  expect(containsTarget({ kind: 'course-surface', surfaceId: outer }, { kind: 'course-surface', surfaceId: 'local' }, model)).toBe(true)
  expect(containsTarget({ kind: 'course-surface', surfaceId: 'other' }, target, model)).toBe(false)
  expect(containsTarget({ kind: 'course-surface', surfaceId: outer, stateId: 'detail' }, { ...target, stateId: 'detail' }, model)).toBe(false)
  expect(() => courseInstanceContext(model, { ...target, surfaceId: 'other' })).toThrow('不属于')
})

it('does not commit a new program root or entry when required source admission fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-program-required-'))
  const host = new DocumentHostService(path.join(root, 'state'))
  try {
    const project = createBlankCourseProjectV10('保留原作品')
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'existing.glx')
    await host.tools.beginRun({ runId: 'program', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: root } })
    await host.tools.loadToolFamilies('program', ['content'])
    const result = await host.tools.execute('program', 'missing-program-source', { name: 'project.apply',
      input: { path: 'entry.html', intent: 'program.set', from: path.join(root, 'missing.html') } })
    expect(result).toMatchObject({ kind: 'read', data: { commit: 'not_committed' } })
    const current = await host.internalAPI.read(initial.documentId)
    expect(current.model).toEqual(initial.model)
    expect(current.revision).toBe(initial.revision)
    expect(current.undoDepth).toBe(0)
  } finally {
    await host.tools.stop('program')
    await fs.rm(root, { recursive: true, force: true })
  }
})
