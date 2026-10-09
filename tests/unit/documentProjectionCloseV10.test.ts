// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { DocumentProjection } from '../../src/renderer/documents/DocumentProjection'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { DocumentDriver, DocumentEvent } from '../../src/shared/workbench/document'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

const roots: string[] = [], projections: DocumentProjection[] = []
afterEach(async () => {
  for (const projection of projections.splice(0)) projection.dispose()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})
describe('V10 composition during discard confirmation', () => {
  it.each(['before-end', 'during-end'] as const)('retains ended IME input through cancellation (%s)', async timing => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'projection-close-v10-')); roots.push(root)
    const host = new DocumentHostService(root, {}, { discardFlowRecovery: async () => undefined })
    const listeners = new Set<(event: DocumentEvent) => void>()
    host.setEventSink(event => { for (const listener of listeners) listener(event) })
    const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: () => host.bootstrapCourse(),
      saveWithDialog: id => host.internalAPI.save(id, path.join(root, 'course.h5lesson')),
      close: async (id, discardDirty) => { await host.operate({ type: 'close', documentId: id, discardDirty }) },
      closeWithDialog: async id => { await host.operate({ type: 'close', documentId: id }); return true },
      discardRecovery: async id => { await host.operate({ type: 'discard-recovery', documentId: id }) },
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } } }
    const project = createBlankCourseProjectV10(), id = project.global.overlay[0]!
    project.instances[id]!.data = { text: 'old' }
    const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'course.h5lesson')
    const courseDriver = new CourseV10Driver()
    let wait: Promise<void> | undefined, release!: () => void
    const driver: DocumentDriver = { kind: courseDriver.kind,
      validate: model => courseDriver.validate(model),
      apply: (model, command) => wait ? wait.then(() => courseDriver.apply(model, command)) : courseDriver.apply(model, command),
      withRevision: (model, revision) => courseDriver.withRevision(model, revision),
      load: bytes => courseDriver.load(bytes), serialize: model => courseDriver.serialize(model),
      describeChanges: (before, after) => courseDriver.describeChanges(before, after) }
    const projection = await DocumentProjection.attach(api, snapshot.documentId, driver); projections.push(projection)
    projection.beginComposition(id, ['text'])
    await projection.updateComposition('中间输入')
    if (timing === 'before-end') {
      projection.suspendForClose()
      await projection.endComposition('最终输入')
    } else {
      wait = new Promise<void>(resolve => { release = resolve })
      const ending = projection.endComposition('最终输入')
      projection.suspendForClose()
      wait = undefined; release(); await ending
    }
    expect((await host.internalAPI.read(snapshot.documentId)).undoDepth).toBe(0)
    projection.resumeAfterCloseCancelled()
    const current = await projection.drain()
    expect(current.model).toMatchObject({ kind: 'course-v10', project: { instances: { [id]: { data: { text: '最终输入' } } } } })
    expect(current.undoDepth).toBe(1)
    expect(projection.read().composing).toBeNull()
  })
})
