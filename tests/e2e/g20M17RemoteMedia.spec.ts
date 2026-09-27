import { expect, test, type ElectronApplication } from '@playwright/test'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { buildPublishedCourseStandaloneHtml } from '../../src/renderer/export/course/buildCoursePackages'
import { closeSelectionApp, selectionServer, launchSelectionApp, setupSelectionUI, openSelectionFile } from './helpers/g20SelectionHarness'
import { solidPng } from '../helpers/solidPng'

const root = resolve(__dirname, '../..')
const courseName = 'M17 远程媒体.h5lesson'
const certificateRoot = join(root, 'tests/fixtures/network')
const certificate = readFileSync(join(certificateRoot, 'localhost-cert.pem'))
const privateKey = readFileSync(join(certificateRoot, 'localhost-key.pem'))
const imageBytes = solidPng(1, 1, [37, 99, 235])
const audioBytes = Buffer.alloc(44 + 8_000)
audioBytes.write('RIFF', 0); audioBytes.writeUInt32LE(audioBytes.length - 8, 4); audioBytes.write('WAVEfmt ', 8)
audioBytes.writeUInt32LE(16, 16); audioBytes.writeUInt16LE(1, 20); audioBytes.writeUInt16LE(1, 22)
audioBytes.writeUInt32LE(8_000, 24); audioBytes.writeUInt32LE(8_000, 28); audioBytes.writeUInt16LE(1, 32); audioBytes.writeUInt16LE(8, 34)
audioBytes.write('data', 36); audioBytes.writeUInt32LE(audioBytes.length - 44, 40)

function makeCourse() {
  const project = createBlankCourseProject({ title: 'M17 远程媒体', canvas: { width: 1280, height: 720 }, includeDefaultController: false, controls: 'none' })
  return new CourseV9Driver().serialize({ kind: 'course-v9', project, resources: { assets: {}, components: {} } })
}

async function closeApp(app: ElectronApplication) {
  await closeSelectionApp(app)
}

test('M17 remote media: HTTPS image/audio import stays live, saves, reopens, and exports declared CSP', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(300_000)
  const base = join(root, 'output/g20/m17/remote-media')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  writeFileSync(join(workspace, courseName), makeCourse())

  const requests: string[] = []
  const remote = createHttpsServer({ cert: certificate, key: privateKey }, (request, response) => {
    const pathname = new URL(request.url ?? '/', 'https://localhost').pathname
    requests.push(pathname)
    if (pathname === '/image.png') {
      response.writeHead(200, { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': 'image/png' })
      response.end(imageBytes)
      return
    }
    if (pathname === '/tone.wav') {
      response.writeHead(200, { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': 'audio/wav' })
      response.end(audioBytes)
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolveListen, reject) => {
    remote.once('error', reject)
    remote.listen(0, '127.0.0.1', () => { remote.removeListener('error', reject); resolveListen() })
  })
  const port = (remote.address() as AddressInfo).port
  const origin = `https://127.0.0.1:${port}`
  writeFileSync(join(workspace, 'remote-media.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Network media</h1><img id="remote-image" alt="Remote lesson image" src="${origin}/image.png"><audio id="remote-audio" controls src="${origin}/tone.wav"></audio></body></html>`)
  const modelServer = await selectionServer()
  let app: ElectronApplication | undefined
  try {
    app = await launchSelectionApp(directory)
    await app.evaluate(({ app: electronApp }, allowedOrigin) => {
      electronApp.on('certificate-error', (event, _contents, url, _error, _certificate, callback) => {
        if (url.startsWith(allowedOrigin)) { event.preventDefault(); callback(true) }
        else callback(false)
      })
    }, origin)
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    await setupSelectionUI(app, page, modelServer.endpoint, workspace)
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.find(value => value && typeof value === 'object' && 'properties' in (value as object)) as { properties?: string[] } | undefined
        return { canceled: false, filePaths: [(options?.properties ?? []).includes('openDirectory') ? folder : (globalThis as unknown as { m17FilePicker?: string }).m17FilePicker ?? ''] }
      }
    }, workspace)
    const opened = await openSelectionFile(page, workspace, courseName)
    const document = () => page.evaluate(id => window.desktopAPI.documents!.read(id), opened.documentId)
    await app.evaluate((_electron, file) => { (globalThis as unknown as { m17FilePicker?: string }).m17FilePicker = file }, join(workspace, 'remote-media.html'))
    await page.getByRole('button', { name: '插入', exact: true }).click()
    await page.getByRole('button', { name: '导入 HTML 页面', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导入 HTML 页面' })
    await dialog.getByRole('button', { name: '导入', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 60_000 })
    await expect(page.getByText('HTML 页面已导入到所选位置')).toBeVisible()
    await expect(page.getByText(/网络媒体.*离线时可能无法使用/)).toBeVisible()
    await expect.poll(() => document().then(snapshot => snapshot.model.kind === 'course-v9' ? snapshot.model.project.network?.connectOrigins : undefined)).toContain(origin)

    const frame = page.locator('.published-authoring-host iframe').last().contentFrame()
    await expect(frame.getByRole('img', { name: 'Remote lesson image' })).toBeVisible()
    await expect.poll(() => frame.locator('#remote-image').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1)
    await expect.poll(() => frame.locator('#remote-audio').evaluate(node => (node as HTMLAudioElement).readyState)).toBeGreaterThan(0)
    expect(requests).toContain('/image.png')
    expect(requests).toContain('/tone.wav')

    const runMode = page.getByRole('group', { name: '画布模式' }).getByRole('button', { name: '当前位置试运行', exact: true })
    await runMode.click()
    const tryRun = page.getByTestId('course-try-run-host')
    await expect(tryRun).toHaveAttribute('data-course-player-ready', 'true', { timeout: 60_000 })
    await page.getByLabel('常用工具').getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await document()).dirty).toBe(false)
    await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${courseName}`, exact: true }).click()
    await openSelectionFile(page, workspace, courseName)
    const saved = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, courseName))))
    expect(saved.project.network?.connectOrigins).toEqual([origin])
    const slide = saved.project.surfaces.find(surface => surface.type === 'slide')
    const runtime = slide?.type === 'slide' ? slide.scenes.flatMap(scene => scene.layerItems).find(item => item.kind === 'runtime') : undefined
    if (!runtime || runtime.kind !== 'runtime') throw new Error('Saved remote HTML Runtime missing')
    expect(runtime.runtime.source).toContain(`${origin}/image.png`)
    expect(runtime.runtime.source).toContain(`${origin}/tone.wav`)
    const reopenedFrame = page.locator('.published-authoring-host iframe').last().contentFrame()
    await expect(reopenedFrame.locator('#remote-image')).toHaveAttribute('src', `${origin}/image.png`)
    await expect(reopenedFrame.locator('#remote-audio')).toHaveAttribute('src', `${origin}/tone.wav`)
    const online = buildPublishedCourseStandaloneHtml({ project: saved.project, assetFiles: saved.assetFiles, components: {} }, {
      playerBundle: readFileSync(join(root, 'dist-player/player.iife.js'), 'utf8'),
      singleHtmlMode: 'online-lightweight',
    })
    const csp = online.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1]
    expect(csp).toContain(`img-src data: blob: ${origin}`)
    expect(csp).toContain(`media-src data: blob: ${origin}`)
  } finally {
    if (app) await closeApp(app)
    await modelServer.close()
    await new Promise<void>(resolveClose => remote.close(() => resolveClose()))
  }
})
