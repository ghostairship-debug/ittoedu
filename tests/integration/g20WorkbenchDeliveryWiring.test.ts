// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { resolveExportDestination, resolveSaveDestination, workbenchExportWriter } from '../../src/main/workbench/workbenchDeliveryAdapters'
import type { DocumentDeliveryServicePort, ExportReceipt, SaveReceipt } from '../../src/shared/workbench/toolPorts'
import type { DocumentPersistence } from '../../src/shared/workbench/document'
import type { ToolRunGrant } from '../../src/shared/workbench/tools'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })

async function tempRoot(prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  roots.push(root)
  return root
}

function memoryPersistence(): DocumentPersistence {
  return { append: async () => undefined, save: async () => { throw new Error('not used') } }
}

async function courseFixture() {
  const root = await tempRoot('g20-workbench-delivery-')
  const driver = new CourseV10Driver()
  const registry = new DocumentRegistry({ persistence: memoryPersistence(), drivers: [driver],
    createId: (() => { let id = 0; return () => `doc-${++id}` })(), bindingKey: binding => binding.path })
  const model = { kind: 'course-v10' as const, project: createBlankCourseProjectV10('Delivery'), resources: { assets: {}, components: {} } }
  const session = await registry.create(model, 'lesson.glx')
  return { root, driver, registry, session }
}

