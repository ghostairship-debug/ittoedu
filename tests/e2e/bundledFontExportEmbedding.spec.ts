/**
 * Real-Electron proof of what an exported lesson does and does not carry.
 *
 * The unit suite proves the builders embed what a payload declares, but every
 * one of those tests injects its own byte source. Inside the app the bytes come
 * from `bundledFontEmbedSourceFetch.ts`, which reads the `woff2` files the
 * renderer build emitted back over `courseware-editor://` — and that read had
 * never run outside a mock.
 *
 * It has to be proven here because its failure is silent: a blocked or missing
 * read leaves the export succeeding with one `console.warn` nobody sees, and the
 * properties panel's promise ("内置字体：导出时嵌入，换机器排版不变") quietly
 * becomes false. So every assertion lands on the bytes written to disk, and
 * font-related console output is asserted with its arguments resolved rather
 * than collapsed to a preview.
 *
 * What this found: the math family embeds; the text family never does, and the
 * export says so only in a warning. The `test.fail()` case below states the
 * mechanism and keeps the requirement asserted until it is fixed.
 *
 * Expectations are derived from the build's own inputs — the family constants,
 * the descriptors `vite.renderer.config.ts` resolves, and the vendored license
 * files — so no family name, face count or notice text is duplicated here.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import type { BrowserContext, ElectronApplication, Page } from 'playwright'
import { APP_E2E_TEMP_DIRECTORY_NAME } from '../../src/shared/constants'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import {
  BUNDLED_MATH_FONT_FAMILY,
  BUNDLED_TEXT_FONT_FAMILY,
} from '../../src/shared/fonts/bundledFontFamilies'
import { resolveBundledFontDescriptors } from '../../src/shared/fonts/bundledFontSources'
import type { BundledFontFamilyDescriptor } from '../../src/shared/fonts/bundledFontManifest'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'

const root = resolve(__dirname, '..', '..')
// One fixed directory rather than one per process: Playwright starts a fresh
// worker after a failed test, so a pid-keyed directory would scatter the
// evidence of a single run across several of them.
const evidenceDirectory = join(root, 'output', 'bundled-font-embedding')
const mathHtmlPath = join(evidenceDirectory, 'formula-math-font.html')
const mathWebPackagePath = join(evidenceDirectory, 'formula-math-font-web.zip')
const textHtmlPath = join(evidenceDirectory, 'bundled-text-font.html')
const plainHtmlPath = join(evidenceDirectory, 'no-bundled-font.html')
const rendererAssetsDirectory = join(root, 'dist-renderer', 'assets')

/**
 * The same descriptors the renderer build turned into `virtual:bundled-fonts`.
 * Reading them here means the expected face list is the shipped face list.
 */
const bundledFontDescriptors = resolveBundledFontDescriptors(
  join(root, 'node_modules'),
)

let launchSequence = 0

function descriptorFor(family: string): BundledFontFamilyDescriptor {
  const found = bundledFontDescriptors.find((entry) => entry.family === family)
  if (!found) throw new Error(`内置字体清单缺少字族：${family}`)
  return found
}

const textFontDescriptor = descriptorFor(BUNDLED_TEXT_FONT_FAMILY)
const mathFontDescriptor = descriptorFor(BUNDLED_MATH_FONT_FAMILY)

/** Verbatim OFL text, read from the path the descriptor itself declares. */
function licenseNotice(descriptor: BundledFontFamilyDescriptor): string {
  return readFileSync(
    join(root, ...descriptor.license.noticePath.split('/')),
    'utf8',
  )
}

/** Compare notice text without letting a checkout's line endings decide. */
function normalizeNewlines(value: string): string {
  return value.replaceAll('\r\n', '\n')
}

let rendererAssetNames: string[] | null = null

/**
 * The hashed file the renderer build emitted for one declared face, or `null`
 * when the build inlined it instead of emitting a file.
 *
 * `null` is not a build error — Vite inlines any asset under
 * `build.assetsInlineLimit` — but it is the reason the text family never
 * reaches an export, so callers have to see it rather than throw over it.
 */
