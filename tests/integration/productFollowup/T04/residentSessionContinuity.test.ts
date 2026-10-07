// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { connectExplicitMcp, readExplicitMcpConnection } from '../../../../scripts/mcpSdkClient'
import { residentMcpFixture } from '../../../helpers/residentMcpFixture'

it('same workspace/settings retain V10 targets and closing one document or detaching one client preserves the other document client and owner', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T04-resident-'))
  let fixture: Awaited<ReturnType<typeof residentMcpFixture>> | undefined
  const clients: Awaited<ReturnType<typeof connectExplicitMcp>>[] = []
  try {
    const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const doc = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Teacher lesson'), resources: { assets: {}, components: {} } }, 'lesson.h5lesson')
    await host.saveToPath(doc.documentId, path.join(workspace, 'lesson.h5lesson'))
    const second = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Second teacher lesson'), resources: { assets: {}, components: {} } }, 'second.h5lesson')
    await host.saveToPath(second.documentId, path.join(workspace, 'second.h5lesson'))
    fixture = await residentMcpFixture({ host, directory, workspaceRoot: workspace })
    const connection = readExplicitMcpConnection({ endpoint: (await fixture.service.status()).endpoint, token: fixture.token() })
    const a = await connectExplicitMcp(connection, 'client-a'); clients.push(a)
    const b = await connectExplicitMcp(connection, 'client-b'); clients.push(b)
    const opened = await b.call('file.open', { path: 'lesson.h5lesson' })
    expect(opened.isError).toBe(false)
    const result = opened.structuredContent?.result as { kind: string; data: { target: string } }
    expect(result.kind).toBe('read')
    expect(host.registry.get(doc.documentId).read().model.kind).toBe('course-v10')
    await fixture.service.configure(fixture.settings())
    expect((await b.call('workspace.switch', { workspaceId: 'space' })).isError).toBe(false)
    expect((await b.call('listChildren', { target: result.data.target })).isError).toBe(false)
    const openedSecond = await b.call('file.open', { path: 'second.h5lesson' })
    expect(openedSecond.isError).toBe(false)
    const secondResult = openedSecond.structuredContent?.result as { data: { target: string } }
    await fixture.service.stopForDocument(doc.documentId)
    await host.operate({ type: 'close', documentId: doc.documentId })
    expect((await b.call('listChildren', { target: result.data.target })).isError).toBe(true)
    expect((await b.call('listChildren', { target: secondResult.data.target })).isError).toBe(false)
    expect(fixture.service.activity()).toEqual([])
    expect((await fixture.service.status()).sessions).toHaveLength(2)
    await Promise.all([a.detach(), a.detach()])
    await expect.poll(async () => (await fixture!.service.status()).sessions.length).toBe(1)
    expect((await b.call('listChildren', { target: secondResult.data.target })).isError).toBe(false)
    expect((await fixture.service.status()).state).toBe('running')
    expect(fixture.service.server.listeningPort).toBeGreaterThan(0)
    await b.detach()
    await expect.poll(async () => (await fixture!.service.status()).sessions.length).toBe(0)
    expect((await fixture.service.status()).state).toBe('running')
  } finally {
    await Promise.allSettled(clients.map(client => client.detach()))
    await fixture?.close()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
