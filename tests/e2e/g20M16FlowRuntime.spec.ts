import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { addCourseFlowPage } from '../../src/core/tools/courseLocations'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseProjectDocument, CourseRuntimeDefinition, FlowSurfaceDocument, NativeLayerItem, RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
const runtimeId = 'm16-flow-long-runtime'
const nativeId = 'm16-flow-paper-annotation'
const runtimeSource = `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
  var expanded=false, root=document.createElement('section'); root.dataset.m16FlowRuntime='true';
  root.style.cssText='box-sizing:border-box;width:100%;padding:12px;background:#e0f2fe;border:2px solid #0369a1';
  var button=document.createElement('button'); button.type='button'; button.dataset.m16FlowRuntimeToggle='true';
  button.textContent='展开 Runtime 内容';
  var content=document.createElement('div'); content.dataset.m16FlowRuntimeContent='true';
  function render(){
    button.textContent=expanded?'收起 Runtime 内容':'展开 Runtime 内容';
    content.replaceChildren();
    var count=expanded?14:2;
    for(var i=0;i<count;i++){var p=document.createElement('p');p.textContent='Runtime 页面内容 '+(i+1);p.style.cssText='height:42px;margin:8px 0';content.appendChild(p)}
  }
  button.addEventListener('click',function(){expanded=!expanded;render()});
  root.append(button,content); ctx.dom.root.appendChild(root); render();
  return {destroy(){button.remove();root.remove()}};
}});`

function runtime(): CourseRuntimeDefinition {
  return { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source: runtimeSource,
    content: { values: {} }, assets: {} }
}

