import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { chooseM20Workspace, closeM20, launchM20, m20Evidence, m20OpenFile, m20Row } from './helpers/g20M20Harness'

const hash = (filename: string) => createHash('sha256').update(readFileSync(filename)).digest('hex')
function tone() {
  const samples = 20 * 8000, data = Buffer.alloc(44 + samples * 2)
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34)
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 8000) * 1800), 44 + i * 2)
  return data
}

test('original PPTX loads its embedded font and native audio/video, pauses inactive playback and cold reopens offline', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Formal Windows product acceptance')
  test.setTimeout(180_000)
  const base = resolve('output/goal-correction-20261102/pptx-original-media')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const fixture = { directory, workspace, profile: join(directory, 'profile') }
  const name = '原件字体与音视频.pptx', filename = join(workspace, name), audio = join(directory, 'tone.wav')
  writeFileSync(audio, tone()); writeFileSync(join(workspace, '切换笔记.txt'), '切换后暂停媒体')
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  const slide = ppt.addSlide(); slide.background = { color: 'EEF3F8' }
  slide.addText('Embedded typography 012345', { x: .7, y: .5, w: 11, h: .7, fontSize: 28, fontFace: 'GuolingEmbeddedAcceptance', color: '183153' })
  slide.addText('视频与音频来自 PPT 原件内嵌资源', { x: .7, y: 1.3, w: 11, h: .5, fontSize: 20 })
  slide.addMedia({ type: 'video', path: resolve('tests/fixtures/r18CommonTasks/materials/motion.webm'), x: .7, y: 2.1, w: 6.3, h: 3.55, objectName: 'native-video' })
  slide.addMedia({ type: 'audio', path: audio, x: 7.5, y: 2.2, w: 4.7, h: 1.4, objectName: 'native-audio' })
  ppt.addSlide().addText('媒体翻页后应暂停', { x: 1, y: 1, w: 10, h: 1, fontSize: 30 })
  const generated = await ppt.write({ outputType: 'uint8array' })
  if (!(generated instanceof Uint8Array)) throw new Error('Expected PPT bytes')
  const parts = unzipSync(generated)
  // PptxGenJS emits videoFile even for an audio relationship and reuses id=3.
  // Keep the acceptance original valid; do not alter the product to mask it.
  let mediaSlide = strFromU8(parts['ppt/slides/slide1.xml'])
  expect(mediaSlide).toContain('<a:videoFile r:link="rId4"/>')
  mediaSlide = mediaSlide.replace('<a:videoFile r:link="rId4"/>', '<a:audioFile r:link="rId4"/>')
    .replace('<p:cNvPr id="3" name="native-video">', '<p:cNvPr id="7" name="native-video">')
  parts['ppt/slides/slide1.xml'] = strToU8(mediaSlide)
  // Use an already installed local font only in this isolated acceptance output;
  // the unique family proves that the view registered package bytes, not a system fallback.
  parts['ppt/fonts/acceptance.ttf'] = readFileSync('C:/Windows/Fonts/arial.ttf')
  parts['ppt/presentation.xml'] = strToU8(strFromU8(parts['ppt/presentation.xml']).replace('</p:presentation>', '<p:embeddedFontLst><p:embeddedFont><p:font typeface="GuolingEmbeddedAcceptance"/><p:regular r:id="acceptanceFont"/></p:embeddedFont></p:embeddedFontLst></p:presentation>'))
  parts['ppt/_rels/presentation.xml.rels'] = strToU8(strFromU8(parts['ppt/_rels/presentation.xml.rels']).replace('</Relationships>', '<Relationship Id="acceptanceFont" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/acceptance.ttf"/></Relationships>'))
  parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace('</Types>', '<Default Extension="ttf" ContentType="application/x-font-ttf"/></Types>'))
  writeFileSync(filename, zipSync(parts))
  const before = hash(filename), errors: string[] = [], network: string[] = []
  const evidence: Record<string, unknown> = { directory, before, phase: 'launch', boundary: 'Actual Electron media decoding/time progression and embedded FontFace loading; no claim of listening quality, PowerPoint playback or all animation support.' }
  let { app, page } = await launchM20(fixture)
  const observe = () => { page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()) }) }
  observe()
  try {
    const pid = app.process().pid
    await chooseM20Workspace(app, page, workspace); await m20Row(page, name).dblclick()
    const preview = page.getByRole('region', { name: `${name} PPTX 对象共编`, exact: true })
    await expect(preview).toContainText('第 1 / 2 页')
    // The host registers a decoded face and the viewer emits a CSS face. Both
    // must load and both must disappear when this document is deactivated.
    const fontState = () => page.evaluate(() => Array.from(new Set(Array.from(document.fonts).filter(f => f.family === 'GuolingEmbeddedAcceptance').map(f => f.status))))
    await expect.poll(fontState).toEqual(['loaded'])
    const video = preview.locator('video'), sound = preview.locator('audio')
    await expect(video).toHaveCount(1); await expect(sound).toHaveCount(1)
    evidence.phase = 'native-media-playback'; evidence.playbackEvents = []
    for (const [kind, media] of [['video', video], ['audio', sound]] as const) {
      await media.evaluate((element: HTMLMediaElement) => { element.muted = true })
      if (kind === 'video') {
        await expect(media).toBeVisible()
        await media.press('Space')
      } else {
        // The original audio icon is the player's real toggle; the audio element
        // itself intentionally occupies a zero-sized foreignObject.
        await preview.locator('[data-media-toggle]').click()
      }
      await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.currentTime)).toBeGreaterThan(.1)
      const state = await media.evaluate((element: HTMLMediaElement) => ({ src: element.currentSrc.split(':')[0], time: element.currentTime, duration: element.duration, error: element.error?.message ?? null, readyState: element.readyState, videoWidth: element instanceof HTMLVideoElement ? element.videoWidth : undefined }))
      expect(state.error).toBeNull(); expect(state.readyState).toBeGreaterThanOrEqual(2)
      if (kind === 'video') expect(state.videoWidth).toBeGreaterThan(0)
      evidence[kind] = state
    }
    await page.screenshot({ path: join(directory, '01-native-media-playing.png'), fullPage: true })
    // The actual fixture is only about two seconds long. Let that first play
    // finish, then restart it through the real control immediately before the
    // switch, so natural completion cannot masquerade as deactivation cleanup.
    await expect.poll(() => video.evaluate((element: HTMLMediaElement) => element.ended)).toBe(true)
    await video.press('Space')
    await expect.poll(() => video.evaluate((element: HTMLMediaElement) => element.paused)).toBe(false)
    const handles = await Promise.all([video.elementHandle(), sound.elementHandle()])
    for (const handle of handles) {
      expect(handle).not.toBeNull()
      expect(await handle!.evaluate((element: HTMLMediaElement) => element.paused)).toBe(false)
    }
    // Opening a file is asynchronous: wait for the selected text tab and its
    // editor before observing the previous PPT media's React-effect cleanup.
    await m20OpenFile(page, '切换笔记.txt', 'text')
    for (const handle of handles) {
      await expect.poll(() => handle!.evaluate((element: HTMLMediaElement) => element.paused)).toBe(true)
      expect(await handle!.evaluate((element: HTMLMediaElement) => element.ended)).toBe(false)
    }
    await expect.poll(fontState).toEqual([])
    await page.getByRole('tab', { name, exact: true }).click()
    await expect(preview).toContainText('第 1 / 2 页'); await expect.poll(fontState).toEqual(['loaded'])
    await video.evaluate((element: HTMLMediaElement) => { element.muted = true })
    await video.press('Space')
    await expect.poll(() => video.evaluate((element: HTMLMediaElement) => element.currentTime)).toBeGreaterThan(.1)
    const videoHandle = await video.elementHandle()
    expect(videoHandle).not.toBeNull()
    expect(await videoHandle!.evaluate((element: HTMLMediaElement) => element.paused)).toBe(false)
    await preview.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(preview).toContainText('第 2 / 2 页')
    await expect.poll(() => videoHandle!.evaluate((element: HTMLMediaElement) => element.paused)).toBe(true)
    expect(await videoHandle!.evaluate((element: HTMLMediaElement) => element.ended)).toBe(false)
    expect(hash(filename)).toBe(before)
    evidence.phase = 'offline-new-process-cold-open'
    await closeM20(app); ({ app, page } = await launchM20(fixture)); observe()
    expect(app.process().pid).not.toBe(pid)
    await page.context().setOffline(true)
    await chooseM20Workspace(app, page, workspace); await m20Row(page, name).dblclick()
    const cold = page.getByRole('region', { name: `${name} PPTX 对象共编`, exact: true })
    await expect(cold).toContainText('第 1 / 2 页'); await expect.poll(fontState).toEqual(['loaded'])
    const coldVideo = cold.locator('video')
    await coldVideo.evaluate((e: HTMLMediaElement) => { e.muted = true })
    await coldVideo.press('Space')
    await expect.poll(() => cold.locator('video').evaluate((e: HTMLMediaElement) => e.currentTime)).toBeGreaterThan(.1)
    await page.screenshot({ path: join(directory, '02-offline-cold-open.png'), fullPage: true })
    expect(hash(filename)).toBe(before); expect(errors).toEqual([]); expect(network).toEqual([])
    evidence.status = 'passed'; evidence.phase = 'complete'; evidence.errors = errors; evidence.network = network; evidence.after = hash(filename)
    await m20Evidence(info, fixture, page, evidence)
  } catch (error) { evidence.errors = errors; evidence.network = network; await m20Evidence(info, fixture, page, evidence, error); throw error }
  finally { await closeM20(app) }
})
