// @vitest-environment node
import { unzipSync } from 'fflate'
import { beforeEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExportBuildRequest } from '../../src/shared/workbench/toolPorts'
import type { ComponentCompilePort } from '../../src/renderer/export/componentPlatform/buildHtml'

vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({ loadPlayerBundle: () => 'window.CoursePlayer = {};' }))
const store = vi.hoisted(() => ({ getState: vi.fn() }))
vi.mock('../../src/renderer/store/editorStore', () => ({ useEditorStore: store }))
import { buildDocumentExport } from '../../src/renderer/workbench/delivery/buildDocumentExport'
import { buildDocumentExport as buildGuiDocumentExport } from '../../src/renderer/workbench/delivery/DocumentExportRenderer'

const compile: ComponentCompilePort = async () => { throw new Error('This source-free fixture must not compile') }
const prepareHeadlessDrafts = async () => {}
beforeEach(() => { store.getState.mockReset() })

function request(format: ExportBuildRequest['format']): ExportBuildRequest {
  let id = 0
  const project = createBlankCourseProjectV10('Lesson', () => `project-${++id}`)
  project.definitions = {}; project.instances = {}; project.global.overlay = []
  const snapshot: DocumentSnapshot = { documentId: 'doc', epoch: 'epoch', revision: 3,
    binding: { kind: 'untitled', suggestedName: 'Lesson.h5lesson' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
    dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  return { requestId: format, identity: { documentId: 'doc', epoch: 'epoch', revision: 3, projectId: project.id }, format, snapshot }
}

it.each(['html-offline', 'html-online', 'web-package'] as const)('produces real %s bytes from the frozen request', async format => {
  const input = request(format)
  const reply = await buildDocumentExport(input, undefined, compile, prepareHeadlessDrafts)
  expect(reply.status, reply.reason).toBe('generated')
  expect(reply.files).toHaveLength(1)
  if (format === 'web-package') {
    expect(reply.files?.[0]).toMatchObject({ relativePath: 'course.zip', mimeType: 'application/zip' })
    const archive = unzipSync(reply.files![0].bytes)
    expect(new TextDecoder().decode(archive['index.html'])).toContain('<html')
  } else {
    expect(reply.files?.[0]).toMatchObject({ relativePath: 'index.html', mimeType: 'text/html' })
    const html = new TextDecoder().decode(reply.files![0].bytes)
    expect(html).toContain('<html')
    expect(html).toContain(input.identity.projectId)
  }
  expect(store.getState).not.toHaveBeenCalled()
})

it('fails closed for a forged snapshot identity and a cancelled request', async () => {
  const forged = request('html-offline')
  forged.identity.revision = 99
  expect(await buildDocumentExport(forged, undefined, compile, prepareHeadlessDrafts)).toMatchObject({ status: 'failed' })
  const controller = new AbortController(); controller.abort()
  expect(await buildDocumentExport(request('html-online'), controller.signal, compile, prepareHeadlessDrafts)).toMatchObject({ status: 'cancelled' })
})

it('delegates the drain phase only to the supplied draft owner', async () => {
  const input = { ...request('html-offline'), phase: 'drain' as const }
  const prepareDrafts = vi.fn(async () => {})
  expect(await buildDocumentExport(input, undefined, compile, prepareDrafts)).toMatchObject({ status: 'drained' })
  expect(prepareDrafts).toHaveBeenCalledExactlyOnceWith('doc', 'epoch')
  expect(store.getState).not.toHaveBeenCalled()
})

it('retains GUI local draft draining before Main captures the snapshot', async () => {
  const input = { ...request('html-offline'), phase: 'drain' as const }
  const drainCourseDocument = vi.fn(async () => input.snapshot)
  store.getState.mockReturnValue({ courseKernel: { readView: () => ({ documents: [input.snapshot] }) }, drainCourseDocument })
  expect(await buildGuiDocumentExport(input)).toMatchObject({ status: 'drained' })
  expect(drainCourseDocument).toHaveBeenCalledExactlyOnceWith('doc')

  store.getState.mockReturnValue({ courseKernel: { readView: () => ({ documents: [{ ...input.snapshot, epoch: 'reopened' }] }) }, drainCourseDocument })
  expect(await buildGuiDocumentExport(input)).toMatchObject({ status: 'failed', reason: '准备导出的目标文档已关闭或重开' })
  expect(drainCourseDocument).toHaveBeenCalledTimes(1)

  store.getState.mockReturnValue({ courseKernel: { readView: () => ({ documents: [input.snapshot] }) },
    drainCourseDocument: async () => ({ ...input.snapshot, epoch: 'reopened' }) })
  expect(await buildGuiDocumentExport(input)).toMatchObject({ status: 'failed', reason: '准备导出时目标文档已变化' })
})
