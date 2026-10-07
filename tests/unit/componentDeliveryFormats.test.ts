import { afterEach, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData } from '../../src/components/text/data'
import { courseDeliverySnapshot } from '../../src/renderer/app/courseDeliverySnapshot'
import { buildComponentDelivery } from '../../src/renderer/export/componentPlatform/delivery'
import { buildDocumentExport } from '../../src/renderer/workbench/delivery/buildDocumentExport'
import { registerBundledFontEmbedPreparer, registerBundledFontEmbedSource, collectBundledFontFamiliesInUse } from '../../src/renderer/export/bundledFontEmbedding'
import { resolveEmbeddableBundledFonts } from '../../src/renderer/export/bundledFontEmbedSourceNode'
import { installFetchBundledFontEmbedSource } from '../../src/renderer/export/bundledFontEmbedSourceFetch'
import { executeDocumentDeliveryTool } from '../../src/core/tools/DocumentDeliveryTools'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ComponentCompilePort } from '../../src/renderer/export/componentPlatform/buildHtml'
import { createElement } from 'react'
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react'
import { CourseExportSettingsDialog } from '../../src/renderer/app/CourseExportSettingsDialog'
import { useCourseDelivery, type CourseDeliveryPorts } from '../../src/renderer/app/useCourseDelivery'

vi.mock('../../src/renderer/export/loadPlayerBundle', () => ({ loadPlayerBundle: () => 'var CoursewarePlayer={};' }))
const compile: ComponentCompilePort = async () => { throw new Error('No custom source in this sample') }
afterEach(() => { registerBundledFontEmbedSource(null); registerBundledFontEmbedPreparer(null) })

function sample() {
  const project = createBlankCourseProjectV10('格式输出')
  project.global.overlay = []; project.instances = {}; project.definitions = {
    text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
  }
  project.surfaces = ['a', 'b', 'c'].map(id => ({ id, title: id, kind: 'slide' as const, childIds: [id], designSize: { width: 1000, height: 700 } }))
  for (const id of ['a', 'b', 'c']) {
    const data = createTextComponentData(`page-${id}`); data.appearance.fontFamily = 'Noto Sans SC'
    project.instances[id] = { id, definitionId: 'text', data: JSON.parse(JSON.stringify(data)), frame: { width: 300, height: 80, transform: [1, 0, 0, 1, 20, 20] } }
  }
  const snapshot: DocumentSnapshot = { documentId: 'delivery', epoch: 'epoch', revision: project.revision, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } },
    binding: { kind: 'untitled', suggestedName: '格式输出.h5lesson' }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  return { project, snapshot }
}

it('embeds actual bundled V10 font files and notices in single HTML and ZIP outputs', async () => {
  registerBundledFontEmbedSource(resolveEmbeddableBundledFonts)
  const { snapshot } = sample(), delivery = courseDeliverySnapshot(snapshot)!
  const html = (await buildComponentDelivery(delivery, 'single-html', { compile })).artifacts[0]!.html!
  expect(html).toContain('data:font/woff2;base64,')
  expect(html).toContain('SIL OPEN FONT LICENSE')
  const zip = unzipSync((await buildComponentDelivery(delivery, 'web-package', { compile })).artifacts[0]!.bytes!)
  const faces = Object.keys(zip).filter(name => name.startsWith('fonts/') && name.endsWith('.woff2'))
  expect(faces.length).toBeGreaterThan(0)
  for (const filename of faces) {
    expect(new TextDecoder().decode(zip[filename]!.subarray(0, 4))).toBe('wOF2')
    expect(strFromU8(zip['index.html']!)).toContain(filename)
  }
  expect(strFromU8(zip['THIRD_PARTY_NOTICES.md']!)).toContain('SIL OPEN FONT LICENSE')
  expect(collectBundledFontFamiliesInUse({ kind: 'flow', data: { inlines: [{ type: 'math' }] } })).toEqual(['Noto Sans SC', 'STIX Two Math'])
})

it('diagnoses the observed HTTP-200 HTML font response without embedding it or refusing the usable course', async () => {
  const font = resolveEmbeddableBundledFonts(['Noto Sans SC'])[0]!
  const bytes = new TextEncoder().encode('<!doctype html><html>错误地址返回首页</html>')
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    installFetchBundledFontEmbedSource({ manifest: { families: [{ ...font, faces: font.faces.map(face => ({ ...face, url: './missing-font.woff2' })) }] },
      licenseTexts: { [font.license.noticePath]: font.licenseText }, fetchResource: async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }) as Response })
    const output = await buildComponentDelivery(courseDeliverySnapshot(sample().snapshot)!, 'single-html', { compile })
    expect(output.artifacts[0]!.html).not.toContain('data:font/woff2')
    expect(output.report.items).toContainEqual(expect.objectContaining({ code: 'bundled-font-unavailable', severity: 'warning' }))
    expect(output.report.summary.canExport).toBe(true)
    expect(warning).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: expect.stringContaining('WOFF2') }))
  } finally { warning.mockRestore() }
})