function fixture(): Uint8Array {
  let project = createBlankCourseProject({ title: 'M16 Flow Runtime 长内容', now: '2026-09-27T00:00:00.000Z' })
  const added = addCourseFlowPage(project, { title: 'Runtime 长页面', expectedRevision: project.revision })
  if (!added.ok) throw new Error(added.reason)
  project = added.project
  const flow = project.surfaces.find((surface): surface is FlowSurfaceDocument => surface.type === 'flow')
  if (!flow) throw new Error('Flow page was not created')
  const heading = flow.blocks[0]
  const anchor = flow.blocks[1]
  if (heading?.type !== 'heading' || anchor?.type !== 'paragraph') throw new Error('Flow fixture blocks are incomplete')
  heading.content.inlines = [{ type: 'text', text: 'Runtime 前置正文' }]
  anchor.content.inlines = [{ type: 'text', text: 'Runtime 后续正文' }]
  flow.blocks.push({ id: 'm16-flow-tail', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Runtime 页面尾部正文' }] } })

  const runtimeItem: RuntimeLayerItem = {
    layerItemId: runtimeId, label: '长内容 DOM Runtime', kind: 'runtime',
    frame: { mode: 'absolute', x: 44, y: 260, width: 760, height: 150 }, order: 10,
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', runtime: runtime(),
  }
  flow.surfaceLayerItems.push({ item: runtimeItem, visibility: { mode: 'all', locationIds: [] },
    paragraphAnchor: { blockId: anchor.id, offsetY: 0, xRatio: 0 }, bodyPlane: 'overlay' })

  const native = sceneNodeToCourseLayerItem(createTextNode({ id: nativeId, name: '纸面原生标注', text: 'Native 纸面标注', x: 110, y: 360,
    width: 320, height: 76, style: { fontSize: 28, bold: true, color: '#7c2d12', backgroundColor: '#ffedd5' } })) as NativeLayerItem
  native.paperSpace = 'paper'
  flow.surfaceLayerItems.push({ item: native, visibility: { mode: 'all', locationIds: [] },
    paragraphAnchor: { blockId: anchor.id, offsetY: 80, xRatio: 0 }, bodyPlane: 'overlay' })
  project.startLocationId = project.locations.find(location => location.kind === 'flow-block' && location.surfaceId === flow.id)!.id
  const parsed: CourseProjectDocument = courseProjectDocumentSchema.parse(project)
  return createCourseProjectArchive({ project: parsed, assetFiles: {}, componentFiles: {} })
}

test('M16-T03 Flow Runtime edits real long DOM content, reserves body height, overlays Native and runs/reopens the same source', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M16-T03 exercises the Windows Electron workbench.')
  test.setTimeout(180_000)
  const output = join(root, 'output/g20/m16/flow-runtime')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const name = 'Flow Runtime 长内容.h5lesson'
  const coursePath = join(workspace, name)
  writeFileSync(coursePath, fixture())
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name, exact: true }).dblclick()
    const frame = page.locator('.course-editor-frame:visible')
    const documentId = await frame.getAttribute('data-document-id')
    if (!documentId) throw new Error('Course editor did not bind a DocumentSession')
    const flow = page.getByTestId('flow-workspace')
    await expect(flow).toBeVisible()
    const runtimeRoot = page.locator('[data-m16-flow-runtime="true"]')
    const runtimeToggle = page.locator('[data-m16-flow-runtime-toggle="true"]')
    const paper = page.getByTestId('flow-paper')
    const tail = paper.locator('[data-flow-block-id="m16-flow-tail"]')
    const nativeOverlay = page.locator(`[data-layer-item-id="${nativeId}"]`)
    await expect(runtimeRoot).toBeVisible()
    await expect(runtimeRoot.locator('[data-m16-flow-runtime-content] p')).toHaveCount(2)
    await expect(paper.getByText('Runtime 前置正文', { exact: true })).toBeVisible()
    await expect(tail).toContainText('Runtime 页面尾部正文')
    await expect(nativeOverlay).toBeVisible()
    await expect(nativeOverlay).toContainText('Native 纸面标注')

    const geometry = async () => page.evaluate(({ tailSelector, runtimeSelector, nativeSelector }) => {
      const tailElement = document.querySelector(tailSelector), runtimeElement = document.querySelector(runtimeSelector), nativeElement = document.querySelector(nativeSelector)
      const rect = (element: Element | null) => { if (!element) throw new Error('missing geometry element'); const value = element.getBoundingClientRect(); return { top: value.top, height: value.height, bottom: value.bottom } }
      const paper = document.querySelector('[data-testid="flow-paper"]')
      if (!(paper instanceof HTMLElement)) throw new Error('missing Flow paper')
      return { tail: rect(tailElement), runtime: rect(runtimeElement), native: rect(nativeElement), paperHeight: paper.scrollHeight }
    }, { tailSelector: '[data-flow-block-id="m16-flow-tail"]', runtimeSelector: '[data-m16-flow-runtime="true"]', nativeSelector: `[data-layer-item-id="${nativeId}"]` })
    const collapsed = await geometry()
    await runtimeToggle.click()
    await expect(runtimeRoot.locator('[data-m16-flow-runtime-content] p')).toHaveCount(14)
    await expect.poll(async () => (await geometry()).tail.top).toBeGreaterThan(collapsed.tail.top + 300)
    const expanded = await geometry()
    expect(expanded.paperHeight).toBeGreaterThan(collapsed.paperHeight + 300)
    expect(expanded.runtime.height).toBeGreaterThan(collapsed.runtime.height + 300)
    await expect(nativeOverlay).toBeVisible()
    expect(expanded.native.top).toBeGreaterThan(expanded.runtime.top)
    expect(expanded.native.top).toBeLessThan(expanded.runtime.bottom)
    await runtimeToggle.click()
    await expect(runtimeRoot.locator('[data-m16-flow-runtime-content] p')).toHaveCount(2)
    await expect.poll(async () => (await geometry()).tail.top).toBeLessThan(expanded.tail.top - 300)
    const collapsedAgain = await geometry()
    expect(collapsedAgain.paperHeight).toBeLessThan(expanded.paperHeight - 300)

    const source = await page.evaluate(id => {
      const snapshot = window.desktopAPI!.documents!.read(id)
      return snapshot.then(value => {
        if (value.model.kind !== 'course-v9') throw new Error('Expected Course Project V9')
        const surface = value.model.project.surfaces.find(candidate => candidate.type === 'flow')
        if (!surface || surface.type !== 'flow') throw new Error('Expected Flow surface')
        const runtime = surface.surfaceLayerItems.find(entry => entry.item.layerItemId === 'm16-flow-long-runtime')
        if (!runtime || runtime.item.kind !== 'runtime') throw new Error('Expected persisted Runtime source')
        return runtime.item.runtime.source
      })
    }, documentId)
    expect(source).toBe(runtimeSource)
    const mode = frame.getByRole('group', { name: '画布模式' })
    await mode.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const player = page.getByTestId('flow-try-run-host')
    const playerRuntime = player.locator('[data-m16-flow-runtime="true"]')
    const playerToggle = player.locator('[data-m16-flow-runtime-toggle="true"]')
    await expect(playerRuntime).toBeVisible()
    await expect(playerRuntime.locator('[data-m16-flow-runtime-content] p')).toHaveCount(2)
    await playerToggle.click()
    await expect(playerRuntime.locator('[data-m16-flow-runtime-content] p')).toHaveCount(14)
    await expect(player.locator('[data-layer-item-id="m16-flow-paper-annotation"]')).toContainText('Native 纸面标注')

    await mode.getByRole('button', { name: '编辑状态', exact: true }).click()
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    const documentApi = await page.evaluate(id => window.desktopAPI!.documents!.read(id), documentId)
    expect(documentApi.dirty).toBe(false)
    const saved = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    expect(saved.project.surfaces.find(surface => surface.type === 'flow')).toMatchObject({
      surfaceLayerItems: expect.arrayContaining([
        expect.objectContaining({ item: expect.objectContaining({ layerItemId: runtimeId, kind: 'runtime', runtime: { source: runtimeSource } }) }),
        expect.objectContaining({ item: expect.objectContaining({ layerItemId: nativeId, kind: 'native' }) }),
      ]),
    })
    await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    await page.locator('.workspace-document-tabs').getByRole('button', { name: `关闭 ${name}`, exact: true }).click()
    await tree.getByRole('button', { name, exact: true }).dblclick()
    const reopenedId = await frame.getAttribute('data-document-id')
    if (!reopenedId || reopenedId === documentId) throw new Error('Course did not reopen in a new DocumentSession')
    const reopenedRuntime = page.locator('[data-m16-flow-runtime="true"]')
    await expect(reopenedRuntime).toBeVisible()
    await expect(reopenedRuntime.locator('[data-m16-flow-runtime-content] p')).toHaveCount(2)
    await expect(page.locator(`[data-layer-item-id="${nativeId}"]`)).toContainText('Native 纸面标注')
    expect(errors).toEqual([])
    const screenshot = join(directory, 'm16-t03-flow-runtime.png')
    await page.screenshot({ path: screenshot, fullPage: false })
    await info.attach('M16-T03 Flow Runtime interaction evidence', { path: screenshot, contentType: 'image/png' })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ documentId, reopenedId, source,
      collapsed, expanded, collapsedAgain, nativeId, runtimeId, pageErrors: errors }, null, 2))
    await info.attach('M16-T03 Flow Runtime layout evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})
