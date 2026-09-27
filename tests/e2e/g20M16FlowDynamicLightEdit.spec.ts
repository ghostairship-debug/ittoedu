import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { componentPackagesToArchiveFiles } from '../../src/renderer/components/componentPackageStore'
import { componentPackageMeta } from '../../src/shared/componentPackageMeta'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { ComponentLayerItem, FlowSurfaceDocument, RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { cardPackage } from './helpers/g20M15Harness'
import { root, solidPng } from './helpers/g20M19Harness'
import { selectionServer, setupSelectionUI } from './helpers/g20SelectionHarness'

const name = 'Flow 动态轻编辑.h5lesson'
const runtimeId = 'm16-light-runtime'
const componentId = 'm16-light-component'
const initialFallbackId = 'm16-light-initial-fallback'
const oldText = 'Flow 页面原文字'
const newText = 'Flow 页面新文字'
const newCardText = '词语卡片：Flow 已修改'
const cardPicture = solidPng(160, 90, [220, 38, 38])
const runtimePicture = solidPng(160, 90, [124, 58, 237])
const originalPicture = solidPng(160, 90, [22, 163, 74])
const runtimeSource = `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
  var panel=document.createElement('section');panel.style.cssText='position:relative;width:100%;height:260px;background:#fef3c7';
  var heading=document.createElement('h2');heading.dataset.m16LightRuntimeText='true';
  heading.textContent='${oldText}';heading.style.cssText='position:absolute;left:20px;top:16px;margin:0;font:bold 28px sans-serif';
  var image=document.createElement('img');image.dataset.m16LightRuntimeImage='true';
  image.style.cssText='position:absolute;left:20px;top:72px;width:160px;height:90px';image.src=ctx.assets.url('hero');
  var button=document.createElement('button');button.type='button';button.dataset.m16LightRuntimeButton='true';
  button.textContent='运行交互';button.style.cssText='position:absolute;left:210px;top:100px';
  var result=document.createElement('output');result.dataset.m16LightRuntimeResult='true';
  var clickCount=0;button.onclick=function(){result.textContent=++clickCount===1?'交互成功':'再次交互成功'};
  var corner=document.createElement('button');corner.type='button';corner.dataset.m16LightRuntimeCorner='true';
  corner.textContent='右上交互';corner.style.cssText='position:absolute;right:8px;top:8px';
  var cornerResult=document.createElement('output');cornerResult.dataset.m16LightRuntimeCornerResult='true';
  corner.onclick=function(){cornerResult.textContent='右上可用'};
  panel.append(heading,image,button,result,corner,cornerResult);ctx.dom.root.appendChild(panel);
  return {destroy(){panel.remove()}};
}});`

function fixture() {
  const project = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('Flow fixture missing')
  const anchor = flow.blocks.find(block => block.type === 'paragraph')
  if (!anchor) throw new Error('Flow page anchor missing')
  const card = cardPackage()
  project.componentPackages[card.manifest.id] = componentPackageMeta(card)
  project.assets['m16-light-original'] = { id: 'm16-light-original', filename: 'original.png', mimeType: 'image/png', kind: 'image',
    path: 'assets/m16-light-original.png', byteLength: originalPicture.byteLength, width: 160, height: 90 }
  project.assets[initialFallbackId] = { id: initialFallbackId, filename: 'initial-fallback.png', mimeType: 'image/png', kind: 'image',
    path: `assets/${initialFallbackId}.png`, byteLength: originalPicture.byteLength, width: 160, height: 90 }
  const runtime: RuntimeLayerItem = {
    kind: 'runtime', layerItemId: runtimeId, label: 'Flow 页面 Runtime', order: 1, visible: true, locked: false,
    rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', paperSpace: 'paper',
    frame: { mode: 'absolute', x: 40, y: 130, width: 440, height: 260 },
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source: runtimeSource,
      content: { values: {} }, assets: { hero: { assetId: 'm16-light-original' } },
      staticFallback: { assetId: initialFallbackId, coverage: 'scene' } },
  }
  const component: ComponentLayerItem = {
    kind: 'component', layerItemId: componentId, label: 'Flow 词语卡片', order: 2, visible: true, locked: false,
    rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', paperSpace: 'paper',
    frame: { mode: 'absolute', x: 500, y: 130, width: 400, height: 300 },
    component: { packageId: card.manifest.id, version: card.manifest.version }, props: {},
    staticFallbackAssetId: initialFallbackId,
  }
  flow.surfaceLayerItems.push(
    { item: runtime, visibility: { mode: 'all', locationIds: [] }, bodyPlane: 'overlay',
      paragraphAnchor: { blockId: anchor.id, offsetY: 0, xRatio: 0 } },
    { item: component, visibility: { mode: 'all', locationIds: [] }, bodyPlane: 'overlay' },
  )
  const parsed = courseProjectDocumentSchema.parse(project)
  return createCourseProjectArchive({ project: parsed, assetFiles: { 'm16-light-original': originalPicture, [initialFallbackId]: originalPicture },
    componentFiles: componentPackagesToArchiveFiles({ [card.manifest.id]: card }) })
}

