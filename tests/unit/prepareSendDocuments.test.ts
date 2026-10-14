// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareSendDocuments } from '../../src/renderer/app/prepareSendDocuments'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture directory')
  await fs.rm(root, { recursive: true, force: true })
} })
async function hostFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'send-input-owners-')); roots.push(root)
  return new DocumentHostService(root, {})
}

describe('workspace send input owners', () => {
  it('reports the original lifecycle failure even when the diagnostic sink fails', async () => {
    const reportFailure = vi.fn(async () => { throw new Error('logger unavailable') })
    const original = new Error('引用文档已关闭或重开，输入与附件已保留，请重新确认引用后发送。')
    await expect(prepareSendDocuments([{ documentId: 'original', epoch: 'epoch' }], {
      read: async () => { throw original }, drainDocuments: async () => true, reportFailure,
    })).rejects.toBe(original)
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith(original, { operation: 'send-prepare', phase: 'read', documentId: 'original', epoch: 'epoch' })
  })
  it('prepares mixed text/course references only through their actual owners', async () => {
    const host = await hostFixture()
    const text = await host.internalAPI.create({ kind: 'text', source: '原文', resources: { assets: {}, components: {} } }, 'notes.txt')
    const course = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} } }, 'lesson.glx')
    const prepareCourses = vi.fn(async () => {}), drainDocuments = vi.fn(async () => true)
    expect(await prepareSendDocuments([text, course, text], {
      read: id => host.internalAPI.read(id), drainDocuments, prepareCourses,
    })).toBe(true)
    expect(drainDocuments).toHaveBeenCalledExactlyOnceWith([text.documentId, course.documentId])
    expect(prepareCourses).toHaveBeenCalledExactlyOnceWith([course.documentId])
  })
  it('does not accept a closed target or a changed epoch after input preparation', async () => {
    const host = await hostFixture()
    const course = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} } }, 'lesson.glx')
    const read = vi.fn(async () => course)
    read.mockResolvedValueOnce(course).mockResolvedValueOnce({ ...course, epoch: 'reopened-epoch' })
    const ports = { read, drainDocuments: async () => true, prepareCourses: async () => {} }
    await expect(prepareSendDocuments([course], ports)).rejects.toThrow('关闭或重开')
    const prepareCourses = vi.fn(async () => {})
    await expect(prepareSendDocuments([{ documentId: 'closed-document', epoch: 'old' }], { read: id => host.internalAPI.read(id), drainDocuments: async () => true, prepareCourses })).rejects.toThrow()
    expect(prepareCourses).not.toHaveBeenCalled()
    const drainDocuments = vi.fn(async () => true)
    await expect(prepareSendDocuments([{ ...course, epoch: 'old-epoch' }], { read: id => host.internalAPI.read(id), drainDocuments, prepareCourses })).rejects.toThrow('关闭或重开')
    expect(drainDocuments).not.toHaveBeenCalled()
  })
})