function emittedFaceFileName(file: string): string | null {
  rendererAssetNames ??= readdirSync(rendererAssetsDirectory)
  const stem = file.replace(/\.woff2$/, '')
  return rendererAssetNames.find((name) => (
    name.startsWith(`${stem}-`) && name.endsWith('.woff2')
  )) ?? null
}

/** Every `@font-face` block the exported stylesheet declares, with its header. */
function faceBlocks(html: string): string[] {
  return html.match(/\/\*[^*]*·[^*]*\*\/\n@font-face \{[^}]*\}/g) ?? []
}

/**
 * Console output that could only come from the font path.
 *
 * `内置字体` heads all three of our own warnings (boot load, byte read, byte
 * preparation); the English fragments are Chromium's own font failures, which
 * would mean the bytes arrived but are not usable.
 */
const FONT_DIAGNOSTIC_PATTERN =
  /内置字体|woff2|font-face|Failed to decode downloaded font|OTS parsing/i

/**
 * The console signature of the known text-family defect, so the other tests can
 * exclude exactly it and stay strict about everything else.
 *
 * Two shapes, both produced on every export of every session: Chromium's own
 * CSP refusal of the three inlined `data:` faces, and our warning naming the
 * family it therefore dropped. Delete this together with the `test.fail()` case.
 */
function isKnownTextFamilyDefect(line: string): boolean {
  return line.includes(BUNDLED_TEXT_FONT_FAMILY) || (
    line.includes('data:font/woff2') &&
    /connect-src|Content Security Policy/i.test(line)
  )
}

interface Diagnostics {
  consoleLines: string[]
  pageErrors: string[]
  externalRequests: string[]
  /** One per console message; resolved before the lines are asserted. */
  pending: Promise<void>[]
}

interface LaunchedEditor {
  app: ElectronApplication
  context: BrowserContext
  page: Page
  userDataPath: string
  diagnostics: Diagnostics
}

interface DialogPaths {
  htmlSave?: string
  webPackageSave?: string
}

function attachDiagnostics(page: Page, diagnostics: Diagnostics): void {
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(error.stack ?? error.message)
  })
  page.on('console', (message) => {
    // `text()` collapses an `Error` argument to its preview, and the preview is
    // exactly where the HTTP status of a failed face read lives. Resolve the
    // arguments instead so a failure reports its own cause.
    diagnostics.pending.push((async () => {
      const parts = await Promise.all(message.args().map(async (argument) => {
        try {
          return await argument.evaluate((value: unknown) => {
            if (value instanceof Error) {
              return `${value.name}: ${value.message}\n${value.stack ?? ''}`
            }
            if (typeof value === 'string') return value
            try {
              return JSON.stringify(value) ?? String(value)
            } catch {
              return String(value)
            }
          })
        } catch {
          return '<无法序列化的 console 参数>'
        }
      }))
      const detail = parts.filter((part) => part.length > 0).join(' ')
      diagnostics.consoleLines.push(
        `[${message.type()}] ${detail || message.text()}`,
      )
    })())
  })
}

async function fontDiagnostics(
  diagnostics: Diagnostics,
): Promise<string[]> {
  await Promise.all(diagnostics.pending)
  return diagnostics.consoleLines.filter((line) => (
    FONT_DIAGNOSTIC_PATTERN.test(line)
  ))
}

/**
 * A silent `console.warn` is this feature's whole failure mode, so the warning
 * is checked before anything else and reported with its arguments resolved —
 * `ConsoleMessage.text()` collapses the `Error` that carries the HTTP status.
 *
 * Soft, so one run yields the console text, the product bytes and the protocol
 * probe together instead of stopping at the first of the three.
 */
async function expectNoFontDiagnostics(
  diagnostics: Diagnostics,
): Promise<void> {
  const fontLines = await fontDiagnostics(diagnostics)
  expect.soft(
    fontLines,
    `渲染进程输出了字体相关的 console 信息（原文如下）：\n${fontLines.join('\n')}`,
  ).toEqual([])
  expect.soft(diagnostics.pageErrors).toEqual([])
  expect.soft(diagnostics.externalRequests).toEqual([])
}

