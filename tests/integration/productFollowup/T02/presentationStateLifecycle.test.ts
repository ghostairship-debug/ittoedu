// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import type { ComponentSurface } from '../../../../src/shared/contracts/component-platform/project'
import type { ToolResult } from '../../../../src/shared/workbench/tools'

function readData<T>(result: ToolResult): T {
  expect(result.kind, JSON.stringify(result)).toBe('read')
  if (result.kind !== 'read') throw new Error('Actual public read result required')
  return result.data as T
}

it('public V10 presentation state actions preserve teacher content geometry background interaction and formal History through save and cold reopen', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t02-presentation-'))
  const host = new DocumentHostService(path.join(directory, 'documents')), runId = 'presentation-state-lifecycle'
  try {
    const project = createBlankCourseProjectV10('展示状态生命周期')
    const surface = project.surfaces[0]
    surface.title = '状态课演示'
    surface.background = { mode: 'own', color: '#dfe8f1' }
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.definitions.interactive = { id: 'interactive', title: '原互动', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
    project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('教师已修改正文'),
      frame: { width: 340, height: 100, transform: [1, 0, 0, 1, 41, 63] }, style: { opacity: .8 } }
    project.instances.button = { id: 'button', definitionId: 'interactive',
      data: { html: '<button onclick="this.textContent=\'已点击\'">原互动按钮</button>' },
      frame: { width: 180, height: 70, transform: [1, 0, 0, 1, 403, 217] } }
    surface.childIds = ['body', 'button']
    surface.presentation = { states: [{ id: 'teacher-state', title: '教师已设状态',
      overrides: { body: { style: { opacity: .35 }, frame: { width: 360, height: 120, transform: [1, 0, 0, 1, 71, 93] } }, button: { visible: false } },
      order: ['button', 'body'], background: { mode: 'own', color: '#ffeecc' } }], initialStateId: 'teacher-state', thumbnailStateId: 'teacher-state' }
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'states.h5lesson')
    await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }] })
    let sequence = 0
    const call = (name: string, input: unknown) => host.tools.execute(runId, `state-call-${++sequence}`, { name, input })
    expect((await host.tools.describeRun(runId)).map(tool => tool.name)).toContain('presentation.update')
    const files = readData<{ files: Array<{ path: string }> }>(await call('project.list', {})).files
    const framework = files.find(file => file.path === 'pages')
    expect(framework, JSON.stringify(files)).toBeTruthy()
    const pages = JSON.parse(readData<{ content: string }>(await call('project.read', { path: framework!.path })).content).pages as Array<{ title: string; path: string }>
    const observedPage = pages.find(page => page.title === '状态课演示')
    expect(observedPage, JSON.stringify(pages)).toBeTruthy()
    expect(JSON.parse(readData<{ content: string }>(await call('project.read', { path: observedPage!.path })).content)).toMatchObject({ title: '状态课演示', kind: 'slide' })
    // Only the original frozen document target is supplied by software. Public listChildren
    // returns the surface handle, and public read returns state identities; callers invent neither.
    const documentHandle = await host.tools.issueTarget(runId, initial.documentId, { kind: 'document' })
    const children = readData<Array<{ target: string; label: string; kind: string }>>(await call('listChildren', { target: documentHandle }))
    const pageHandle = children.find(child => child.kind === 'course-surface' && child.label === observedPage!.title)?.target
    expect(pageHandle, JSON.stringify(children)).toBeTruthy()
    const readSurface = async () => JSON.parse(readData<{ text: string }>(await call('read', { target: pageHandle })).text) as ComponentSurface
    const observed = await readSurface()
    const sourceState = observed.presentation!.states.find(state => state.title === '教师已设状态')!
    expect(sourceState).toBeTruthy()
    const update = async (input: Record<string, unknown>) => expect(await call('presentation.update', { target: pageHandle, ...input }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    await update({ action: 'add', title: '临时状态' })
    const added = (await readSurface()).presentation!.states.find(state => state.title === '临时状态')!
    expect(added).toMatchObject({ title: '临时状态', overrides: {} })
    expect(added.id).not.toBe(sourceState.id)
    await update({ action: 'duplicate', state: sourceState.id, title: '解释副本' })
    const copy = (await readSurface()).presentation!.states.find(state => state.title === '解释副本')!
    expect(copy.id).not.toBe(sourceState.id)
    expect(copy.id).not.toBe(added.id)
    expect(copy).toEqual({ ...sourceState, id: copy.id, title: '解释副本' })
    await update({ action: 'rename', state: copy.id, title: '显示讲解' })
    expect((await readSurface()).presentation!.states.find(state => state.id === copy.id)?.title).toBe('显示讲解')
    await update({ action: 'set-initial', state: copy.id })
    await update({ action: 'set-thumbnail', state: copy.id })
    const beforeClear = (await readSurface()).presentation!
    expect(beforeClear).toMatchObject({ initialStateId: copy.id, thumbnailStateId: copy.id })
    await update({ action: 'clear-overrides', state: copy.id })
    const cleared = (await readSurface()).presentation!
    expect(cleared.states.find(state => state.id === copy.id)).toEqual({ id: copy.id, title: '显示讲解', overrides: {} })
    expect(cleared.states.find(state => state.id === sourceState.id)).toEqual(sourceState)
    await update({ action: 'delete', state: copy.id })
    const deleted = (await readSurface()).presentation!
    expect(deleted.states.map(state => state.id)).not.toContain(copy.id)
    expect(deleted).toMatchObject({ initialStateId: null, thumbnailStateId: null })
    const history = async (type: 'undo' | 'redo') => {
      const current = await host.internalAPI.read(initial.documentId)
      expect(await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
        actor: 'human', operationId: `human-${type}-${++sequence}`, mutation: { type } })).toMatchObject({ status: 'applied' })
    }
    await history('undo')
    expect((await readSurface()).presentation).toEqual(cleared)
    await history('undo')
    expect((await readSurface()).presentation).toEqual(beforeClear)
    await history('redo'); await history('redo')
    expect((await readSurface()).presentation).toEqual(deleted)
    const current = await host.internalAPI.read(initial.documentId)
    expect(current.undoDepth).toBe(7)
    if (current.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(current.model.project.instances).toEqual(project.instances)
    expect(current.model.project.definitions).toEqual(project.definitions)
    expect(current.model.project.global).toEqual(project.global)
    expect(current.model.project.surfaces[0]).toEqual({ ...surface, presentation: deleted })
    const filename = path.join(directory, 'saved.h5lesson')
    await host.internalAPI.save(initial.documentId, filename)
    const reopened = await new DocumentHostService(path.join(directory, 'cold-documents')).internalAPI.open(filename)
    expect(reopened.model).toEqual(current.model)
  } finally { await host.tools.stop(runId); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) }
})
