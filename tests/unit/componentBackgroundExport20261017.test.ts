import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { courseProjectV10Schema, publishedCourseV3Schema } from '../../src/shared/contracts/component-platform'
import type { ComponentBackground } from '../../src/shared/contracts/component-platform/project'
import type { CaptureObservationInput } from '../../src/shared/ipcTypes'
import { createTextComponentData } from '../../src/components/text/data'
import { createComponentDeliveryCapture } from '../../src/renderer/export/componentPlatform/capture'
import { buildComponentPptx } from '../../src/renderer/export/componentPlatform/pptx'
import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'
import { buildComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'
import { bytesToDataUrl } from '../../src/renderer/export/base64'
import { auditExportPng } from '../fixtures/auditExportPng'

const image = auditExportPng(8, 8), imageUrl = bytesToDataUrl(image, 'image/png')
const paint: ComponentBackground = { mode: 'own', paint: { layers: [
  { style: { 'background-color': '#204060', 'background-image': 'linear-gradient(90deg, #204060, #6080a0), url("layer-a.png")',
    'background-size': 'cover, 16px 16px', 'background-position': 'center, left top', 'background-repeat': 'no-repeat, repeat' }, resourceBindings: { 'layer-a.png': 'a' } },
  { style: { 'background-image': 'url("layer-b.png")', 'background-size': '50% 50%', 'background-position': 'right bottom', 'background-repeat': 'no-repeat' }, resourceBindings: { 'layer-b.png': 'b' } },
] } }

function project(kind: 'slide' | 'flow' = 'slide') {
  return courseProjectV10Schema.parse(createTestProjectFromLegacy({ schemaVersion: 10, id: 'background-export', revision: 0, title: 'Background export',
    definitions: { text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } } },
    instances: { text: { id: 'text', definitionId: 'text', data: createTextComponentData('Native editable foreground'),
      frame: { width: 500, height: 70, transform: [1, 0, 0, 1, 20, 30] } },
    global: { id: 'global', definitionId: 'text', data: createTextComponentData('Global foreground'),
      frame: { width: 500, height: 70, transform: [1, 0, 0, 1, 20, 130] } } },
    surfaces: [{ id: 'page', title: 'Background page', kind, childIds: ['text'], background: paint,
      ...(kind === 'slide' ? { designSize: { width: 800, height: 600 } } : {}) }],
    global: { underlay: [], overlay: ['global'] },
    assets: { a: { id: 'a', path: 'assets/a.png', mimeType: 'image/png' }, b: { id: 'b', path: 'assets/b.png', mimeType: 'image/png' } } }))
}

it('background capture sends an initial-state background with no foreground or executable project owners', async () => {
  const source = project()
  testContainerInstance(source, 0).container!.presentation = { initialStateId: 'initial', states: [{ id: 'initial', title: 'Initial', overrides: {},
    background: { mode: 'own', paint: { layers: [{ style: { 'background-image': 'linear-gradient(red, blue)' }, resourceBindings: {} }] } } }] }
  const { revision: _revision, ...plain } = source
  const published = publishedCourseV3Schema.parse({ ...plain, schemaVersion: 4, assets: {
    a: { id: 'a', mimeType: 'image/png', url: imageUrl }, b: { id: 'b', mimeType: 'image/png', url: imageUrl },
  } })
  const before = structuredClone(published), requests: CaptureObservationInput[] = []
  const capture = await createComponentDeliveryCapture(published, async input => {
    requests.push(input); return { dataUrl: imageUrl, width: 800, height: 600 }
  })
  await capture.captureBackground!('page')
  await capture.captureInstance('page', 'text')
  await capture.dispose()
  const request = requests[0]!
  if (!('kind' in request) || request.kind !== 'published') throw new Error('Expected published capture')
  expect(publishedCourseV3Schema.safeParse(request.published).success).toBe(true)
  expect(Object.keys(request.published.instances)).toEqual(['page'])
  expect(Object.values(request.published.definitions).map(definition => definition.implementation)).toEqual([{ kind: 'builtin', key: 'guoling.container.slide' }])
  expect(request.published.global).toEqual({ underlay: [], overlay: [] })
  expect(componentSurfaces(request.published)).toEqual([{ id: 'page', title: 'Background page', kind: 'slide', childIds: [],
    designSize: { width: 800, height: 600 }, background: expect.objectContaining({ paint: testContainerInstance(source, 0).container!.presentation!.states[0]!.background!.paint }) }])
  expect(request).toMatchObject({ staticExport: true, stateId: null })
  expect(request.published).not.toHaveProperty('logic')
  expect(requests[1]).toMatchObject({ published, instanceId: 'text', stateId: 'initial' })
  expect(published).toEqual(before)
})

