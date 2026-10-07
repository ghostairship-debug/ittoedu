// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentExportPort } from '../../../../src/main/workbench/delivery/DocumentExportPort'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import type { DocumentSnapshot } from '../../../../src/shared/workbench/document'
import type { ExportBuildRequest, ExportBuildReply } from '../../../../src/shared/workbench/toolPorts'

afterEach(() => { vi.useRealTimers() })
function request(): ExportBuildRequest {
  const project = createBlankCourseProjectV10('长导出')
  const snapshot: DocumentSnapshot = { documentId: 'v10', epoch: 'epoch', revision: 0, binding: { kind: 'untitled', suggestedName: 'lesson.h5lesson' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  return { requestId: 'build', identity: { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, projectId: project.id }, format: 'html-offline', snapshot }
}
const reply = (input: ExportBuildRequest): ExportBuildReply => ({ requestId: input.requestId, identity: input.identity, status: 'generated', warnings: [],
  files: [{ relativePath: 'index.html', mimeType: 'text/html', bytes: new TextEncoder().encode('<button>继续教学</button>') }] })

it('an active V10 export beyond the former total deadline succeeds while stale progress cannot prolong a silent build', async () => {
  vi.useFakeTimers()
  const input = request(), cancel = vi.fn(), dispatch = vi.fn()
  const port = new DocumentExportPort(12, dispatch, cancel)
  try {
    const pending = port.build(input).then(value => ({ value }), error => ({ error }))
    await vi.advanceTimersByTimeAsync(90_000)
    expect(port.progress({ requestId: input.requestId, identity: input.identity, sequence: 1, stage: 'assembling' }, 12)).toBe(true)
    await vi.advanceTimersByTimeAsync(90_000)
    expect(port.accept(reply(input), 12)).toBe(true)
    expect(await pending).toEqual({ value: reply(input) })
    expect(cancel).not.toHaveBeenCalled()
    const silent = { ...input, requestId: 'silent' }
    const failing = port.build(silent).then(value => ({ value }), error => ({ error }))
    await vi.advanceTimersByTimeAsync(90_000)
    expect(port.progress({ requestId: silent.requestId, identity: { ...silent.identity, revision: 7 }, sequence: 1 }, 12)).toBe(false)
    await vi.advanceTimersByTimeAsync(30_001)
    expect(await failing).toMatchObject({ error: expect.any(Error) })
    expect(cancel).toHaveBeenCalledWith({ requestId: silent.requestId, identity: silent.identity })
  } finally { port.dispose() }
})

it('user abort cancels the matching V10 renderer producer once and ignores late generation', async () => {
  const input = request(), cancel = vi.fn(), controller = new AbortController()
  const port = new DocumentExportPort(12, () => undefined, cancel)
  try {
    const pending = port.build(input, controller.signal).catch(error => error)
    controller.abort()
    expect(await pending).toBeInstanceOf(Error)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith({ requestId: input.requestId, identity: input.identity })
    expect(port.accept(reply(input), 12)).toBe(false)
    expect(port.progress({ requestId: input.requestId, identity: input.identity, sequence: 1 }, 12)).toBe(false)
  } finally { port.dispose() }
})
