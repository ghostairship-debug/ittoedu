import { plainDocumentText } from '../../src/shared/document/content'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import {
  openCourseProjectArchive,
} from '../../src/renderer/project/courseProjectArchive'
import { createArchiveFixture as createCourseProjectArchive } from '../fixtures/teacherController'
import type {
  CourseProjectDocument,
  FlowBlock,
  FlowSurfaceDocument,
  LayerItem,
} from '../../src/shared/courseProjectTypes'
import {
  resolveFlowMediaLayoutInlineSize,
  type FlowMediaLayoutValue,
} from '../../src/shared/flowMediaLayout'
import { APP_E2E_TEMP_DIRECTORY_NAME } from '../../src/shared/constants'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { expectBackgroundWindowsIsolated } from './expectBackgroundWindowsIsolated'
import { showEditorPanel } from './r18NativeAuthoringFixture'
import { enterIndependentEditor } from './lessonWorkspaceEntry'

const root = resolve(__dirname, '..', '..')
const flowFixturePath = join(root, 'tests', 'fixtures', 'course-project-v9', 'flow.h5lesson')
const assetFixturePath = join(root, 'tests', 'fixtures', 'course-project-v9', 'multi-asset.h5lesson')
const FORMAT_TEXT = '甲乙丙丁戊己庚辛'
const MEDIA_PROBES = [
  { blockId: 'wave-c-media-content', layout: 'content-width', tier: 'reading' },
  { blockId: 'wave-c-media-wide', layout: 'wide', tier: 'wide' },
  { blockId: 'wave-c-media-full', layout: 'full-width', tier: 'container' },
] as const

interface Diagnostics {
  pageErrors: string[]
  consoleErrors: string[]
  consoleWarnings: string[]
  externalRequests: string[]
}

interface LaunchedEditor extends Diagnostics {
  app: ElectronApplication
  page: Page
  runRoot: string
}

interface MediaMeasurements {
  logicalContainerWidth: number
  visualScale: number
  widths: number[]
  layouts: Array<string | null>
  tiers: Array<string | null>
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
    || !leaf.startsWith(`${APP_E2E_TEMP_DIRECTORY_NAME}-wave-c-`)
  ) {
    throw new Error(`Refusing to remove an unscoped Wave C directory: ${absolute}`)
  }
  rmSync(absolute, { recursive: true, force: true })
}

async function closeEditor(app: ElectronApplication, runRoot: string): Promise<void> {
  const child = app.process()
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((window) => window.destroy())
    setTimeout(() => electronApp.exit(0), 0)
  }).catch(() => undefined)
  await app.close().catch(() => undefined)
  if (child.exitCode === null) {
    const exited = await Promise.race([
      new Promise<boolean>((resolveExit) => child.once('exit', () => resolveExit(true))),
      new Promise<boolean>((resolveExit) => setTimeout(() => resolveExit(false), 5_000)),
    ])
    if (!exited && child.exitCode === null) {
      child.kill()
      await new Promise<void>((resolveExit) => {
        if (child.exitCode !== null) return resolveExit()
        child.once('exit', () => resolveExit())
        setTimeout(resolveExit, 5_000)
      })
    }
  }
  removeRunRoot(runRoot)
}