interface FaceProbeResult {
  file: string
  ok: boolean
  status: number
  byteLength: number
  error: string
}

/**
 * Read every shipped face back the way the editor's own byte source does:
 * `fetch` over `courseware-editor://`, all faces of a family in flight at once
 * (`Promise.all` inside `loadFamily`). A failure here is the difference between
 * a lesson that carries its typography and one that only looks like it does.
 */
async function probeShippedFaces(
  page: Page,
  files: readonly string[],
): Promise<FaceProbeResult[]> {
  return page.evaluate(async (names: string[]) => Promise.all(
    names.map(async (name) => {
      try {
        const response = await fetch(`courseware-editor://app/assets/${name}`)
        const buffer = await response.arrayBuffer()
        return {
          file: name,
          ok: response.ok,
          status: response.status,
          byteLength: buffer.byteLength,
          error: '',
        }
      } catch (error) {
        return {
          file: name,
          ok: false,
          status: -1,
          byteLength: -1,
          error: String(error),
        }
      }
    }),
  ), [...files])
}

/**
 * Numbers a reader needs but no assertion can carry: durations, product sizes
 * and the full protocol probe. Written next to the exported files, inside the
 * ignored `output/` tree, so a failing run leaves its evidence behind.
 */
function writeMeasurements(name: string, value: unknown): void {
  writeFileSync(
    join(evidenceDirectory, `${name}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
}

function removeProfile(userDataPath: string): void {
  const absolute = resolve(userDataPath)
  const scoped = relative(resolve(tmpdir()), absolute)
  if (
    !scoped ||
    scoped === '..' ||
    scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(scoped) ||
    !scoped.split(/[\\/]/)[0]!.startsWith(`${APP_E2E_TEMP_DIRECTORY_NAME}-fonts-`)
  ) {
    throw new Error(`拒绝删除范围外的 Electron 配置目录：${absolute}`)
  }
  rmSync(absolute, { recursive: true, force: true })
}

async function closeEditor(
  app: ElectronApplication,
  userDataPath: string,
): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((window) => window.destroy())
    setTimeout(() => electronApp.exit(0), 0)
  }).catch(() => undefined)
  await app.close().catch(() => undefined)
  removeProfile(userDataPath)
}

async function launchEditor(): Promise<LaunchedEditor> {
  const userDataPath = join(
    tmpdir(),
    `${APP_E2E_TEMP_DIRECTORY_NAME}-fonts-${process.pid}-${launchSequence++}`,
  )
  rmSync(userDataPath, { recursive: true, force: true })
  mkdirSync(userDataPath, { recursive: true })
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataPath}`],
      cwd: root,
      env: {
        ...process.env,
        // Force the packaged `courseware-editor://` path: the whole point is
        // the scheme the shipped app reads its own font files over.
        VITE_DEV_SERVER_URL: '',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        [BACKGROUND_E2E_ENV]: '1',
      },
    })
    const context = app.context()
    const diagnostics: Diagnostics = {
      consoleLines: [],
      pageErrors: [],
      externalRequests: [],
      pending: [],
    }
    const attached = new WeakSet<Page>()
    const attach = (target: Page): void => {
      if (attached.has(target)) return
      attached.add(target)
      attachDiagnostics(target, diagnostics)
    }
    // Attached before `firstWindow()` resolves so a boot-time font warning is
    // still captured.
    context.on('page', attach)
    context.on('request', (request) => {
      if (/^https?:/i.test(request.url())) {
        diagnostics.externalRequests.push(request.url())
      }
    })
    const page = await app.firstWindow()
    attach(page)
    await page.locator('[data-testid="canvas-stage"] canvas').waitFor()
    await expectBackgroundWindowsIsolated(app, true)
    const recoveryDialog = page.getByRole('alertdialog', {
      name: '发现未完成的本地恢复副本',
    })
    if (await recoveryDialog.isVisible().catch(() => false)) {
      await recoveryDialog.getByRole('button', { name: '丢弃副本' }).click()
    }
    const professional = page.getByRole('button', { name: '专业' })
    if (await professional.getAttribute('aria-pressed') !== 'true') {
      await professional.click()
    }
    return { app, context, page, userDataPath, diagnostics }
  } catch (error) {
    if (app) await closeEditor(app, userDataPath).catch(() => undefined)
    else removeProfile(userDataPath)
    throw error
  }
}

