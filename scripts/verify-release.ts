import { isControllerFixture } from '../tests/fixtures/teacherController'
import { extractFile, listPackage, statFile } from '@electron/asar'
import { _electron as electron, chromium } from '@playwright/test'
import { prepareElectronLaunchEnvironment } from './electronLaunchEnvironment'
import { unzipSync } from 'fflate'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
} from '../src/core/drivers/codecs/importComponentPackage'
import { createCourseProjectArchive, openCourseProjectArchive } from '../src/core/drivers/codecs/courseProjectArchive'
import {
  APP_EXECUTABLE_NAME,
  APP_PRODUCT_NAME,
  APP_VERSION,
} from '../src/shared/constants'
import type {
  CourseProjectDocument,
  LayerFrame,
} from '../src/shared/courseProjectTypes'
import { publishedCourseV2Schema } from '../src/shared/publishedCourseSchema'
import { BACKGROUND_E2E_ENV } from '../src/main/windowVisibility'
import {
  assertExpectedAsarPackage,
  assertExpectedWindowsVersion,
  assertNoRemoteUrlReferences,
  collectFileArtifactEvidence,
  readAsarPackageMetadata,
  readWindowsVersionEvidence,
  type AsarArtifactEvidence,
  type ExecutableArtifactEvidence,
} from './releaseArtifactEvidence'
import {
  formatReleaseArtifactBoundaryFindings,
  releaseArtifactBoundaryTargetPath,
  releaseArtifactBoundaryTargetPaths,
  scanReleaseArtifactPath,
  type ReleaseArtifactBoundaryFinding,
} from './releaseArtifactBoundary'

interface VerificationCheck {
  name: string
  detail: string
  passed: true
}

interface ControllerVerificationTarget {
  itemId: string
  nextButtonId: string
  frame: LayerFrame
  canvas: {
    width: number
    height: number
  }
}

const PUBLISHED_FRAME_TOLERANCE_CSS_PX = 1

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
const packagedMixedProject = path.join(
  projectRoot,
  'tests',
  'fixtures',
  'architecture-baseline',
  'mixed-spatial.h5lesson',
)
/**
 * 打包产物边界扫描的目录：`win-unpacked/resources/**`。
 *
 * 这是应用自身的负载（app.asar、app.asar.unpacked、electron-builder 生成的
 * 辅助文件），不含 exe 同级的 Electron/Chromium 运行时文件。实测（2026-09-22）：
 * 用同一套规则扫 `node_modules/electron/dist` 的 75 个文件（347.3 MB）会在
 * `electron.exe` 上命中 5 处 `credential.aws-access-key-id` —— Chromium 自带的
 * AWS 文档示例串，整树无例外扫描会把发布验证误判成失败，而放宽该规则属于削弱
 * 现有规则。
 */
const unpackedResourcesDirectory = path.join(
  releaseDirectory,
  'win-unpacked',
  'resources',
)
/**
 * 发布物数据边界的 6 个源码树目标只有一处定义：`scripts/releaseArtifactBoundary.ts`
 * 的 `RELEASE_ARTIFACT_BOUNDARY_DEFAULT_TARGET_FILES`。这里按 key 取具名绝对路径，
 * 不再平行重写一份字面清单 —— 两份清单曾各自存在，2026-09-22 实测它们解析到仓库根
 * 后同序同集合，所以合并为单一来源不改变被扫描的文件。
 * 漂移守卫见 `tests/unit/releaseArtifactBoundary.test.ts`。
 */
