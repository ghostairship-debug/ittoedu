// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createVideoData } from '../../src/components/media/data'
import { publishedCourseV3Schema, type PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'
import type { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'
import type { prepareComponentOutputRegion } from '../../src/player/componentPlatform/outputCapture'

type ProbeWindow = Window & {
  auditStaticVideo: { mountPublishedCourseV3: typeof mountPublishedCourseV3; prepareComponentOutputRegion: typeof prepareComponentOutputRegion }
  auditVideoPlayer?: Awaited<ReturnType<typeof mountPublishedCourseV3>>
  auditVideoPayload?: PublishedCourseV3
  auditVideoBefore?: string
}

it('static native video captures the decoded frame without playback chrome; ordinary observation and authored source controls stay intact', async () => {
  const bytes = readFileSync('tests/fixtures/r18CommonTasks/materials/motion.webm')
  const authored = `export default {mount({root}){const video=root.ownerDocument.createElement('video');video.controls=true;video.dataset.authoredVideo='true';root.append(video);return {update(){},dispose(){root.replaceChildren()}}}}`
  const payload = publishedCourseV3Schema.parse({ schemaVersion: 3, id: 'static-video', title: 'Native first frame',
    definitions: { libraryVideo: { id: 'libraryVideo', role: 'content', implementation: { kind: 'builtin', key: 'guoling.video' } },
      authored: { id: 'authored', role: 'content', implementation: { kind: 'source', language: 'javascript', source: authored, compiled: { code: authored } } } },
    instances: { video: { id: 'video', definitionId: 'libraryVideo', data: createVideoData('motion'), frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 20, 20] } },
      authored: { id: 'authored', definitionId: 'authored', data: {}, frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 400, 210] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: 'Slide', childIds: ['video', 'authored'], designSize: { width: 640, height: 360 } }],
    global: { underlay: [], overlay: [] }, assets: { motion: { id: 'motion', kind: 'video', mimeType: 'video/webm', url: `data:video/webm;base64,${bytes.toString('base64')}` } } })
  const code = (await build({ stdin: { contents: `export {mountPublishedCourseV3} from './src/player/componentPlatform/publishedPlayer';
    export {prepareComponentOutputRegion} from './src/player/componentPlatform/outputCapture';`, resolveDir: process.cwd() }, bundle: true, write: false,
    format: 'iife', globalName: 'auditStaticVideo', platform: 'browser' })).outputFiles[0]!.text
  const browser = await chromium.launch({ headless: true }), samples = []
  const directory = resolve('output/audit-real-machine-20261011/native-readiness/static-video'); mkdirSync(directory, { recursive: true })
  try {
    for (const mode of ['ordinary', 'static-surface', 'static-instance'] as const) {
      const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 })
      try {
        await page.setContent('<body style="margin:0"><div id="root" style="position:relative;width:640px;height:360px"></div></body>')
        await page.addScriptTag({ content: code })
        const state = await page.evaluate(async ({ encoded, mode }) => {
          const probe = window as unknown as ProbeWindow, source = JSON.parse(encoded) as PublishedCourseV3
          const root = document.getElementById('root')!, before = JSON.stringify(source)
          const player = await probe.auditStaticVideo.mountPublishedCourseV3(source, root, { capture: true, keyboardNavigation: false })
          probe.auditVideoPlayer = player; probe.auditVideoPayload = source; probe.auditVideoBefore = before
          await probe.auditStaticVideo.prepareComponentOutputRegion({ payload: source, root, player, surfaceId: 'slide',
            ...(mode === 'ordinary' ? {} : { staticExport: true }), ...(mode === 'static-instance' ? { instanceId: 'video' } : {}) })
          const video = root.querySelector<HTMLVideoElement>('video[data-media-instance-id="video"]')!
          const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
          const context = canvas.getContext('2d')!; context.drawImage(video, 0, 0)
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
          let rawBlack = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 40 && pixels[i + 1]! < 40 && pixels[i + 2]! < 40) rawBlack++
          return { controls: video.controls, readyState: video.readyState, time: video.currentTime, paused: video.paused, seeking: video.seeking,
            width: video.videoWidth, height: video.videoHeight, rawBlack, unchanged: before === JSON.stringify(source) }
        }, { encoded: JSON.stringify(payload), mode })
        const sourceFrame = page.frames().find(frame => frame !== page.mainFrame())!
        const sourceControls = await sourceFrame.locator('video[data-authored-video]').evaluate(video => (video as HTMLVideoElement).controls)
        const screenshot = await page.locator('video[data-media-instance-id="video"]').screenshot({ path: resolve(directory, `${mode}.png`) })
        const paint = await page.evaluate(async dataUrl => {
          const image = new Image(); image.src = dataUrl; await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
          const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
          let black = 0, red = 0, white = 0
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i]! < 40 && pixels[i + 1]! < 40 && pixels[i + 2]! < 40) black++
            if (pixels[i]! > 180 && pixels[i + 1]! < 80 && pixels[i + 2]! < 80) red++
            if (pixels[i]! > 230 && pixels[i + 1]! > 230 && pixels[i + 2]! > 230) white++
          }
          return { black, red, white }
        }, `data:image/png;base64,${screenshot.toString('base64')}`)
        samples.push({ mode, ...state, sourceControls, paint })
        expect(state.controls).toBe(mode === 'ordinary'); expect(state.readyState).toBeGreaterThanOrEqual(2)
        expect(state.time).toBe(0); expect(state.paused).toBe(true); expect(state.seeking).toBe(false)
        expect(state.width).toBe(320); expect(state.height).toBe(180); expect(state.rawBlack).toBe(0)
        expect(state.unchanged).toBe(true); expect(sourceControls).toBe(true)
        if (mode === 'ordinary') expect(paint.black).toBeGreaterThan(0)
        else { expect(paint.black).toBe(0); expect(paint.red).toBeGreaterThan(50_000); expect(paint.white).toBeGreaterThan(200) }
      } finally {
        await page.evaluate(async () => { await (window as unknown as ProbeWindow).auditVideoPlayer?.dispose() })
        await page.close()
      }
    }
    writeFileSync(resolve(directory, 'result.json'), JSON.stringify({ carrier: 'real Chromium Published Player: native video and opaque ordinary authored source', samples }, null, 2))
  } finally { await browser.close() }
}, 20_000)
