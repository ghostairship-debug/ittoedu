// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { closeDocumentFlow } from '../../../../src/main/workbench/documentCloseFlow'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION , textDataEdit } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { connectExplicitMcp, readExplicitMcpConnection } from '../../../../scripts/mcpSdkClient'
import { residentMcpFixture } from '../../../helpers/residentMcpFixture'

it('cancelled close can reopen A for a real edit while old A authority remains stopped and the same client B target still writes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T04-close-cancel-'))
  let fixture: Awaited<ReturnType<typeof residentMcpFixture>> | undefined
  let client: Awaited<ReturnType<typeof connectExplicitMcp>> | undefined
  try {
    const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const make = async (name: string) => {
      const project = createBlankCourseProjectV10(name)
      project.definitions.text = { ...TEXT_DEFINITION, id: 'text' }
      project.instances.content = { id: 'content', definitionId: 'text', data: textDataEdit('fixture', createTextComponentData(name)).value }
      project.surfaces[0].childIds = ['content']
      const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, `${name}.h5lesson`)
      await host.saveToPath(snapshot.documentId, path.join(workspace, `${name}.h5lesson`))
      return { snapshot }
    }
    const a = await make('A'), b = await make('B')
    if (a.snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
    await host.internalAPI.dispatch({ documentId: a.snapshot.documentId, epoch: a.snapshot.epoch, baseRevision: a.snapshot.revision, operationId: 'dirty-A', actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(a.snapshot.model.project, [{ type: 'project.title.set', title: 'A dirty teacher content' }]) } })
    fixture = await residentMcpFixture({ host, directory, workspaceRoot: workspace })
    client = await connectExplicitMcp(readExplicitMcpConnection({ endpoint: (await fixture.service.status()).endpoint }))
    const openedA = await client.call('file.open', { path: 'A.h5lesson' })
    const openedB = await client.call('file.open', { path: 'B.h5lesson' })
    expect(openedA.isError).toBe(false); expect(openedB.isError).toBe(false)
    const targetA = (openedA.structuredContent?.result as { data: { target: string } }).data.target
    const targetB = (openedB.structuredContent?.result as { data: { target: string } }).data.target
    const observePath = async (project: string) => {
      const listed = await client!.call('project.list', { project })
      expect(listed.isError, JSON.stringify(listed)).toBe(false)
      const files = (listed.structuredContent?.result as { data: { files: Array<{ path: string }> } }).data.files
      const filename = files.find(file => file.path.endsWith('.data.json'))?.path
      if (!filename) throw new Error('Public catalog did not expose the text data file')
      const read = await client!.call('project.read', { project, path: filename })
      expect(read.isError, JSON.stringify(read)).toBe(false)
      expect((read.structuredContent?.result as { data: { content: string } }).data.content).toBeTruthy()
      return filename
    }
    await observePath(targetA)
    const pathB = await observePath(targetB)
    const [oldRunId] = host.tools.writableRunIdsForDocument(a.snapshot.documentId)
    expect(oldRunId).toBeTruthy()
    let closes = 0
    expect(await closeDocumentFlow({ read: () => host.internalAPI.read(a.snapshot.documentId),
      hasWritableTasks: async () => fixture!.service.writableSessionsForDocument(a.snapshot.documentId).length > 0,
      confirmStop: async () => true, stopWritableTasks: () => fixture!.service.stopForDocument(a.snapshot.documentId),
      chooseDirty: async () => 'cancel', save: () => host.saveToPath(a.snapshot.documentId), withBarrier: work => work(),
      close: async (_snapshot, discardDirty) => { closes++; await host.operate({ type: 'close', documentId: a.snapshot.documentId, discardDirty }) },
    })).toBe(false)
    expect(closes).toBe(0)
    expect((await client.call('project.list', { project: targetA })).isError).toBe(true)
    const reopened = await client.call('file.open', { path: 'A.h5lesson' })
    expect(reopened.isError).toBe(false)
    const renewed = (reopened.structuredContent?.result as { data: { target: string; writable: boolean } }).data
    expect(renewed.writable).toBe(true)
    const pathA = await observePath(renewed.target)
    const editedA = await client.call('object.update', { project: renewed.target, path: pathA, properties: { opacity: .7 } })
    expect(editedA.structuredContent, JSON.stringify(editedA))
      .toMatchObject({ result: { kind: 'document-operation', result: { status: 'applied' } } })
    const editedB = await client.call('object.update', { project: targetB, path: pathB, properties: { opacity: .4 } })
    expect(editedB.structuredContent, JSON.stringify(editedB))
      .toMatchObject({ result: { kind: 'document-operation', result: { status: 'applied' } } })
    const currentA = await host.internalAPI.read(a.snapshot.documentId)
    if (currentA.model.kind !== 'course-v10') throw new Error('Expected V10')
    expect(await host.internalAPI.dispatch({ documentId: currentA.documentId, epoch: currentA.epoch, baseRevision: currentA.revision, operationId: 'late-old-authority', actor: 'agent', runId: oldRunId,
      mutation: { type: 'command', command: captureComponentOperation(currentA.model.project, [{ type: 'project.title.set', title: 'Must not commit' }]) } }))
      .toMatchObject({ status: 'cancelled', applied: false })
    expect(await host.internalAPI.read(a.snapshot.documentId)).toMatchObject({ model: { project: { title: 'A dirty teacher content', instances: { content: { style: { opacity: .7 } } } } } })
    expect(await host.internalAPI.read(b.snapshot.documentId)).toMatchObject({ model: { project: { instances: { content: { style: { opacity: .4 } } } } } })
  } finally {
    await client?.detach(); await fixture?.close()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
