import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { DocumentProjection } from '../../src/renderer/documents/DocumentProjection'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { readCourseProjectV9FixtureArchive } from '../fixtures/course-project-v9'
import { buildPublishedCourseWebPackageAsync } from '../../src/renderer/export/course/buildCoursePackages'
import { loadPlayerBundle } from '../../src/renderer/export/loadPlayerBundle'
import { courseDeliverySnapshot } from '../../src/renderer/app/courseDeliverySnapshot'
import { useCourseDelivery, type CourseDeliveryPorts } from '../../src/renderer/app/useCourseDelivery'
vi.mock('../../src/renderer/export/loadPlayerBundle', async () => { const { readFileSync } = await import('node:fs'); return { loadPlayerBundle: () => readFileSync('dist-player/player.iife.js', 'utf8') } })
const fonts = vi.hoisted(() => ({ gate: null as Promise<void> | null }))
vi.mock('../../src/renderer/export/bundledFontEmbedding', async original => {
  const actual = await original<typeof import('../../src/renderer/export/bundledFontEmbedding')>()
  return { ...actual, prepareBundledFontEmbedding: async () => { if (fonts.gate) await fonts.gate; await actual.prepareBundledFontEmbedding() } }
})
const directories: string[] = []
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); fonts.gate = null; for (const directory of directories.splice(0)) { if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('invalid fixture'); await fs.rm(directory, { recursive: true, force: true }) } })
async function setup() {
  // jsdom uses Node structuredClone; align its typed-array constructor with the main service realm.
  vi.stubGlobal('Uint8Array', Object.getPrototypeOf(Buffer.prototype).constructor)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-delivery-')); directories.push(directory)
  const host = new DocumentHostService(directory), model = structuredClone(await new CourseV9Driver().load(readCourseProjectV9FixtureArchive('multi-asset')))
  const a = await host.internalAPI.create(model, 'A.h5lesson'), b = await host.internalAPI.create(model, 'B.h5lesson')
  const api = { ...host.internalAPI, subscribe: (listener: Parameters<typeof host.setEventSink>[0]) => { host.setEventSink(listener); return () => host.setEventSink(undefined) } } as unknown as Parameters<typeof DocumentProjection.attach>[0]
  const projection = await DocumentProjection.attach(api, a.documentId)
  let active = a.documentId
  const errors: unknown[] = []
  const ports: CourseDeliveryPorts = { captureSnapshot: async () => courseDeliverySnapshot(await (active === a.documentId ? projection.drain() : host.registry.get(active).drain())),
    readCanonicalSnapshot: () => courseDeliverySnapshot(host.registry.get(active).read()),
    runBusy: async action => { try { return await action() } catch (error) { errors.push(error); return undefined } }, commitStatus: vi.fn(), reportError: vi.fn(), navigateFinding: vi.fn(),
    exportHtml: vi.fn(async () => ({ path: 'generated.html' })), exportWebPackage: vi.fn(async () => null), exportPdf: vi.fn(async () => null), exportBinary: vi.fn(async () => null) }
  const hook = renderHook(() => useCourseDelivery(ports, { documentTrigger: null, sidecarTrigger: null, componentPackagesTrigger: null }))
  const preflight = async () => { await act(async () => hook.result.current.exportCourse('single-html')); await waitFor(() => expect(hook.result.current.exportPreflightReport?.summary.canExport).toBe(true)) }
  return { host, a, b, projection, ports, errors, hook, preflight, setActive: (id: string) => { active = id } }
}
it('uses drained document identity through tab changes and exports r with complete resources while main commits r+1', async () => {
  const f = await setup()
  await f.preflight()
  const capture = f.ports.captureSnapshot
  let releaseCapture!: () => void
  const barrier = new Promise<void>(resolve => { releaseCapture = resolve })
  f.ports.captureSnapshot = async () => { await barrier; return capture() }
  act(() => f.hook.result.current.continuePreflightExport())
  act(() => f.hook.result.current.cancelPreflight())
  await act(async () => { releaseCapture(); await barrier })
  expect(f.ports.exportHtml).not.toHaveBeenCalled(); expect(f.hook.result.current.exportPreflightReport).toBeNull()
  f.ports.captureSnapshot = capture; await f.preflight(); f.setActive(f.b.documentId)
  await act(async () => f.hook.result.current.continuePreflightExport())
  expect(f.errors).toHaveLength(1); expect(String(f.errors[0])).toContain('切换文档'); expect(f.ports.exportHtml).not.toHaveBeenCalled()
  f.setActive(f.a.documentId); f.errors.length = 0
  let release!: () => void; fonts.gate = new Promise<void>(resolve => { release = resolve })
  await act(async () => f.hook.result.current.continuePreflightExport())
  await waitFor(() => expect(f.hook.result.current.exportProgress).toBe('generating'))
  const r = await f.host.registry.get(f.a.documentId).drain(); if (r.model.kind !== 'course-v9') throw new Error('fixture')
  const project = structuredClone(r.model.project); project.title = '生成期间的新标题 r+1'
  await act(async () => { await f.host.registry.get(r.documentId).execute({ documentId: r.documentId, epoch: r.epoch, baseRevision: r.revision, operationId: 'during-export', actor: 'human', mutation: { type: 'command', command: { type: 'course.replace', project } } }) })
  await act(async () => { release(); await fonts.gate })
  await waitFor(() => expect(f.ports.exportHtml).toHaveBeenCalledTimes(1))
  const output = vi.mocked(f.ports.exportHtml).mock.calls[0][0]
  expect(output.suggestedName).toBe(`${r.model.project.title}.html`); expect(output.html).not.toContain('生成期间的新标题 r+1')
  for (const bytes of Object.values(r.model.resources.assets)) expect(output.html).toContain(Buffer.from(bytes).toString('base64'))
  expect(output.html).toContain('teacher-controller')
  expect((await f.host.registry.get(r.documentId).drain()).revision).toBe(r.revision + 1)
  expect(f.errors).toEqual([]); f.projection.dispose()
})
it('cancels a pending real generation before the write port and permits a new export from the preserved draft', async () => {
  const f = await setup(); await f.preflight()
  let release!: () => void; fonts.gate = new Promise<void>(resolve => { release = resolve })
  await act(async () => f.hook.result.current.continuePreflightExport())
  await waitFor(() => expect(f.hook.result.current.exportProgress).toBe('generating'))
  act(() => f.hook.result.current.cancelExport()); expect(f.hook.result.current.exportProgress).toBe('cancelling')
  await act(async () => { release(); await fonts.gate })
  await waitFor(() => expect(f.hook.result.current.exportProgress).toBeNull())
  expect(f.ports.exportHtml).not.toHaveBeenCalled(); expect(f.errors).toEqual([])
  expect((await f.host.registry.get(f.a.documentId).drain()).revision).toBe(f.a.revision)
  fonts.gate = null; await f.preflight(); await act(async () => f.hook.result.current.continuePreflightExport())
  await waitFor(() => expect(f.ports.exportHtml).toHaveBeenCalledTimes(1))
  const snapshot = courseDeliverySnapshot(await f.projection.drain())!, controller = new AbortController()
  const zip = buildPublishedCourseWebPackageAsync(snapshot, loadPlayerBundle(), controller.signal)
  controller.abort()
  await expect(zip).rejects.toMatchObject({ name: 'AbortError' })
  f.projection.dispose()
})