async function snapshot(page: Page, documentId: string) {
  const value = await page.evaluate(id => window.desktopAPI.documents!.read(id), documentId)
  if (value.model.kind !== 'course-v9') throw new Error('Expected Course Project V9')
  const flow = value.model.project.surfaces.find((surface): surface is FlowSurfaceDocument => surface.type === 'flow')
  if (!flow) throw new Error('Flow surface missing')
  const runtimeEntry = flow.surfaceLayerItems.find(entry => entry.item.layerItemId === runtimeId)
  const runtime = runtimeEntry?.item
  const component = flow.surfaceLayerItems.find(entry => entry.item.layerItemId === componentId)?.item
  if (runtime?.kind !== 'runtime' || component?.kind !== 'component') throw new Error('Dynamic items missing')
  return { revision: value.revision, undoDepth: value.undoDepth, redoDepth: value.redoDepth, dirty: value.dirty,
    runtimeAnchorBlockId: runtimeEntry?.paragraphAnchor?.blockId,
    runtime: { content: runtime.runtime.content, assets: runtime.runtime.assets, fallback: runtime.runtime.staticFallback?.assetId, source: runtime.runtime.source },
    component: { textOverrides: component.textOverrides ?? [], assetOverrides: component.assetOverrides ?? {}, fallback: component.staticFallbackAssetId },
    assetIds: Object.keys(value.model.project.assets) }
}