async function launchEditor(): Promise<LaunchedEditor> {
  const runRoot = mkdtempSync(
    join(tmpdir(), `${APP_E2E_TEMP_DIRECTORY_NAME}-wave-c-${process.pid}-`),
  )
  const userDataPath = join(runRoot, 'profile')
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataPath}`],
      cwd: root,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: '',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        [BACKGROUND_E2E_ENV]: '1',
      },
    })
    const diagnostics: Diagnostics = {
      pageErrors: [],
      consoleErrors: [],
      consoleWarnings: [],
      externalRequests: [],
    }
    const attached = new WeakSet<Page>()
    const attach = (target: Page) => {
      if (attached.has(target)) return
      attached.add(target)
      target.on('pageerror', (error) => diagnostics.pageErrors.push(error.message))
      target.on('console', (message) => {
        if (message.type() === 'error') diagnostics.consoleErrors.push(message.text())
        if (message.type() === 'warning') diagnostics.consoleWarnings.push(message.text())
      })
    }
    const context = app.context()
    context.on('page', attach)
    context.on('request', (request) => {
      if (/^https?:/i.test(request.url())) diagnostics.externalRequests.push(request.url())
    })
    const page = await app.firstWindow()
    attach(page)
    // 冷启动只进入独立编辑器面（判据见 tests/e2e/lessonWorkspaceEntry.ts）。
    await enterIndependentEditor(page)
    await expectBackgroundWindowsIsolated(app, true)
    return { app, page, runRoot, ...diagnostics }
  } catch (error) {
    if (app) await closeEditor(app, runRoot).catch(() => undefined)
    else removeRunRoot(runRoot)
    throw error
  }
}

async function openEditorTab(page: Page, name: '图层' | '属性'): Promise<void> {
  await showEditorPanel(page, '属性与素材')
  await page.getByRole('tab', { name, exact: true }).click()
}

function requireFlowSurface(project: CourseProjectDocument): FlowSurfaceDocument {
  const surface = project.surfaces.find((candidate) => candidate.type === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('Wave C fixture is missing its Flow surface')
  return surface
}

function requireBlock<T extends FlowBlock['type']>(
  surface: FlowSurfaceDocument,
  id: string,
  type: T,
): Extract<FlowBlock, { type: T }> {
  const visit = (blocks: readonly FlowBlock[]): FlowBlock | null => {
    for (const block of blocks) {
      if (block.id === id) return block
      if (block.type === 'section') {
        const nested = visit(block.blocks)
        if (nested) return nested
      }
    }
    return null
  }
  const block = visit(surface.blocks)
  if (!block || block.type !== type) throw new Error(`Wave C fixture is missing ${type} block ${id}`)
  return block as Extract<FlowBlock, { type: T }>
}

function prepareWaveCArchive(projectPath: string): void {
  const flowSource = openCourseProjectArchive(new Uint8Array(readFileSync(flowFixturePath)))
  const assetSource = openCourseProjectArchive(new Uint8Array(readFileSync(assetFixturePath)))
  const project = structuredClone(flowSource.project)
  const surface = requireFlowSurface(project)
  const originalHeading = requireBlock(surface, 'flow-heading', 'heading')
  const originalFormula = requireBlock(surface, 'flow-formula', 'formula')
  const originalSection = requireBlock(surface, 'flow-section', 'section')
  const sourceSlide = assetSource.project.surfaces.find((candidate) => candidate.type === 'slide')
  const sourceOverlay = sourceSlide?.type === 'slide'
    ? sourceSlide.scenes[0]?.layerItems.find((item) => item.layerItemId === 'slide-photo')
    : undefined
  if (!sourceOverlay) throw new Error('Multi-asset fixture is missing slide-photo')

  const overlay: LayerItem = structuredClone(sourceOverlay)
  overlay.layerItemId = 'wave-c-overlay'
  overlay.label = 'Wave C 浮层'
  overlay.order = 100
  // Keep the viewport-pinned overlay visible for the layer/z-order assertion,
  // but outside the paper's central authoring hit area used by the real drag.
  overlay.frame = { ...overlay.frame, x: 1760, y: 960, width: 120, height: 80 }

  const blocks: FlowBlock[] = [
    structuredClone(originalHeading),
    {
      id: 'flow-paragraph',
      type: 'paragraph',
      content: { inlines: [{ type: 'text', text: FORMAT_TEXT }] },
    },
    structuredClone(originalFormula),
    structuredClone(originalSection),
    {
      id: 'wave-c-media-edit',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'video',
      altText: '待编辑视频',
      caption: { inlines: [{ type: 'text', text: '待编辑题注' }] },
      layout: 'content-width',
    },
    {
      id: 'wave-c-media-content',
      type: 'media',
      assetId: 'flow-image',
      mediaKind: 'image',
      altText: '正文宽图片',
      caption: { inlines: [{ type: 'text', text: '正文宽' }] },
      layout: 'content-width',
    },
    {
      id: 'wave-c-media-wide',
      type: 'media',
      assetId: 'photo',
      mediaKind: 'image',
      altText: '较宽图片',
      caption: { inlines: [{ type: 'text', text: '较宽' }] },
      layout: 'wide',
    },
    {
      id: 'wave-c-media-full',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'video',
      altText: '全宽讲解视频',
      caption: { inlines: [{ type: 'text', text: '全宽' }] },
      layout: 'full-width',
    },
  ]

  project.id = 'wave-c-flow-authoring'
  project.title = 'Wave C Flow Authoring'
  project.revision = 1
  project.updatedAt = '2026-08-25T00:00:00.000Z'
  project.assets = {
    ...project.assets,
    ...structuredClone(assetSource.project.assets),
  }
  const sourceClip = project.assets.clip
  const sourceClipBytes = assetSource.assetFiles.clip
  if (!sourceClip || sourceClip.kind !== 'video' || !sourceClipBytes) {
    throw new Error('Multi-asset fixture is missing its video sidecar')
  }
  project.assets['clip-replacement'] = {
    ...structuredClone(sourceClip),
    id: 'clip-replacement',
    filename: 'clip-replacement.mp4',
    path: 'assets/clip-replacement.mp4',
  }
  surface.title = 'Wave C Flow Authoring'
  surface.blocks = blocks
  surface.surfaceLayerItems = [{
    item: overlay,
    visibility: { mode: 'all', locationIds: [] },
  }]
  project.locations = [{
    id: 'location-flow',
    label: 'Wave C Flow Authoring',
    kind: 'flow-block',
    surfaceId: surface.id,
    blockId: 'flow-heading',
  }]
  project.startLocationId = 'location-flow'

  writeFileSync(projectPath, createCourseProjectArchive({
    project,
    assetFiles: {
      ...flowSource.assetFiles,
      ...assetSource.assetFiles,
      'clip-replacement': sourceClipBytes,
    },
    componentFiles: { ...flowSource.componentFiles, ...assetSource.componentFiles },
  }, { mtime: '2026-08-25T00:00:00.000Z' }))
}

async function patchProjectDialogs(app: ElectronApplication, projectPath: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async (): Promise<Electron.SaveDialogReturnValue> => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async (): Promise<Electron.OpenDialogReturnValue> => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog
  }, projectPath)
}

function readProject(projectPath: string): CourseProjectDocument {
  return openCourseProjectArchive(new Uint8Array(readFileSync(projectPath))).project
}

async function saveCurrent(page: Page, projectPath: string, savedMatches: (project: CourseProjectDocument) => boolean): Promise<CourseProjectDocument> {
  const saveButton = page.getByRole('button', { name: '保存（Ctrl+S）' })
  const projectName = page.getByRole('button', { name: '重命名课件', exact: true })
  await expect(projectName).toContainText('*')
  await saveButton.click()
  await expect(projectName).not.toContainText('*', { timeout: 15_000 })
  await expect.poll(() => savedMatches(readProject(projectPath)), { timeout: 15_000 }).toBe(true)
  return readProject(projectPath)
}

async function flowTextPoint(
  editor: Locator,
  offset: number,
  edge: 'start' | 'end',
): Promise<{ x: number; y: number }> {
  return editor.evaluate((root, input) => {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let remaining = input.offset
    let textNode: Text | null = null
    while (walker.nextNode()) {
      const candidate = walker.currentNode as Text
      if (remaining < candidate.data.length) {
        textNode = candidate
        break
      }
      remaining -= candidate.data.length
    }
    if (!textNode) throw new Error(`Cannot resolve Flow text offset ${input.offset}`)
    const start = Math.min(remaining, Math.max(0, textNode.data.length - 1))
    const range = root.ownerDocument.createRange()
    range.setStart(textNode, start)
    range.setEnd(textNode, Math.min(textNode.data.length, start + 1))
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
    return {
      x: input.edge === 'start' ? rect.left + 1 : rect.right - 1,
      y: rect.top + rect.height / 2,
    }
  }, { offset, edge })
}

async function selectRealTextRange(
  page: Page,
  editor: Locator,
  startOffset: number,
  endCharacterOffset: number,
): Promise<{
  editorConnected: boolean
  text: string
  collapsed: boolean
  inside: boolean
  start: number
  end: number
}> {
  const start = await flowTextPoint(editor, startOffset, 'start')
  const end = await flowTextPoint(editor, endCharacterOffset, 'end')
  const hitTargets = await page.evaluate((points) => points.map((point) => (
    document.elementFromPoint(point.x, point.y)?.closest('[data-testid="flow-block-flow-paragraph"]') !== null
  )), [start, end])
  expect(hitTargets).toEqual([true, true])
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
  return readRealTextSelection(page)
}

async function readRealTextSelection(page: Page): Promise<{
  editorConnected: boolean
  text: string
  collapsed: boolean
  inside: boolean
  start: number
  end: number
}> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-testid="flow-block-flow-paragraph"]')
    const selection = document.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const inside = (node: Node | null) => Boolean(
      element && node && (node === element || element.contains(node)),
    )
    const logicalOffset = (container: Node | undefined, offset: number | undefined) => {
      if (!element || !container || offset === undefined) return -1
      const prefix = document.createRange()
      prefix.selectNodeContents(element)
      prefix.setEnd(container, offset)
      return Array.from(prefix.toString()).length
    }
    return {
      editorConnected: element?.isConnected === true,
      text: selection?.toString() ?? '',
      collapsed: range?.collapsed ?? true,
      inside: inside(range?.startContainer ?? null) && inside(range?.endContainer ?? null),
      start: logicalOffset(range?.startContainer, range?.startOffset),
      end: logicalOffset(range?.endContainer, range?.endOffset),
    }
  })
}

async function measureMedia(
  queryRoot: Locator,
  scope: Locator,
): Promise<MediaMeasurements> {
  const rootMetrics = await queryRoot.evaluate((element) => {
    const root = element as HTMLElement
    const style = getComputedStyle(root)
    const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
    const border = Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth)
    const computedWidth = Number.parseFloat(style.width)
    const rect = root.getBoundingClientRect()
    return {
      logicalContainerWidth: style.boxSizing === 'border-box'
        ? computedWidth - padding - border
        : computedWidth,
      visualScale: root.offsetWidth > 0 ? rect.width / root.offsetWidth : 1,
    }
  })
  const widths: number[] = []
  const layouts: Array<string | null> = []
  const tiers: Array<string | null> = []
  for (const probe of MEDIA_PROBES) {
    const figure = scope.locator(
      `[data-flow-block-id="${probe.blockId}"] figure, figure[data-flow-block-id="${probe.blockId}"]`,
    ).first()
    await expect(figure).toBeVisible()
    const box = await figure.boundingBox()
    if (!box) throw new Error(`Media probe ${probe.blockId} has no actual bounding rect`)
    widths.push(box.width)
    layouts.push(await figure.getAttribute('data-flow-media-layout'))
    tiers.push(await figure.getAttribute('data-flow-media-width-tier'))
  }
  return { ...rootMetrics, widths, layouts, tiers }
}

function expectMediaProjection(measurement: MediaMeasurements): void {
  expect(measurement.layouts).toEqual(MEDIA_PROBES.map(({ layout }) => layout))
  expect(measurement.tiers).toEqual(MEDIA_PROBES.map(({ tier }) => tier))
  for (let index = 0; index < MEDIA_PROBES.length; index += 1) {
    const expectedLogical = resolveFlowMediaLayoutInlineSize(
      MEDIA_PROBES[index]!.layout as FlowMediaLayoutValue,
      { readingWidth: 760, wideContentWidth: 1120 },
      measurement.logicalContainerWidth,
    )
    expect(Math.abs(
      measurement.widths[index]! - expectedLogical * measurement.visualScale,
    )).toBeLessThanOrEqual(2.5)
  }
  expect(measurement.widths[0]).toBeLessThan(measurement.widths[1]!)
  expect(measurement.widths[1]).toBeLessThan(measurement.widths[2]!)
  expect(measurement.widths[1]! - measurement.widths[0]!).toBeGreaterThanOrEqual(16)
  expect(measurement.widths[2]! - measurement.widths[1]!).toBeGreaterThanOrEqual(16)
}

function expectCleanDiagnostics(diagnostics: Diagnostics): void {
  expect(diagnostics.pageErrors).toEqual([])
  expect(diagnostics.consoleErrors).toEqual([])
  expect(diagnostics.externalRequests).toEqual([])
  const knownBadImageWarnings = diagnostics.consoleWarnings.filter((message) => (
    /^WebGL: INVALID_VALUE: texImage2D: bad image data$/.test(message)
  ))
  expect(knownBadImageWarnings.length).toBeLessThanOrEqual(1)
  expect(diagnostics.consoleWarnings.filter((message) => !(
    /^WebGL: INVALID_VALUE: texImage2D: bad image data$/.test(message)
  ))).toEqual([])
}

function readEffectiveTextStyles(element: HTMLElement) {
  const view = element.ownerDocument.defaultView!
  const walker = element.ownerDocument.createTreeWalker(element, view.NodeFilter.SHOW_TEXT)
  const characters: Array<{ text: string; fontFamily: string; fontSize: string; fontWeight: string }> = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const style = view.getComputedStyle(node.parentElement!)
    for (const text of Array.from(node.textContent ?? '')) {
      characters.push({ text, fontFamily: style.fontFamily, fontSize: style.fontSize,
        fontWeight: style.fontWeight === 'normal' ? '400' : style.fontWeight === 'bold' ? '700' : style.fontWeight })
    }
  }
  return characters
}

async function expectPublishedRangeStyles(block: Locator): Promise<void> {
  // TextRun is a character range; its rendering may split or nest styled spans.
  const characters = await block.evaluate(readEffectiveTextStyles)
  expect(characters.map(character => character.text).join('')).toBe(`${FORMAT_TEXT}新`)
  expect(characters.slice(2, 4)).toEqual(['丙', '丁'].map(text => ({
    text, fontFamily: 'SimSun', fontSize: '30px', fontWeight: '700',
  })))
  expect(characters.slice(8)).toEqual([
    { text: '新', fontFamily: 'KaiTi', fontSize: '32px', fontWeight: '400' },
  ])
}

test('Wave C Flow authoring survives one real Editor and Player session', async () => {
  test.setTimeout(240_000)
  const launch = await launchEditor()
  const projectPath = join(launch.runRoot, 'wave-c-flow-authoring.h5lesson')
  const { app, page } = launch
  try {
    prepareWaveCArchive(projectPath)
    await patchProjectDialogs(app, projectPath)
    await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
    await expect(page.getByTestId('flow-workspace')).toBeVisible()
    const formatPanel = page.locator('details.flow-document-format')
    const formatToolbar = page.getByRole('toolbar', { name: '正文工具' }).first()
    await formatPanel.locator('summary').click()
    await expect(formatToolbar).toBeVisible()

    await test.step('formula preserves its semantic target and explicit LaTeX editor', async () => {
      const formula = page.getByTestId('flow-block-flow-formula')
      const toolbar = page.getByRole('toolbar', { name: '正文工具' }).first()
      const identity = await formula.getAttribute('data-formula-id')
      await formula.click()
      await expect(formula).toHaveClass(/ProseMirror-selectednode/)
      await expect(page.getByRole('form', { name: '公式编辑' })).toHaveCount(0)
      await formula.click()
      await expect(formula).toHaveAttribute('data-formula-id', identity!)
      await toolbar.getByRole('button', { name: '公式', exact: true }).click()
      const dialog = page.getByRole('form', { name: '公式编辑' })
      await expect(dialog).toBeVisible()
      expect(await dialog.getByLabel('LaTeX', { exact: true }).inputValue()).toBe(requireBlock(requireFlowSurface(readProject(projectPath)), 'flow-formula', 'formula').latex)
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(formula).toHaveAttribute('data-formula-id', identity!)
    })

    await test.step('real range formatting stays local while a page overlay crosses the single body boundary', async () => {
      const formatBaseline = readProject(projectPath)
      const paragraph = page.getByTestId('flow-block-flow-paragraph')
      const editor = page.getByRole('textbox', { name: '正文排版编辑', exact: true }).first()
      const toolbar = formatToolbar
      // The format panel is an intentional popover over the paper. Close it to
      // focus and select real editor text, then reopen it through the normal UI;
      // the shared editor preserves the DOM selection for toolbar commands.
      await formatPanel.locator('summary').click()
      await expect(toolbar).toBeHidden()
      await paragraph.click()
      await expect(editor).toBeFocused()
      const expectedSelection = { editorConnected: true, text: '丙丁', collapsed: false, inside: true, start: 2, end: 4 }
      expect(await selectRealTextRange(page, paragraph, 2, 3)).toEqual(expectedSelection)
      await formatPanel.locator('summary').click()
      await expect(toolbar).toBeVisible()
      expect(await readRealTextSelection(page)).toEqual(expectedSelection)
      const fontFamily = toolbar.getByLabel('字体', { exact: true })
      await fontFamily.selectOption('SimSun')
      await expect(editor).toBeFocused()
      expect(await readRealTextSelection(page)).toEqual(expectedSelection)
      const fontSize = toolbar.getByLabel('字号', { exact: true })
      await fontSize.fill('30')
      await expect(editor).toBeFocused()
      expect(await readRealTextSelection(page)).toEqual(expectedSelection)
      await expect(toolbar.getByRole('button', { name: '粗体', exact: true })).toHaveAttribute('aria-pressed', 'false')
      await toolbar.getByRole('button', { name: '粗体', exact: true }).click()
      await expect(toolbar.getByRole('button', { name: '粗体', exact: true })).toHaveAttribute('aria-pressed', 'true')
      const selectedStyles = await paragraph.evaluate(readEffectiveTextStyles)
      expect(selectedStyles.slice(2, 4)).toEqual(['丙', '丁'].map(text => ({ text, fontFamily: 'SimSun', fontSize: '30px', fontWeight: '700' })))
      expect(selectedStyles.slice(0, 2).every(character => character.fontWeight !== '700')).toBe(true)
      await editor.press('Home')
      for (let offset = 0; offset < 4; offset += 1) await editor.press('Shift+ArrowRight')
      expect(await readRealTextSelection(page)).toEqual({ editorConnected: true, text: '甲乙丙丁', collapsed: false, inside: true, start: 0, end: 4 })
      await expect(fontFamily).toHaveValue('__mixed')
      await expect(fontSize).toHaveValue('')
      await expect(fontSize).toHaveAttribute('placeholder', '混合')
      await expect(toolbar.getByRole('button', { name: '粗体', exact: true })).toHaveAttribute('aria-pressed', 'mixed')
      await formatPanel.locator('summary').click()
      await expect(toolbar).toBeHidden()
      const caretPoint = await flowTextPoint(paragraph, FORMAT_TEXT.length - 1, 'end')
      await page.mouse.click(caretPoint.x, caretPoint.y)
      expect(await readRealTextSelection(page)).toMatchObject({ collapsed: true, start: FORMAT_TEXT.length, end: FORMAT_TEXT.length })
      await formatPanel.locator('summary').click()
      await expect(toolbar).toBeVisible()
      expect(await readRealTextSelection(page)).toMatchObject({ collapsed: true, start: FORMAT_TEXT.length, end: FORMAT_TEXT.length })
      await fontFamily.selectOption('KaiTi')
      await fontSize.fill('32')
      await expect(fontFamily).toHaveValue('KaiTi')
      await expect(fontSize).toHaveValue('32')
      await expect(toolbar.getByRole('button', { name: '粗体', exact: true })).toHaveAttribute('aria-pressed', 'false')
      await expect(editor).toBeFocused()
      await editor.pressSequentially('新')
      await expect(paragraph).toHaveText(`${FORMAT_TEXT}新`)
      await expectPublishedRangeStyles(paragraph)
      // The shared editor remains continuous; one owner undo reverses just this typing group.
      await toolbar.getByRole('button', { name: '撤销', exact: true }).click()
      await expect(paragraph).toHaveText(FORMAT_TEXT)
      // Owner Undo restores the document session and its initially collapsed format panel.
      await formatPanel.locator('summary').click()
      await toolbar.getByRole('button', { name: '重做', exact: true }).click()
      await expect(paragraph).toHaveText(`${FORMAT_TEXT}新`)

      await openEditorTab(page, '图层')
      const overlayRegion = page.getByTestId('flow-overlay-layers')
      const bodyBoundary = page.getByTestId('flow-body-boundary')
      await expect(bodyBoundary).toHaveCount(1)
      await expect(bodyBoundary).toContainText('正文')
      await expect(bodyBoundary).toContainText('全部 FlowBlock · 跟随稿纸')
      await expect(page.locator('[data-testid^="flow-outline-block-"]')).toHaveCount(0)
      await expect(page.getByTestId('nodes-layer-group-surface-overlay'))
        .toContainText('正文上方')
      await expect(page.getByTestId('flow-overlay-placement'))
        .toHaveText('页面浮层可排在正文上方或下方；正文内部顺序在稿纸中编辑。')
      const overlayRow = page.getByTestId('node-item-wave-c-overlay')
      await expect(overlayRegion.locator('[data-testid="node-item-wave-c-overlay"]')).toBeVisible()
      await expect(overlayRow.locator('.drag-handle')).toBeVisible()
      await expect(page.getByTestId('node-source-wave-c-overlay'))
        .toContainText('归属：当前 Flow 页面 · 正文上方')
      await expect(page.getByTestId('flow-authoring-surface-overlay')
        .getByTestId('flow-layer-card-wave-c-overlay'))
        .toHaveAttribute('data-flow-body-plane', 'overlay')

      await page.getByTestId('flow-move-across-body-wave-c-overlay').click()
      await expect(page.getByTestId('nodes-layer-group-surface-overlay')).toHaveCount(0)
      await expect(page.getByTestId('nodes-layer-group-surface-underlay'))
        .toContainText('正文下方')
      await expect(page.getByTestId('node-source-wave-c-overlay'))
        .toContainText('归属：当前 Flow 页面 · 正文下方')
      await expect(page.getByTestId('flow-authoring-surface-underlay')
        .getByTestId('flow-layer-card-wave-c-overlay'))
        .toHaveAttribute('data-flow-body-plane', 'underlay')

      const saved = await saveCurrent(page, projectPath, project => {
        const surface = requireFlowSurface(project)
        return plainDocumentText(requireBlock(surface, 'flow-paragraph', 'paragraph').content) === `${FORMAT_TEXT}新` && surface.surfaceLayerItems[0]?.bodyPlane === 'underlay'
      })
      const savedParagraph = requireBlock(requireFlowSurface(saved), 'flow-paragraph', 'paragraph')
      expect(requireFlowSurface(saved).surfaceLayerItems[0]?.bodyPlane).toBe('underlay')
      expect(saved.revision).toBeGreaterThan(formatBaseline.revision)
      expect(plainDocumentText(savedParagraph.content)).toBe(`${FORMAT_TEXT}新`)
      expect(savedParagraph.content.inlines).toEqual([
        { type: 'text', text: '甲乙' },
        { type: 'text', text: '丙丁', style: { bold: true, fontFamily: 'SimSun', fontSize: 30 } },
        { type: 'text', text: '戊己庚辛' },
        { type: 'text', text: '新', style: { fontFamily: 'KaiTi', fontSize: 32 } },
      ])

      await page.getByRole('button', { name: '新建课件（Ctrl+N）' }).click()
      await expect(page.getByTestId('flow-workspace')).toHaveCount(0)
      await page.getByRole('button', { name: '打开工程（Ctrl+O）' }).click()
      await expect(page.getByTestId('flow-workspace')).toBeVisible({ timeout: 15_000 })
      const reopenedParagraph = page.getByTestId('flow-block-flow-paragraph')
      await expect(reopenedParagraph)
        .toHaveText(`${FORMAT_TEXT}新`)
      await expectPublishedRangeStyles(reopenedParagraph)

      // 紧凑布局下属性面板覆盖层（top:40px/z-index:40）压住画布右上的「画布模式」开关；
      // 点击前先关闭面板（同 editor.spec.ts showEditorCanvas / r18-089 showEditorPanel(page,null)）。
      const closePanel = page.locator('[aria-label="课件编辑面板"]')
        .getByRole('button', { name: '关闭面板', exact: true })
      if (await closePanel.isVisible()) await closePanel.click()
      const canvasMode = page.getByRole('group', { name: '画布模式' })
      const tryRunButton = canvasMode.getByRole('button', { name: '当前位置试运行', exact: true })
      await tryRunButton.click()
      await expect(tryRunButton).toHaveAttribute('aria-pressed', 'true')
      const tryRunArticle = page.getByRole('main').getByTestId('flow-runtime-article')
      await expect(tryRunArticle).toBeVisible({ timeout: 15_000 })
      await expectPublishedRangeStyles(tryRunArticle.locator('[data-flow-block-id="flow-paragraph"]'))
      await canvasMode.getByRole('button', { name: '编辑状态', exact: true }).click()
      await expect(tryRunArticle).toBeHidden()
    })

    await test.step('current media fields persist and all three actual rect tiers match Editor and Player', async () => {
      const editBlock = page.getByTestId('flow-block-wave-c-media-edit')
      // The video center belongs to native playback controls; the caption selects its media block.
      await editBlock.locator('[data-document-slot="caption"]').click()
      await openEditorTab(page, '属性')
      await expect(page.getByTestId('flow-media-properties')).toBeVisible()
      const altText = page.getByLabel('替代文本', { exact: true })
      await altText.fill('Wave C 新替代文本')
      await altText.press('Enter')
      const caption = editBlock.locator('[data-document-slot="caption"]')
      await caption.click()
      await page.keyboard.press('Home'); await page.keyboard.press('Shift+End')
      await page.keyboard.insertText('Wave C 新题注')
      await page.getByLabel('版式', { exact: true }).selectOption('wide')
      const wrap = page.getByLabel('文字环绕', { exact: true })
      await wrap.selectOption('right')
      await expect(wrap).toHaveValue('right')
      await wrap.selectOption('none')
      await expect(wrap).toHaveValue('none')
      await page.getByLabel('替换素材', { exact: true }).selectOption('clip-replacement')

      const editedVideo = editBlock.locator('video')
      await expect(editedVideo).toHaveAttribute('data-flow-asset-id', 'clip-replacement')
      await expect(editedVideo).toHaveAttribute('aria-label', 'Wave C 新替代文本')
      await expect(editedVideo).toHaveAttribute('controls', '')
      await expect(editedVideo).toHaveAttribute('src', /^blob:/)
      await expect(editBlock.locator('[data-document-slot="caption"]')).toHaveText('Wave C 新题注')
      await expect(editBlock).toHaveAttribute('data-flow-media-layout', 'wide')
      await expect(page.getByTestId('flow-block-wave-c-media-content').locator('img'))
        .toHaveAttribute('src', /^blob:/)
      await expect(page.getByTestId('flow-block-wave-c-media-wide').locator('img'))
        .toHaveAttribute('src', /^blob:/)
      const editorVideo = page.getByTestId('flow-block-wave-c-media-full').locator('video')
      await expect(editorVideo).toHaveAttribute('controls', '')
      await expect(editorVideo).toHaveAttribute('aria-label', '全宽讲解视频')
      await expect(editorVideo).toHaveAttribute('src', /^blob:/)

      const editorMeasurement = await measureMedia(
        page.getByTestId('flow-workspace-scroll'),
        page.getByTestId('flow-workspace'),
      )
      expectMediaProjection(editorMeasurement)

      const saved = await saveCurrent(page, projectPath, project => {
        const media = requireBlock(requireFlowSurface(project), 'wave-c-media-edit', 'media')
        return media.assetId === 'clip-replacement' && media.altText === 'Wave C 新替代文本' && media.layout === 'wide' && media.wrap === 'none' && plainDocumentText(media.caption!) === 'Wave C 新题注'
      })
      const savedMedia = requireBlock(requireFlowSurface(saved), 'wave-c-media-edit', 'media')
      expect(savedMedia).toMatchObject({
        assetId: 'clip-replacement',
        mediaKind: 'video',
        altText: 'Wave C 新替代文本',
        caption: { inlines: [{ type: 'text', text: 'Wave C 新题注' }] },
        layout: 'wide',
        wrap: 'none',
      })

      await page.getByRole('button', { name: '整课预览' }).click()
      const preview = page.getByTestId('course-preview-overlay')
      const previewHost = page.getByTestId('course-preview-host')
      await expect(preview).toBeVisible()
      const playerArticle = previewHost.getByTestId('flow-runtime-article')
      await expect(playerArticle).toBeVisible({ timeout: 15_000 })
      await expectPublishedRangeStyles(previewHost.locator('[data-flow-block-id="flow-paragraph"]'))
      await expect(previewHost.getByTestId('flow-runtime-surface-underlay')
        .locator('[data-flow-overlay-item="wave-c-overlay"]'))
        .toHaveAttribute('data-flow-body-plane', 'underlay')
      await expect(previewHost.locator('[data-flow-block-id="wave-c-media-content"] img'))
        .toHaveAttribute('src', /^(?:blob:|data:image\/)/)
      await expect(previewHost.locator('[data-flow-block-id="wave-c-media-wide"] img'))
        .toHaveAttribute('src', /^(?:blob:|data:image\/)/)
      const playerVideo = previewHost.locator('[data-flow-block-id="wave-c-media-full"] video')
      await expect(playerVideo).toHaveAttribute('controls', '')
      await expect(playerVideo).toHaveAttribute('src', /^(?:blob:|data:video\/)/)
      const playerEditedVideo = previewHost.locator('[data-flow-block-id="wave-c-media-edit"] video')
      await expect(playerEditedVideo).toHaveAttribute('controls', '')
      await expect(playerEditedVideo).toHaveAttribute('src', /^(?:blob:|data:video\/)/)
      const playerMeasurement = await measureMedia(playerArticle, previewHost)
      expectMediaProjection(playerMeasurement)
      expect(editorMeasurement.layouts).toEqual(playerMeasurement.layouts)
      expect(editorMeasurement.tiers).toEqual(playerMeasurement.tiers)
      await expectBackgroundWindowsIsolated(app, true)
      await preview.getByRole('button', { name: '关闭预览' }).click()
      await expect(preview).toHaveCount(0)
    })

    expectCleanDiagnostics(launch)
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('failure.png'), fullPage: true }).catch(() => undefined)
    await test.info().attach('failure-state', { body: JSON.stringify({
      alerts: await page.getByRole('alert').allTextContents().catch(() => []),
      workspace: await page.getByTestId('flow-workspace').evaluate(element => Object.fromEntries(Array.from(element.attributes).map(attribute => [attribute.name, attribute.value]))).catch(() => null),
      diagnostics: { pageErrors: launch.pageErrors, consoleErrors: launch.consoleErrors, consoleWarnings: launch.consoleWarnings },
      savedProject: readProject(projectPath),
    }), contentType: 'application/json' })
    throw error
  } finally {
    await closeEditor(app, launch.runRoot)
  }
})
