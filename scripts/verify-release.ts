import { _electron as electron, chromium } from '@playwright/test'
import { unzipSync } from 'fflate'
import { execFile, spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Browser, ElectronApplication, Page } from 'playwright'
import packageJson from '../package.json'
import {
  importComponentPackage,
  parseComponentPackageFiles,
} from '../src/renderer/components/importComponentPackage'
import { openCourseProjectArchive } from '../src/renderer/project/courseProjectArchive'
import { openProjectArchive } from '../src/renderer/project/projectArchive'
import {
  APP_EXECUTABLE_NAME,
  APP_PRODUCT_NAME,
  APP_VERSION,
} from '../src/shared/constants'
import type { CourseProjectDocument } from '../src/shared/courseProjectTypes'
import { BACKGROUND_E2E_ENV } from '../src/main/windowVisibility'
import {
  assertExpectedAsarPackage,
  assertExpectedWindowsVersion,
  collectFileArtifactEvidence,
  readAsarPackageMetadata,
  readWindowsVersionEvidence,
  type AsarArtifactEvidence,
  type ExecutableArtifactEvidence,
} from './releaseArtifactEvidence'

interface VerificationCheck {
  name: string
  detail: string
  passed: true
}

interface ControllerVerificationTarget {
  itemId: string
  nextButtonId: string
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const releaseDirectory = path.join(projectRoot, 'release')
const verificationDirectory = path.join(releaseDirectory, 'verification')
const portableExecutable = path.join(
  releaseDirectory,
  `${APP_EXECUTABLE_NAME}-portable-${packageJson.version}.exe`,
)
const unpackedExecutable = path.join(
  releaseDirectory,
  'win-unpacked',
  `${APP_EXECUTABLE_NAME}.exe`,
)
const unpackedAppAsar = path.join(
  releaseDirectory,
  'win-unpacked',
  'resources',
  'app.asar',
)
const sampleProject = path.join(
  projectRoot,
  'examples',
  'sample-project.h5lesson',
)
const sampleComponent = path.join(
  projectRoot,
  'examples',
  'sample-counter.h5component',
)
const renderHostBenchmarkDirectory = path.join(
  projectRoot,
  'examples',
  'render-host-benchmark',
)
const renderHostBenchmarkProject = path.join(
  renderHostBenchmarkDirectory,
  'render-host-benchmark.h5lesson',
)
const renderHostBenchmarkTable = path.join(
  renderHostBenchmarkDirectory,
  'render-host-editable-table.h5component',
)
const renderHostBenchmarkPhaserMeter = path.join(
  renderHostBenchmarkDirectory,
  'render-host-phaser-meter.h5component',
)
const renderHostBenchmarkHtml = path.join(
  renderHostBenchmarkDirectory,
  'render-host-benchmark.html',
)
const exportedHtml = path.join(
  verificationDirectory,
  'sample-project-offline.html',
)
const exportedPdf = path.join(
  verificationDirectory,
  'sample-project-static.pdf',
)
const exportedPptx = path.join(
  verificationDirectory,
  'sample-project-editable.pptx',
)
const screenshotPath = path.join(
  verificationDirectory,
  'offline-sample.png',
)
const reportPath = path.join(verificationDirectory, 'report.json')
const unpackedProfileDirectory = path.join(
  verificationDirectory,
  'unpacked-profile',
)

const checks: VerificationCheck[] = []
const execFileAsync = promisify(execFile)

function pass(name: string, detail: string): void {
  checks.push({ name, detail, passed: true })
  console.log(`✓ ${name}：${detail}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sampleControllerTarget(
  project: CourseProjectDocument,
): ControllerVerificationTarget {
  assert(
    project.playback.controls === 'canvas',
    '示例工程必须使用画布内教师控制器',
  )
  const placement = project.globalLayerItems.find(
    (entry) => entry.item.kind === 'native' &&
      entry.item.content.nativeType === 'teacher-controller' &&
      entry.item.visible,
  )
  assert(placement, '示例工程缺少可见的画布内教师控制器')
  const controller = placement.item
  assert(
    controller.kind === 'native' &&
      controller.content.nativeType === 'teacher-controller',
    '教师控制器图层类型错误',
  )
  assert(
    placement.visibility.mode === 'all',
    '发布验收样例的教师控制器必须在全部位置可见',
  )
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  assert(slide?.type === 'slide', '发布验收样例缺少 Slide surface')
  assert(
    controller.frame.x >= 0 && controller.frame.y >= 0 &&
      controller.frame.x + controller.frame.width <= slide.canvas.width &&
      controller.frame.y + controller.frame.height <= slide.canvas.height,
    '发布验收样例的教师控制器位置超出 Slide 画布',
  )
  const nextButton = controller.content.data.buttons.find(
    (button) => button.action.type === 'scene.next',
  )
  assert(nextButton, '示例工程教师控制器缺少可见的下一场景按钮')
  assert(nextButton.visible, '示例工程教师控制器的下一场景按钮不可见')
  assert(controller.rotation === 0, '发布验收样例的教师控制器不应旋转')
  return {
    itemId: controller.layerItemId,
    nextButtonId: nextButton.id,
  }
}

async function assertWindowsExecutable(
  filePath: string,
  label: string,
  expectedVersion: string,
): Promise<ExecutableArtifactEvidence> {
  const stats = await fs.stat(filePath)
  assert(stats.isFile(), `${label} 不是普通文件`)
  assert(stats.size > 1024 * 1024, `${label} 文件大小异常`)
  const handle = await fs.open(filePath, 'r')
  try {
    const signature = Buffer.alloc(2)
    await handle.read(signature, 0, 2, 0)
    assert(signature.toString('ascii') === 'MZ', `${label} 缺少 PE MZ 签名`)
  } finally {
    await handle.close()
  }
  const [artifact, windowsVersion] = await Promise.all([
    collectFileArtifactEvidence(filePath),
    readWindowsVersionEvidence(filePath),
  ])
  assertExpectedWindowsVersion(
    windowsVersion,
    expectedVersion,
    APP_PRODUCT_NAME,
    label,
  )
  pass(
    label,
    `${filePath}（${(stats.size / 1024 / 1024).toFixed(1)} MB，` +
      `FileVersion ${windowsVersion.fileVersion}，` +
      `ProductVersion ${windowsVersion.productVersion}）`,
  )
  return {
    ...artifact,
    windowsVersion,
  }
}

async function assertAppAsar(
  filePath: string,
  expectedName: string,
  expectedVersion: string,
): Promise<AsarArtifactEvidence> {
  const artifact = await collectFileArtifactEvidence(filePath)
  assert(artifact.sizeBytes > 1024 * 1024, 'app.asar 文件大小异常')
  const embeddedPackage = readAsarPackageMetadata(filePath)
  assertExpectedAsarPackage(embeddedPackage, expectedName, expectedVersion)
  pass(
    'app.asar',
    `${embeddedPackage.name}@${embeddedPackage.version}（` +
      `${(artifact.sizeBytes / 1024 / 1024).toFixed(1)} MB，` +
      `SHA-256 ${artifact.sha256}）`,
  )
  return {
    ...artifact,
    package: embeddedPackage,
  }
}

function systemEdgePath(): string {
  const candidates = [
    process.env['PROGRAMFILES(X86)'],
    process.env.PROGRAMFILES,
    process.env.LOCALAPPDATA,
  ]
    .filter((value): value is string => Boolean(value))
    .map((base) =>
      path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    )
  const match = candidates.find(existsSync)
  if (!match) {
    throw new Error('未找到 Microsoft Edge，无法执行离线浏览器验证')
  }
  return match
}

async function availableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法分配便携版验证端口'))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}

async function removeDirectoryWithRetries(
  directory: string,
  attempts = 20,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rm(directory, { recursive: true, force: true })
      return true
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : ''
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  return false
}

async function connectPortableBrowser(
  port: number,
  childExited: () => boolean,
  readStderr: () => string,
): Promise<Browser> {
  const endpoint = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 60_000
  let lastError: unknown
  while (Date.now() < deadline) {
    if (childExited()) {
      throw new Error(
        `便携版在 CDP 连接前退出。${readStderr() ? `\n${readStderr()}` : ''}`,
      )
    }
    try {
      return await chromium.connectOverCDP(endpoint, { timeout: 1_000 })
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`便携版 CDP 连接超时：${String(lastError)}`)
}

async function findPortableEditorPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (await page.locator('[data-testid="canvas-stage"] canvas').count()) {
          return page
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('便携版已启动，但主窗口 Phaser 画布未加载')
}

async function closeElectronApplication(
  application: ElectronApplication,
): Promise<void> {
  await application
    .evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((window) => window.destroy())
    })
    .catch(() => undefined)
  await application.close().catch(() => undefined)
  if (!(await removeDirectoryWithRetries(unpackedProfileDirectory))) {
    console.warn(`警告：目录版验证临时目录稍后需清理：${unpackedProfileDirectory}`)
  }
}

async function launchPackagedEditor(
  executablePath: string,
): Promise<{
  application: ElectronApplication
  page: Page
  pageErrors: string[]
  consoleErrors: string[]
  externalRequests: string[]
}> {
  assert(
    await removeDirectoryWithRetries(unpackedProfileDirectory),
    '无法清理上一次目录版验证的临时用户目录',
  )
  await fs.mkdir(unpackedProfileDirectory, { recursive: true })
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${unpackedProfileDirectory}`],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      VITE_DEV_SERVER_URL: '',
      [BACKGROUND_E2E_ENV]: '1',
    },
    timeout: 45_000,
  })
  try {
    const page = await application.firstWindow({ timeout: 45_000 })
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    const externalRequests: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('request', (request) => {
      if (/^(?:https?|wss?):/i.test(request.url())) {
        externalRequests.push(request.url())
      }
    })
    await page
      .locator('[data-testid="canvas-stage"] canvas')
      .waitFor({ timeout: 45_000 })
    return { application, page, pageErrors, consoleErrors, externalRequests }
  } catch (error) {
    await closeElectronApplication(application)
    throw error
  }
}

