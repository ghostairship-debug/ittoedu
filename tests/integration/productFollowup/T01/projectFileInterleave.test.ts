// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../../../src/core/drivers/courseV10Operations'
import { componentProjectFiles } from '../../../../src/core/projectFiles/componentPlatform'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import type { DocumentSnapshot } from '../../../../src/shared/workbench/document'

function course(snapshot: DocumentSnapshot) {
  if (snapshot.model.kind !== 'course-v10') throw new Error('V10 fixture required')
  return snapshot.model
}
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t01-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const project = createBlankCourseProjectV10('真实内容应用')
  return { directory, host, project }
}
async function run(host: DocumentHostService, snapshot: DocumentSnapshot, directory: string) {
  await host.tools.beginRun({ runId: 'agent', actor: 'agent', documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: directory } })
  await host.tools.loadToolFamilies('agent', ['content'])
  let serial = 0
  return (name: string, input: unknown) => host.tools.execute('agent', `call-${++serial}`, { name, input })
}

it('pagination keeps the captured file version and rejects overwrite of intervening teacher edits', async () => {
  const { directory, host, project } = await fixture()
  try {
    const original = '.a{color:red}.b{color:blue}', human = '.a{color:tan}.b{color:cyan}'
    project.theme = { css: original }
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'pagination.h5lesson')
    const tool = await run(host, initial, directory)
    const first = await tool('project.read', { path: 'theme.css', limit: 14 })
    expect(first).toMatchObject({ kind: 'read', data: { content: original.slice(0, 14), nextOffset: 14 } })
    expect(await host.internalAPI.dispatch({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision,
      actor: 'human', operationId: 'teacher-theme', mutation: { type: 'command', command: captureComponentOperation(project,
        [{ type: 'project.theme.set', theme: { css: human } }]) } })).toMatchObject({ status: 'applied' })
    const tail = await tool('project.read', { path: 'theme.css', offset: 14 })
    // The second slice must not silently make the unread first slice a new baseline.
    expect(tail).toMatchObject({ kind: 'read', data: { content: original.slice(14) } })
    expect(await tool('project.apply', { path: 'theme.css', content: original.replace('blue', 'green') }))
      .toMatchObject({ kind: 'read', data: { commit: 'not_committed', receipt: { status: 'conflict' } } })
    expect(course(await host.internalAPI.read(initial.documentId)).project.theme?.css).toBe(human)
  } finally { await host.tools.stop('agent'); await fs.rm(directory, { recursive: true, force: true }) }
})

it('Flow literal dollars and markerless rewrite preserve opaque interaction and manual attributes through undo save cold reopen', async () => {
  const { directory, host, project } = await fixture()
  try {
    const frame = { width: 280, height: 95, transform: [1, 0, 0, 1, 43, 27] as [number, number, number, number, number, number] }
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
    project.instances.paragraph = { id: 'paragraph', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('旧正文'), frame, style: { opacity: .8 } }
    project.instances.interaction = { id: 'interaction', definitionId: 'web', data: { html: '<button onclick="this.textContent=\'已点击\'">互动</button>' }, frame }
    project.surfaces.push({ id: 'flow', kind: 'flow', title: '讲义', childIds: ['paragraph', 'interaction'] })
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'flow.h5lesson')
    const tool = await run(host, initial, directory)
    const file = componentProjectFiles(project, course(initial).resources).find(value => value.binding?.kind === 'flow' && value.binding.format === 'markdown')!
    expect(file.content).toContain('cw-object-v1')
    await tool('project.read', { path: file.path })
    const markerless = file.content!.replace(/<!--[^]*?-->/g, '').replace('旧正文', '新正文，售价 $5，另一个售价 $10')
    const applied = await tool('project.apply', { path: file.path, content: markerless })
    expect(applied).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    const current = await host.internalAPI.read(initial.documentId)
    const p = course(current).project
    expect(p.surfaces.find(value => value.id === 'flow')?.childIds).toEqual(['paragraph', 'interaction'])
    expect(p.instances.paragraph).toMatchObject({ frame, style: { opacity: .8 }, data: { content: { inlines: [{ type: 'text', text: '新正文，售价 $5，另一个售价 $10' }] } } })
    expect(p.instances.interaction).toEqual(project.instances.interaction)
    expect(current.undoDepth).toBe(1)
    const history = async (type: 'undo' | 'redo') => {
      const snapshot = await host.internalAPI.read(initial.documentId)
      return host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
        actor: 'human', operationId: type, mutation: { type } })
    }
    expect(await history('undo')).toMatchObject({ status: 'applied' })
    expect(course(await host.internalAPI.read(initial.documentId)).project.instances.paragraph).toEqual(project.instances.paragraph)
    expect(await history('redo')).toMatchObject({ status: 'applied' })
    const filename = path.join(directory, 'saved.h5lesson')
    await host.internalAPI.save(initial.documentId, filename)
    const reopened = course(await new DocumentHostService(path.join(directory, 'cold')).internalAPI.open(filename))
    expect(reopened.project.instances.paragraph).toEqual(p.instances.paragraph)
    expect(reopened.project.instances.interaction).toEqual(project.instances.interaction)
  } finally { await host.tools.stop('agent'); await fs.rm(directory, { recursive: true, force: true }) }
})
