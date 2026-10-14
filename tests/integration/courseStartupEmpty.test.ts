// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { documentHostAPI } from '../helpers/documentHostAPI'

const fixtures: { directory: string; bridge: CourseV10DocumentBridge }[] = []
afterEach(async () => {
  for (const { directory, bridge } of fixtures.splice(0)) {
    bridge.dispose()
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Fixture outside temporary directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

it('connects an empty workbench without creating a course; explicit New still opens one', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-empty-start-'))
  const host = new DocumentHostService(directory), bridge = new CourseV10DocumentBridge()
  fixtures.push({ directory, bridge })
  const bootstrap = vi.spyOn(host, 'bootstrapCourse')
  const api = documentHostAPI(host)
  await bridge.connect(api)
  expect(bootstrap).not.toHaveBeenCalled()
  expect(await api.list()).toEqual([])
  expect(bridge.read()).toMatchObject({ documents: [], activeDocumentId: null, project: null })
  expect(await api.recoverable()).toEqual([])
  await bridge.create()
  expect(bridge.read().documents).toHaveLength(1)
  expect(bridge.read().activeDocumentId).toBeTruthy()
  expect((await api.list())[0].model.kind).toBe('course-v10')
})

it('attaches an already opened course without creating a second document', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-existing-start-'))
  const host = new DocumentHostService(directory), bridge = new CourseV10DocumentBridge()
  fixtures.push({ directory, bridge })
  const existing = await host.bootstrapCourse()
  const bootstrap = vi.spyOn(host, 'bootstrapCourse')
  await bridge.connect(documentHostAPI(host))
  expect(bootstrap).not.toHaveBeenCalled()
  expect(bridge.read().activeDocumentId).toBe(existing.documentId)
  expect(host.registry.list()).toHaveLength(1)
})