async function verifyPortableStartup(): Promise<void> {
  const port = await availableLoopbackPort()
  const profileDirectory = path.join(
    verificationDirectory,
    'portable-profile',
  )
  assert(
    await removeDirectoryWithRetries(profileDirectory),
    '无法清理上一次便携版验证的临时用户目录',
  )
  await fs.mkdir(profileDirectory, { recursive: true })
  let stderr = ''
  const child = spawn(
    portableExecutable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDirectory}`,
    ],
    {
      cwd: releaseDirectory,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        VITE_DEV_SERVER_URL: '',
        [BACKGROUND_E2E_ENV]: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    },
  )
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  let browser: Browser | undefined
  try {
    browser = await connectPortableBrowser(
      port,
      () => child.exitCode !== null,
      () => stderr.trim(),
    )
    const page = await findPortableEditorPage(browser)
    const security = await page.evaluate(() => {
      const globals = window as unknown as Record<string, unknown>
      return {
        url: window.location.href,
        hasDesktopApi: typeof globals.desktopAPI === 'object',
        desktopApiFrozen:
          typeof globals.desktopAPI === 'object' &&
          Object.isFrozen(globals.desktopAPI),
        hasRequire: typeof globals.require !== 'undefined',
        hasProcess: typeof globals.process !== 'undefined',
      }
    })
    assert(
      security.url === 'courseware-editor://app/index.html',
      `便携版主页 URL 不符合白名单协议预期：${security.url}`,
    )
    assert(security.hasDesktopApi, '便携版 preload API 未加载')
    assert(security.desktopApiFrozen, '便携版 preload API 未冻结')
    assert(!security.hasRequire, '便携版渲染器暴露了 require')
    assert(!security.hasProcess, '便携版渲染器暴露了 process')
    pass(
      '便携版启动',
      '主窗口、冻结 preload API 与 Phaser 画布已从 courseware-editor://app/index.html 加载',
    )
  } finally {
    await browser?.close().catch(() => undefined)
    if (child.pid) {
      await execFileAsync('taskkill', [
        '/PID',
        String(child.pid),
        '/T',
        '/F',
      ]).catch(() => undefined)
    }
    if (!(await removeDirectoryWithRetries(profileDirectory))) {
      console.warn(`警告：便携版验证临时目录稍后需清理：${profileDirectory}`)
    }
  }
}

async function verifyUnpackedWorkflows(): Promise<void> {
  const componentRun = await launchPackagedEditor(unpackedExecutable)
  try {
    await componentRun.page.getByRole('button', { name: '专业' }).click()
    await componentRun.application.evaluate(
      ({ dialog }, componentPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [componentPath],
        })
      },
      sampleComponent,
    )
    await componentRun.page.getByRole('tab', { name: '组件', exact: true }).click()
    await componentRun.page.getByTestId('import-external-components').click()
    await componentRun.page
      .locator('[data-testid="component-com.example.sample-counter"]')
      .waitFor({ timeout: 20_000 })

    await componentRun.page.getByRole('tab', { name: '元素' }).click()
    await componentRun.page.getByRole('tab', { name: '常用' }).click()
    await componentRun.page.getByTestId('add-text').click()
    await componentRun.page.getByRole('tab', { name: '属性' }).click()
    const fontInput = componentRun.page.getByRole('combobox', { name: '字体' })
    const initialFont = await fontInput.inputValue()
    assert(initialFont.trim().length > 0, '目录版字体框默认值为空')
    await componentRun.page
      .getByRole('button', { name: '展开字体列表' })
      .click()
    await componentRun.page
      .getByRole('listbox', { name: '常用字体' })
      .waitFor({ timeout: 10_000 })
    assert(
      await componentRun.page.getByRole('option', {
        name: /微软雅黑，Microsoft YaHei，/,
      }).count() === 1,
      '目录版字体框未在保留默认值时展开完整字体列表',
    )
    pass('字体组合框', '保留默认值即可展开完整字体列表并支持搜索')
    assert(componentRun.pageErrors.length === 0, componentRun.pageErrors.join('\n'))
    assert(
      componentRun.consoleErrors.length === 0,
      componentRun.consoleErrors.join('\n'),
    )
    assert(
      componentRun.externalRequests.length === 0,
      `目录版导入组件时产生了网络请求：${componentRun.externalRequests.join(', ')}`,
    )
    pass('示例组件导入', '目录版 GUI 已显示“示例计数器”组件')
  } finally {
    await closeElectronApplication(componentRun.application)
  }

  const projectRun = await launchPackagedEditor(unpackedExecutable)
  try {
    await projectRun.application.evaluate(
      ({ dialog }, values) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [values.projectPath],
        })
        dialog.showSaveDialog = async (
          windowOrOptions: Electron.BaseWindow | Electron.SaveDialogOptions,
          maybeOptions?: Electron.SaveDialogOptions,
        ) => {
          const options = maybeOptions ?? windowOrOptions as Electron.SaveDialogOptions
          return {
            canceled: false,
            filePath: options.title?.includes('PDF')
              ? values.pdfPath
              : options.title?.includes('PowerPoint')
                ? values.pptxPath
                : values.htmlPath,
          }
        }
      },
      {
        projectPath: sampleProject,
        htmlPath: exportedHtml,
        pdfPath: exportedPdf,
        pptxPath: exportedPptx,
      },
    )
    await projectRun.page
      .getByRole('button', { name: '打开工程（Ctrl+O）' })
      .click()
    await projectRun.page
      .getByRole('button', { name: '重命名课件' })
      .filter({ hasText: '示例互动课件' })
      .waitFor({ timeout: 20_000 })
    const sceneCount = await projectRun.page.locator('.scene-item').count()
    assert(sceneCount === 2, `示例工程应有 2 个场景，实际为 ${sceneCount}`)
    pass('示例工程打开', '目录版 GUI 已打开双场景示例工程')

    await fs.rm(exportedHtml, { force: true })
    await projectRun.page
      .getByTestId('export-menu-trigger')
      .click()
    await projectRun.page
      .getByTestId('export-single-html')
      .click()
    const htmlPreflight = projectRun.page.getByRole('alertdialog', {
      name: '单 HTML 导出预检',
    })
    await htmlPreflight.getByRole('button', { name: '继续导出' }).click()

    const exportDeadline = Date.now() + 30_000
    while (!existsSync(exportedHtml) && Date.now() < exportDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert(existsSync(exportedHtml), '目录版 GUI 未生成导出 HTML')
    const html = await fs.readFile(exportedHtml, 'utf8')
    assert(html.startsWith('<!doctype html>'), '导出内容不是完整 HTML')
    assert(!/https?:\/\//i.test(html), '导出 HTML 含有远程 URL')
    assert(
      !html.includes('data-testid="top-toolbar"'),
      '导出 HTML 不应包含编辑器 GUI',
    )

    await fs.rm(exportedPdf, { force: true })
    await projectRun.page
      .getByTestId('export-menu-trigger')
      .click()
    await projectRun.page
      .getByTestId('export-pdf')
      .click()
    const pdfPreflight = projectRun.page.getByRole('alertdialog', {
      name: 'PDF 导出预检',
    })
    await pdfPreflight.getByRole('button', { name: '继续导出' }).click()
    const pdfDeadline = Date.now() + 30_000
    while (!existsSync(exportedPdf) && Date.now() < pdfDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert(existsSync(exportedPdf), '目录版 GUI 未生成导出 PDF')
    const pdf = await fs.readFile(exportedPdf)
    assert(pdf.subarray(0, 5).toString() === '%PDF-', 'PDF 文件签名错误')
    assert(pdf.byteLength > 5_000, 'PDF 文件大小异常')
    pass('PDF 导出', '目录版 GUI 已生成两页静态 PDF')

    await fs.rm(exportedPptx, { force: true })
    await projectRun.page
      .getByTestId('export-menu-trigger')
      .click()
    await projectRun.page
      .getByTestId('export-pptx')
      .click()
    const pptxPreflight = projectRun.page.getByRole('alertdialog', {
      name: 'PPTX 导出预检',
    })
    await pptxPreflight.getByRole('button', { name: '继续导出' }).click()
    const pptxDeadline = Date.now() + 30_000
    while (!existsSync(exportedPptx) && Date.now() < pptxDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert(existsSync(exportedPptx), '目录版 GUI 未生成导出 PPTX')
    const pptx = await fs.readFile(exportedPptx)
    assert(pptx.subarray(0, 2).toString() === 'PK', 'PPTX ZIP 文件签名错误')
    const pptxArchive = unzipSync(Uint8Array.from(pptx))
    const pptxEntries = Object.keys(pptxArchive)
    assert(pptxEntries.includes('ppt/slides/slide1.xml'), 'PPTX 缺少第 1 页')
    assert(pptxEntries.includes('ppt/slides/slide2.xml'), 'PPTX 缺少第 2 页')
    const slide1 = new TextDecoder().decode(pptxArchive['ppt/slides/slide1.xml'])
    const slide2 = new TextDecoder().decode(pptxArchive['ppt/slides/slide2.xml'])
    const slideXmlErrors = await projectRun.page.evaluate((slides) => slides.map((xml) => {
      const document = new DOMParser().parseFromString(xml, 'application/xml')
      return document.getElementsByTagName('parsererror')[0]?.textContent ?? null
    }), [slide1, slide2])
    assert(
      slideXmlErrors.every((error) => error === null),
      `PPTX 幻灯片 XML 无效：${slideXmlErrors.filter(Boolean).join('；')}`,
    )
    assert(slide1.includes('交互式课件编辑器'), 'PPTX 第 1 页主标题不是原生文字')
    assert(slide1.includes('双击文字即可修改'), 'PPTX 第 1 页副标题不是原生文字')
    assert((slide1.match(/<p:sp>/g) ?? []).length === 2, 'PPTX 第 1 页应包含 2 个独立原生文字对象')
    assert((slide1.match(/<p:pic>/g) ?? []).length === 0, 'PPTX 第 1 页不应退化为整页图片')
    assert(slide2.includes('拖动组件，调整课件布局'), 'PPTX 第 2 页提示不是原生文字')
    assert((slide2.match(/<p:sp>/g) ?? []).length === 1, 'PPTX 第 2 页应包含 1 个原生文字对象')
    assert((slide2.match(/<p:pic>/g) ?? []).length === 1, 'PPTX 第 2 页组件应为 1 个独立图片对象')
    pass('PPTX 导出', '目录版 GUI 已生成两页对象级可编辑 PowerPoint')

    assert(projectRun.pageErrors.length === 0, projectRun.pageErrors.join('\n'))
    assert(
      projectRun.consoleErrors.length === 0,
      projectRun.consoleErrors.join('\n'),
    )
    assert(
      projectRun.externalRequests.length === 0,
      `目录版工作流产生了网络请求：${projectRun.externalRequests.join(', ')}`,
    )
    pass('目录版启动与导出', '工程已从 GUI 导出为单一 HTML，编辑器无网络请求')
  } finally {
    await closeElectronApplication(projectRun.application)
  }
}

async function verifyOfflineHtml(
  controllerTarget: ControllerVerificationTarget,
): Promise<void> {
  const browser = await chromium.launch({
    executablePath: systemEdgePath(),
    headless: true,
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    const pageErrors: string[] = []
    const externalRequests: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      if (/^(?:https?|wss?):/i.test(request.url())) {
        externalRequests.push(request.url())
      }
    })
    await page.goto(pathToFileURL(exportedHtml).href, {
      waitUntil: 'load',
      timeout: 45_000,
    })
    await page.waitForFunction(() => Boolean(window.__H5_LESSON_PLAYER__))
    await page.evaluate(() => {
      window.addEventListener('courseware-component-event', (event) => {
        Reflect.set(window, '__sampleCounterEvent', (event as CustomEvent).detail)
      })
    })
    assert(
      await page.locator('.lesson-footer').count() === 0,
      '画布控制器成品不应再渲染 lesson-footer',
    )
    assert(
      await page.locator('.lesson-page-indicator').count() === 0,
      '画布控制器成品不应残留 DOM 页码栏',
    )
    const initialSceneIndex = await page.evaluate(
      () => window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex(),
    )
    assert(initialSceneIndex === 0, '离线 HTML 初始场景错误')

    const controller = page.locator(
      `[data-global-layer-item="${controllerTarget.itemId}"] .slide-native-teacher-controller`,
    )
    assert(await controller.count() === 1, '离线 HTML 中未找到 Published V2 全局教师控制器')
    assert(await controller.isVisible(), '离线 HTML 的全局教师控制器不可见')
    const nextButton = controller.locator(
      `[data-controller-button-id="${controllerTarget.nextButtonId}"]`,
    )
    if (!await nextButton.isVisible()) {
      const expand = controller.locator('[data-teacher-controller-collapse="true"]')
      assert(await expand.count() === 1, '收起的教师控制器缺少展开按钮')
      const expandBounds = await expand.boundingBox()
      assert(expandBounds, '教师控制器展开按钮没有可点击范围')
      await page.mouse.click(
        expandBounds.x + expandBounds.width / 2,
        expandBounds.y + expandBounds.height / 2,
      )
    }
    assert(await nextButton.isVisible(), '离线 HTML 的下一场景按钮不可见')
    assert(await nextButton.isEnabled(), '离线 HTML 的下一场景按钮未启用')
    const nextButtonBounds = await nextButton.boundingBox()
    assert(nextButtonBounds, '下一场景按钮没有可点击范围')
    await page.mouse.click(
      nextButtonBounds.x + nextButtonBounds.width / 2,
      nextButtonBounds.y + nextButtonBounds.height / 2,
    )
    await page.waitForFunction(
      () => window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex() === 1,
    )

    const canvas = page.locator(
      '[data-published-phaser-component="component_sample_counter"]',
    )
    await canvas.waitFor({ state: 'visible', timeout: 15_000 })
    const canvasBounds = await canvas.boundingBox()
    assert(canvasBounds, '离线 HTML 第 2 页的示例 Phaser 画布不可见')
    await page.mouse.click(
      canvasBounds.x + (356 / 480) * canvasBounds.width,
      canvasBounds.y + (238 / 280) * canvasBounds.height,
    )
    await page.waitForFunction(() => {
      const detail = Reflect.get(window, '__sampleCounterEvent') as
        | { instanceId?: string; eventName?: string; payload?: { value?: number } }
        | undefined
      return detail?.instanceId === 'component_sample_counter' &&
        detail.eventName === 'change' &&
        detail.payload?.value === 1
    }, undefined, { timeout: 10_000 })
    assert(
      await canvas.isVisible(),
      '计数变更后示例 Phaser 画布不可见',
    )
    await page.keyboard.press('ArrowLeft')
    await page.waitForFunction(
      () => window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex() === 0,
    )
    await page.screenshot({ path: screenshotPath, fullPage: true })
    assert(pageErrors.length === 0, pageErrors.join('\n'))
    assert(
      externalRequests.length === 0,
      `离线 HTML 产生了网络请求：${externalRequests.join(', ')}`,
    )
    pass(
      '离线 HTML',
      'Edge 通过 file:// 打开，无页脚栏；Published 教师控制器/键盘翻页、Phaser 计数交互可用且网络请求为 0',
    )
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  await fs.mkdir(verificationDirectory, { recursive: true })
  console.log('开始验证 Windows 发布产物…')

  assert(
    APP_VERSION === packageJson.version,
    `应用版本 ${APP_VERSION} 与 package.json ${packageJson.version} 不一致`,
  )
  pass('源码版本一致性', `APP_VERSION 与 package.json 均为 ${APP_VERSION}`)

  const portableArtifact = await assertWindowsExecutable(
    portableExecutable,
    'Portable.exe',
    packageJson.version,
  )
  const unpackedArtifact = await assertWindowsExecutable(
    unpackedExecutable,
    'win-unpacked exe',
    packageJson.version,
  )
  const appAsarArtifact = await assertAppAsar(
    unpackedAppAsar,
    packageJson.name,
    packageJson.version,
  )
  pass(
    '发布产物版本一致性',
    `Portable.exe、win-unpacked exe 与 app.asar 均来自 ${packageJson.name}@${packageJson.version}`,
  )
  const requiredFiles = [
    path.join(projectRoot, 'README.md'),
    path.join(projectRoot, 'docs', 'USER_GUIDE.md'),
    path.join(projectRoot, 'docs', 'COMPONENT_AUTHORING.md'),
    path.join(projectRoot, 'docs', 'AI_COURSEWARE_AUTHORING.md'),
    path.join(projectRoot, 'docs', 'RUNTIME_AUTHORING.md'),
    path.join(renderHostBenchmarkDirectory, 'README.md'),
    path.join(renderHostBenchmarkDirectory, 'THIRD_PARTY_NOTICES.md'),
    path.join(projectRoot, 'package-lock.json'),
  ]
  for (const requiredFile of requiredFiles) {
    const stats = await fs.stat(requiredFile)
    assert(stats.isFile() && stats.size > 0, `必需文件无效：${requiredFile}`)
  }
  pass(
    '发布配套文件',
    'README、AI 创作规范、自由运行时/组件指南、渲染基准及 package-lock.json 均存在',
  )

  const [projectBytes, componentBytes] = await Promise.all([
    fs.readFile(sampleProject),
    fs.readFile(sampleComponent),
  ])
  const openedProject = openCourseProjectArchive(Uint8Array.from(projectBytes))
  const importedComponent = importComponentPackage(
    Uint8Array.from(componentBytes),
  )
  const sampleSlide = openedProject.project.surfaces[0]
  assert(
    openedProject.project.schemaVersion === 9 &&
      openedProject.project.surfaces.length === 1 &&
      sampleSlide?.type === 'slide' &&
      sampleSlide.scenes.length === 2,
    '示例工程必须是两页 Slide 的 Course Project V9',
  )
  const controllerTarget = sampleControllerTarget(openedProject.project)
  assert(
    importedComponent.manifest.id === 'com.example.sample-counter',
    '示例组件 ID 错误',
  )
  const embeddedComponentFiles = openedProject.componentFiles[importedComponent.key]
  assert(embeddedComponentFiles, '示例 V9 工程未内嵌计数器组件字节')
  parseComponentPackageFiles(embeddedComponentFiles, {
    expectedId: importedComponent.manifest.id,
    expectedVersion: importedComponent.manifest.version,
  })
  pass(
    '示例文件结构',
    'Course Project V9 与内嵌 Component API 4 包均通过正式解析器校验',
  )

  const [benchmarkBytes, tableBytes, phaserMeterBytes, benchmarkHtml] =
    await Promise.all([
      fs.readFile(renderHostBenchmarkProject),
      fs.readFile(renderHostBenchmarkTable),
      fs.readFile(renderHostBenchmarkPhaserMeter),
      fs.readFile(renderHostBenchmarkHtml, 'utf8'),
    ])
  const benchmarkProject = openProjectArchive(Uint8Array.from(benchmarkBytes))
  const benchmarkTable = importComponentPackage(Uint8Array.from(tableBytes))
  const benchmarkPhaserMeter = importComponentPackage(Uint8Array.from(phaserMeterBytes))
  assert(
    benchmarkProject.project.schemaVersion === 8 &&
      benchmarkProject.project.scenes.length === 5,
    '渲染宿主基准必须是五场景 Project V8 工程',
  )
  assert(
    benchmarkProject.project.scenes[1]?.runtime?.runtimeApiVersion === 2 &&
      benchmarkProject.project.scenes[1]?.runtime?.renderMode === 'phaser' &&
      benchmarkProject.project.scenes[2]?.runtime?.runtimeApiVersion === 2 &&
      benchmarkProject.project.scenes[2]?.runtime?.renderMode === 'dom',
    '渲染宿主基准缺少 API 2 Phaser / Three-DOM 运行时',
  )
  assert(
    benchmarkTable.manifest.schemaVersion === 4 &&
      benchmarkTable.manifest.renderMode === 'dom',
    '渲染宿主基准缺少 V4 DOM 组件',
  )
  assert(
    benchmarkPhaserMeter.manifest.schemaVersion === 4 &&
      benchmarkPhaserMeter.manifest.renderMode === 'phaser',
    '渲染宿主基准缺少 V4 Phaser 组件',
  )
  assert(
    benchmarkHtml.includes('connect-src data: blob:') &&
      !/connect-src[^;]*(?:https?:|\*|'self')/i.test(benchmarkHtml) &&
      !/<script[^>]+src=/i.test(benchmarkHtml),
    '渲染宿主基准单 HTML 不是自包含离线成品',
  )
  pass(
    '渲染宿主基准',
    'Project V8、Runtime API 2 Phaser/Three 与 Component API 4 DOM/Phaser 产物均通过正式解析器',
  )

  await verifyPortableStartup()
  await verifyUnpackedWorkflows()
  await verifyOfflineHtml(controllerTarget)

  await fs.writeFile(
    reportPath,
    `${JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        platform: `${process.platform}-${process.arch}`,
        checks,
        artifacts: {
          portableExecutable: portableArtifact,
          unpackedExecutable: unpackedArtifact,
          appAsar: appAsarArtifact,
          sampleProject,
          sampleComponent,
          exportedHtml,
          exportedPdf,
          exportedPptx,
          screenshotPath,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  console.log(`发布验证通过，共 ${checks.length} 项。`)
  console.log(`验证报告：${reportPath}`)
}

main().catch(async (error: unknown) => {
  await fs.mkdir(verificationDirectory, { recursive: true }).catch(() => undefined)
  await fs
    .writeFile(
      reportPath,
      `${JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          platform: `${process.platform}-${process.arch}`,
          checks,
          failure: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    .catch(() => undefined)
  console.error('发布验证失败：', error)
  process.exitCode = 1
})
