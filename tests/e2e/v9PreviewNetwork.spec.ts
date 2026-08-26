import { _electron as electron, expect, test } from '@playwright/test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { ElectronApplication, Locator, Page } from 'playwright'
import { createCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const root = resolve(__dirname, '..', '..')
const rendererDirectory = join(root, 'dist-renderer')
const certificateDirectory = join(root, 'tests', 'fixtures', 'network')
const certificate = readFileSync(join(certificateDirectory, 'localhost-cert.pem'))
const privateKey = readFileSync(join(certificateDirectory, 'localhost-key.pem'))
const LOCALHOST_CERTIFICATE_SPKI = 'DNIiwZV2/2dxPciQIn3bHbi8UyIs3pJdIXVDYExz9K4='
const PROJECT_B_IMAGE_BYTES = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64',
))

type NodeServer = ReturnType<typeof createHttpServer>

interface RunningServer {
  server: NodeServer
  origin: string
  requests: string[]
}

function contentType(pathname: string): string {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }
  return types[extname(pathname).toLowerCase()] ?? 'application/octet-stream'
}

async function listen(server: NodeServer): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolveListen()
    })
  })
  return (server.address() as AddressInfo).port
}

async function closeServer(server: NodeServer): Promise<void> {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
}

async function startRendererServer(): Promise<RunningServer> {
  const requests: string[] = []
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    requests.push(url.pathname)
    if (url.pathname === '/base-probe') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      })
      response.end('{"ok":true}')
      return
    }
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (relativePath === '') relativePath = 'index.html'
    const filePath = resolve(rendererDirectory, relativePath)
    const scoped = relative(rendererDirectory, filePath)
    if (
      scoped === '..'
      || scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
      || isAbsolute(scoped)
      || !existsSync(filePath)
      || !statSync(filePath).isFile()
    ) {
      response.writeHead(404).end('not found')
      return
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': contentType(filePath),
    })
    response.end(readFileSync(filePath))
  })
  const port = await listen(server)
  return { server, origin: `http://127.0.0.1:${port}`, requests }
}

async function startHttpsFixtureServer(imageBytes: Uint8Array): Promise<RunningServer> {
  const requests: string[] = []
  const server = createHttpsServer({ cert: certificate, key: privateKey }, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://127.0.0.1')
    requests.push(url.pathname)
    const commonHeaders = {
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    }
    if (url.pathname === '/remote.png') {
      response.writeHead(200, { ...commonHeaders, 'content-type': 'image/png' })
      response.end(imageBytes)
      return
    }
    response.writeHead(200, { ...commonHeaders, 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, pathname: url.pathname }))
  })
  const port = await listen(server)
  return { server, origin: `https://127.0.0.1:${port}`, requests }
}

function writeRemoteProject(input: {
  filePath: string
  projectId: string
  title: string
  remoteAssetOrigin: string
  connectOrigin?: string
  unusedRemoteOrigin: string
  localPhotoBytes?: Uint8Array
}): void {
  const fixture = listCourseProjectV9Fixtures().find(({ id }) => id === 'multi-asset')!
  const project: CourseProjectDocument = structuredClone(fixture.data.project)
  const localPhotoBytes = input.localPhotoBytes ?? fixture.data.assetFiles.photo!
  project.id = input.projectId
  project.title = input.title
  project.assets.photo.byteLength = localPhotoBytes.byteLength
  project.assets.photo.remote = { url: `${input.remoteAssetOrigin}/remote.png` }
  project.assets.unused = {
    ...structuredClone(project.assets.photo),
    id: 'unused',
    filename: 'unused.png',
    path: 'assets/unused.png',
    remote: { url: `${input.unusedRemoteOrigin}/remote.png` },
  }
  if (input.connectOrigin) project.network = { connectOrigins: [input.connectOrigin] }
  else delete project.network
  const bytes = createCourseProjectArchive({
    project,
    assetFiles: {
      ...fixture.data.assetFiles,
      photo: localPhotoBytes,
      unused: localPhotoBytes,
    },
    componentFiles: {},
  })
  writeFileSync(input.filePath, bytes)
}

