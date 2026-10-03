// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import type { AgentFileContext } from '../../src/core/tools/AgentFileTools'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'unified-office-agent-')); roots.push(directory)
  const workspace = path.join(directory, 'workspace'), outside = path.join(directory, 'outside')
  await fs.mkdir(workspace); await fs.mkdir(outside)
  const prepared = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'Before' }] })
  await fs.writeFile(path.join(workspace, 'lesson.docx'), prepared.bytes)
  await fs.writeFile(path.join(outside, 'external.docx'), prepared.bytes)
  const host = new DocumentHostService(path.join(directory, 'owner')), files = new AgentFileService(host)
  const context: AgentFileContext = { runId: 'office-run', workspaceRoot: workspace, permission: 'workspace' }
  return { workspace, outside, host, files, context }
}
const editedContent = { format: 'docx' as const, edits: [{ type: 'paragraph' as const, index: 0, text: 'After' }] }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('Office agent file authority and observed versions', () => {
  it('allows read-only inspection, forbids read-only writes and requires the existing outside-path grant', async () => {
    const f = await fixture(), readonly = { ...f.context, permission: 'read-only' as const }
    expect((await f.files.executeOffice(readonly, 'office.inspect', { path: 'lesson.docx' }, 'inspect-readonly')).data).toMatchObject({ writable: false, inspection: { format: 'docx' } })
    await expect(f.files.executeOffice(readonly, 'office.edit', { path: 'lesson.docx', content: editedContent }, 'edit-readonly')).rejects.toThrow('只读')
    await expect(f.files.executeOffice(readonly, 'office.create', { name: 'new.docx', content: { format: 'docx', blocks: [{ type: 'paragraph', text: 'New' }] } }, 'create-readonly')).rejects.toThrow('只读')
    const external = path.join(f.outside, 'external.docx')
    await expect(f.files.executeOffice(f.context, 'office.inspect', { path: external }, 'inspect-outside')).rejects.toThrow('工作空间外')
    const readGrant = { ...f.context, readOnlyRoots: [f.outside] }
    expect((await f.files.executeOffice(readGrant, 'office.inspect', { path: external }, 'inspect-granted')).data).toMatchObject({ writable: false })
    expect(await f.files.preflightOffice(readGrant, 'office.edit', { path: external, content: editedContent })).toEqual({ paths: [external], outside: true })
    await expect(f.files.executeOffice(readGrant, 'office.edit', { path: external, content: editedContent }, 'edit-outside-denied')).rejects.toThrow('明确批准')
    const writeGrant = { ...readGrant, approvedOutsidePaths: [external] }
    expect((await f.files.executeOffice(writeGrant, 'office.edit', { path: external, content: editedContent }, 'edit-granted')).data).toMatchObject({ status: 'saved', saved: true })
    expect(f.host.registry.list()).toHaveLength(0)
    await expect(f.files.execute(f.context, 'file.open', { path: 'lesson.docx' }, 'binary-text-denied')).rejects.toThrow()
  })

  it('uses the per-run inspected binding for edits and never silently binds a later external draft', async () => {
    const f = await fixture(), filename = path.join(f.workspace, 'lesson.docx')
    await expect(f.files.executeOffice(f.context, 'office.edit', { path: 'lesson.docx', content: editedContent }, 'no-inspection')).rejects.toThrow('请先使用 office.inspect')
    const observed = await f.files.executeOffice(f.context, 'office.inspect', { path: 'lesson.docx' }, 'inspect-original')
    expect(observed.data).toMatchObject({ inspection: { paragraphs: [{ text: 'Before' }] } })
    const external = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'External draft' }] })
    await fs.writeFile(filename, external.bytes)
    await expect(f.files.executeOffice(f.context, 'office.edit', { path: 'lesson.docx', content: editedContent }, 'stale-inspection')).rejects.toThrow('磁盘文件已改变')
    expect(inspectOfficeContent(await fs.readFile(filename), 'docx')).toMatchObject({ paragraphs: [{ text: 'External draft' }] })
    await f.files.executeOffice(f.context, 'office.inspect', { path: 'lesson.docx' }, 'inspect-current')
    expect((await f.files.executeOffice(f.context, 'office.edit', { path: 'lesson.docx', content: editedContent }, 'edit-current')).data).toMatchObject({ status: 'saved', inspection: { paragraphs: [{ text: 'After' }] } })
    f.files.releaseRun(f.context.runId)
    await expect(f.files.executeOffice(f.context, 'office.edit', { path: 'lesson.docx', content: editedContent }, 'released-inspection')).rejects.toThrow('请先使用 office.inspect')
    const created = await f.files.executeOffice(f.context, 'office.create', { name: 'new.xlsx', content: { format: 'xlsx', sheets: [{ name: 'Data', rows: [[4, { formula: 'A1*2' }]] }] } }, 'create-content')
    expect(created.data).toMatchObject({ status: 'saved', calculation: { status: 'complete', values: [{ sheet: 'Data', cell: 'B1', value: 8 }] } })
    expect(f.host.registry.list()).toHaveLength(0)
  })

  it('passes the task stop barrier to the existing file.create final publication boundary', async () => {
    const f = await fixture(), entered = deferred(), release = deferred(), queued = deferred()
    const blocker = f.host.fileCoordinator.withFileOperation(async () => { entered.resolve(); await release.promise })
    await entered.promise
    const create = f.host.files.createFile.bind(f.host.files)
    vi.spyOn(f.host.files, 'createFile').mockImplementation((...args) => { queued.resolve(); return create(...args) })
    let stopped = false
    const pending = f.files.execute({ ...f.context, assertActive: () => { if (stopped) throw new Error('任务已停止') } }, 'file.create', { name: 'stopped.md' }, 'stopped-file-create')
    await queued.promise; stopped = true; release.resolve(); await blocker
    const result = await pending
    expect(result.data).toMatchObject({ operation: { status: 'failed', items: [{ error: { message: '任务已停止' } }] } })
    expect(await fs.readdir(f.workspace)).toEqual(['lesson.docx'])
    expect(f.host.registry.list()).toHaveLength(0)
  })
})