async function patchDialogs(
  app: ElectronApplication,
  paths: DialogPaths,
): Promise<void> {
  await app.evaluate(({ dialog }, values) => {
    dialog.showSaveDialog = (async (...args:
      | [Electron.BaseWindow, Electron.SaveDialogOptions]
      | [Electron.SaveDialogOptions]
    ): Promise<Electron.SaveDialogReturnValue> => {
      const options = args.length === 1 ? args[0] : args[1]
      return {
        canceled: false,
        filePath: options.title?.includes('网页')
          ? values.webPackageSave ?? ''
          : options.title?.includes('HTML')
            ? values.htmlSave ?? ''
            : '',
      }
    }) as typeof dialog.showSaveDialog
  }, paths)
}

async function addElement(page: Page, testId: string): Promise<void> {
  await page.getByRole('tab', { name: '元素' }).click()
  await page.getByRole('tab', { name: '常用' }).click()
  await page.getByTestId(testId).click()
  await expect(page.locator('.runtime-preview-loading')).toHaveCount(0, {
    timeout: 15_000,
  })
}

/** Pick a family from the real picker, the way a teacher would. */
async function selectFontFamily(page: Page, family: string): Promise<void> {
  await page.getByRole('tab', { name: '属性' }).click()
  await page.getByRole('button', { name: '展开字体列表' }).click()
  await page.getByRole('option', { name: new RegExp(`，${family}，内置字体`) })
    .click()
  await expect(page.getByRole('combobox', { name: '字体' })).toHaveValue(family)
}

/**
 * Run one export through the product's own menu and preflight.
 *
 * Returns the wall-clock milliseconds from the confirm click to the status line
 * the app writes after the file lands, which for the first export of a session
 * includes the whole bundled font read.
 */
async function exportThroughUi(
  page: Page,
  target: {
    testId: string
    dialogName: string
    statusText: string
    path: string
  },
): Promise<number> {
  // A leftover product from an earlier run would let a failed export satisfy
  // the existence check below.
  rmSync(target.path, { force: true })
  await page.getByTestId('export-menu-trigger').click()
  await page.getByTestId(target.testId).click()
  const preflight = page.getByRole('alertdialog', { name: target.dialogName })
  await expect(preflight).toBeVisible()
  await expect(preflight).toContainText('0 个错误')
  const startedAt = Date.now()
  await preflight.getByRole('button', { name: '继续导出' }).click()
  await expect(page.locator('.status-bar')).toContainText(target.statusText, {
    timeout: 180_000,
  })
  const elapsed = Date.now() - startedAt
  expect(existsSync(target.path)).toBe(true)
  expect(statSync(target.path).size).toBeGreaterThan(1_000)
  return elapsed
}

/**
 * Assert one family is embedded whole: its faces, its bytes, its notice, and no
 * link out of the file.
 *
 * Soft throughout, so one run reports every way an export fell short instead of
 * only the first.
 */
