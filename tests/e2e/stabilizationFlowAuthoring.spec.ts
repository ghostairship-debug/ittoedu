import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../../src/renderer/project/courseProjectArchive'
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

const root = resolve(__dirname, '..', '..')
const flowFixturePath = join(root, 'tests', 'fixtures', 'course-project-v9', 'flow.h5lesson')
const assetFixturePath = join(root, 'tests', 'fixtures', 'course-project-v9', 'multi-asset.h5lesson')
const FORMAT_TEXT = '甲乙丙丁戊己庚辛'
const MEDIA_PROBES = [
  { blockId: 'wave-c-media-content', layout: 'content-width', tier: 'reading' },
  { blockId: 'wave-c-media-wide', layout: 'wide', tier: 'wide' },
  { blockId: 'wave-c-media-full', layout: 'full-width', tier: 'container' },
] as const
const OUTLINE_IDS = [
  'flow-heading',
  'flow-paragraph',
  'flow-formula',
  'flow-section',
  'flow-section-note',
  'wave-c-media-edit',
  ...MEDIA_PROBES.map(({ blockId }) => blockId),
]

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
    await page.locator('[data-testid="canvas-stage"] canvas').waitFor()
    await expectBackgroundWindowsIsolated(app, true)
    const professional = page.getByRole('button', { name: '专业' })
    if (await professional.getAttribute('aria-pressed') !== 'true') await professional.click()
    return { app, page, runRoot, ...diagnostics }
  } catch (error) {
    if (app) await closeEditor(app, runRoot).catch(() => undefined)
    else removeRunRoot(runRoot)
    throw error
  }
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
      text: FORMAT_TEXT,
    },
    structuredClone(originalFormula),
    structuredClone(originalSection),
    {
      id: 'wave-c-media-edit',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'video',
      altText: '待编辑视频',
      caption: '待编辑题注',
      layout: 'content-width',
    },
    {
      id: 'wave-c-media-content',
      type: 'media',
      assetId: 'flow-image',
      mediaKind: 'image',
      altText: '正文宽图片',
      caption: '正文宽',
      layout: 'content-width',
    },
    {
      id: 'wave-c-media-wide',
      type: 'media',
      assetId: 'photo',
      mediaKind: 'image',
      altText: '较宽图片',
      caption: '较宽',
      layout: 'wide',
    },
    {
      id: 'wave-c-media-full',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'video',
      altText: '全宽讲解视频',
      caption: '全宽',
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
    componentFiles: {},
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

async function saveCurrent(page: Page, projectPath: string): Promise<CourseProjectDocument> {
  const previousMtime = statSync(projectPath).mtimeMs
  const saveButton = page.getByRole('button', { name: '保存（Ctrl+S）' })
  await page.waitForTimeout(25)
  await saveButton.click()
  await expect.poll(() => statSync(projectPath).mtimeMs, { timeout: 15_000 })
    .toBeGreaterThan(previousMtime)
  await expect(saveButton).toBeEnabled()
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
}> {
  const start = await flowTextPoint(editor, startOffset, 'start')
  const end = await flowTextPoint(editor, endCharacterOffset, 'end')
  const hitTargets = await page.evaluate((points) => points.map((point) => (
    document.elementFromPoint(point.x, point.y)?.closest('[data-testid="flow-inline-editor"]') !== null
  )), [start, end])
  expect(hitTargets).toEqual([true, true])
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await page.mouse.up()
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-testid="flow-inline-editor"]')
    const selection = document.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const inside = (node: Node | null) => Boolean(
      element && node && (node === element || element.contains(node)),
    )
    return {
      editorConnected: element?.isConnected === true,
      text: selection?.toString() ?? '',
      collapsed: range?.collapsed ?? true,
      inside: inside(range?.startContainer ?? null) && inside(range?.endContainer ?? null),
    }
  })
}