it('carries public ordered page choices through a captured Main request into actual PPTX XML and paper dimensions', async () => {
  const { snapshot } = sample(), options = { pageIds: ['c', 'a'], pageSize: 'letter' as const, orientation: 'landscape' as const }
  const service = { lookup: async () => null, export: vi.fn(async () => ({ status: 'generated' as const, documentId: 'delivery', epoch: 'epoch', format: 'pptx' as const, currentRevision: 0, warnings: [] })), save: vi.fn() }
  await executeDocumentDeliveryTool(service, { runId: 'run', operationId: 'op', requestDigest: 'digest', resolveHandle: async () => ({ documentId: 'delivery', epoch: 'epoch', revision: 0 }) },
    'document.export', { target: 'course', format: 'pptx', options })
  expect(service.export).toHaveBeenCalledWith(expect.objectContaining({ options }))
  const reply = await buildDocumentExport({ requestId: 'output', identity: { documentId: 'delivery', epoch: 'epoch', revision: 0, projectId: snapshot.model.kind === 'course-v10' ? snapshot.model.project.id : '' },
    format: 'pptx', snapshot, options }, undefined, compile, async () => {})
  expect(reply.status, reply.reason).toBe('generated')
  const zip = unzipSync(reply.files![0]!.bytes)
  expect(strFromU8(zip['ppt/slides/slide1.xml']!)).toContain('page-c')
  expect(strFromU8(zip['ppt/slides/slide2.xml']!)).toContain('page-a')
  expect(zip['ppt/slides/slide3.xml']).toBeUndefined()
  const presentation = new DOMParser().parseFromString(strFromU8(zip['ppt/presentation.xml']!), 'application/xml')
  expect(presentation.getElementsByTagName('p:sldSz')[0]!.getAttribute('cx')).toBe(String(11 * 914400))
  expect(presentation.getElementsByTagName('p:sldSz')[0]!.getAttribute('cy')).toBe(String(8.5 * 914400))
})

it('prints only selected Spatial cameras in captured order with requested paper', async () => {
  const { snapshot } = sample()
  if (snapshot.model.kind !== 'course-v10') throw new Error('course')
  snapshot.model.project.surfaces.push({ id: 'space', kind: 'spatial', title: '空间', childIds: [], spatial: { home: { x: 0, y: 0, zoom: 1 }, frames: [
    { id: 'first', pose: { x: 0, y: 0, zoom: 1 } }, { id: 'second', pose: { x: 0, y: 0, zoom: 1 } },
  ] } })
  const calls: string[] = []
  const output = await buildComponentDelivery(courseDeliverySnapshot(snapshot, { pageIds: ['space:second', 'b', 'space:first'], pageSize: 'letter', orientation: 'landscape' })!, 'pdf', {
    compile, createCapture: async () => ({ async captureSurface(id, frame) { calls.push(`${id}/${frame ?? ''}`); return { dataUrl: 'data:image/png;base64,aW1hZ2U=', width: 1000, height: 700 } }, captureInstance: async () => undefined, dispose() {} }),
  })
  expect(calls).toEqual(['space/second', 'b/', 'space/first'])
  expect(output.artifacts[0]!.html).toContain('letter landscape')
  expect(new DOMParser().parseFromString(output.artifacts[0]!.html!, 'text/html').querySelectorAll('.page')).toHaveLength(3)
})

it('confirms optional GUI settings into the drained snapshot and retains them through the existing output notice', async () => {
  const { snapshot } = sample(), delivery = courseDeliverySnapshot(snapshot)!, calls: string[] = [], saved: string[] = []
  const captureSnapshot = vi.fn(async () => delivery)
  const ports: CourseDeliveryPorts = { captureSnapshot, readCanonicalSnapshot: () => delivery, compileComponent: compile,
    runBusy: async work => work(), commitStatus: vi.fn(), reportError: vi.fn(), navigateFinding: vi.fn(),
    exportHtml: vi.fn(), exportWebPackage: vi.fn(), exportBinary: vi.fn(), exportPdf: async input => { saved.push(input.html); return { path: 'selected.pdf' } },
    createOutputCapture: async () => ({ async captureSurface(id) { calls.push(id); return { dataUrl: 'data:image/png;base64,aW1hZ2U=', width: 1000, height: 700 } }, captureInstance: async () => undefined, dispose() {} }),
  }
  const hook = renderHook(() => useCourseDelivery(ports, { documentTrigger: null, sidecarTrigger: null, componentPackagesTrigger: null }))
  act(() => hook.result.current.openExportSettings())
  expect(captureSnapshot).not.toHaveBeenCalled()
  const dialog = render(createElement(CourseExportSettingsDialog, { pages: hook.result.current.exportSettingsPages,
    onCancel: hook.result.current.closeExportSettings, onConfirm: hook.result.current.confirmExportSettings }))
  fireEvent.click(dialog.getByLabelText('导出 b'))
  fireEvent.click(dialog.getByLabelText('上移 c'))
  fireEvent.change(dialog.getByLabelText('导出纸型'), { target: { value: 'letter' } })
  fireEvent.change(dialog.getByLabelText('导出方向'), { target: { value: 'landscape' } })
  fireEvent.click(dialog.getByRole('button', { name: '导出', exact: true }))
  await waitFor(() => expect(hook.result.current.exportPreflightReport).not.toBeNull())
  expect(captureSnapshot).toHaveBeenCalledTimes(1)
  expect(calls).toEqual(['c', 'a'])
  act(() => hook.result.current.continuePreflightExport())
  await waitFor(() => expect(saved).toHaveLength(1))
  expect(saved[0]).toContain('letter landscape')
  expect(calls).toEqual(['c', 'a'])
  dialog.unmount(); hook.unmount()
})
