// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import { createComponentDeliveryCapture } from '../../src/renderer/export/componentPlatform/capture'
import { buildComponentPptx } from '../../src/renderer/export/componentPlatform/pptx'
import { publishedCourseV3Schema, type PublishedCourseV3 } from '../../src/shared/contracts/component-platform'
import type { CaptureObservationInput } from '../../src/shared/ipcTypes'
import type { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'
import type { prepareComponentOutputRegion } from '../../src/player/componentPlatform/outputCapture'
import { auditExportPng } from '../fixtures/auditExportPng'

function payload(): PublishedCourseV3 {
  const source = `export default {mount({root,instance}){root.textContent=instance.name;return {update(){},dispose(){root.replaceChildren()}}}}`
  return publishedCourseV3Schema.parse({ schemaVersion: 3, id: 'static-teacher', title: 'Static teacher', assets: {},
    definitions: { customTeacher: { id: 'customTeacher', role: 'mixed', professionalBuiltinKey: 'guoling.navigation', implementation: { kind: 'source', language: 'javascript', source, compiled: { code: source } } },
      ordinary: { id: 'ordinary', role: 'content', implementation: { kind: 'source', language: 'javascript', source, compiled: { code: source } } } },
    instances: { omitted: { id: 'omitted', definitionId: 'customTeacher', name: 'DEFAULT OMITTED TEACHER', data: {}, style: { display: 'flex' }, frame: { width: 220, height: 45, transform: [1, 0, 0, 1, 20, 20] } },
      included: { id: 'included', definitionId: 'customTeacher', name: 'EXPLICIT INCLUDED TEACHER', data: { includeInStaticExports: true }, frame: { width: 240, height: 45, transform: [1, 0, 0, 1, 20, 90] } },
      status: { id: 'status', definitionId: 'ordinary', name: 'GLOBAL STATUS 0', data: {}, frame: { width: 220, height: 45, transform: [1, 0, 0, 1, 20, 160] } } },
    surfaces: [{ id: 'space', title: 'Spatial', kind: 'spatial', childIds: [], spatial: { home: { x: 320, y: 180, zoom: 1 }, frames: [] } }],
    global: { underlay: [], overlay: ['omitted', 'included', 'status'] } })
}

it('the formal delivery capture marks both surface and instance requests as static without changing its publication', async () => {
  const source = payload(), before = structuredClone(source), requests: CaptureObservationInput[] = []
  const capture = await createComponentDeliveryCapture(source, async input => { requests.push(input); return { dataUrl: 'data:image/png;base64,', width: 640, height: 360 } })
  await capture.captureSurface('space'); await capture.captureInstance('space', 'included'); await capture.dispose()
  expect(requests).toHaveLength(2)
  expect(requests).toEqual([expect.objectContaining({ kind: 'published', staticExport: true, surfaceId: 'space' }), expect.objectContaining({ staticExport: true, instanceId: 'included' })])
  expect(source).toEqual(before)
})

it('real Spatial capture omits only default-false professional teacher wrappers and keeps explicit inclusion, ordinary source and observation', async () => {
  const code = (await build({ stdin: { contents: `export {mountPublishedCourseV3} from './src/player/componentPlatform/publishedPlayer';
    export {prepareComponentOutputRegion} from './src/player/componentPlatform/outputCapture';`, resolveDir: process.cwd() }, bundle: true, write: false,
    format: 'iife', globalName: 'auditStaticTeacher', platform: 'browser' })).outputFiles[0]!.text
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
    await page.setContent('<body style="margin:0"><div id="root" style="position:relative;width:640px;height:360px"></div></body>')
    await page.addScriptTag({ content: code })
    const result = await page.evaluate(async (encoded: string) => {
      // The Node fixture is schema-parsed before this browser transport boundary.
      const source = JSON.parse(encoded) as PublishedCourseV3
      const api = (window as unknown as { auditStaticTeacher: { mountPublishedCourseV3: typeof mountPublishedCourseV3; prepareComponentOutputRegion: typeof prepareComponentOutputRegion } }).auditStaticTeacher
      const root = document.getElementById('root')!, before = JSON.stringify(source), samples: { staticExport: boolean; omitted: boolean; included: boolean; status: boolean; rect: { width: number; height: number } }[] = []
      for (const staticExport of [false, true]) {
        const player = await api.mountPublishedCourseV3(source, root, { capture: true, keyboardNavigation: false })
        try {
          const rect = await api.prepareComponentOutputRegion({ payload: source, root, player, surfaceId: 'space', ...(staticExport ? { staticExport: true } : {}) })
          const visible = (id: string) => { const target = player.runtime.targetElement(id)!; return target.checkVisibility() && target.getBoundingClientRect().width > 0 }
          samples.push({ staticExport, omitted: visible('omitted'), included: visible('included'), status: visible('status'), rect: { width: rect.width, height: rect.height } })
        } finally { await player.dispose() }
      }
      return { samples, unchanged: before === JSON.stringify(source) }
    }, JSON.stringify(payload()))
    expect(result.samples).toEqual([{ staticExport: false, omitted: true, included: true, status: true, rect: { width: 640, height: 360 } },
      { staticExport: true, omitted: false, included: true, status: true, rect: { width: 640, height: 360 } }])
    expect(result.unchanged).toBe(true)
  } finally { await browser.close() }
}, 15_000)

it('PPTX professional source aliases obey the same teacher inclusion contract before invoking local capture', async () => {
  const source = payload(), before = structuredClone(source), calls: string[] = []
  source.surfaces = [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: [], designSize: { width: 640, height: 360 } }]
  const result = await buildComponentPptx(source, { captureInstance: ({ instance }) => { calls.push(instance.id); return `data:image/png;base64,${Buffer.from(auditExportPng(32, 16)).toString('base64')}` } })
  expect(calls).toEqual(['included', 'status'])
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'teacher-controller-omitted', instanceId: 'omitted' }))
  const xml = strFromU8(unzipSync(result.bytes)['ppt/slides/slide1.xml']!)
  expect(xml.match(/<p:pic>/g)).toHaveLength(2)
  expect(source.instances).toEqual(before.instances); expect(source.global).toEqual(before.global)
})
