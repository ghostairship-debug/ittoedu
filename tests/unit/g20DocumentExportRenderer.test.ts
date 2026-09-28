// @vitest-environment node
import { unzipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExportBuildRequest } from '../../src/shared/workbench/toolPorts'

vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({ loadPlayerBundle: () => 'window.CoursePlayer = {};' }))
vi.mock('../../src/renderer/export/bundledFontEmbedding', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/renderer/export/bundledFontEmbedding')>()
  return { ...actual, prepareBundledFontEmbedding: async () => undefined }
})
import { buildDocumentExport } from '../../src/renderer/workbench/delivery/DocumentExportRenderer'

function request(format: ExportBuildRequest['format']): ExportBuildRequest {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const snapshot: DocumentSnapshot = { documentId: 'doc', epoch: 'epoch', revision: 3,
    binding: { kind: 'untitled', suggestedName: 'Lesson.h5lesson' },
    model: { kind: 'course-v9', project, resources: { assets: {}, components: {} } },
    dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  return { requestId: format, identity: { documentId: 'doc', epoch: 'epoch', revision: 3, projectId: project.id }, format, snapshot }
}

it.each(['html-offline', 'html-online', 'web-package'] as const)('produces real %s bytes from the frozen request', async format => {
  const input = request(format)
  const reply = await buildDocumentExport(input)
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
})

it('fails closed for a forged snapshot identity and a cancelled request', async () => {
  const forged = request('html-offline')
  forged.identity.revision = 99
  expect(await buildDocumentExport(forged)).toMatchObject({ status: 'failed' })
  const controller = new AbortController(); controller.abort()
  expect(await buildDocumentExport(request('html-online'), controller.signal)).toMatchObject({ status: 'cancelled' })
})