it('PPTX places the complex background image before editable foreground and leaves simple images on the native route', async () => {
  const source = project(), before = structuredClone(source)
  const captureBackground = vi.fn(async () => imageUrl), captureInstance = vi.fn()
  const result = await buildComponentPptx(source, { captureBackground, captureInstance })
  expect(captureBackground).toHaveBeenCalledTimes(1); expect(captureInstance).not.toHaveBeenCalled()
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'background-static-capture', surfaceId: 'page' }))
  const xml = strFromU8(unzipSync(result.bytes)['ppt/slides/slide1.xml']!)
  expect(xml.match(/<p:pic>/g)).toHaveLength(1)
  expect(xml).toContain('Native editable foreground'); expect(xml).toContain('Global foreground')
  expect(xml.indexOf('name="page:background"')).toBeLessThan(xml.indexOf('Native editable foreground'))
  expect(xml.match(/<p:sp>/g)).toHaveLength(3)
  expect(source).toEqual(before)
  testContainerInstance(source, 0).container!.background = { mode: 'own', assetId: 'a', fit: 'fill' }
  captureBackground.mockClear()
  const simple = await buildComponentPptx(source, { captureBackground, resolveAsset: () => imageUrl })
  expect(captureBackground).not.toHaveBeenCalled()
  expect(simple.diagnostics.some(value => value.code === 'background-static-capture')).toBe(false)
})

it('PPTX reports an unavailable background capture while preserving native foreground', async () => {
  const result = await buildComponentPptx(project())
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'background-capture-missing', severity: 'error' }))
  expect(strFromU8(unzipSync(result.bytes)['ppt/slides/slide1.xml']!)).toContain('Native editable foreground')
})

it('Flow PDF HTML embeds both background resources in noninteractive paint layers before semantic content', async () => {
  const source = project('flow'), reads: string[] = []
  const result = await buildComponentPrintHtml(source, { surfaceId: 'page', resolveAsset: async id => {
    reads.push(id); return { bytes: image, mimeType: 'image/png' }
  } })
  const dom = new DOMParser().parseFromString(result.html, 'text/html')
  const root = dom.querySelector<HTMLElement>('[data-component-print-root]')!
  const background = root.querySelector<HTMLElement>('[data-surface-background] > [data-component-background-paint]')!
  expect(reads.sort()).toEqual(['a', 'b'])
  expect(background.hasAttribute('data-component-background-paint')).toBe(true)
  expect(background.style.pointerEvents).toBe('none'); expect(background.style.zIndex).toBe('-1')
  expect(background.children).toHaveLength(2)
  expect((background.children[0] as HTMLElement).style.backgroundColor).toBe('rgb(32, 64, 96)')
  expect(background.innerHTML).toContain('linear-gradient')
  expect(background.innerHTML.match(/data:image\/png;base64/g)).toHaveLength(2)
  expect(background.querySelector('[data-component-output],[data-component-instance-id]')).toBeNull()
  expect(root.querySelector('[data-component-output="text"]')?.textContent).toContain('Native editable foreground')
  expect(result.diagnostics.some(value => value.code === 'asset-missing')).toBe(false)
})

it('DOCX diagnoses unmapped complex paint without replacing semantic foreground', async () => {
  const result = await buildComponentDocx(project('flow'), { surfaceId: 'page' })
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'word-background-paint', surfaceId: 'page' }))
  expect(result.fidelity).toBe('partial')
  expect(strFromU8(unzipSync(result.bytes)['word/document.xml']!)).toContain('Native editable foreground')
})