async function patchOpenDialog(app: ElectronApplication, projectPath: string): Promise<void> {
  await app.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = (async (): Promise<Electron.OpenDialogReturnValue> => ({
      canceled: false,
      filePaths: [selectedPath],
    })) as typeof dialog.showOpenDialog
  }, projectPath)
}

async function openProject(
  app: ElectronApplication,
  page: Page,
  projectPath: string,
  title: string,
): Promise<void> {
  await patchOpenDialog(app, projectPath)
  await page.getByRole('button', { name: '打开工程（Ctrl+O）', exact: true }).click()
  await expect(page).toHaveTitle(new RegExp(title))
}

async function fetchSucceeded(page: Page, url: string): Promise<boolean> {
  return page.evaluate(async (target) => {
    try {
      const response = await fetch(target, { cache: 'no-store' })
      await response.text()
      return response.ok
    } catch {
      return false
    }
  }, url)
}

async function startCurrentLocationPreview(page: Page): Promise<void> {
  await page.getByRole('group', { name: '画布模式' })
    .getByRole('button', { name: '当前位置试运行', exact: true })
    .click()
  const host = page.getByTestId('course-try-run-host')
  await expect(host).toBeVisible()
  await expect.poll(() => host.getAttribute('data-course-player-ready')).toBe('true')
}

async function stopCurrentLocationPreview(page: Page): Promise<void> {
  await page.getByRole('group', { name: '画布模式' })
    .getByRole('button', { name: '编辑状态', exact: true })
    .click()
  const host = page.getByTestId('course-try-run-host')
  await expect(host).toBeHidden()
  await expect(host.locator('[data-course-surface-slot]')).toHaveCount(0)
}

async function expectOnlyLocalDataImages(images: Locator, expectedSource: string): Promise<void> {
  await expect.poll(() => images.evaluateAll((entries, source) => {
    const urls = entries.map((image) => (image as HTMLImageElement).src)
    return urls.length > 0
      && urls.every((url) => url.startsWith('data:image/png;base64,'))
      && urls.includes(source)
  }, expectedSource)).toBe(true)
}

function remoteImageRequestCount(server: RunningServer): number {
  return server.requests.filter((path) => path === '/remote.png').length
}

function removeRunRoot(runRoot: string): void {
  const absolute = resolve(runRoot)
  const temporaryRoot = resolve(tmpdir())
  const scoped = relative(temporaryRoot, absolute)
  const leaf = scoped.split(/[\\/]/)[0] ?? ''
  if (
    !scoped
    || scoped === '..'
    || scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(scoped)
    || !leaf.startsWith('courseware-net-h1-')
  ) {
    throw new Error(`Refusing to remove unscoped NET-H1 directory: ${absolute}`)
  }
  rmSync(absolute, { recursive: true, force: true })
}

