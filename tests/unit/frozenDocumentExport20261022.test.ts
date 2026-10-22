// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { FrozenDocumentExportService } from '../../src/main/workbench/delivery/FrozenDocumentExportService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { BuiltComponentDelivery, FrozenDeliveryBuildInput } from '../../src/shared/workbench/frozenDelivery'
import type { ExportBuildReply, ExportBuildRequest } from '../../src/shared/workbench/toolPorts'

function snapshot(): DocumentSnapshot {
  const project = createBlankCourseProjectV10('冻结导出')
  return { documentId: 'document', epoch: 'epoch', revision: project.revision,
    binding: { kind: 'file', path: 'D:/works/original.glx', version: 'original', bindingVersion: 1 },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
    dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
}
function input(source: DocumentSnapshot): FrozenDeliveryBuildInput {
  if (source.model.kind !== 'course-v10') throw new Error('fixture')
  return { requestId: crypto.randomUUID(), format: 'pptx', identity: { documentId: source.documentId,
    epoch: source.epoch, revision: source.revision, projectId: source.model.project.id } }
}
function output(request: ExportBuildRequest): BuiltComponentDelivery {
  return { artifacts: [{ suggestedName: '冻结导出.pptx', extension: 'pptx', bytes: new Uint8Array([7, 8]) }],
    report: { reportVersion: 1, schemaVersion: 11, projectId: request.identity.projectId, target: 'pptx', generatedAt: '2026-10-22',
      items: [{ code: 'capture-needed', severity: 'warning', message: '需要图面', surfaceId: 'slide', instanceId: 'item', path: ['instances', 'item'] }],
      summary: { error: 0, warning: 1, info: 0, total: 1, canExport: true } } }
}
const owner = (id: number) => ({ id, onDestroyed: vi.fn((_stop: () => void) => vi.fn()) })

describe('fixed-revision isolated GUI export', () => {
  it('builds the requested historical snapshot while later edits continue, preserving full preflight data', async () => {
    const original = snapshot(), captured = input(original)
    let finish!: (reply: ExportBuildReply) => void
    let built!: ExportBuildRequest
    const build = vi.fn((request: ExportBuildRequest, _signal: AbortSignal) => {
      built = request
      return new Promise<ExportBuildReply>(resolve => { finish = resolve })
    })
    const readRevision = vi.fn((_id: string, revision: number) => revision === original.revision ? structuredClone(original) : undefined)
    const service = new FrozenDocumentExportService({ readRevision, build })
    const pending = service.build(captured, owner(1))
    const newer = structuredClone(original)
    newer.revision++
    if (newer.model.kind === 'course-v10') { newer.model.project.revision++; newer.model.project.title = '继续编辑后的作品' }
    expect(built.snapshot.revision).toBe(original.revision)
    expect(built.snapshot.model).toEqual(original.model)
    expect(built.snapshot.model).not.toEqual(newer.model)
    expect(built.includeDelivery).toBe(true)
    const delivery = output(built)
    finish({ requestId: built.requestId, identity: built.identity, status: 'generated', delivery, warnings: ['需要图面'] })
    await expect(pending).resolves.toEqual(delivery)
    expect(readRevision).toHaveBeenCalledWith(original.documentId, original.revision)
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('cancels only the matching sender/request job and cannot accept its late result', async () => {
    const original = snapshot(), request = input(original)
    let signal!: AbortSignal, finish!: (reply: ExportBuildReply) => void, frozen!: ExportBuildRequest
    const service = new FrozenDocumentExportService({ readRevision: () => original,
      build: (value, running) => { signal = running; frozen = value; return new Promise(resolve => { finish = resolve }) } })
    const pending = service.build(request, owner(2))
    expect(service.cancel(request.requestId, 3)).toBe(false)
    expect(signal.aborted).toBe(false)
    expect(service.cancel(request.requestId, 2)).toBe(true)
    expect(signal.aborted).toBe(true)
    finish({ requestId: request.requestId, identity: request.identity, status: 'generated', delivery: output(frozen), warnings: [] })
    await expect(pending).rejects.toThrow('导出已取消')
    expect(service.cancel(request.requestId, 2)).toBe(false)
  })

  it('does not replace an unavailable or mismatched historical revision with current content', async () => {
    const original = snapshot(), request = input(original), build = vi.fn()
    const missing = new FrozenDocumentExportService({ readRevision: () => undefined, build })
    await expect(missing.build(request, owner(1))).rejects.toThrow('冻结版本已无法定位')
    const newer = structuredClone(original); newer.revision++
    const mismatch = new FrozenDocumentExportService({ readRevision: () => newer, build })
    await expect(mismatch.build(request, owner(1))).rejects.toThrow('冻结版本已无法定位')
    expect(build).not.toHaveBeenCalled()
  })
})