function expectFamilyEmbedded(
  html: string,
  descriptor: BundledFontFamilyDescriptor,
): void {
  expect.soft(html).toContain('@font-face')
  expect.soft(html).toContain('data:font/woff2;base64,')
  expect.soft(
    html.includes(`font-family: '${descriptor.family}';`),
    `导出物缺少 ${descriptor.family} 的 @font-face`,
  ).toBe(true)
  // OFL 1.1 §2 only permits shipping the bytes together with this text.
  expect.soft(
    normalizeNewlines(html)
      .includes(normalizeNewlines(licenseNotice(descriptor).trimEnd())),
    `导出物缺少 ${descriptor.family} 的逐字 OFL 声明`,
  ).toBe(true)

  // Every declared face, not "some of them": a half-embedded family produces a
  // file that looks self-contained and silently falls back for whichever code
  // points its missing slices covered.
  const missing = descriptor.faces
    .filter((face) => !html.includes(` · ${face.file} */`))
    .map((face) => face.file)
  expect.soft(
    missing.length,
    `导出物缺少 ${descriptor.family} 的 ${missing.length} 个已声明切片，例如 ${
      missing.slice(0, 3).join('、')
    }`,
  ).toBe(0)

  // The bytes have to be the real files, not empty placeholders: base64 is
  // about four thirds of what it encodes.
  const embeddedBase64Length = [...html.matchAll(
    /src: url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g,
  )].reduce((total, match) => total + (match[1]?.length ?? 0), 0)
  const upstreamBytes = descriptor.faces.reduce((total, face) => (
    total + statSync(join(
      root,
      'node_modules',
      ...face.specifier.split('/'),
    )).size
  ), 0)
  expect.soft(embeddedBase64Length).toBeGreaterThanOrEqual(
    Math.floor((upstreamBytes * 4) / 3),
  )

  // A delivered lesson may not reach for the network, and may not keep the
  // editor's own scheme, which resolves to nothing outside the app.
  expect.soft(html).not.toMatch(/url\(\s*["']?https?:/i)
  expect.soft(html).not.toContain('courseware-editor://')
}

test.describe('导出物内嵌内置字体（真实 Electron）', () => {
  test.beforeEach(() => {
    mkdirSync(evidenceDirectory, { recursive: true })
  })

  test('含公式的工程：数学字族的字节与 OFL 声明真的写进了导出物', async () => {
    test.setTimeout(300_000)
    const launched = await launchEditor()
    const { app, page, diagnostics } = launched
    try {
      await patchDialogs(app, {
        htmlSave: mathHtmlPath,
        webPackageSave: mathWebPackagePath,
      })
      // A formula is the math family's only possible declaration: the renderer's
      // font chain is a module constant, never a document property, so no walk
      // over the payload could ever find it. The node itself is the trigger.
      await addElement(page, 'add-formula')

      const singleHtmlMilliseconds = await exportThroughUi(page, {
        testId: 'export-single-html',
        dialogName: '单 HTML 导出预检',
        statusText: '离线便携单 HTML已导出到',
        path: mathHtmlPath,
      })
      const html = readFileSync(mathHtmlPath, 'utf8')

      // Every face the build emitted as a file, read back at the concurrency
      // `loadFamily` uses. This is the read the whole feature stands on, and it
      // had never run outside a mock.
      const emittedFaces = [...textFontDescriptor.faces, ...mathFontDescriptor.faces]
        .map((face) => emittedFaceFileName(face.file))
        .filter((name): name is string => name !== null)
      const probes = await probeShippedFaces(page, emittedFaces)
      const failedProbes = probes.filter((probe) => (
        !probe.ok ||
        probe.byteLength !== statSync(join(rendererAssetsDirectory, probe.file)).size
      ))

      const webPackageMilliseconds = await exportThroughUi(page, {
        testId: 'export-web-package',
        dialogName: '网页包 导出预检',
        statusText: '网页包已导出到',
        path: mathWebPackagePath,
      })
      const archive = unzipSync(new Uint8Array(readFileSync(mathWebPackagePath)))

      writeMeasurements('measurements-formula', {
        singleHtmlMilliseconds,
        webPackageMilliseconds,
        singleHtmlBytes: statSync(mathHtmlPath).size,
        webPackageBytes: statSync(mathWebPackagePath).size,
        faceBlockCount: faceBlocks(html).length,
        probedFaceCount: probes.length,
        failedFaceProbes: failedProbes,
        fontConsoleLines: await fontDiagnostics(diagnostics),
        consoleLines: diagnostics.consoleLines,
      })

      // The text family's own defect is owned by the `test.fail()` case below
      // and fires on every export; anything else means this path broke.
      const unrelatedDiagnostics = (await fontDiagnostics(diagnostics))
        .filter((line) => !isKnownTextFamilyDefect(line))
      expect.soft(
        unrelatedDiagnostics,
        `渲染进程输出了与文字字族缺陷无关的字体 console 信息：\n${
          unrelatedDiagnostics.join('\n')
        }`,
      ).toEqual([])
      expect.soft(diagnostics.pageErrors).toEqual([])
      expect.soft(diagnostics.externalRequests).toEqual([])

      expectFamilyEmbedded(html, mathFontDescriptor)
      // Exactly the one face a formula needs, and nothing else.
      expect.soft(faceBlocks(html)).toHaveLength(mathFontDescriptor.faces.length)

      expect.soft(
        failedProbes,
        `courseware-editor:// 未能返回 ${failedProbes.length} 个字体切片的字节`,
      ).toEqual([])

      // The web package is the second `await prepareBundledFontEmbedding()` and
      // the sibling-file form of the same rules.
      expect.soft(
        Object.keys(archive).filter((entry) => entry.startsWith('player/fonts/')).sort(),
      ).toEqual(mathFontDescriptor.faces.map((face) => `player/fonts/${face.file}`))
      const packageCss = strFromU8(archive['player/player.css']!)
      expect.soft(packageCss).toContain('@font-face')
      expect.soft(packageCss).toContain(`font-family: '${mathFontDescriptor.family}';`)
      expect.soft(packageCss).not.toMatch(/url\(\s*["']?https?:/i)
      expect.soft(packageCss).not.toContain('courseware-editor://')
      const notices = archive['THIRD_PARTY_NOTICES.md']
      expect.soft(notices, '网页包缺少 THIRD_PARTY_NOTICES.md').toBeDefined()
      expect.soft(
        notices
          ? normalizeNewlines(strFromU8(notices))
            .includes(normalizeNewlines(licenseNotice(mathFontDescriptor).trimEnd()))
          : false,
        `网页包缺少 ${mathFontDescriptor.family} 的逐字 OFL 声明`,
      ).toBe(true)
    } finally {
      await closeEditor(app, launched.userDataPath)
    }
  })

  // KNOWN DEFECT — reproduced on 2026-08-26, `d36e519`. Remove `test.fail()`
  // together with the fix; Playwright turns the suite red the moment this
  // starts passing.
  //
  // The text family never reaches an export, and the export never says so:
  //   1. `@fontsource-variable/noto-sans-sc` ships 101 slices. Three of them
  //      (`noto-sans-sc-4/97/98-wght-normal.woff2`, 2–3.8 KB) fall under Vite's
  //      default `build.assetsInlineLimit` of 4096, so the renderer build
  //      inlines them as `data:font/woff2;base64,…` instead of emitting files.
  //      `virtual:bundled-fonts` therefore hands three `data:` URLs to the byte
  //      source alongside 98 `courseware-editor://` ones.
  //   2. `installFetchBundledFontEmbedSource` reads every face with `fetch()`.
  //      `fetch` is governed by `connect-src`, and the editor shell declares
  //      `connect-src 'self' blob: https: wss:` (`index.html`) — no `data:`. The
  //      three reads fail with `TypeError: Failed to fetch`. (`font-src` does
  //      allow `data:`, which is why the same slices load fine for rendering.)
  //   3. `loadFamily` awaits `Promise.all` over the family's faces, so those
  //      three rejections drop all 101, by the module's own "all faces or none"
  //      rule.
  //   4. `loadAllFamilies` reports the drop with `console.warn` and never
  //      throws, so the export completes and the lesson ships without the font.
  //
  // The warning fires on the first export of every session regardless of the
  // project, because `loadAllFamilies` loads all families, not the used ones.
  test('用了内置文字字族的工程：该字族应当整族嵌入', async () => {
    test.fail()
    test.setTimeout(300_000)
    const launched = await launchEditor()
    const { app, page, diagnostics } = launched
    try {
      await patchDialogs(app, { htmlSave: textHtmlPath })
      await addElement(page, 'add-text')
      await selectFontFamily(page, BUNDLED_TEXT_FONT_FAMILY)

      const singleHtmlMilliseconds = await exportThroughUi(page, {
        testId: 'export-single-html',
        dialogName: '单 HTML 导出预检',
        statusText: '离线便携单 HTML已导出到',
        path: textHtmlPath,
      })
      const html = readFileSync(textHtmlPath, 'utf8')
      const inlinedFaces = textFontDescriptor.faces
        .filter((face) => emittedFaceFileName(face.file) === null)
        .map((face) => face.file)
      writeMeasurements('measurements-text-family', {
        singleHtmlMilliseconds,
        singleHtmlBytes: statSync(textHtmlPath).size,
        declaredFaceCount: textFontDescriptor.faces.length,
        faceBlockCount: faceBlocks(html).length,
        inlinedByViteFaces: inlinedFaces,
        fontConsoleLines: await fontDiagnostics(diagnostics),
        consoleLines: diagnostics.consoleLines,
      })

      // The payload really does name the family; the gap is downstream of it.
      expect.soft(html).toContain(`"fontFamily":"${BUNDLED_TEXT_FONT_FAMILY}"`)

      // Step 1 of the chain above, asserted where it is caused: a declared face
      // with no emitted file is a face the byte source can only reach through a
      // `data:` URL.
      expect.soft(
        inlinedFaces,
        'Vite 把这些已声明切片内联成了 data: URL，没有产出独立文件',
      ).toEqual([])

      // Step 4: the export must not be able to fail quietly.
      await expectNoFontDiagnostics(diagnostics)

      expectFamilyEmbedded(html, textFontDescriptor)
    } finally {
      await closeEditor(app, launched.userDataPath)
    }
  })

  test('没用内置字体、也没有公式的工程，导出物里一条 @font-face 都没有', async () => {
    test.setTimeout(240_000)
    const launched = await launchEditor()
    const { app, page, diagnostics } = launched
    try {
      await patchDialogs(app, { htmlSave: plainHtmlPath })
      // The blank project's default stack is Microsoft YaHei; nothing here
      // names a bundled family and nothing renders a formula.
      await addElement(page, 'add-text')
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.getByRole('combobox', { name: '字体' }))
        .not.toHaveValue(BUNDLED_TEXT_FONT_FAMILY)

      const milliseconds = await exportThroughUi(page, {
        testId: 'export-single-html',
        dialogName: '单 HTML 导出预检',
        statusText: '离线便携单 HTML已导出到',
        path: plainHtmlPath,
      })
      const html = readFileSync(plainHtmlPath, 'utf8')
      writeMeasurements('measurements-no-bundled-font', {
        firstExportMilliseconds: milliseconds,
        singleHtmlBytes: statSync(plainHtmlPath).size,
        fontConsoleLines: await fontDiagnostics(diagnostics),
      })

      // "Only what the lesson uses" has to be a fact about the product, not a
      // side effect of the byte source being absent: this session registered the
      // same source and awaited the same preparation as the two above.
      //
      // Not `not.toContain(family)`: the shell stylesheet names the bundled text
      // family in its own fallback chain, which embeds nothing. What must be
      // absent is a face declaration and its bytes.
      expect.soft(html).not.toContain('@font-face')
      expect.soft(html).not.toContain('data:font/woff2')
      expect.soft(html).not.toContain('SIL Open Font License')
      expect.soft(faceBlocks(html)).toEqual([])
      expect.soft(diagnostics.pageErrors).toEqual([])
      expect.soft(diagnostics.externalRequests).toEqual([])
      // Same exclusion as the formula case: the text family's defect fires on
      // every first export, whatever the project declares.
      const unrelatedDiagnostics = (await fontDiagnostics(diagnostics))
        .filter((line) => !isKnownTextFamilyDefect(line))
      expect.soft(
        unrelatedDiagnostics,
        `渲染进程输出了与文字字族缺陷无关的字体 console 信息：\n${
          unrelatedDiagnostics.join('\n')
        }`,
      ).toEqual([])
    } finally {
      await closeEditor(app, launched.userDataPath)
    }
  })
})
