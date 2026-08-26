import { _electron as electron, chromium } from '@playwright/test'
import { assertElectronCanLaunchAsApp } from './electronLaunchEnvironment'
import { strToU8, zipSync } from 'fflate'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Browser, ElectronApplication, Page } from 'playwright'
import packageJson from '../package.json'
// Teaches the export builders where this host's font bytes are. Without it the
// portability run would check an export the product never ships.
import '../src/renderer/export/bundledFontEmbedSourceNode'
import {
  importComponentPackage,
  parseComponentPackageFiles,
} from '../src/renderer/components/importComponentPackage'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackage,
  buildPublishedCourseWebPackageFiles,
} from '../src/renderer/export/course/buildCoursePackages'
import {
  addSlideComponentLayer,
  readSlideComponentLayer,
} from '../src/renderer/course/v9SlideContentCommands'
import {
  openSlideAuthoringSession,
  type SlideAuthoringSession,
} from '../src/renderer/course/slideAuthoringBackend'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
  type CourseProjectArchiveData,
} from '../src/renderer/project/courseProjectArchive'
import { createBlankCourseProject } from '../src/renderer/project/createCourseProject'
import type { ComponentPackageData, ComponentManifest } from '../src/shared/componentTypes'
import { courseProjectDocumentSchema } from '../src/shared/courseProjectSchema'
import { BACKGROUND_E2E_ENV } from '../src/main/windowVisibility'
import {
  APP_EXECUTABLE_NAME,
  APP_PRODUCT_NAME,
  APP_VERSION,
} from '../src/shared/constants'
import { collectFileArtifactEvidence } from './releaseArtifactEvidence'
import {
  assertEquivalentDirectoryEvidence,
  assertNoForbiddenPathReferences,
  collectDirectoryEvidence,
  summarizeDirectoryEvidence,
} from './windowsPortabilityEvidence'

interface VerificationCheck {
  name: string
  detail: string
  passed: true
}

interface OfflineResult {
  label: string
  screenshotPath: string
  screenshotSha256: string
  externalRequests: string[]
}

interface MovedApplicationIdentity {
  appPath: string
  execPath: string
  cwd: string
  userData: string
  configuredComponentDirectory: string
}

const execFileAsync = promisify(execFile)
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const releaseDirectory = path.join(projectRoot, 'release')
const sourceUnpackedDirectory = path.join(releaseDirectory, 'win-unpacked')
const sourceUnpackedExecutable = path.join(
  sourceUnpackedDirectory,
  `${APP_EXECUTABLE_NAME}.exe`,
)
const sourcePortableExecutable = path.join(
  releaseDirectory,
  `${APP_EXECUTABLE_NAME}-portable-${packageJson.version}.exe`,
)
const playerBundlePath = path.join(projectRoot, 'dist-player', 'player.iife.js')
const evidenceDirectory = path.join(
  releaseDirectory,
  'verification',
  'w3-portability',
)
const reportPath = path.join(evidenceDirectory, 'report.json')
const reproducibleTimestamp = new Date('2026-08-13T00:00:00.000Z')
const checks: VerificationCheck[] = []
const portabilityComponentId = 'com.ittoedu.w3-portability-phaser-counter'
const portabilityComponentItemId = 'component_w3_phaser_counter'
const movedDeliveryDirectoryName = 'moved delivery 空格与中文'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function pass(name: string, detail: string): void {
  checks.push({ name, detail, passed: true })
  console.log(`✓ ${name}：${detail}`)
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function assertTemporaryPath(
  isolatedRoot: string,
  candidate: string,
  description: string,
): void {
  assert(
    isWithin(isolatedRoot, candidate) && path.resolve(candidate) !== path.resolve(isolatedRoot),
    `${description} 不在 W3 临时隔离目录内：${candidate}`,
  )
}

function assertMovedDeliveryPath(
  isolatedRoot: string,
  deliveryDirectory: string,
  candidate: string,
  description: string,
): void {
  assertTemporaryPath(isolatedRoot, candidate, description)
  const relativeToIsolatedRoot = path.relative(isolatedRoot, candidate)
  assert(
    isWithin(deliveryDirectory, candidate),
    `${description} 未落在带空格和 Unicode 的移动交付目录：${candidate}`,
  )
  assert(
    relativeToIsolatedRoot === movedDeliveryDirectoryName ||
      relativeToIsolatedRoot.startsWith(`${movedDeliveryDirectoryName}${path.sep}`),
    `${description} 的实际相对路径未以移动交付目录开头：${relativeToIsolatedRoot}`,
  )
  assert(
    movedDeliveryDirectoryName.includes(' ') && /[^\x00-\x7F]/.test(movedDeliveryDirectoryName),
    '移动交付目录名称必须同时包含空格与 Unicode 字符',
  )
}

function assertEvidencePath(candidate: string, description: string): void {
  assert(
    isWithin(evidenceDirectory, candidate) && path.resolve(candidate) !== path.resolve(evidenceDirectory),
    `${description} 未落在 W3 持久 evidence 目录内：${candidate}`,
  )
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase()
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

async function writeWebPackageDirectory(
  directory: string,
  files: Readonly<Record<string, Uint8Array>>,
): Promise<void> {
  for (const [relativePath, bytes] of Object.entries(files)) {
    const destination = path.resolve(directory, ...relativePath.split('/'))
    assert(
      isWithin(directory, destination),
      `网页包试图写出隔离目录：${relativePath}`,
    )
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, bytes)
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
  if (!match) throw new Error('未找到 Microsoft Edge，无法验证 file:// 离线交付物')
  return match
}

async function verifyOfflinePage(
  browser: Browser,
  filePath: string,
  label: string,
  screenshotPath: string,
): Promise<OfflineResult> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const externalRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    if (/^(?:https?|wss?):/i.test(request.url())) externalRequests.push(request.url())
  })

  try {
    await page.goto(pathToFileURL(filePath).href, {
      waitUntil: 'load',
      timeout: 45_000,
    })
    await page.waitForFunction(() => Boolean(window.__H5_LESSON_PLAYER__), undefined, {
      timeout: 45_000,
    })
    const canvas = page.locator(
      `[data-published-phaser-component="${portabilityComponentItemId}"]`,
    )
    await canvas.waitFor({ timeout: 45_000 })
    const bounds = await canvas.boundingBox()
    assert(bounds, `${label} 未渲染 Player 画布`)

    const before = await canvas.screenshot()
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.waitForTimeout(300)
    const after = await canvas.screenshot()
    assert(
      Buffer.compare(before, after) !== 0,
      `${label} 中嵌入组件未响应点击`,
    )
    await page.screenshot({ path: screenshotPath, fullPage: true })
    assert(pageErrors.length === 0, `${label} page errors：${pageErrors.join('；')}`)
    assert(
      consoleErrors.length === 0,
      `${label} console errors：${consoleErrors.join('；')}`,
    )
    assert(
      externalRequests.length === 0,
      `${label} 产生外部网络请求：${externalRequests.join('；')}`,
    )
    const resources = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => entry.name),
    )
    assert(
      resources.every((resource) => !/^(?:https?|wss?):/i.test(resource)),
      `${label} 性能记录中包含外部资源：${resources.join('；')}`,
    )
    const screenshot = await collectFileArtifactEvidence(screenshotPath)
    return {
      label,
      screenshotPath,
      screenshotSha256: screenshot.sha256,
      externalRequests,
    }
  } finally {
    await page.close().catch(() => undefined)
  }
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
}

