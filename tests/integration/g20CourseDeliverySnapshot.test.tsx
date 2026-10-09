import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { IMAGE_DEFINITION, createImageData } from '../../src/components/image'
import { jsonValueSchema } from '../../src/shared/contracts/component-platform/schema'
import { buildComponentWebPackage } from '../../src/renderer/export/componentPlatform/buildHtml'
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
async function setup(warning = false) {
  // Main structuredClone returns Node buffers; preserve that actual byte realm in jsdom.
  vi.stubGlobal('Uint8Array', Object.getPrototypeOf(Buffer.prototype).constructor)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-delivery-')); directories.push(directory)
  const host = new DocumentHostService(directory), project = createBlankCourseProjectV10('完整交付')
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN6kAAAAASUVORK5CYII=', 'base64'))
  project.definitions.image = { ...IMAGE_DEFINITION, id: 'image' }
  project.instances.image = { id: 'image', definitionId: 'image', data: jsonValueSchema.parse(createImageData('png')), frame: { width: 100, height: 100, transform: [1, 0, 0, 1, 10, 10] } }
  project.assets.png = { id: 'png', path: 'assets/image.png', mimeType: 'image/png' }
  project.surfaces[0].childIds = ['image']
  if (warning) {
    project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
    project.instances.web = { id: 'web', definitionId: 'web', data: { html: '<img src="https://lesson.example/online.png">' } }
    project.surfaces[0].childIds.push('web')
  }
  const model = { kind: 'course-v10' as const, project, resources: { assets: { png }, components: {} } }
  const a = await host.internalAPI.create(model, 'A.h5lesson'), b = await host.internalAPI.create(model, 'B.h5lesson')
  let active = a.documentId
  const errors: unknown[] = []
  const ports: CourseDeliveryPorts = { captureSnapshot: async () => courseDeliverySnapshot(await host.registry.get(active).drain()),
    readCanonicalSnapshot: () => courseDeliverySnapshot(host.registry.get(active).read()),
    compileComponent: async () => { throw new Error('No source modules in this sample') },
    runBusy: async action => { try { return await action() } catch (error) { errors.push(error); return undefined } }, commitStatus: vi.fn(), reportError: vi.fn(), navigateFinding: vi.fn(),
    exportHtml: vi.fn(async () => ({ path: 'generated.html' })), exportWebPackage: vi.fn(async () => null), exportPdf: vi.fn(async () => null), exportBinary: vi.fn(async () => null) }
  const hook = renderHook(() => useCourseDelivery(ports, { documentTrigger: null, sidecarTrigger: null, componentPackagesTrigger: null }))
  return { host, a, b, ports, errors, hook, setActive: (id: string) => { active = id } }
}
it('keeps a pending output notice bound to its document and cancels a delayed continuation before any write', async () => {
  const f = await setup(true)
  await act(async () => f.hook.result.current.exportCourse('single-html'))
  await waitFor(() => expect(f.hook.result.current.exportPreflightReport?.summary.warning).toBeGreaterThan(0))
  expect(f.ports.exportHtml).not.toHaveBeenCalled()
  const capture = f.ports.captureSnapshot
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  f.ports.captureSnapshot = async () => { await barrier; return capture() }
  act(() => f.hook.result.current.continuePreflightExport())
  act(() => f.hook.result.current.cancelPreflight())
  await act(async () => { release(); await barrier })
  await waitFor(() => expect(f.hook.result.current.exportProgress).toBeNull())
  expect(f.ports.exportHtml).not.toHaveBeenCalled()
  f.ports.captureSnapshot = capture
  await act(async () => f.hook.result.current.exportCourse('single-html'))
  await waitFor(() => expect(f.hook.result.current.exportPreflightReport).not.toBeNull())
  f.setActive(f.b.documentId)
  await act(async () => f.hook.result.current.continuePreflightExport())
  await waitFor(() => expect(f.errors).toHaveLength(1))
  expect(String(f.errors[0])).toContain('切换文档'); expect(f.ports.exportHtml).not.toHaveBeenCalled()
})
it('exports the captured revision and resource bytes while Main commits a newer revision, and cancels a new generation without writes', async () => {
  const f = await setup()
  let release!: () => void; fonts.gate = new Promise<void>(resolve => { release = resolve })
  await act(async () => f.hook.result.current.exportCourse('single-html'))
  await waitFor(() => expect(f.hook.result.current.exportProgress).toBe('generating'))
  const r = await f.host.registry.get(f.a.documentId).drain(); if (r.model.kind !== 'course-v10') throw new Error('fixture')
  const capturedProject = r.model.project
  await act(async () => { const receipt = await f.host.registry.get(r.documentId).execute({ documentId: r.documentId, epoch: r.epoch, baseRevision: r.revision, operationId: 'during-export', actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(capturedProject, [{ type: 'project.title.set', title: '生成期间的新标题 r+1' }]) } }); expect(receipt).toMatchObject({ status: 'applied' }) })
  await act(async () => { release(); await fonts.gate })
  await waitFor(() => expect(f.ports.exportHtml).toHaveBeenCalledTimes(1))
  const output = vi.mocked(f.ports.exportHtml).mock.calls[0][0]
  expect(output.suggestedName).toBe(`${r.model.project.title}.html`); expect(output.html).not.toContain('生成期间的新标题 r+1')
  expect(output.html).toContain(Buffer.from(r.model.resources.assets.png).toString('base64'))
  expect(output.html).toContain('guoling.navigation')
  expect((await f.host.registry.get(r.documentId).drain()).revision).toBe(r.revision + 1)
  expect(f.errors).toEqual([])
  fonts.gate = new Promise<void>(resolve => { release = resolve })
  act(() => f.hook.result.current.exportCourse('single-html'))
  await waitFor(() => expect(f.hook.result.current.exportProgress).toBe('generating'))
  act(() => f.hook.result.current.cancelExport())
  expect(f.hook.result.current.exportProgress).toBe('cancelling')
  await act(async () => { release(); await fonts.gate })
  await waitFor(() => expect(f.hook.result.current.exportProgress).toBeNull())
  expect(f.ports.exportHtml).toHaveBeenCalledTimes(1); expect(f.errors).toEqual([])
  fonts.gate = null
  await act(async () => f.hook.result.current.exportCourse('single-html'))
  await waitFor(() => expect(f.ports.exportHtml).toHaveBeenCalledTimes(2))
  const controller = new AbortController()
  const zip = buildComponentWebPackage(await f.host.internalAPI.read(f.a.documentId), f.ports.compileComponent, controller.signal)
  controller.abort(); await expect(zip).rejects.toMatchObject({ name: 'AbortError' })
})