const sampleProject = releaseArtifactBoundaryTargetPath('sampleProject', projectRoot)
const sampleComponent = releaseArtifactBoundaryTargetPath('sampleComponent', projectRoot)
const renderHostBenchmarkDirectory = path.join(
  projectRoot,
  'examples',
  'render-host-benchmark',
)
const renderHostBenchmarkProject = releaseArtifactBoundaryTargetPath(
  'renderHostBenchmarkProject',
  projectRoot,
)
const renderHostBenchmarkPublished = releaseArtifactBoundaryTargetPath(
  'renderHostBenchmarkPublished',
  projectRoot,
)
const renderHostBenchmarkHtml = releaseArtifactBoundaryTargetPath(
  'renderHostBenchmarkHtml',
  projectRoot,
)
const renderHostBenchmarkNotices = path.join(
  renderHostBenchmarkDirectory,
  'THIRD_PARTY_NOTICES_V9.md',
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
const focusedM13 = process.argv.includes('--m13-package')
const focusedM13Exports = process.argv.includes('--m13-exports')
const focusedM13ReportPath = path.join(projectRoot, 'output', 'g20', 'm13', 'package-report.json')
const focusedM13ExportsReportPath = path.join(projectRoot, 'output', 'g20', 'm13', 'format-diagnostic.json')
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

/**
 * AI 消息、trace、凭据与本机个人路径不得进入 `.h5lesson`、Published payload、
 * 组件包、导出 HTML 与打包产物。
 *
 * `docs/development-plan/reviews/2026-09-21-r20-contextual-acceptance.md:85`
 * 记录该边界此前只有一次人工扫描结论、没有任何自动化检查；这里把它变成
 * 每次发版验证都会重跑的一步。只读产物，不改写 `examples/`。
 * 规则集与「非空转」证明见 `scripts/releaseArtifactBoundary.ts` 与
 * `tests/unit/releaseArtifactBoundary.test.ts`。
 *
 * 每个目标按路径形态分派：普通文件走字节扫描，目录走逐文件扫描，`*.asar`
 * 走逐条目扫描（asar 未压缩，但按原始字节扫会丢掉条目归属与 unpacked 条目）。
 * 覆盖计数一并打进验证报告，避免「0 命中」掩盖「其实什么都没扫」。
 */
async function verifyReleaseArtifactBoundary(
  name: string,
  targets: readonly string[],
): Promise<void> {
  const findings: ReleaseArtifactBoundaryFinding[] = []
  let files = 0
  let archives = 0
  let entries = 0
  let bytes = 0
  for (const target of targets) {
    assert(existsSync(target), `发布物数据边界扫描目标不存在：${target}`)
    const result = await scanReleaseArtifactPath(target)
    findings.push(...result.findings)
    files += result.coverage.files
    archives += result.coverage.archives
    entries += result.coverage.entries
    bytes += result.coverage.bytes
    if (result.findings.length > 0) {
      console.error(
        formatReleaseArtifactBoundaryFindings([...result.findings], target),
      )
      continue
    }
    console.log(
      `OK\t${target}\t应用记录/凭据 0 命中` +
        `（普通文件 ${result.coverage.files}，asar 归档 ${result.coverage.archives}` +
        `/条目 ${result.coverage.entries}）`,
    )
  }
  if (findings.length > 0) {
    throw new Error(
      formatReleaseArtifactBoundaryFindings(findings, '发布物数据边界'),
    )
  }
  pass(
    name,
    `${targets.length} 个产物（普通文件 ${files} 个，asar 归档 ${archives} 个/条目 ${entries} 条，` +
      `共检查 ${(bytes / 1024 / 1024).toFixed(1)} MB）的` +
      '应用对话记录、trace、凭据与本机个人路径均为 0 命中',
  )
}

function sampleControllerTarget(
  project: CourseProjectDocument,
): ControllerVerificationTarget {
  assert(
    project.playback.controls === 'canvas',
    '示例工程必须使用画布内教师控制器',
  )
  const placement = project.globalLayerItems.find(
    (entry) => isControllerFixture(entry.item) &&
      entry.item.visible,
  )
  assert(placement, '示例工程缺少可见的画布内教师控制器')
  const controller = placement.item
  assert(
    isControllerFixture(controller),
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
  const nextButton = controller.props.buttons.find(
    (button) => button.action.type === 'scene.next',
  )
  assert(nextButton, '示例工程教师控制器缺少可见的下一场景按钮')
  assert(nextButton.visible, '示例工程教师控制器的下一场景按钮不可见')
  assert(controller.rotation === 0, '发布验收样例的教师控制器不应旋转')
  return {
    itemId: controller.layerItemId,
    nextButtonId: nextButton.id,
    frame: structuredClone(controller.frame),
    canvas: structuredClone(slide.canvas),
  }
}

async function assertPublishedControllerFrame(
  page: Page,
  target: ControllerVerificationTarget,
): Promise<void> {
  const stage = page.locator('[data-slide-scene-stage="true"]')
  const wrapper = page.locator(`[data-global-layer-item="${target.itemId}"]`)
  assert(await stage.count() === 1, '离线 HTML 中未找到唯一的 Published Slide 画布宿主')
  assert(await wrapper.count() === 1, '离线 HTML 中未找到 Published 教师控制器 wrapper')
  const [stageBounds, wrapperBounds] = await Promise.all([
    stage.boundingBox(),
    wrapper.boundingBox(),
  ])
  assert(stageBounds, 'Published Slide 画布宿主没有可见范围')
  assert(wrapperBounds, 'Published 教师控制器 wrapper 没有可见范围')
  const scaleX = stageBounds.width / target.canvas.width
  const scaleY = stageBounds.height / target.canvas.height
  assert(scaleX > 0 && scaleY > 0, 'Published Slide 画布缩放比例无效')
  const mapped = {
    left: wrapperBounds.x - stageBounds.x,
    top: wrapperBounds.y - stageBounds.y,
    width: wrapperBounds.width,
    height: wrapperBounds.height,
  }
  const expected = {
    left: target.frame.x * scaleX,
    top: target.frame.y * scaleY,
    width: target.frame.width * scaleX,
    height: target.frame.height * scaleY,
  }
  for (const key of ['left', 'top', 'width', 'height'] as const) {
    assert(
      Math.abs(mapped[key] - expected[key]) <= PUBLISHED_FRAME_TOLERANCE_CSS_PX,
      `Published 教师控制器 ${key} 映射错误：` +
        `实际 ${mapped[key].toFixed(2)}px，预期 ${expected[key].toFixed(2)}px，` +
        `容差 ${PUBLISHED_FRAME_TOLERANCE_CSS_PX}px`,
    )
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

async function verifyPackagedRuntimeResources(): Promise<void> {
  const entries = new Set(
    listPackage(unpackedAppAsar, { isPack: false })
      .map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '')),
  )
  const required = [
    'dist-electron/main/index.js',
    'dist-electron/main/ipc.js',
    'dist-electron/main/workbench/execution/ExecutionDesktopService.js',
    'dist-electron/main/workbench/attachments/AttachmentService.js',
    'dist-electron/main/workbench/admittedImageResource.js',
    'dist-electron/preload/index.js',
    'dist-electron/preload/attachmentExtraction.js',
    'dist-renderer/index.html',
    'dist-renderer/attachment-extraction.html',
    'dist-renderer/native-text-measurement.html',
    'dist-player/player.iife.js',
    'resources/icons/icon.png',
    'resources/built-in-components/catalog.json',
    'node_modules/sharp/package.json',
    'node_modules/@img/sharp-win32-x64/package.json',
  ]
  const absent = required.filter((entry) => !entries.has(entry))
  assert(absent.length === 0, `正式包缺少运行时读取的文件：${absent.join(', ')}`)
  const catalog = JSON.parse(extractFile(unpackedAppAsar,
    'resources/built-in-components/catalog.json'.split('/').join(path.sep)).toString('utf8')) as {
    packages?: Array<{ packagePath: string; thumbnailPath: string; sha256: string }>
  }
  assert(Array.isArray(catalog.packages) && catalog.packages.length > 0,
    '正式包内置组件目录为空')
  for (const component of catalog.packages) {
    for (const relative of [component.packagePath, component.thumbnailPath]) {
      assert(typeof relative === 'string' && !path.posix.isAbsolute(relative) &&
        !relative.split('/').includes('..'), `内置组件目录路径非法：${relative}`)
      const entry = `resources/built-in-components/${relative}`
      assert(entries.has(entry), `正式包缺少内置组件关联资源：${entry}`)
    }
    const entry = `resources/built-in-components/${component.packagePath}`
    const bytes = extractFile(unpackedAppAsar, entry.split('/').join(path.sep))
    assert(createHash('sha256').update(bytes).digest('hex') === component.sha256,
      `正式包内置组件与目录声明不一致：${entry}`)
  }
  for (const entry of [
    'dist-electron/main/ipc.js',
    'dist-electron/main/workbench/execution/ExecutionDesktopService.js',
    'dist-electron/main/workbench/attachments/AttachmentService.js',
    'dist-electron/preload/index.js',
  ]) {
    const compiled = await fs.readFile(path.join(projectRoot, ...entry.split('/')))
    const packaged = extractFile(unpackedAppAsar, entry.split('/').join(path.sep))
    assert(Buffer.compare(compiled, packaged) === 0,
      `正式包与当前构建产物不一致：${entry}`)
  }
  const nativeRoot = 'node_modules/@img/sharp-win32-x64/lib/'
  const nativeFiles = [...entries].filter((entry) => entry.startsWith(nativeRoot) &&
    (entry.endsWith('.node') || entry.endsWith('.dll')))
  assert(nativeFiles.some((entry) => entry.endsWith('.node')) &&
    nativeFiles.filter((entry) => entry.endsWith('.dll')).length >= 2,
  '正式包缺少 sharp Win64 原生模块或 libvips DLL')
  for (const entry of nativeFiles) {
    const metadata = statFile(unpackedAppAsar, entry.split('/').join(path.sep))
    assert('unpacked' in metadata && metadata.unpacked === true,
      `sharp 原生依赖未从 asar 解包：${entry}`)
    const physical = path.join(`${unpackedAppAsar}.unpacked`, ...entry.split('/'))
    assert((await fs.stat(physical)).isFile(), `sharp 原生依赖实体文件不存在：${physical}`)
  }
  const helper = path.join(unpackedResourcesDirectory, 'clipboard-file-list', 'clipboard-file-list.exe')
  assert((await fs.stat(helper)).isFile(), '正式包缺少剪贴板文件辅助程序')
  const forbidden = [...entries].filter((entry) => entry.startsWith('.agents/') ||
    entry.startsWith('output/') || entry.endsWith('editor-root.local.json') ||
    entry.startsWith('dist-electron/main/localAgent/'))
  assert(forbidden.length === 0, `正式包混入本机配置或开发资料：${forbidden.join(', ')}`)
  pass('运行时资源打包',
    `${required.length} 项编辑器/Player 资源、${catalog.packages.length} 个内置组件及关联图齐全；4 个 M08/S10 关键模块与当前编译产物一致；sharp 原生模块及 ${nativeFiles.filter((entry) => entry.endsWith('.dll')).length} 个 DLL 已解包；无本机配置`)
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

async function enterPackagedEditor(page: Page): Promise<void> {
  const canvas = page.getByRole('main', { name: '课件画布' })
  if (await canvas.isVisible()) return
  const emptyContent = page.getByRole('region', { name: '没有打开的文件' })
  await emptyContent.getByRole('button', { name: '新建课件', exact: true })
    .click({ timeout: 30_000 })
  await page.getByRole('button', { name: '深度编辑', exact: true })
    .click({ timeout: 30_000 })
  await canvas.waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('[data-testid="canvas-stage"] canvas')
    .waitFor({ state: 'visible', timeout: 30_000 })
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
  prepareElectronLaunchEnvironment()
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
    await enterPackagedEditor(page)
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
    await enterPackagedEditor(page)
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
  const mixedArchive = openCourseProjectArchive(
    Uint8Array.from(await fs.readFile(packagedMixedProject)),
  )
  assert(
    mixedArchive.project.surfaces.map((surface) => surface.type).join(',') ===
      'slide,flow,spatial-2d',
    '正式包验收样本必须包含 Slide、Flow、Spatial 三表面',
  )
  const imageBytes = Object.values(mixedArchive.assetFiles)[0]
  assert(imageBytes && imageBytes.byteLength > 0,
    '正式包验收样本缺少可供图片解码的素材字节')
  const componentRun = await launchPackagedEditor(unpackedExecutable)
  try {
    const admitted = await componentRun.application.evaluate(async ({ app }, base64) => {
      const imageModule = process.mainModule?.require(
        `${app.getAppPath()}/dist-electron/main/workbench/admittedImageResource.js`,
      )
      if (!imageModule) throw new Error('正式包主进程没有可用的 CommonJS 模块入口')
      const result = await imageModule.prepareImageResource({
        bytes: Uint8Array.from(Buffer.from(base64, 'base64')),
        mimeType: 'image/png',
        filename: 'mixed-figure.png',
      }, () => 'packaged-image-smoke')
      return { width: result.meta.width, height: result.meta.height,
        byteLength: result.bytes.byteLength }
    }, Buffer.from(imageBytes).toString('base64'))
    assert(admitted.width > 0 && admitted.height > 0 &&
      admitted.byteLength === imageBytes.byteLength,
    '正式包中 sharp 未能解码实际课件图片素材')
    pass('正式包图片解码',
      `包内主进程 sharp 已实际解码 ${admitted.width}×${admitted.height} PNG`)

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
    await componentRun.page.getByText('已添加 1 个组件到当前画布').waitFor({ timeout: 20_000 })
    await componentRun.page.getByRole('tab', { name: '组件', exact: true }).click()
    await componentRun.page
      .getByTestId('component-package-com.example.sample-counter')
      .waitFor({ timeout: 20_000 })
      .catch(async (error: unknown) => {
        const visible = await componentRun.page.locator('body').innerText({ timeout: 2_000 }).catch(() => '<body unavailable>')
        const dialogs = await componentRun.page.getByRole('dialog').allTextContents().catch(() => [])
        const screenshot = path.join(projectRoot, 'output', 'g20', 'm13', 'component-import-failure.png')
        await fs.mkdir(path.dirname(screenshot), { recursive: true })
        await componentRun.page.screenshot({ path: screenshot }).catch(() => undefined)
        throw new Error(`正式包组件导入后未入列：${String(error)}；URL：${componentRun.page.url()}；页面：${visible.slice(0, 5000)}；对话框：${dialogs.join(' | ')}；控制台：${componentRun.consoleErrors.join(' | ')}；页面错误：${componentRun.pageErrors.join(' | ')}；截图：${screenshot}`)
      })

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
    await projectRun.page.getByRole('tab', { name: path.basename(sampleProject), exact: true })
      .waitFor({ state: 'visible', timeout: 20_000 })
    if (await projectRun.page.getByRole('button', { name: '深度编辑', exact: true }).isVisible()) {
      await projectRun.page.getByRole('button', { name: '深度编辑', exact: true }).click()
    }
    await projectRun.page.getByRole('button', { name: '重命名课件' })
      .filter({ hasText: '示例互动课件' }).waitFor({ timeout: 20_000 })
    const sceneItems = projectRun.page.locator('[data-testid^="scene-item-"]:visible')
    await sceneItems.first().waitFor({ state: 'visible', timeout: 20_000 })
    const sceneCount = await sceneItems.count()
    assert(sceneCount === 2, `示例工程应有 2 个 Slide 位置，实际为 ${sceneCount}`)
    for (let index = 0; index < sceneCount; index += 1) {
      const sceneItem = sceneItems.nth(index)
      assert(await sceneItem.isVisible(), `示例工程第 ${index + 1} 个 Slide 位置不可见`)
      await sceneItem.click()
      await projectRun.page.waitForFunction((activeIndex) => (
        [...document.querySelectorAll('[data-testid^="scene-item-"]')]
          .filter((element) => element.getClientRects().length > 0)[activeIndex]
          ?.getAttribute('aria-current') === 'page'
      ), index)
    }
    await sceneItems.first().click()
    await projectRun.page.waitForFunction(() => (
      [...document.querySelectorAll('[data-testid^="scene-item-"]')]
        .find((element) => element.getClientRects().length > 0)
        ?.getAttribute('aria-current') === 'page'
    ))
    pass('示例工程打开', '目录版 GUI 已打开且可切换两个 V9 Slide 位置')

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
    assertNoRemoteUrlReferences(html, '导出 HTML')
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

async function verifyMixedSurfacePackagedExports(): Promise<string> {
  const mixed = openCourseProjectArchive(
    Uint8Array.from(await fs.readFile(packagedMixedProject)),
  )
  assert(mixed.project.surfaces.map((surface) => surface.type).join(',') ===
    'slide,flow,spatial-2d', '三表面导出样本不完整')
  const evidenceRoot = path.join(projectRoot, 'output', 'g20', 'm13')
  await fs.mkdir(evidenceRoot, { recursive: true })
  // The architecture fixture intentionally exercises a text overflow. Delivery
  // preflight correctly blocks it; widen only that banner in this isolated
  // export sample so package verification can reach all six format producers.
  const banner = mixed.project.globalLayerItems.find((entry) =>
    entry.item.layerItemId === 'mixed-global-banner')
  assert(banner, '三表面基线缺少可修正的共享横幅')
  assert(banner.item.frame.mode === 'absolute', '三表面共享横幅不是绝对定位')
  banner.item.frame.width = 720
  banner.item.frame.height = 80
  const exportReadyProject = path.join(evidenceRoot, 'mixed-export-ready.h5lesson')
  await fs.writeFile(exportReadyProject, createCourseProjectArchive(mixed))
  const directory = await fs.mkdtemp(path.join(evidenceRoot, 'packaged-exports-'))
  const destinations = {
    offline: path.join(directory, 'mixed-offline.html'),
    online: path.join(directory, 'mixed-online.html'),
    web: path.join(directory, 'mixed-web.zip'),
    pdf: path.join(directory, 'mixed-static.pdf'),
    pptx: path.join(directory, 'mixed-editable.pptx'),
    docx: path.join(directory, 'mixed-flow.docx'),
  }
  type Format = keyof typeof destinations
  const packaged = await launchPackagedEditor(unpackedExecutable)
  try {
    await packaged.application.evaluate(({ dialog }, args) => {
      const state = globalThis as typeof globalThis & { __m13ExportFormat?: keyof typeof args.destinations }
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [args.project] })
      dialog.showSaveDialog = async () => {
        const format = state.__m13ExportFormat
        if (!format) throw new Error('M13 导出目标尚未固定')
        return { canceled: false, filePath: args.destinations[format] }
      }
    }, { project: exportReadyProject, destinations })
    await packaged.page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    await packaged.page.getByRole('tab', { name: path.basename(exportReadyProject), exact: true })
      .waitFor({ state: 'visible', timeout: 20_000 })
    if (await packaged.page.getByRole('button', { name: '深度编辑', exact: true }).isVisible()) {
      await packaged.page.getByRole('button', { name: '深度编辑', exact: true }).click()
    }
    await packaged.page.getByRole('button', { name: '重命名课件' })
      .filter({ hasText: mixed.project.title }).waitFor({ timeout: 20_000 })
    await packaged.page.getByTestId('export-menu-trigger').click()
    assert(await packaged.page.getByTestId('export-docx').isEnabled(),
      '三表面工程中的 Flow DOCX 导出入口未启用')
    await packaged.page.getByTestId('export-menu-trigger').click()

    const formats: Array<{ key: Format; testId: string; preflight?: string }> = [
      { key: 'offline', testId: 'export-single-html', preflight: '单 HTML 导出预检' },
      { key: 'online', testId: 'export-single-html-online', preflight: '单 HTML 导出预检' },
      { key: 'web', testId: 'export-web-package', preflight: '网页包 导出预检' },
      { key: 'pdf', testId: 'export-pdf', preflight: 'PDF 导出预检' },
      { key: 'pptx', testId: 'export-pptx', preflight: 'PPTX 导出预检' },
      { key: 'docx', testId: 'export-docx' },
    ]
    for (const format of formats) {
      await packaged.application.evaluate(({}, key) => {
        ;(globalThis as typeof globalThis & { __m13ExportFormat?: string }).__m13ExportFormat = key
      }, format.key)
      await packaged.page.getByTestId('export-menu-trigger').click()
      await packaged.page.getByTestId(format.testId).click()
      if (format.preflight) {
        await packaged.page.getByRole('alertdialog', { name: format.preflight })
          .getByRole('button', { name: '继续导出' }).click({ timeout: 5_000 })
          .catch(async (error: unknown) => {
            const body = await packaged.page.locator('body').innerText({ timeout: 2_000 }).catch(() => '<body unavailable>')
            const dialogs = await packaged.page.getByRole('alertdialog').allTextContents().catch(() => [])
            throw new Error(`${format.key} 导出预检未出现：${String(error)}；当前对话框：${dialogs.join(' | ')}；页面：${body.slice(0, 5000)}；页面错误：${packaged.pageErrors.join(' | ')}；控制台：${packaged.consoleErrors.join(' | ')}`)
          })
      }
      const deadline = Date.now() + 90_000
      while (!existsSync(destinations[format.key]) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert(existsSync(destinations[format.key]),
        `正式包未生成 ${format.key} 导出文件`)
      assert((await fs.stat(destinations[format.key])).size > 100,
        `正式包的 ${format.key} 导出文件异常小`)
    }
    assert(packaged.pageErrors.length === 0, packaged.pageErrors.join('\n'))
    assert(packaged.consoleErrors.length === 0, packaged.consoleErrors.join('\n'))
    assert(packaged.externalRequests.length === 0,
      `三表面正式包导出产生了网络请求：${packaged.externalRequests.join(', ')}`)
  } finally {
    await closeElectronApplication(packaged.application)
  }

  const offline = await fs.readFile(destinations.offline, 'utf8')
  const online = await fs.readFile(destinations.online, 'utf8')
  assert(offline.startsWith('<!doctype html>') && online.startsWith('<!doctype html>'),
    '单 HTML 导出未生成完整文档')
  assertNoRemoteUrlReferences(offline, '三表面离线单 HTML')
  const assetFiles = Object.values(mixed.assetFiles)
  assert(assetFiles.every((bytes) => offline.includes(Buffer.from(bytes).toString('base64'))),
    '离线单 HTML 未保留三表面工程的图片素材字节')
  const webArchive = unzipSync(Uint8Array.from(await fs.readFile(destinations.web)))
  for (const required of ['index.html', 'course-data.js',
    'player/player.iife.js', 'player/player.css']) {
    assert(webArchive[required]?.byteLength, `网页包缺少 ${required}`)
  }
  assert(Object.keys(webArchive).filter((entry) => entry.startsWith('assets/')).length >=
    assetFiles.length, '网页包未保留三表面工程的图片素材')
  const webRoot = path.join(directory, 'web-unpacked')
  for (const [entry, bytes] of Object.entries(webArchive)) {
    const target = path.resolve(webRoot, ...entry.split('/'))
    assert(target.startsWith(`${webRoot}${path.sep}`), `网页包路径越界：${entry}`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, bytes)
  }
  const pdf = await fs.readFile(destinations.pdf)
  assert(pdf.subarray(0, 5).toString() === '%PDF-', '混合表面 PDF 文件签名错误')
  const pptx = unzipSync(Uint8Array.from(await fs.readFile(destinations.pptx)))
  const slideEntries = Object.keys(pptx).filter((entry) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(entry))
  const mappedPptxLocations = mixed.project.locations.filter((location) =>
    location.kind !== 'flow-block')
  assert(slideEntries.length === mappedPptxLocations.length,
    `PPTX 应只生成 Slide/Spatial 的 ${mappedPptxLocations.length} 页，实际 ${slideEntries.length} 页；Flow 走单独 DOCX 导出`)
  const docx = unzipSync(Uint8Array.from(await fs.readFile(destinations.docx)))
  assert(docx['word/document.xml']?.byteLength,
    'DOCX 未包含可编辑的 Flow 正文 XML')

  const browser = await chromium.launch({ executablePath: systemEdgePath(), headless: true })
  const visualEvidence: Array<{ format: string; locationCount: number; loadedImageCount: number }> = []
  try {
    for (const [format, filename] of [
      ['offline-html', destinations.offline],
      ['online-html', destinations.online],
      ['web-package', path.join(webRoot, 'index.html')],
    ] as const) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
      const errors: string[] = []
      const externalRequests: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (/^(?:https?|wss?):/i.test(request.url())) externalRequests.push(request.url())
      })
      try {
        await page.goto(pathToFileURL(filename).href, { waitUntil: 'load', timeout: 45_000 })
        await page.waitForFunction(() => Boolean(window.__H5_LESSON_PLAYER__))
        let loadedImageCount = 0
        for (let index = 0; index < mixed.project.locations.length; index += 1) {
          assert(await page.evaluate((target) =>
            window.__H5_LESSON_PLAYER__?.goToScene(target), index),
          `${format} 无法切到第 ${index + 1} 个位置`)
          await page.waitForFunction((target) =>
            window.__H5_LESSON_PLAYER__?.getCurrentSceneIndex() === target, index)
          assert(await page.locator('#course-root').count() === 1 &&
            await page.locator('.course-player-error').count() === 0,
          `${format} 第 ${index + 1} 个位置未正常显示`)
          loadedImageCount += await page.evaluate(() => [...document.images]
            .filter((image) => image.complete && image.naturalWidth > 0).length)
          await page.screenshot({ path: path.join(directory, `${format}-${index + 1}.png`) })
        }
        assert(errors.length === 0 && externalRequests.length === 0,
          `${format} 独立打开出现错误或外部请求：${[...errors, ...externalRequests].join('; ')}`)
        assert(loadedImageCount > 0, `${format} 未加载任何真实图片素材`)
        visualEvidence.push({ format, locationCount: mixed.project.locations.length,
          loadedImageCount })
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({
    package: unpackedExecutable,
    source: exportReadyProject,
    derivedFrom: packagedMixedProject,
    fixtureAdjustment: 'mixed-global-banner absolute frame widened from 480×44 to 720×80 to pass real text-overflow export preflight',
    originalFixturePreflight: 'The unmodified architecture fixture was rejected by the packaged GUI: text-content-overflow error and project-health:text-capacity-overflow warning for mixed-global-banner.',
    formats: destinations,
    surfaces: mixed.project.surfaces.map((surface) => surface.type),
    locations: mixed.project.locations.length,
    assets: assetFiles.length,
    pptxSlides: slideEntries.length,
    formatLimits: {
      pptx: 'PPTX maps the Slide page and two Spatial camera frames; Spatial frames are static snapshots, Flow is intentionally skipped and exported separately as DOCX.',
      docx: 'DOCX exports the Flow surface only.',
      onlineHtml: 'This fixture has no remote asset URLs, so online-lightweight remote retention is not exercised.',
    },
    visualEvidence,
    limitation: 'PDF/PPTX/DOCX signatures and package XML checked; third-party document readers remain a separate check.',
  }, null, 2))
  pass('三表面正式包导出',
    `六种可见导出入口生成文件；三种网页交付独立离线打开并遍历 ${mixed.project.locations.length} 个位置；证据 ${directory}`)
  return directory
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

    await assertPublishedControllerFrame(page, controllerTarget)
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

async function verifyM13Package(): Promise<void> {
  await fs.mkdir(verificationDirectory, { recursive: true })
  await fs.mkdir(path.dirname(focusedM13ReportPath), { recursive: true })
  console.log('开始验证 M13 正式包与三表面导出…')
  assert(APP_VERSION === packageJson.version, '正式包源码版本不一致')
  const [portableArtifact, unpackedArtifact, appAsarArtifact] = await Promise.all([
    assertWindowsExecutable(portableExecutable, 'Portable.exe', packageJson.version),
    assertWindowsExecutable(unpackedExecutable, 'win-unpacked exe', packageJson.version),
    assertAppAsar(unpackedAppAsar, packageJson.name, packageJson.version),
  ])
  await verifyPackagedRuntimeResources()
  await verifyPortableStartup()
  await verifyUnpackedWorkflows()
  const mixedExportEvidence = await verifyMixedSurfacePackagedExports()
  await fs.writeFile(focusedM13ReportPath, `${JSON.stringify({
    verifiedAt: new Date().toISOString(),
    status: 'passed',
    checks,
    boundary: 'M13 checks packaged file paths and app runtime resources. The broad releaseArtifactBoundary scan is a separate release gate and is not counted here.',
    artifacts: { portableArtifact, unpackedArtifact, appAsarArtifact, mixedExportEvidence },
  }, null, 2)}\n`, 'utf8')
  console.log(`M13 正式包验证通过，共 ${checks.length} 项；报告：${focusedM13ReportPath}`)
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
  await verifyPackagedRuntimeResources()
  pass(
    '发布产物版本一致性',
    `Portable.exe、win-unpacked exe 与 app.asar 均来自 ${packageJson.name}@${packageJson.version}`,
  )
  const requiredFiles = [
    path.join(projectRoot, 'README.md'),
    path.join(projectRoot, 'docs', 'README.md'),
    path.join(projectRoot, 'docs', 'USER_GUIDE.md'),
    path.join(projectRoot, 'docs', 'COMPONENT_AUTHORING.md'),
    path.join(projectRoot, 'docs', 'RUNTIME_AUTHORING.md'),
    path.join(projectRoot, '.agents', 'skills', 'orchestrate-courseware', 'SKILL.md'),
    path.join(projectRoot, '.agents', 'skills', 'build-courseware-project', 'SKILL.md'),
    path.join(renderHostBenchmarkDirectory, 'README.md'),
    renderHostBenchmarkNotices,
    path.join(projectRoot, 'package-lock.json'),
  ]
  for (const requiredFile of requiredFiles) {
    const stats = await fs.stat(requiredFile)
    assert(stats.isFile() && stats.size > 0, `必需文件无效：${requiredFile}`)
  }
  pass(
    '发布配套文件',
    'README、AI 编排/构建 Skills、自由运行时/组件指南、V9/V2 渲染基准及 package-lock.json 均存在',
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

  const [benchmarkBytes, publishedBenchmarkJson, benchmarkHtml, benchmarkNotices] =
    await Promise.all([
      fs.readFile(renderHostBenchmarkProject),
      fs.readFile(renderHostBenchmarkPublished, 'utf8'),
      fs.readFile(renderHostBenchmarkHtml, 'utf8'),
      fs.readFile(renderHostBenchmarkNotices, 'utf8'),
    ])
  const benchmarkProject = openCourseProjectArchive(Uint8Array.from(benchmarkBytes))
  const publishedBenchmark = publishedCourseV2Schema.parse(
    JSON.parse(publishedBenchmarkJson) as unknown,
  )
  const expectedBenchmarkLocationIds = [
    'scene_native_nodes_v9',
    'scene_runtime_phaser_v9',
    'scene_runtime_three_v9',
    'scene_component_v4_dom_v9',
    'scene_component_v4_phaser_v9',
  ]
  assert(
    benchmarkProject.project.schemaVersion === 9 &&
      benchmarkProject.project.locations.map(({ id }) => id).join('\n') ===
        expectedBenchmarkLocationIds.join('\n'),
    '渲染宿主基准必须是五页 Course Project V9 工程',
  )
  assert(
    benchmarkProject.project.globalLayerItems.filter(
      ({ item, visibility }) => isControllerFixture(item) &&
        item.visible && visibility.mode === 'all',
    ).length === 1,
    '渲染宿主 V9 基准必须只有一个全局教师控制器入口',
  )
  sampleControllerTarget(benchmarkProject.project)
  const benchmarkSlide = benchmarkProject.project.surfaces[0]
  assert(
    benchmarkSlide?.type === 'slide' && benchmarkSlide.scenes.length === 5,
    '渲染宿主 V9 基准必须包含单一五场景 Slide surface',
  )
  const benchmarkLayerItems = benchmarkSlide.scenes.flatMap(({ layerItems }) => layerItems)
  assert(
    benchmarkLayerItems.some((item) => item.kind === 'native') &&
      benchmarkLayerItems.filter((item) => item.kind === 'component').length === 2,
    '渲染宿主 V9 基准缺少 Native 或双 Component 路径',
  )
  const benchmarkRuntimeModes = benchmarkLayerItems.flatMap((item) =>
    item.kind === 'runtime'
      ? [`${item.runtime.runtimeApiVersion}:${item.runtime.renderMode}`]
      : [],
  )
  assert(
    benchmarkRuntimeModes.join('\n') === ['2:phaser', '2:dom'].join('\n'),
    '渲染宿主 V9 基准缺少 API 2 Phaser / Three-DOM 运行时路径',
  )
  const embeddedBenchmarkComponents = Object.values(
    benchmarkProject.project.componentPackages,
  ).map((metadata) => {
    const key = `${metadata.packageId}@${metadata.version}`
    const files = benchmarkProject.componentFiles[key]
    assert(files, `渲染宿主 V9 基准缺少内嵌组件包 ${key}`)
    return parseComponentPackageFiles(files, {
      expectedId: metadata.packageId,
      expectedVersion: metadata.version,
    })
  })
  assert(
    embeddedBenchmarkComponents.length === 2 &&
      embeddedBenchmarkComponents.every(({ manifest }) => manifest.schemaVersion === 4) &&
      embeddedBenchmarkComponents.map(({ manifest }) => manifest.renderMode)
        .sort().join('\n') === ['dom', 'phaser'].join('\n'),
    '渲染宿主 V9 基准缺少内嵌 Component API 4 DOM / Phaser 包',
  )
  assert(
    publishedBenchmark.formatVersion === 2 &&
      publishedBenchmark.sourceSchemaVersion === 9 &&
      publishedBenchmark.courseId === benchmarkProject.project.id &&
      publishedBenchmark.locations.map(({ id }) => id).join('\n') ===
        expectedBenchmarkLocationIds.join('\n'),
    '渲染宿主 Published Course V2 与 V9 五页工程不一致',
  )
  const publishedSlide = publishedBenchmark.surfaces[0]
  assert(
    publishedSlide?.type === 'slide' && publishedSlide.scenes.length === 5,
    '渲染宿主 Published Course V2 缺少五场景 Slide surface',
  )
  const publishedLayerItems = publishedSlide.scenes.flatMap(({ layerItems }) => layerItems)
  const publishedRuntimeModes = publishedLayerItems.flatMap((item) =>
    item.kind === 'runtime'
      ? [`${item.runtime.runtimeApiVersion}:${item.runtime.renderMode}`]
      : [],
  )
  assert(
    publishedLayerItems.some((item) => item.kind === 'native') &&
      publishedRuntimeModes.join('\n') === ['2:phaser', '2:dom'].join('\n') &&
      publishedLayerItems.filter((item) => item.kind === 'component').length === 2,
    '渲染宿主 Published Course V2 未保留 Native、双 Runtime 与双 Component 五路径',
  )
  assert(
    Object.values(publishedBenchmark.components).map(({ renderMode }) => renderMode)
      .sort().join('\n') === ['dom', 'phaser'].join('\n'),
    '渲染宿主 Published Course V2 缺少 Component API 4 DOM / Phaser 包',
  )
  assert(
    publishedBenchmark.globalLayerItems.filter(
      ({ item, visibility }) => isControllerFixture(item) &&
        item.visible && visibility.mode === 'all',
    ).length === 1,
    '渲染宿主 Published Course V2 缺少唯一全局教师控制器入口',
  )
  assert(
    benchmarkHtml.includes('window.__H5_COURSE_PAYLOAD__=') &&
      !benchmarkHtml.includes('window.__H5_LESSON_PAYLOAD__=') &&
      benchmarkHtml.includes('connect-src data: blob:') &&
      !/connect-src[^;]*(?:https?:|\*|'self')/i.test(benchmarkHtml) &&
      !/<script[^>]+src=/i.test(benchmarkHtml),
    '渲染宿主 Published Course V2 单 HTML 不是自包含离线成品',
  )
  assert(
    benchmarkNotices.includes('## Three.js ') &&
      benchmarkNotices.includes('render-host-benchmark-v2.html') &&
      benchmarkNotices.includes('The MIT License'),
    '渲染宿主 V9/V2 第三方声明缺少 Three.js 来源或许可证',
  )
  pass(
    '渲染宿主基准',
    'Course Project V9、Published Course V2、Runtime API 2 Phaser/Three 与 Component API 4 DOM/Phaser 均通过正式解析器',
  )

  await verifyReleaseArtifactBoundary(
    '发布物数据边界',
    releaseArtifactBoundaryTargetPaths(projectRoot),
  )

  /**
   * 打包产物数据边界：`win-unpacked/resources/**`。
   *
   * app.asar 走逐条目扫描（`getRawHeader` 枚举 → 按 offset/size 取内容 → 同一套
   * 规则），目录里其余文件走字节扫描。头部损坏、条目越界、unpacked 条目读不出来
   * 都会抛错，不会静默当成干净。
   *
   * portable 单文件刻意不在本步内：electron-builder 的 portable 目标用 NSIS +
   * `SetCompressor zlib` 打包（`app-builder-lib/out/targets/nsis/NsisTarget.js:267`），
   * 应用负载在 exe 里是压缩态，对它的原始字节做文本扫描只能看到自解压外壳，
   * 报「0 命中」等于把没看过的负载判成干净。它由同一份构建产出的
   * `win-unpacked/resources/app.asar` 条目扫描承担。
   */
  assert(
    unpackedAppAsar.startsWith(`${unpackedResourcesDirectory}${path.sep}`),
    `app.asar 必须位于 ${unpackedResourcesDirectory} 之内，否则打包产物边界扫不到它`,
  )
  await verifyReleaseArtifactBoundary('打包产物数据边界', [
    unpackedResourcesDirectory,
  ])

  await verifyPortableStartup()
  await verifyUnpackedWorkflows()
  const mixedExportEvidence = await verifyMixedSurfacePackagedExports()
  await verifyOfflineHtml(controllerTarget)

  await verifyReleaseArtifactBoundary('导出 HTML 数据边界', [exportedHtml])

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
          renderHostBenchmarkProject,
          renderHostBenchmarkPublished,
          renderHostBenchmarkHtml,
          renderHostBenchmarkNotices,
          exportedHtml,
          exportedPdf,
          exportedPptx,
          mixedExportEvidence,
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

;(focusedM13 ? verifyM13Package() : focusedM13Exports
  ? verifyMixedSurfacePackagedExports().then(async (evidence) => {
    await fs.writeFile(focusedM13ExportsReportPath, `${JSON.stringify({ status: 'passed', evidence }, null, 2)}\n`)
  }) : main()).catch(async (error: unknown) => {
  const failureReportPath = focusedM13 ? focusedM13ReportPath : focusedM13Exports
    ? focusedM13ExportsReportPath : reportPath
  await fs.mkdir(verificationDirectory, { recursive: true }).catch(() => undefined)
  await fs.mkdir(path.dirname(failureReportPath), { recursive: true }).catch(() => undefined)
  await fs
    .writeFile(
      failureReportPath,
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