async function verifyMovedUnpackedApplication(
  isolatedRoot: string,
  movedProjectPath: string,
): Promise<{
  identity: MovedApplicationIdentity
  directory: ReturnType<typeof summarizeDirectoryEvidence>
  screenshotPath: string
  screenshotSha256: string
}> {
  const movedApplicationDirectory = path.join(isolatedRoot, 'moved-editor')
  const movedExecutable = path.join(
    movedApplicationDirectory,
    `${APP_EXECUTABLE_NAME}.exe`,
  )
  const profileDirectory = path.join(isolatedRoot, 'moved-editor-profile')
  const missingComponentDirectory = path.join(
    isolatedRoot,
    'deliberately-missing-component-library',
  )

  const sourceEvidence = await collectDirectoryEvidence(sourceUnpackedDirectory)
  await fs.cp(sourceUnpackedDirectory, movedApplicationDirectory, {
    recursive: true,
    force: false,
    errorOnExist: true,
  })
  const movedEvidence = await collectDirectoryEvidence(movedApplicationDirectory)
  assertEquivalentDirectoryEvidence(sourceEvidence, movedEvidence)
  const directory = summarizeDirectoryEvidence(movedEvidence)
  pass(
    '目录版逐字节复制',
    `${directory.fileCount} 个文件、${directory.totalBytes} 字节，目录清单 SHA-256 ${directory.manifestSha256}`,
  )

  await fs.mkdir(profileDirectory, { recursive: true })
  assertElectronCanLaunchAsApp()
  const application = await electron.launch({
    executablePath: movedExecutable,
    cwd: isolatedRoot,
    args: [`--user-data-dir=${profileDirectory}`],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      COURSEWARE_COMPONENTS_DIR: missingComponentDirectory,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      [BACKGROUND_E2E_ENV]: '1',
    },
    timeout: 60_000,
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
      if (/^(?:https?|wss?):/i.test(request.url())) externalRequests.push(request.url())
    })
    await page.locator('[data-testid="canvas-stage"] canvas').waitFor({
      timeout: 45_000,
    })

    const identity = await application.evaluate(({ app }) => ({
      appPath: app.getAppPath(),
      execPath: process.execPath,
      cwd: process.cwd(),
      userData: app.getPath('userData'),
      configuredComponentDirectory:
        process.env.COURSEWARE_COMPONENTS_DIR ?? '',
    }))
    assert(
      isWithin(movedApplicationDirectory, identity.appPath),
      `目录版仍从原仓库加载 appPath：${identity.appPath}`,
    )
    assert(
      path.resolve(identity.execPath) === path.resolve(movedExecutable),
      `目录版实际 execPath 不是复制后的 exe：${identity.execPath}`,
    )
    assert(
      path.resolve(identity.cwd) === path.resolve(isolatedRoot),
      `目录版继承了非隔离 cwd：${identity.cwd}`,
    )
    assert(
      isWithin(isolatedRoot, identity.userData),
      `目录版复用了当前用户数据目录：${identity.userData}`,
    )
    assert(
      path.resolve(identity.configuredComponentDirectory) ===
        path.resolve(missingComponentDirectory) &&
        !existsSync(missingComponentDirectory),
      '目录版未被指向明确不存在的组件目录',
    )

    await application.evaluate(
      ({ dialog }, projectPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [projectPath],
        })
      },
      movedProjectPath,
    )
    await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    await page
      .getByRole('button', { name: '重命名课件' })
      .filter({ hasText: 'W3 可移植性隔离课件（移动后重存）' })
      .waitFor({ timeout: 30_000 })
    assert(
      await page.locator('[data-testid^="scene-item-"]').count() === 1,
      '移动工程在复制后的目录版中场景数量错误',
    )
    await page.getByRole('button', { name: '专业' }).click()
    await page.getByRole('tab', { name: '组件', exact: true }).click()
    await page
      .getByTestId(`component-${portabilityComponentId}`)
      .waitFor({ timeout: 20_000 })

    assert(pageErrors.length === 0, pageErrors.join('；'))
    assert(consoleErrors.length === 0, consoleErrors.join('；'))
    assert(
      externalRequests.length === 0,
      `复制后的目录版产生外部网络请求：${externalRequests.join('；')}`,
    )
    const screenshotPath = path.join(
      evidenceDirectory,
      'moved-unpacked-opened-project.png',
    )
    await page.screenshot({ path: screenshotPath, fullPage: true })
    const screenshot = await collectFileArtifactEvidence(screenshotPath)
    pass(
      '隔离目录版启动并打开移动工程',
      `execPath/appPath/cwd/userData 均位于隔离树；外部组件目录不存在；工程内嵌组件可见；网络请求 0`,
    )
    return {
      identity,
      directory,
      screenshotPath,
      screenshotSha256: screenshot.sha256,
    }
  } finally {
    await closeElectronApplication(application)
  }
}