async function measureMedia(
  queryRoot: Locator,
  scope: Locator,
): Promise<MediaMeasurements> {
  const rootMetrics = await queryRoot.evaluate((element) => {
    const style = getComputedStyle(element)
    const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
    const rect = element.getBoundingClientRect()
    return {
      logicalContainerWidth: element.clientWidth - padding,
      visualScale: element.clientWidth > 0 ? rect.width / element.clientWidth : 1,
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

    await test.step('formula keeps its target through two real clicks and exposes explicit edit', async () => {
      const block = page.getByTestId('flow-block-flow-formula')
      const target = page.getByTestId('flow-formula-edit-target-flow-formula')
      await target.click()
      await expect(block).toHaveAttribute('aria-selected', 'true')
      await expect(target).toBeVisible()
      await expect(page.getByTestId('formula-edit-dialog')).toHaveCount(0)

      await target.click()
      await expect(page.getByTestId('formula-edit-dialog')).toBeVisible()
      await page.getByRole('button', { name: '关闭公式编辑' }).click()
      await expect(page.getByTestId('formula-edit-dialog')).toHaveCount(0)

      await page.getByTestId('flow-formula-edit-flow-formula').click()
      await expect(page.getByTestId('formula-edit-dialog')).toBeVisible()
      await page.getByRole('button', { name: '关闭公式编辑' }).click()
      await expect(page.getByTestId('formula-edit-dialog')).toHaveCount(0)
    })

    await test.step('real range formatting stays local while body outline and overlay order stay separate', async () => {
      const formatBaseline = readProject(projectPath)
      const paragraph = page.getByTestId('flow-block-flow-paragraph')
      await paragraph.dblclick()
      const editor = page.getByTestId('flow-inline-editor')
      await expect(editor).toBeFocused()
      expect(await selectRealTextRange(page, editor, 2, 3)).toEqual({
        editorConnected: true,
        text: '丙丁',
        collapsed: false,
        inside: true,
      })
      await expect(page.getByTestId('flow-toolbar-format-scope'))
        .toHaveAttribute('data-flow-format-mode', 'range')
      const bold = page.getByRole('button', { name: '局部加粗' })
      await expect(bold).toHaveAttribute('aria-pressed', 'false')
      await bold.click()
      await expect(bold).toHaveAttribute('aria-pressed', 'true')

      expect(await selectRealTextRange(page, editor, 0, 3)).toEqual({
        editorConnected: true,
        text: '甲乙丙丁',
        collapsed: false,
        inside: true,
      })
      await expect(page.getByTestId('flow-toolbar-format-scope')).toHaveText('选区 · 混合格式')
      await expect(page.getByRole('button', { name: '局部加粗' }))
        .toHaveAttribute('aria-pressed', 'mixed')

      await expect(editor).toBeFocused()
      await editor.evaluate((element) => {
        ;(window as Window & { __waveCCommitKeys?: unknown[] }).__waveCCommitKeys = []
        element.addEventListener('keydown', (event) => {
          const keyboardEvent = event as KeyboardEvent
          ;(window as Window & { __waveCCommitKeys?: unknown[] }).__waveCCommitKeys?.push({
            key: keyboardEvent.key,
            ctrlKey: keyboardEvent.ctrlKey,
            metaKey: keyboardEvent.metaKey,
            isComposing: keyboardEvent.isComposing,
          })
        }, { capture: true })
      })
      await editor.press('Control+Enter')
      expect(await page.evaluate(() => (
        (window as Window & { __waveCCommitKeys?: unknown[] }).__waveCCommitKeys
      ))).toContainEqual({ key: 'Enter', ctrlKey: true, metaKey: false, isComposing: false })
      await expect(editor).toHaveCount(0)

      await page.getByRole('tab', { name: '图层' }).click()
      const outline = page.getByTestId('flow-content-outline')
      const overlayRegion = page.getByTestId('flow-overlay-layers')
      await expect(outline).toContainText('正文大纲')
      await expect(page.getByTestId('flow-content-placement'))
        .toHaveText('归属：当前 Flow 页面 · 定位：跟随稿纸')
      await expect(page.getByTestId('flow-overlay-placement'))
        .toHaveText('归属：全课 / 当前 Flow 页面 · 定位：钉在视口')
      expect(await outline.locator('[data-testid^="flow-outline-block-"]').evaluateAll((rows) => (
        rows.map((row) => row.getAttribute('data-testid')?.replace('flow-outline-block-', ''))
      ))).toEqual(OUTLINE_IDS)
      await expect(page.getByTestId('flow-outline-block-flow-section-note'))
        .toHaveAttribute('data-depth', '1')
      await expect(outline.locator('.drag-handle')).toHaveCount(0)
      const overlayRow = page.getByTestId('node-item-wave-c-overlay')
      await expect(overlayRegion.locator('[data-testid="node-item-wave-c-overlay"]')).toBeVisible()
      await expect(overlayRow.locator('.drag-handle')).toBeVisible()
      await expect(overlayRegion).toContainText('可拖动调整前后层级')

      const saved = await saveCurrent(page, projectPath)
      const savedParagraph = requireBlock(requireFlowSurface(saved), 'flow-paragraph', 'paragraph')
      expect(saved.revision).toBe(formatBaseline.revision + 1)
      expect(savedParagraph.text).toBe(FORMAT_TEXT)
      expect(savedParagraph.runs).toEqual([
        { start: 2, end: 4, style: { bold: true } },
      ])
    })

    await test.step('current media fields persist and all three actual rect tiers match Editor and Player', async () => {
      const editBlock = page.getByTestId('flow-block-wave-c-media-edit')
      await editBlock.click()
      await page.getByRole('tab', { name: '属性' }).click()
      await expect(page.getByTestId('flow-media-properties')).toBeVisible()
      const altText = page.getByLabel('替代文本', { exact: true })
      await altText.fill('Wave C 新替代文本')
      await altText.press('Enter')
      const caption = page.getByLabel('题注', { exact: true })
      await caption.fill('Wave C 新题注')
      await caption.press('Enter')
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
      await expect(editBlock.locator('figcaption')).toHaveText('Wave C 新题注')
      await expect(editBlock.locator('figure')).toHaveAttribute('data-flow-media-layout', 'wide')
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

      const saved = await saveCurrent(page, projectPath)
      const savedMedia = requireBlock(requireFlowSurface(saved), 'wave-c-media-edit', 'media')
      expect(savedMedia).toMatchObject({
        assetId: 'clip-replacement',
        mediaKind: 'video',
        altText: 'Wave C 新替代文本',
        caption: 'Wave C 新题注',
        layout: 'wide',
        wrap: 'none',
      })

      await page.getByRole('button', { name: '全屏 16:9 整课预览' }).click()
      const preview = page.getByTestId('course-preview-overlay')
      const previewHost = page.getByTestId('course-preview-host')
      await expect(preview).toBeVisible()
      const playerArticle = previewHost.getByTestId('flow-runtime-article')
      await expect(playerArticle).toBeVisible({ timeout: 15_000 })
      await expect(previewHost.locator('[data-flow-block-id="wave-c-media-content"] img'))
        .toHaveAttribute('src', /^blob:/)
      await expect(previewHost.locator('[data-flow-block-id="wave-c-media-wide"] img'))
        .toHaveAttribute('src', /^blob:/)
      const playerVideo = previewHost.locator('[data-flow-block-id="wave-c-media-full"] video')
      await expect(playerVideo).toHaveAttribute('controls', '')
      await expect(playerVideo).toHaveAttribute('src', /^blob:/)
      const playerEditedVideo = previewHost.locator('[data-flow-block-id="wave-c-media-edit"] video')
      await expect(playerEditedVideo).toHaveAttribute('controls', '')
      await expect(playerEditedVideo).toHaveAttribute('src', /^blob:/)
      const playerMeasurement = await measureMedia(playerArticle, previewHost)
      expectMediaProjection(playerMeasurement)
      expect(editorMeasurement.layouts).toEqual(playerMeasurement.layouts)
      expect(editorMeasurement.tiers).toEqual(playerMeasurement.tiers)
      await expectBackgroundWindowsIsolated(app, true)
      await preview.getByRole('button', { name: '关闭预览' }).click()
      await expect(preview).toHaveCount(0)
    })

    expectCleanDiagnostics(launch)
  } finally {
    await closeEditor(app, launch.runRoot)
  }
})
