// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createDocumentArchive, createDocumentArchiveDriver, loadDocumentArchive, openDocumentArchive } from '../../src/main/workbench/documentArchiveWorker'

describe('fixed input document archive worker', () => {
  it('keeps shared input bytes attached while a real archive is created and opened outside Main', async () => {
    const project = createBlankCourseProjectV10('Worker archive'), bytes = new Uint8Array(512 * 1024).fill(7)
    project.assets.raw = { id: 'raw', path: 'assets/raw.bin', mimeType: 'application/octet-stream' }
    const data = { project, resources: { assets: { raw: bytes }, components: {} } }
    let ticks = 0
    const timer = setInterval(() => { ticks++ }, 1)
    let archive: Uint8Array
    try { archive = await createDocumentArchive(data) } finally { clearInterval(timer) }
    expect(ticks).toBeGreaterThan(0)
    expect(bytes.byteLength).toBe(512 * 1024)
    expect(bytes[0]).toBe(7)
    const decoded = await openDocumentArchive(archive)
    expect(decoded.project).toEqual(project)
    expect(decoded.resources.assets.raw).toEqual(bytes)
    expect(archive.byteLength).toBeGreaterThan(0)
    expect(new CourseV10Driver().load(archive)).toMatchObject({ kind: 'course-v10', project: { title: 'Worker archive' } })
  })

  it('uses an opened validation fact only once and preserves later mutable validation', async () => {
    const project = createBlankCourseProjectV10('Validation fact')
    const archive = await createDocumentArchive({ project, resources: { assets: {}, components: {} } })
    const loaded = await loadDocumentArchive(archive), driver = createDocumentArchiveDriver()
    driver.validate(loaded.model)
    if (loaded.model.kind !== 'course-v10') throw new Error('expected work project')
    loaded.model.project.rootIds.push('missing-instance')
    expect(() => driver.validate(loaded.model)).toThrow('所属对象不存在')
    await expect(openDocumentArchive(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })

  it('cancels only its archive job and keeps the shared input bytes attached', async () => {
    const project = createBlankCourseProjectV10('Cancelled archive'), bytes = new Uint8Array(512 * 1024).fill(3)
    project.assets.raw = { id: 'raw', path: 'assets/raw.bin' }
    const controller = new AbortController()
    const work = createDocumentArchive({ project, resources: { assets: { raw: bytes }, components: {} } }, controller.signal)
    controller.abort()
    await expect(work).rejects.toMatchObject({ name: 'AbortError' })
    expect(bytes.byteLength).toBe(512 * 1024)
    expect(bytes[0]).toBe(3)
  })
})