async function availableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法分配 Portable 验证端口'))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}

async function connectPortableBrowser(
  port: number,
  childExited: () => boolean,
  stderr: () => string,
): Promise<Browser> {
  const deadline = Date.now() + 60_000
  let lastError: unknown
  while (Date.now() < deadline) {
    if (childExited()) {
      throw new Error(`复制后的 Portable 在连接前退出：${stderr()}`)
    }
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 1_000,
      })
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`复制后的 Portable CDP 连接超时：${String(lastError)}`)
}

async function findEditorPage(browser: Browser): Promise<Page> {
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
  throw new Error('复制后的 Portable 已启动，但编辑器画布未加载')
}

async function verifyMovedPortableApplication(
  isolatedRoot: string,
): Promise<{
  sourceSha256: string
  movedSha256: string
  movedPath: string
}> {
  const portableDirectory = path.join(isolatedRoot, 'moved-portable')
  const movedPortableExecutable = path.join(
    portableDirectory,
    path.basename(sourcePortableExecutable),
  )
  const profileDirectory = path.join(isolatedRoot, 'moved-portable-profile')
  await fs.mkdir(portableDirectory, { recursive: true })
  await fs.mkdir(profileDirectory, { recursive: true })
  await fs.copyFile(sourcePortableExecutable, movedPortableExecutable)
  const [sourceArtifact, movedArtifact] = await Promise.all([
    collectFileArtifactEvidence(sourcePortableExecutable),
    collectFileArtifactEvidence(movedPortableExecutable),
  ])
  assert(
    sourceArtifact.sizeBytes === movedArtifact.sizeBytes &&
      sourceArtifact.sha256 === movedArtifact.sha256,
    'Portable.exe 复制后字节或 SHA-256 改变',
  )

  const port = await availableLoopbackPort()
  let stderr = ''
  const child = spawn(
    movedPortableExecutable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDirectory}`,
    ],
    {
      cwd: portableDirectory,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: '',
        COURSEWARE_COMPONENTS_DIR: path.join(isolatedRoot, 'missing-portable-components'),
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
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
    const page = await findEditorPage(browser)
    const security = await page.evaluate(() => {
      const globals = window as unknown as Record<string, unknown>
      return {
        url: window.location.href,
        desktopApiFrozen:
          typeof globals.desktopAPI === 'object' &&
          Object.isFrozen(globals.desktopAPI),
        hasRequire: typeof globals.require !== 'undefined',
        hasProcess: typeof globals.process !== 'undefined',
        externalResources: performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((url) => /^(?:https?|wss?):/i.test(url)),
      }
    })
    assert(
      security.url === 'courseware-editor://app/index.html',
      `Portable 主页 URL 错误：${security.url}`,
    )
    assert(security.desktopApiFrozen, 'Portable preload API 未冻结')
    assert(!security.hasRequire && !security.hasProcess, 'Portable 渲染器暴露 Node 全局')
    assert(
      security.externalResources.length === 0,
      `Portable 启动加载外部资源：${security.externalResources.join('；')}`,
    )
    pass(
      '复制后的 Portable.exe 启动',
      `${(movedArtifact.sizeBytes / 1024 / 1024).toFixed(1)} MB，SHA-256 ${movedArtifact.sha256}，隔离 cwd/profile，外部资源 0`,
    )
    return {
      sourceSha256: sourceArtifact.sha256,
      movedSha256: movedArtifact.sha256,
      movedPath: movedPortableExecutable,
    }
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
  }
}

async function verifyDocumentationContract(): Promise<void> {
  const [readme, guide, launcher, lockfile] = await Promise.all([
    fs.readFile(path.join(projectRoot, 'README.md'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'docs', 'USER_GUIDE.md'), 'utf8'),
    fs.readFile(path.join(projectRoot, '启动课件编辑器.cmd'), 'utf8'),
    fs.readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'),
  ])
  assert(
    guide.includes('Windows 10/11 x64') &&
      guide.includes('Node.js LTS') &&
      guide.includes('启动课件编辑器.cmd') &&
      guide.includes('npm ci') &&
      guide.includes('npm start'),
    '用户指南未完整声明 Windows 源码启动前提与命令',
  )
  assert(
    readme.includes('启动课件编辑器.cmd') &&
      readme.includes('npm start') &&
      readme.includes('npm run build:desktop'),
    'README 的源码启动入口与命令不完整',
  )
  assert(
    /call npm\.cmd ci/i.test(launcher) &&
      /call npm\.cmd run build:desktop/i.test(launcher) &&
      /node_modules\\electron\\dist\\electron\.exe/i.test(launcher),
    '双击入口未按文档执行锁定依赖、生产构建和 Electron 启动',
  )
  assert(
    packageJson.scripts.start ===
      'npm run build:desktop && cross-env VITE_DEV_SERVER_URL= electron .' &&
      packageJson.scripts['build:desktop'] ===
        'npm run build:player && npm run build:renderer && npm run build:electron',
    'package.json 的 npm start/build:desktop 与文档不一致',
  )
  const parsedLockfile = JSON.parse(lockfile) as { lockfileVersion?: number }
  assert(
    typeof parsedLockfile.lockfileVersion === 'number',
    'package-lock.json 缺少 lockfileVersion',
  )
  pass(
    '文档与启动入口静态一致性',
    'README/用户指南、CMD、package scripts 与 package-lock 的 Windows 源码启动合同一致',
  )
}

async function buildAndVerifyMovedLesson(
  isolatedRoot: string,
): Promise<{
  projectPathForApplication: string
  projectArtifact: Awaited<ReturnType<typeof collectFileArtifactEvidence>>
  htmlArtifact: Awaited<ReturnType<typeof collectFileArtifactEvidence>>
  webPackageArtifact: Awaited<ReturnType<typeof collectFileArtifactEvidence>>
  webPackageDirectory: ReturnType<typeof summarizeDirectoryEvidence>
  offline: OfflineResult[]
}> {
  const externalSourceDirectory = path.join(
    isolatedRoot,
    'external-component-library-to-disconnect',
  )
  const authoringDirectory = path.join(isolatedRoot, 'authoring-origin')
  const deliveryDirectory = path.join(isolatedRoot, movedDeliveryDirectoryName)
  const movedWebDirectory = path.join(deliveryDirectory, 'web-package')
  for (const [candidate, description] of [
    [externalSourceDirectory, '临时组件源目录'],
    [authoringDirectory, '临时作者目录'],
    [deliveryDirectory, '临时交付目录'],
    [movedWebDirectory, '临时网页包目录'],
  ] as const) {
    assertTemporaryPath(isolatedRoot, candidate, description)
  }
  assertMovedDeliveryPath(
    isolatedRoot,
    deliveryDirectory,
    deliveryDirectory,
    '移动交付根目录',
  )
  await Promise.all([
    fs.mkdir(externalSourceDirectory, { recursive: true }),
    fs.mkdir(authoringDirectory, { recursive: true }),
    fs.mkdir(deliveryDirectory, { recursive: true }),
  ])

  const externalComponentPath = path.join(
    externalSourceDirectory,
    'only-source-w3-phaser-counter.h5component',
  )
  assertTemporaryPath(isolatedRoot, externalComponentPath, '临时外部组件源')
  const componentManifest: ComponentManifest = {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    id: portabilityComponentId,
    name: 'W3 Phaser 移植计数器',
    version: '1.0.0',
    entry: 'runtime.js',
    defaultSize: { width: 360, height: 210 },
    minSize: { width: 120, height: 80 },
    preserveAspectRatio: false,
    supportedScopes: ['scene'],
    renderMode: 'phaser',
    assets: {},
    defaultProps: { label: '移动后计数' },
  }
  const componentRuntime = `
window.CoursewareComponent.define({
  id: '${portabilityComponentId}',
  runtimeApiVersion: 4,
  create(ctx) {
    let count = 0
    const panel = ctx.phaser.scene.add.rectangle(0, 0, ctx.width, ctx.height, 0x0f766e, 1)
      .setOrigin(0, 0).setInteractive()
    const label = ctx.phaser.scene.add.text(28, 82, String(ctx.props.label) + ': ' + count, {
      fontFamily: 'Arial', fontSize: '30px', color: '#ffffff'
    })
    const onHit = () => {
      count += 1
      label.setText(String(ctx.props.label) + ': ' + count)
    }
    panel.on('pointerup', onHit)
    ctx.phaser.root.add([panel, label])
    return {
      resize(width, height) { panel.setSize(width, height) },
      updateProps(props) { label.setText(String(props.label) + ': ' + count) },
      destroy() { panel.off('pointerup', onHit) },
    }
  },
})
`
  const externalComponentBytes = zipSync({
    'manifest.json': strToU8(JSON.stringify(componentManifest)),
    'runtime.js': strToU8(componentRuntime),
  })
  await fs.writeFile(externalComponentPath, externalComponentBytes)
  const componentBytes = Uint8Array.from(await fs.readFile(externalComponentPath))
  const packageSha256 = sha256Bytes(componentBytes).toLocaleLowerCase('en-US')
  const imported = importComponentPackage(componentBytes, {
    provenance: {
      sha256: packageSha256,
      importedAt: reproducibleTimestamp.toISOString(),
      sourceLabel: 'W3 临时外部组件源（删除后验证）',
    },
  })

  let project = createBlankCourseProject({
    id: 'project_w3_windows_portability',
    title: 'W3 可移植性隔离课件',
    now: reproducibleTimestamp,
    includeDefaultController: false,
    controls: 'none',
    idFactory: (() => {
      let sequence = 0
      return () => `w3_${String(++sequence).padStart(3, '0')}`
    })(),
  })
  project = structuredClone(project)
  project.componentPackages[imported.manifest.id] = structuredClone(imported.metadata)
  project = courseProjectDocumentSchema.parse(project)
  const session = openSlideAuthoringSession(project)
  const authored = addSlideComponentLayer(session, {
    packageId: imported.manifest.id,
    manifest: imported.manifest,
    id: portabilityComponentItemId,
    x: 460,
    y: 255,
    width: imported.manifest.defaultSize.width,
    height: imported.manifest.defaultSize.height,
    props: { label: '移动后计数' },
  }, { now: reproducibleTimestamp.toISOString() })
  assert(
    authored.ok && authored.nextSession !== undefined,
    `Slide component authoring command failed: ${authored.reason ?? 'unknown'}`,
  )
  const authoredSession: SlideAuthoringSession = authored.nextSession
  const authoredLayer = readSlideComponentLayer(authoredSession, portabilityComponentItemId)
  assert(
    authoredLayer.component.packageId === imported.manifest.id &&
      authoredLayer.component.version === imported.manifest.version,
    'Slide component authoring command did not retain the imported V9 package identity',
  )
  project = authoredSession.history.present

  const sourceProjectPath = path.join(authoringDirectory, 'source-project.h5lesson')
  assertTemporaryPath(isolatedRoot, sourceProjectPath, '待移动的 V9 工程')
  const initialArchive = createCourseProjectArchive(
    {
      project,
      assetFiles: {},
      componentFiles: { [imported.key]: imported.files },
    },
    { mtime: reproducibleTimestamp },
  )
  await fs.writeFile(sourceProjectPath, initialArchive)

  const movedProjectPath = path.join(deliveryDirectory, 'moved-project.h5lesson')
  assertMovedDeliveryPath(
    isolatedRoot,
    deliveryDirectory,
    movedProjectPath,
    '移动后的 V9 工程',
  )
  await fs.rename(sourceProjectPath, movedProjectPath)
  assertTemporaryPath(isolatedRoot, externalSourceDirectory, '待删除的临时组件源目录')
  await fs.rm(externalSourceDirectory, { recursive: true, force: true })
  assert(!existsSync(externalSourceDirectory), '临时外部组件源目录未真正删除')
  assert(!existsSync(sourceProjectPath), '工程仍留在原作者目录，未完成移动')

  const movedArchive = Uint8Array.from(await fs.readFile(movedProjectPath))
  const reopened = openCourseProjectArchive(movedArchive)
  const componentsFromArchive = (
    archive: CourseProjectArchiveData,
  ): Record<string, ComponentPackageData> => Object.fromEntries(
    Object.entries(archive.project.componentPackages).map(([key, metadata]) => {
      const componentKey = `${metadata.packageId}@${metadata.version}`
      const files = archive.componentFiles[componentKey]
      assert(files, `工程归档缺少组件文件：${componentKey}`)
      return [key, parseComponentPackageFiles(files, {
        expectedId: metadata.packageId,
        expectedVersion: metadata.version,
      })]
    }),
  )
  const reopenedComponents = componentsFromArchive(reopened)
  const embedded = reopenedComponents[imported.manifest.id]
  assert(embedded, '删除外部组件源后，工程未恢复内嵌组件')
  assert(
    embedded.contentSha256 === imported.contentSha256 &&
      embedded.runtimeSource === imported.runtimeSource,
    '移动工程中的内嵌组件内容或锁定哈希改变',
  )
  assert(
    Object.keys(reopened.componentFiles[imported.key] ?? {}).length >= 2,
    '移动工程未包含完整组件 manifest/runtime 文件',
  )

  reopened.project.title = 'W3 可移植性隔离课件（移动后重存）'
  reopened.project.updatedAt = '2026-08-13T00:01:00.000Z'
  const resavedArchive = createCourseProjectArchive(reopened, {
    mtime: reproducibleTimestamp,
  })
  await fs.writeFile(movedProjectPath, resavedArchive)
  const finalArchive = openCourseProjectArchive(
    Uint8Array.from(await fs.readFile(movedProjectPath)),
  )
  const finalComponents = componentsFromArchive(finalArchive)
  assert(
    finalArchive.project.title === 'W3 可移植性隔离课件（移动后重存）',
    '移动工程重存后未保留修改',
  )
  assert(finalComponents[imported.manifest.id], '移动工程重存后丢失内嵌组件')
  assertNoForbiddenPathReferences(
    '移动后 Course Project V9',
    JSON.stringify(finalArchive.project),
    [projectRoot, externalSourceDirectory, authoringDirectory],
  )
  for (const component of Object.values(finalComponents)) {
    assertNoForbiddenPathReferences(
      `移动后组件 ${component.manifest.id}`,
      `${JSON.stringify(component.manifest)}\n${component.runtimeSource}`,
      [projectRoot, externalSourceDirectory, authoringDirectory],
    )
  }
  pass(
    '组件断源、工程移动与重存',
    `唯一临时组件源已删除；${imported.key} 由工程归档恢复且 contentSha256 ${imported.contentSha256}`,
  )

  const playerBundle = await fs.readFile(playerBundlePath, 'utf8')
  const sources = {
    project: finalArchive.project,
    assetFiles: finalArchive.assetFiles,
    components: finalComponents,
  }
  const html = buildPublishedCourseStandaloneHtml(sources, playerBundle)
  const htmlPath = path.join(deliveryDirectory, 'moved-offline.html')
  assertMovedDeliveryPath(
    isolatedRoot,
    deliveryDirectory,
    htmlPath,
    '移动后的离线单 HTML',
  )
  await fs.writeFile(htmlPath, html, 'utf8')
  const webFiles = buildPublishedCourseWebPackageFiles(sources, playerBundle)
  await writeWebPackageDirectory(movedWebDirectory, webFiles)
  const webArchive = buildPublishedCourseWebPackage(sources, playerBundle)
  const webArchivePath = path.join(deliveryDirectory, 'moved-web-package.zip')
  assertMovedDeliveryPath(
    isolatedRoot,
    deliveryDirectory,
    movedWebDirectory,
    '移动后的网页包目录',
  )
  assertMovedDeliveryPath(
    isolatedRoot,
    deliveryDirectory,
    webArchivePath,
    '移动后的网页包归档',
  )
  await fs.writeFile(webArchivePath, webArchive)
  pass(
    '带空格与 Unicode 的移动交付路径',
    `V9 工程、离线单 HTML、网页包目录与归档均位于 ${movedDeliveryDirectoryName}`,
  )

  assert(!/https?:\/\//i.test(html), '移动后的单 HTML 含远程 URL')
  assertNoForbiddenPathReferences(
    '移动后的单 HTML',
    html,
    [projectRoot, externalSourceDirectory, authoringDirectory],
  )
  for (const [relativePath, bytes] of Object.entries(webFiles)) {
    if (!/\.(?:html|css|js|json|svg|txt)$/i.test(relativePath)) continue
    assertNoForbiddenPathReferences(
      `移动后的网页包 ${relativePath}`,
      new TextDecoder().decode(bytes),
      [projectRoot, externalSourceDirectory, authoringDirectory],
    )
  }

  const persistentProjectPath = path.join(
    evidenceDirectory,
    'moved-self-contained-v9.h5lesson',
  )
  const persistentHtmlPath = path.join(
    evidenceDirectory,
    'moved-offline-v9.html',
  )
  const persistentWebDirectory = path.join(
    evidenceDirectory,
    'moved-web-package-v9',
  )
  const persistentWebArchivePath = path.join(
    evidenceDirectory,
    'moved-web-package-v9.zip',
  )
  for (const [candidate, description] of [
    [persistentProjectPath, '持久 V9 工程 evidence'],
    [persistentHtmlPath, '持久离线单 HTML evidence'],
    [persistentWebDirectory, '持久网页包目录 evidence'],
    [persistentWebArchivePath, '持久网页包归档 evidence'],
  ] as const) {
    assertEvidencePath(candidate, description)
  }
  for (const [candidate, description] of [
    [movedProjectPath, '待复制的临时 V9 工程'],
    [htmlPath, '待复制的临时离线单 HTML'],
    [movedWebDirectory, '待复制的临时网页包目录'],
    [webArchivePath, '待复制的临时网页包归档'],
  ] as const) {
    assertMovedDeliveryPath(isolatedRoot, deliveryDirectory, candidate, description)
  }
  await Promise.all([
    fs.copyFile(movedProjectPath, persistentProjectPath),
    fs.copyFile(htmlPath, persistentHtmlPath),
    fs.copyFile(webArchivePath, persistentWebArchivePath),
    fs.cp(movedWebDirectory, persistentWebDirectory, {
      recursive: true,
      force: false,
      errorOnExist: true,
    }),
  ])
  assert(
    existsSync(persistentProjectPath) &&
      existsSync(persistentHtmlPath) &&
      existsSync(persistentWebArchivePath) &&
      existsSync(path.join(persistentWebDirectory, 'index.html')),
    '持久 portability evidence 复制后不完整',
  )

  const browser = await chromium.launch({
    executablePath: systemEdgePath(),
    headless: true,
  })
  let offline: OfflineResult[]
  try {
    offline = [
      await verifyOfflinePage(
        browser,
        htmlPath,
        '移动后的单 HTML',
        path.join(evidenceDirectory, 'moved-single-html.png'),
      ),
      await verifyOfflinePage(
        browser,
        path.join(movedWebDirectory, 'index.html'),
        '移动后的网页包',
        path.join(evidenceDirectory, 'moved-web-package.png'),
      ),
    ]
  } finally {
    await browser.close()
  }
  pass(
    '移动交付物 file:// 离线互动',
    '单 HTML 与网页包均在 Edge file:// 打开，内嵌计数器响应点击，页错误/控制台错误/外部请求均为 0',
  )

  const [
    movedProjectArtifact,
    movedHtmlArtifact,
    movedWebPackageArtifact,
    projectArtifact,
    htmlArtifact,
    webPackageArtifact,
    movedWebPackageDirectory,
    persistentWebPackageDirectory,
  ] = await Promise.all([
    collectFileArtifactEvidence(movedProjectPath),
    collectFileArtifactEvidence(htmlPath),
    collectFileArtifactEvidence(webArchivePath),
    collectFileArtifactEvidence(persistentProjectPath),
    collectFileArtifactEvidence(persistentHtmlPath),
    collectFileArtifactEvidence(persistentWebArchivePath),
    collectDirectoryEvidence(movedWebDirectory),
    collectDirectoryEvidence(persistentWebDirectory),
  ])
  assert(
    movedProjectArtifact.sizeBytes === projectArtifact.sizeBytes &&
      movedProjectArtifact.sha256 === projectArtifact.sha256 &&
      movedHtmlArtifact.sizeBytes === htmlArtifact.sizeBytes &&
      movedHtmlArtifact.sha256 === htmlArtifact.sha256 &&
      movedWebPackageArtifact.sizeBytes === webPackageArtifact.sizeBytes &&
      movedWebPackageArtifact.sha256 === webPackageArtifact.sha256,
    '持久 portability evidence 的文件副本与移动交付物不一致',
  )
  assertEquivalentDirectoryEvidence(movedWebPackageDirectory, persistentWebPackageDirectory)
  const webPackageDirectory = summarizeDirectoryEvidence(
    persistentWebPackageDirectory,
  )
  pass(
    '持久 portability evidence',
    `${path.basename(persistentProjectPath)}、${path.basename(persistentHtmlPath)}、${webPackageDirectory.fileCount} 个网页包文件均保存在 release/verification/w3-portability，且与移动交付物逐字节一致`,
  )
  return {
    projectPathForApplication: movedProjectPath,
    projectArtifact,
    htmlArtifact,
    webPackageArtifact,
    webPackageDirectory,
    offline,
  }
}

async function main(): Promise<void> {
  let isolatedRoot = ''
  let failure: string | undefined
  let result: Record<string, unknown> = {}
  try {
    assert(process.platform === 'win32', 'W3 Windows 可移植性验证只能在 Windows 上运行')
    assert(process.arch === 'x64', `W3 目标为 Windows x64，当前为 ${process.arch}`)
    assert(APP_VERSION === packageJson.version, '源码应用版本与 package.json 不一致')
    assert(APP_PRODUCT_NAME === 'ittoedu Courseware Editor', '产品名称不是 ittoedu')
    for (const requiredPath of [
      sourceUnpackedExecutable,
      sourcePortableExecutable,
      playerBundlePath,
    ]) {
      assert(existsSync(requiredPath), `W3 验证缺少前置产物：${requiredPath}`)
    }

    assert(
      isWithin(releaseDirectory, evidenceDirectory) &&
        path.resolve(evidenceDirectory) !== path.resolve(releaseDirectory),
      `拒绝清理 release 根目录以外的 W3 evidence：${evidenceDirectory}`,
    )
    await fs.rm(evidenceDirectory, { recursive: true, force: true })
    await fs.mkdir(evidenceDirectory, { recursive: true })
    isolatedRoot = await fs.mkdtemp(path.join(tmpdir(), 'ittoedu-w3-portability-'))
    assert(!isWithin(projectRoot, isolatedRoot), '隔离工作区意外位于源码仓库内')
    assert(
      isWithin(tmpdir(), isolatedRoot),
      `隔离工作区不在系统临时目录内：${isolatedRoot}`,
    )
    console.log(`W3 隔离工作区：${isolatedRoot}`)

    await verifyDocumentationContract()
    const lesson = await buildAndVerifyMovedLesson(isolatedRoot)
    const movedApplication = await verifyMovedUnpackedApplication(
      isolatedRoot,
      lesson.projectPathForApplication,
    )
    const movedPortable = await verifyMovedPortableApplication(isolatedRoot)

    result = {
      host: {
        platform: `${process.platform}-${process.arch}`,
        node: process.version,
        windowsRelease: (await import('node:os')).release(),
        windowsVersion: (await import('node:os')).version(),
      },
      application: {
        productName: APP_PRODUCT_NAME,
        version: APP_VERSION,
      },
      isolation: {
        workspaceWasOutsideProjectRoot: true,
        externalComponentSourceDeletedBeforeReopen: true,
        authoringOriginAbsentAfterMove: true,
        keptAfterRun: process.env.W3_KEEP_ISOLATED_WORKSPACE === '1',
      },
      lesson: {
        movedDeliveryDirectory: {
          name: movedDeliveryDirectoryName,
          hasSpace: movedDeliveryDirectoryName.includes(' '),
          hasUnicode: /[^\x00-\x7F]/.test(movedDeliveryDirectoryName),
        },
        projectArtifact: lesson.projectArtifact,
        htmlArtifact: lesson.htmlArtifact,
        webPackageArtifact: lesson.webPackageArtifact,
        webPackageDirectory: lesson.webPackageDirectory,
        offline: lesson.offline,
      },
      movedApplication: {
        directory: movedApplication.directory,
        screenshotPath: movedApplication.screenshotPath,
        screenshotSha256: movedApplication.screenshotSha256,
        isolation: {
          appPathWithinCopiedApplication: true,
          execPathWasCopiedExecutable: true,
          cwdWasIsolated: true,
          userDataWasIsolated: true,
          configuredComponentDirectoryWasAbsent: true,
        },
      },
      movedPortable: {
        sourceSha256: movedPortable.sourceSha256,
        movedSha256: movedPortable.movedSha256,
        fileName: path.basename(movedPortable.movedPath),
      },
      limitations: [
        '本验证在当前 Windows x64 主机的系统临时目录运行；它不能证明另一台全新 Windows 的环境、驱动、权限或安全软件行为。',
        'README/CMD/package scripts 的启动合同已静态核对，但没有在另一台无 node_modules 的机器上执行首次 npm ci。',
        '自动化结果最多为 engineering candidate；可见界面质量、真实课堂操作和内部产品 accepted 仍需明确人类验收。',
      ],
    }
    pass(
      'W3 自动化结论边界',
      '同机隔离复制/断源/移动/离线工程证据通过；不冒充另一台干净 Windows 或人工 accepted',
    )
  } catch (error) {
    failure = error instanceof Error ? error.stack ?? error.message : String(error)
    throw error
  } finally {
    const report = {
      reportVersion: 1,
      verifiedAt: new Date().toISOString(),
      status: failure ? 'failed' : 'engineering-candidate',
      checks,
      ...result,
      ...(failure ? { failure } : {}),
    }
    await fs.mkdir(evidenceDirectory, { recursive: true }).catch(() => undefined)
    await fs
      .writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
      .catch(() => undefined)

    if (isolatedRoot && process.env.W3_KEEP_ISOLATED_WORKSPACE !== '1') {
      assert(
        isWithin(tmpdir(), isolatedRoot),
        `拒绝删除系统临时目录以外的 W3 隔离工作区：${isolatedRoot}`,
      )
      const removed = await removeDirectoryWithRetries(isolatedRoot)
      if (!removed) console.warn(`警告：未能清理隔离工作区 ${isolatedRoot}`)
    }
  }

  console.log(`W3 Windows 可移植性验证通过，共 ${checks.length} 项。`)
  console.log(`验证报告：${reportPath}`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error('W3 Windows 可移植性验证失败：', error)
    process.exitCode = 1
  })
}