test('M16 Flow paper Runtime and managed Component light edits commit with fallback, history, reopen and try-run', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows Electron host acceptance path.')
  test.setTimeout(360_000)
  const base = join(root, 'output/g20/m16/flow-dynamic-light-edit')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  writeFileSync(join(workspace, name), fixture())
  const cardImagePath = join(directory, 'card-replacement.png')
  const runtimeImagePath = join(directory, 'runtime-replacement.png')
  writeFileSync(cardImagePath, cardPicture)
  writeFileSync(runtimeImagePath, runtimePicture)
  const errors: string[] = []
  const evidence: Record<string, unknown> = { run: directory, pageErrors: errors }
  const model = await selectionServer()
  let app: ElectronApplication | undefined
  let evidencePage: Page | undefined
  try {
    app = await electron.launch({ cwd: resolve(__dirname, '../..'), args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    evidencePage = page
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await setupSelectionUI(app, page, model.endpoint, workspace)
    await app.evaluate(({ dialog }, folder) => {
      const state = globalThis as unknown as { m16LightImage?: string }
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.find(value => value && typeof value === 'object' && 'properties' in (value as object)) as { properties?: string[] } | undefined
        return { canceled: false, filePaths: [(options?.properties ?? []).includes('openDirectory') ? folder : state.m16LightImage ?? ''] }
      }
    }, workspace)
    const pick = (path: string) => app!.evaluate((_electron, value) => { (globalThis as unknown as { m16LightImage?: string }).m16LightImage = value }, path)
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name, exact: true }).dblclick()
    const frame = page.locator('.course-editor-frame:visible')
    const documentId = await frame.getAttribute('data-document-id')
    if (!documentId) throw new Error('DocumentSession was not bound')
    // Paper overlays are siblings of the article, scoped to the visible editor frame.
    const runtime = frame.getByTestId(`flow-layer-card-${runtimeId}`)
    const runtimeEditToggle = frame.getByTestId('flow-workspace-toolbar-host').getByTestId('flow-runtime-edit-mode-toggle')
    const component = frame.getByTestId(`flow-layer-card-${componentId}`)
    const textEditor = page.getByTestId('canvas-plain-text-editor').locator('input, textarea')
    const initial = await snapshot(page, documentId)
    evidence.initial = initial
    expect(initial.runtimeAnchorBlockId).toBeTruthy()
    expect(initial.runtime.fallback).toBe(initialFallbackId)
    expect(initial.component.fallback).toBe(initialFallbackId)
    await expect(runtime.getByTestId('flow-page-runtime')).toBeVisible()
    await expect(runtime.locator('[data-m16-light-runtime-text]')).toHaveText(oldText)
    await expect(component.locator('[data-m15-card-title]')).toHaveText('词语卡片')

    // UI controls are generated by the live DOM host; a Main read after each edit is the ACK boundary.
    await expect(component.getByTestId('flow-component-authoring-targets').getByRole('button', { name: /词语卡片.*编辑组件文字/ })).toBeVisible()
    await component.getByTestId('flow-component-authoring-targets').getByRole('button', { name: /词语卡片.*编辑组件文字/ }).click()
    await expect(textEditor).toHaveValue('词语卡片')
    await textEditor.fill(newCardText)
    await textEditor.press('Enter')
    await expect.poll(async () => (await snapshot(page, documentId)).component.textOverrides).toContainEqual({ original: '词语卡片', region: 'section>h3', text: newCardText })
    const afterCardText = await snapshot(page, documentId)
    expect(afterCardText.undoDepth).toBe(initial.undoDepth + 1)
    expect(afterCardText.component.fallback).toBeTruthy()
    expect(afterCardText.component.fallback).not.toBe(initialFallbackId)
    await expect(component.locator('[data-m15-card-title]')).toHaveText(newCardText)

    await pick(cardImagePath)
    await component.getByTestId('flow-component-authoring-targets').getByRole('button', { name: /替换组件图片/ }).click()
    await expect.poll(async () => (await snapshot(page, documentId)).component.assetOverrides.pic?.assetId).toBeTruthy()
    const afterCardImage = await snapshot(page, documentId)
    expect(afterCardImage.undoDepth).toBe(afterCardText.undoDepth + 1)
    expect(afterCardImage.component.fallback).toBeTruthy()
    expect(afterCardImage.component.fallback).not.toBe(afterCardText.component.fallback)
    const cardAssetId = afterCardImage.component.assetOverrides.pic!.assetId
    await expect.poll(() => component.locator('[data-m15-card-picture]').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

    await expect(runtime.getByTestId('flow-runtime-light-edit-targets')).toHaveCount(0)
    await runtime.locator('[data-m16-light-runtime-corner]').click()
    await expect(runtime.locator('[data-m16-light-runtime-corner-result]')).toHaveText('右上可用')
    await runtime.locator('[data-m16-light-runtime-button]').click()
    await expect(runtime.locator('[data-m16-light-runtime-result]')).toHaveText('交互成功')
    await expect(runtimeEditToggle).toBeVisible()
    await runtimeEditToggle.click()
    await expect(runtime.locator('[data-m16-light-runtime-result]')).toHaveText('交互成功')
    await expect(runtime.getByTestId('flow-runtime-light-edit-targets').getByRole('button', { name: /Flow 页面原文字.*编辑文字/ })).toBeVisible()
    const buttonTarget = runtime.getByTestId('flow-runtime-light-edit-targets').getByRole('button', { name: /运行交互.*编辑文字/ })
    await expect(buttonTarget).toBeVisible()
    const buttonBounds = await runtime.locator('[data-m16-light-runtime-button]').boundingBox()
    const targetBounds = await buttonTarget.boundingBox()
    if (!buttonBounds || !targetBounds) throw new Error('Runtime button or edit target has no layout')
    expect(Math.min(buttonBounds.x + buttonBounds.width, targetBounds.x + targetBounds.width))
      .toBeGreaterThan(Math.max(buttonBounds.x, targetBounds.x))
    expect(Math.min(buttonBounds.y + buttonBounds.height, targetBounds.y + targetBounds.height))
      .toBeGreaterThan(Math.max(buttonBounds.y, targetBounds.y))
    await runtimeEditToggle.click()
    await expect(runtime.getByTestId('flow-runtime-light-edit-targets')).toHaveCount(0)
    await runtime.locator('[data-m16-light-runtime-button]').click()
    await expect(runtime.locator('[data-m16-light-runtime-result]')).toHaveText('再次交互成功')
    await runtimeEditToggle.click()
    await expect(runtime.getByTestId('flow-runtime-light-edit-targets').getByRole('button', { name: /Flow 页面原文字.*编辑文字/ })).toBeVisible()
    await runtime.getByTestId('flow-runtime-light-edit-targets').getByRole('button', { name: /Flow 页面原文字.*编辑文字/ }).click()
    await expect(textEditor).toHaveValue(oldText)
    await textEditor.fill(newText)
    await textEditor.press('Enter')
    await expect.poll(async () => (await snapshot(page, documentId)).runtime.content.overrides ?? []).toContainEqual({ original: oldText, region: 'section>h2', text: newText })
    const afterRuntimeText = await snapshot(page, documentId)
    expect(afterRuntimeText.undoDepth).toBe(afterCardImage.undoDepth + 1)
    expect(afterRuntimeText.runtime.fallback).toBeTruthy()
    expect(afterRuntimeText.runtime.fallback).not.toBe(initialFallbackId)
    await expect(runtime.locator('[data-m16-light-runtime-text]')).toHaveText(newText)

    await pick(runtimeImagePath)
    await runtime.getByTestId('flow-runtime-light-edit-targets').getByRole('button', { name: /替换图片/ }).click()
    await expect.poll(async () => (await snapshot(page, documentId)).runtime.assets.hero.assetId).not.toBe('m16-light-original')
    const edited = await snapshot(page, documentId)
    expect(edited.undoDepth).toBe(afterRuntimeText.undoDepth + 1)
    expect(edited.runtime.fallback).toBeTruthy()
    expect(edited.runtime.fallback).not.toBe(afterRuntimeText.runtime.fallback)
    const runtimeAssetId = edited.runtime.assets.hero.assetId
    evidence.edited = edited
    await runtimeEditToggle.click()
    await expect(runtime.getByTestId('flow-runtime-light-edit-targets')).toHaveCount(0)
    await page.screenshot({ path: join(directory, 'edited.png') })

    await page.keyboard.press('Control+Z')
    await expect.poll(async () => (await snapshot(page, documentId)).runtime.assets.hero.assetId).toBe('m16-light-original')
    const undone = await snapshot(page, documentId)
    expect(undone.undoDepth).toBe(edited.undoDepth - 1)
    expect(undone.runtime.content.overrides).toContainEqual({ original: oldText, region: 'section>h2', text: newText })
    expect(undone.runtime.fallback).toBe(afterRuntimeText.runtime.fallback)
    evidence.undone = undone
    await page.getByLabel('常用工具').getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, documentId)).runtime.assets.hero.assetId).toBe(runtimeAssetId)
    const redone = await snapshot(page, documentId)
    expect(redone.redoDepth).toBe(0)
    expect(redone.runtime.fallback).toBe(edited.runtime.fallback)
    evidence.redone = redone

    await page.keyboard.press('Control+S')
    await expect.poll(async () => (await snapshot(page, documentId)).dirty).toBe(false)
    const saved = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, name))))
    const savedFlow = saved.project.surfaces.find(surface => surface.type === 'flow')
    if (savedFlow?.type !== 'flow') throw new Error('Saved Flow surface missing')
    const savedRuntime = savedFlow.surfaceLayerItems.find(entry => entry.item.layerItemId === runtimeId)?.item
    const savedCard = savedFlow.surfaceLayerItems.find(entry => entry.item.layerItemId === componentId)?.item
    if (savedRuntime?.kind !== 'runtime' || savedCard?.kind !== 'component') throw new Error('Saved dynamic items missing')
    expect(savedRuntime.runtime.source).toBe(runtimeSource)
    expect(savedRuntime.runtime.content.overrides).toContainEqual({ original: oldText, region: 'section>h2', text: newText })
    expect(savedRuntime.runtime.assets.hero.assetId).toBe(runtimeAssetId)
    expect(savedCard.textOverrides).toContainEqual({ original: '词语卡片', region: 'section>h3', text: newCardText })
    expect(savedCard.assetOverrides?.pic?.assetId).toBe(cardAssetId)
    expect(saved.assetFiles[cardAssetId]).toEqual(cardPicture)
    expect(saved.assetFiles[runtimeAssetId]).toEqual(runtimePicture)
    const runtimeFallback = savedRuntime.runtime.staticFallback?.assetId
    const cardFallback = savedCard.staticFallbackAssetId
    expect(runtimeFallback).toBeTruthy()
    expect(cardFallback).toBeTruthy()
    expect(runtimeFallback).not.toBe(initialFallbackId)
    expect(cardFallback).not.toBe(initialFallbackId)
    expect(saved.assetFiles[runtimeFallback!]?.byteLength).toBeGreaterThan(0)
    expect(saved.assetFiles[cardFallback!]?.byteLength).toBeGreaterThan(0)
    evidence.saved = { cardAssetId, runtimeAssetId, runtimeFallback, cardFallback }

    await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${name}`, exact: true }).click()
    await tree.getByRole('button', { name, exact: true }).dblclick()
    const reopenedId = await frame.getAttribute('data-document-id')
    if (!reopenedId || reopenedId === documentId) throw new Error('Course did not reopen into a new DocumentSession')
    await expect(runtime.locator('[data-m16-light-runtime-text]')).toHaveText(newText)
    await expect(component.locator('[data-m15-card-title]')).toHaveText(newCardText)
    await expect.poll(() => runtime.locator('[data-m16-light-runtime-image]').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await page.getByRole('group', { name: '画布模式' }).getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const player = page.getByTestId('flow-try-run-host')
    await expect(player.locator('[data-m16-light-runtime-text]')).toHaveText(newText)
    await expect(player.locator('[data-m15-card-title]')).toHaveText(newCardText)
    await player.locator('[data-m16-light-runtime-button]').click()
    await expect(player.locator('[data-m16-light-runtime-result]')).toHaveText('交互成功')
    await page.screenshot({ path: join(directory, 'reopened-try-run.png') })
    evidence.reopenedId = reopenedId
    expect(model.requests).toHaveLength(0)
    expect(errors).toEqual([])
  } finally {
    if (evidencePage && !evidencePage.isClosed()) evidence.runtimeHost = await evidencePage.evaluate(() => {
      const card = document.querySelector('[data-testid="flow-layer-card-m16-light-runtime"]')
      return { cardHtml: card?.outerHTML.slice(0, 8_000) ?? null,
        mountedHosts: card?.querySelectorAll('[data-surface-runtime-root]').length ?? 0,
        fallbackHosts: card?.querySelectorAll('[data-runtime-fallback]').length ?? 0 }
    }).catch(error => ({ error: String(error) }))
    evidence.modelRequests = model.requests.length
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await info.attach('Flow dynamic light edit evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    await app?.evaluate(({ app: electronApp, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => undefined)
    await app?.close().catch(() => undefined)
    await model.close()
  }
})