test('V9 current/full preview embeds local assets and leases declared origins per project', async () => {
  test.setTimeout(90_000)
  const runRoot = mkdtempSync(join(tmpdir(), `courseware-net-h1-${process.pid}-`))
  const renderer = await startRendererServer()
  const fixture = listCourseProjectV9Fixtures().find(({ id }) => id === 'multi-asset')!
  const assetA = await startHttpsFixtureServer(fixture.data.assetFiles.photo!)
  const assetB = await startHttpsFixtureServer(fixture.data.assetFiles.photo!)
  const api = await startHttpsFixtureServer(fixture.data.assetFiles.photo!)
  const projectAPath = join(runRoot, 'network-a.h5lesson')
  const projectBPath = join(runRoot, 'network-b.h5lesson')
  writeRemoteProject({
    filePath: projectAPath,
    projectId: 'network-project-a',
    title: 'NET H1 A',
    remoteAssetOrigin: assetA.origin,
    connectOrigin: api.origin,
    unusedRemoteOrigin: assetB.origin,
  })
  writeRemoteProject({
    filePath: projectBPath,
    projectId: 'network-project-b',
    title: 'NET H1 B',
    remoteAssetOrigin: assetB.origin,
    connectOrigin: assetB.origin,
    unusedRemoteOrigin: assetA.origin,
    localPhotoBytes: PROJECT_B_IMAGE_BYTES,
  })

  let app: ElectronApplication | null = null
  try {
    app = await electron.launch({
      args: [
        '.',
        `--user-data-dir=${join(runRoot, 'profile')}`,
        `--ignore-certificate-errors-spki-list=${LOCALHOST_CERTIFICATE_SPKI}`,
      ],
      cwd: root,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: renderer.origin,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        [BACKGROUND_E2E_ENV]: '1',
      },
    })
    const page = await app.firstWindow()
    await page.locator('[data-testid="canvas-stage"] canvas').waitFor()
    const professional = page.getByRole('button', { name: '专业' })
    if (await professional.getAttribute('aria-pressed') !== 'true') await professional.click()

    await openProject(app, page, projectAPath, 'NET H1 A')
    const projectAPhotoDataUrl = `data:image/png;base64,${Buffer.from(
      fixture.data.assetFiles.photo!,
    ).toString('base64')}`
    const projectBPhotoDataUrl = `data:image/png;base64,${Buffer.from(
      PROJECT_B_IMAGE_BYTES,
    ).toString('base64')}`
    const assetARemoteBeforeCurrent = remoteImageRequestCount(assetA)
    await startCurrentLocationPreview(page)
    const currentPreviewAImages = page.getByTestId('course-try-run-host').locator('img')
    await expectOnlyLocalDataImages(currentPreviewAImages, projectAPhotoDataUrl)
    expect(remoteImageRequestCount(assetA)).toBe(assetARemoteBeforeCurrent)
    await expect(fetchSucceeded(page, `${api.origin}/declared-current`)).resolves.toBe(true)
    const assetBBeforeDenied = assetB.requests.length
    await expect(fetchSucceeded(page, `${assetB.origin}/undeclared-current`)).resolves.toBe(false)
    expect(assetB.requests).toHaveLength(assetBBeforeDenied)

    await stopCurrentLocationPreview(page)
    await expect.poll(() => fetchSucceeded(page, `${api.origin}/revoked-current`)).toBe(false)
    const apiAfterRevoke = api.requests.length
    await expect(fetchSucceeded(page, `${api.origin}/revoked-current-stable`)).resolves.toBe(false)
    expect(api.requests).toHaveLength(apiAfterRevoke)

    await page.getByTitle('全屏 16:9 整课预览').click()
    await expect(page.getByTestId('course-preview-overlay')).toBeVisible()
    const fullPreviewImages = page.getByTestId('course-preview-host').locator('img')
    const assetARemoteBeforeFull = remoteImageRequestCount(assetA)
    await expectOnlyLocalDataImages(fullPreviewImages, projectAPhotoDataUrl)
    expect(remoteImageRequestCount(assetA)).toBe(assetARemoteBeforeFull)
    await expect(fetchSucceeded(page, `${api.origin}/declared-full`)).resolves.toBe(true)

    const assetBRemoteBeforeOverlaySwitch = remoteImageRequestCount(assetB)
    await patchOpenDialog(app, projectBPath)
    await page.keyboard.press('Control+O')
    await expect(page).toHaveTitle(/NET H1 B/)
    await expect(page.getByTestId('course-preview-overlay')).toBeVisible()
    await expectOnlyLocalDataImages(fullPreviewImages, projectBPhotoDataUrl)
    expect(remoteImageRequestCount(assetB)).toBe(assetBRemoteBeforeOverlaySwitch)
    const assetBBeforeDeclaredFull = assetB.requests.length
    await expect(fetchSucceeded(page, `${assetB.origin}/declared-full-b`)).resolves.toBe(true)
    expect(assetB.requests).toHaveLength(assetBBeforeDeclaredFull + 1)
    const assetAAfterOverlaySwitch = assetA.requests.length
    const apiAfterOverlaySwitch = api.requests.length
    await expect(fetchSucceeded(page, `${assetA.origin}/project-a-after-overlay-switch`))
      .resolves.toBe(false)
    await expect(fetchSucceeded(page, `${api.origin}/project-a-api-after-overlay-switch`))
      .resolves.toBe(false)
    expect(assetA.requests).toHaveLength(assetAAfterOverlaySwitch)
    expect(api.requests).toHaveLength(apiAfterOverlaySwitch)

    await page.getByTestId('course-preview-overlay')
      .getByRole('button', { name: '关闭预览' })
      .click()
    await expect(page.getByTestId('course-preview-overlay')).toHaveCount(0)
    await expect.poll(() => fetchSucceeded(page, `${assetB.origin}/revoked-full`)).toBe(false)

    const assetBRemoteBeforeCurrent = remoteImageRequestCount(assetB)
    await startCurrentLocationPreview(page)
    const currentPreviewImages = page.getByTestId('course-try-run-host').locator('img')
    await expectOnlyLocalDataImages(currentPreviewImages, projectBPhotoDataUrl)
    expect(remoteImageRequestCount(assetB)).toBe(assetBRemoteBeforeCurrent)
    const assetBBeforeDeclaredCurrent = assetB.requests.length
    await expect(fetchSucceeded(page, `${assetB.origin}/declared-current-b`)).resolves.toBe(true)
    expect(assetB.requests).toHaveLength(assetBBeforeDeclaredCurrent + 1)
    const assetAAfterSwitch = assetA.requests.length
    await expect(fetchSucceeded(page, `${assetA.origin}/project-a-after-switch`)).resolves.toBe(false)
    expect(assetA.requests).toHaveLength(assetAAfterSwitch)
    await stopCurrentLocationPreview(page)

    await page.evaluate((lateOrigin) => {
      window.addEventListener('pagehide', () => {
        const lateRequest = window.desktopAPI?.setPreviewNetworkPolicy({
          leaseId: 'old-document-late-lease',
          connectOrigins: [lateOrigin],
          remoteAssetUrls: [],
        })
        window.name = 'old-document-late-invoke-sent'
        void lateRequest?.catch(() => undefined)
      }, { once: true })
    }, assetA.origin)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="canvas-stage"] canvas').waitFor()
    await expect(page.evaluate(() => window.name)).resolves
      .toBe('old-document-late-invoke-sent')
    const assetAAfterReload = assetA.requests.length
    await expect(fetchSucceeded(page, `${assetA.origin}/old-document-after-reload`))
      .resolves.toBe(false)
    expect(assetA.requests).toHaveLength(assetAAfterReload)

    await page.evaluate(async (newDocumentOrigin) => {
      await window.desktopAPI.setPreviewNetworkPolicy({
        leaseId: 'new-document-generation',
        connectOrigins: [newDocumentOrigin],
        remoteAssetUrls: [],
      })
    }, assetB.origin)
    const assetBBeforeNewDocument = assetB.requests.length
    await expect(fetchSucceeded(page, `${assetB.origin}/new-document-generation`))
      .resolves.toBe(true)
    expect(assetB.requests).toHaveLength(assetBBeforeNewDocument + 1)
    await page.evaluate(() => window.desktopAPI.releasePreviewNetworkPolicy({
      leaseId: 'new-document-generation',
    }))
    await expect.poll(() => fetchSucceeded(page, `${assetB.origin}/new-document-released`))
      .toBe(false)

    const baseProbeBefore = renderer.requests.filter((path) => path === '/base-probe').length
    await expect(fetchSucceeded(page, `${renderer.origin}/base-probe`)).resolves.toBe(true)
    expect(renderer.requests.filter((path) => path === '/base-probe')).toHaveLength(
      baseProbeBefore + 1,
    )
  } finally {
    if (app) {
      await app.evaluate(({ app: electronApp, BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((window) => window.destroy())
        setTimeout(() => electronApp.exit(0), 0)
      }).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
    await Promise.all([
      closeServer(renderer.server),
      closeServer(assetA.server),
      closeServer(assetB.server),
      closeServer(api.server),
    ])
    removeRunRoot(runRoot)
  }
})