describe('G20 workbench save/export delivery wiring', () => {
  it('pins workspace delivery to the task-frozen original binding and rejects a later outside Save As', async () => {
    const root = await tempRoot('g20-delivery-bound-path-')
    const workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside')
    await fs.mkdir(workspace); await fs.mkdir(outside)
    const markdown = new MarkdownDriver()
    const registry = new DocumentRegistry({ persistence: memoryPersistence(), drivers: [markdown], createId: () => 'bound-doc', bindingKey: binding => binding.path })
    const session = await registry.create(markdown.load(new TextEncoder().encode('# note')), 'note.md')
    const originalPath = path.join(workspace, 'note.md'), movedPath = path.join(outside, 'note.md')
    const original = { ...session.read(), binding: { kind: 'file' as const, path: originalPath, version: null, bindingVersion: 1 } }
    const moved = { ...original, binding: { ...original.binding, path: movedPath, bindingVersion: 2 } }
    const access: NonNullable<ToolRunGrant['fileAccess']> = {
      permission: 'workspace', workspaceRoot: workspace, boundPaths: { [session.documentId]: originalPath },
    }
    const frozenAccess = () => access

    await expect(resolveSaveDestination('run', moved, undefined, frozenAccess)).rejects.toThrow('文档文件绑定已移到工作空间外')
    await expect(resolveExportDestination('run', moved, undefined, 'note.html', 'html-offline', frozenAccess))
      .rejects.toThrow('文档文件绑定已移到工作空间外')
    await expect(resolveSaveDestination('run', original, undefined, frozenAccess)).resolves.toBe(originalPath)
    const nested = { ...original, binding: { ...original.binding, path: path.join(workspace, 'lesson', 'note.md') } }
    await fs.mkdir(path.join(workspace, 'lesson'))
    await expect(resolveSaveDestination('run', nested, 'copy.md', frozenAccess)).resolves.toBe(path.join(workspace, 'copy.md'))
    await expect(resolveSaveDestination('run', nested, undefined, frozenAccess)).resolves.toBe(nested.binding.path)
  })

  it('allows default save and export to an outside original binding frozen in an approved workspace task', async () => {
    const root = await tempRoot('g20-delivery-approved-binding-')
    const workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside')
    await fs.mkdir(workspace); await fs.mkdir(outside)
    const markdown = new MarkdownDriver()
    const registry = new DocumentRegistry({ persistence: memoryPersistence(), drivers: [markdown], createId: () => 'external-doc', bindingKey: binding => binding.path })
    const session = await registry.create(markdown.load(new TextEncoder().encode('# note')), 'note.md')
    const externalPath = path.join(outside, 'lesson.glx')
    const snapshot = { ...session.read(), binding: { kind: 'file' as const, path: externalPath, version: null, bindingVersion: 1 } }
    // Engine freezes this exact original path after the user approves the outside-document operation.
    const access: NonNullable<ToolRunGrant['fileAccess']> = {
      permission: 'workspace', workspaceRoot: workspace, boundPaths: { [session.documentId]: externalPath },
    }
    const frozenAccess = () => access

    await expect(resolveSaveDestination('run', snapshot, undefined, frozenAccess)).resolves.toBe(externalPath)
    await expect(resolveExportDestination('run', snapshot, undefined, 'lesson.html', 'html-offline', frozenAccess))
      .resolves.toBe(path.join(outside, 'lesson.html'))
  })

  it('authorizes save/export paths by real parent path and atomically refuses overwrite', async () => {
    const root = await tempRoot('g20-delivery-paths-')
    const workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside')
    await fs.mkdir(workspace); await fs.mkdir(outside)
    const link = path.join(workspace, 'linked')
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')

    const markdown = new MarkdownDriver()
    const registry = new DocumentRegistry({ persistence: memoryPersistence(), drivers: [markdown], createId: () => 'md-doc', bindingKey: binding => binding.path })
    const session = await registry.create(markdown.load(new TextEncoder().encode('# note')), 'note.md')
    const access: NonNullable<ToolRunGrant['fileAccess']> = { permission: 'workspace', workspaceRoot: workspace }
    const fileAccess = (runId: string) => { expect(runId).toBe('run'); return access }

    await expect(resolveSaveDestination('run', session.read(), path.join('linked', 'outside.md'), fileAccess))
      .rejects.toThrow('工作空间外')
    await expect(resolveExportDestination('run', session.read(), path.join('linked', 'outside.html'), 'lesson.html', 'html-offline', fileAccess))
      .rejects.toThrow('工作空间外')
    await expect(resolveSaveDestination('run', session.read(), 'inside.md', fileAccess))
      .resolves.toBe(path.join(workspace, 'inside.md'))

    const target = path.join(workspace, 'lesson.html')
    const first = new TextEncoder().encode('<h1>first</h1>')
    const second = new TextEncoder().encode('<h1>second</h1>')
    await workbenchExportWriter.writeNew(target, first)
    await expect(workbenchExportWriter.writeNew(target, second)).rejects.toBeDefined()
    expect(await fs.readFile(target, 'utf8')).toBe('<h1>first</h1>')
  })

  it('advertises and executes file.save/document.export through Gateway, then looks up before stale-handle validation', async () => {
    const { root, driver, registry, session } = await courseFixture()
    const receipts = new Map<string, SaveReceipt | ExportReceipt>()
    const lookup = vi.fn(async ({ operationId }: { runId: string; operationId: string; requestDigest: string }) => receipts.get(operationId) ?? null)
    const save = vi.fn(async (input: Parameters<DocumentDeliveryServicePort['save']>[0]) => {
        const receipt: SaveReceipt = { status: 'saved', path: path.join(root, 'lesson.glx'), documentId: input.documentId,
          epoch: input.epoch, savedRevision: input.baseRevision, currentRevision: session.read().revision,
          fileVersion: 'saved-v1', dirty: false, warnings: [] }
        receipts.set(input.operationId, receipt)
        return receipt
      })
    const exportDocument = vi.fn(async (input: Parameters<DocumentDeliveryServicePort['export']>[0]) => {
        const receipt: ExportReceipt = { status: 'written', path: path.join(root, 'lesson.html'), documentId: input.documentId,
          epoch: input.epoch, format: input.format, exportedRevision: input.revision,
          currentRevision: session.read().revision, fileVersion: 'export-v1', warnings: [] }
        receipts.set(input.operationId, receipt)
        return receipt
      })
    const deliveries: DocumentDeliveryServicePort = { lookup, save, export: exportDocument }
    const gateway = new DocumentToolGateway(registry, [driver], (() => { let id = 0; return () => `handle-${++id}` })(),
      { services: { deliveries } })
    const runId = 'delivery-run'
    await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })

    const initial = await gateway.describeRun(runId)
    expect(initial.map(tool => tool.name)).toContain('file.save')
    await gateway.loadToolFamilies(runId, ['build'])
    expect((await gateway.describeRun(runId)).map(tool => tool.name)).toContain('document.export')

    const target = await gateway.issueTarget(runId, session.documentId, { kind: 'document' })
    const saveCall = { name: 'file.save', input: { target } }
    const saveResult = await gateway.execute(runId, 'save-call', saveCall)
    expect(saveResult).toMatchObject({ kind: 'read', data: { status: 'saved', documentId: session.documentId } })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('overwriteConfirmed')

    const before = session.read()
    const model = before.model
    if (model.kind !== 'course-v10') throw new Error('fixture must be a Course V10 document')
    await session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'human-change', actor: 'human',
      baseRevision: before.revision, mutation: { type: 'command', command: captureComponentOperation(model.project, [{ type: 'project.title.set', title: `${model.project.title} changed` }]) } })

    const resolveWholeDocument = vi.spyOn(gateway, 'resolveWholeDocumentHandle')
    await expect(gateway.resolveWholeDocumentHandle(runId, target, 'write')).rejects.toMatchObject({ code: 'target-conflict' })
    expect(resolveWholeDocument).toHaveBeenCalledTimes(1)
    const replay = await gateway.execute(runId, 'save-call', saveCall)
    expect(replay).toEqual(saveResult)
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenCalledTimes(1)
    expect(resolveWholeDocument).toHaveBeenCalledTimes(1)

    const currentTarget = await gateway.issueTarget(runId, session.documentId, { kind: 'document' })
    const exportResult = await gateway.execute(runId, 'export-call', {
      name: 'document.export', input: { target: currentTarget, format: 'html-offline' },
    })
    expect(exportResult).toMatchObject({ kind: 'read', data: { status: 'written', format: 'html-offline', documentId: session.documentId } })
    expect(exportDocument).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledTimes(3)
  })

})
