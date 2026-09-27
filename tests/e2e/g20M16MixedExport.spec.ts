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
const runtimeId = 'm16-mixed-export-runtime'
const nativeId = 'm16-mixed-export-native'
const runtimeSource = `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
  var root=document.createElement('section'); root.dataset.m16MixedRuntime='true';
  root.style.cssText='box-sizing:border-box;width:100%;padding:12px;background:#e0f2fe;border:2px solid #0369a1';
  var heading=document.createElement('h2'); heading.textContent='Runtime 改后标题';
  var button=document.createElement('button'); button.type='button'; button.dataset.m16MixedRun='true'; button.textContent='Runtime 互动已运行';
  button.addEventListener('click',function(){button.dataset.ran='true'});
  root.append(heading,button); ctx.dom.root.appendChild(root);
  return {destroy(){root.remove()}};
}});`

function fixture(): Uint8Array {
  let project = createBlankCourseProject({ title: 'M16 Flow 混合内容保全', now: '2026-09-27T00:00:00.000Z', includeDefaultController: false, controls: 'none' })
  const added = addCourseFlowPage(project, { title: '混合内容页', expectedRevision: project.revision })
  if (!added.ok) throw new Error(added.reason)
  project = added.project
  const flow = project.surfaces.find((surface): surface is FlowSurfaceDocument => surface.type === 'flow')
  if (!flow) throw new Error('Flow page was not created')
  const heading = flow.blocks[0]
  const body = flow.blocks[1]
  if (heading?.type !== 'heading' || body?.type !== 'paragraph') throw new Error('Flow fixture blocks are incomplete')
  heading.content.inlines = [{ type: 'text', text: 'Flow 正文原始标题' }]
  body.content.inlines = [{ type: 'text', text: 'Flow 正文原始段落' }]

  const runtime: CourseRuntimeDefinition = { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){var root=document.createElement('section');root.dataset.m16MixedRuntime='true';root.textContent='Runtime 原始内容';ctx.dom.root.appendChild(root);return{destroy(){root.remove()}}}});`, content: { values: {} }, assets: {} }
  const runtimeItem: RuntimeLayerItem = { layerItemId: runtimeId, label: '混合内容 Runtime', kind: 'runtime', frame: { mode: 'absolute', x: 44, y: 250, width: 760, height: 120 }, order: 10, visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', paperSpace: 'paper', runtime }
  flow.surfaceLayerItems.push({ item: runtimeItem, visibility: { mode: 'all', locationIds: [] }, paragraphAnchor: { blockId: body.id, offsetY: 0, xRatio: 0 }, bodyPlane: 'overlay' })
  const native = sceneNodeToCourseLayerItem(createTextNode({ id: nativeId, name: '纸面原生标注', text: 'Native 原始标注', x: 120, y: 390, width: 360, height: 76, style: { fontSize: 28, bold: true, color: '#7c2d12', backgroundColor: '#ffedd5' } })) as NativeLayerItem
  native.paperSpace = 'paper'
  native.order = 20
  flow.surfaceLayerItems.push({ item: native, visibility: { mode: 'all', locationIds: [] }, paragraphAnchor: { blockId: body.id, offsetY: 80, xRatio: 0 }, bodyPlane: 'overlay' })
  project.startLocationId = project.locations.find(location => location.kind === 'flow-block' && location.surfaceId === flow.id)!.id
  return createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project) as CourseProjectDocument, assetFiles: {}, componentFiles: {} })
}

test('M16-T04 Flow 正文、paper Native 与 Runtime 独立修改后保存重开并保全到离线导出预览', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M16-T04 exercises the Windows Electron workbench.')
  test.setTimeout(180_000)
  const output = join(root, 'output/g20/m16/mixed-export')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const name = 'Flow 混合内容保全.h5lesson'
  const coursePath = join(workspace, name)
  const exportPath = join(directory, 'mixed.html')
  writeFileSync(coursePath, fixture())
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: (globalThis as any).__m16MixedExportPath })
    }, workspace)
    await app.evaluate(({}, path) => { (globalThis as any).__m16MixedExportPath = path }, exportPath)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name, exact: true }).dblclick()
    const frame = page.locator('.course-editor-frame:visible')
    const documentId = await frame.getAttribute('data-document-id')
    if (!documentId) throw new Error('Course editor did not bind a DocumentSession')

    const edit = async (kind: 'body' | 'native' | 'runtime') => page.evaluate(async ({ documentId, kind, runtimeSource }) => {
      const documents = window.desktopAPI!.documents!
      const snapshot = await documents.read(documentId)
      if (snapshot.model.kind !== 'course-v9') throw new Error('Expected Course Project V9')
      const project = structuredClone(snapshot.model.project)
      const surface = project.surfaces.find(candidate => candidate.type === 'flow')
      if (!surface || surface.type !== 'flow') throw new Error('Expected Flow surface')
      if (kind === 'body') {
        const paragraph = surface.blocks.find(block => block.type === 'paragraph')
        if (!paragraph || paragraph.type !== 'paragraph') throw new Error('Flow paragraph missing')
        paragraph.content.inlines = [{ type: 'text', text: 'Flow 正文已修改' }]
      } else {
        const entry = surface.surfaceLayerItems.find(candidate => candidate.item.layerItemId === (kind === 'native' ? 'm16-mixed-export-native' : 'm16-mixed-export-runtime'))
        if (!entry) throw new Error(`${kind} layer missing`)
        if (kind === 'native') {
          if (entry.item.kind !== 'native' || entry.item.content.nativeType !== 'text') throw new Error('Expected paper Native text')
          entry.item.content.data.text = 'Native 纸面标注已修改'
        } else {
          if (entry.item.kind !== 'runtime') throw new Error('Expected Runtime layer')
          entry.item.runtime.source = runtimeSource
        }
      }
      const result = await documents.dispatch({ documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, actor: 'human', operationId: crypto.randomUUID(), mutation: { type: 'command', command: { type: 'course.replace', project } } })
      if (result.status !== 'applied') throw new Error(`${kind} edit did not commit: ${result.status}`)
      return documents.read(documentId)
    }, { documentId, kind, runtimeSource })

    await edit('body')
    await edit('native')
    const edited = await edit('runtime')
    await expect(page.getByTestId('flow-paper').getByText('Flow 正文已修改', { exact: true })).toBeVisible()
    await expect(page.locator(`[data-layer-item-id="${nativeId}"]`)).toContainText('Native 纸面标注已修改')
    await expect(page.locator('[data-m16-mixed-runtime="true"] h2')).toHaveText('Runtime 改后标题')

    await page.keyboard.press('Control+z')
    const undone = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), documentId)
    if (undone.model.kind !== 'course-v9') throw new Error('Expected course after undo')
    const undoneFlow = undone.model.project.surfaces.find(surface => surface.type === 'flow')
    if (!undoneFlow || undoneFlow.type !== 'flow') throw new Error('Flow missing after undo')
    const undoneRuntime = undoneFlow.surfaceLayerItems.find(entry => entry.item.layerItemId === 'm16-mixed-export-runtime')
    expect(undoneRuntime?.item).toMatchObject({ kind: 'runtime', runtime: { source: expect.not.stringContaining('Runtime 改后标题') } })
    await page.keyboard.press('Control+Shift+z')
    await expect(page.locator('[data-m16-mixed-runtime="true"] h2')).toHaveText('Runtime 改后标题')

    const mode = frame.getByRole('group', { name: '画布模式' })
    await mode.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const player = page.getByTestId('flow-try-run-host')
    await expect(player.getByText('Flow 正文已修改', { exact: true })).toBeVisible()
    await expect(player.locator('[data-flow-overlay-item="m16-mixed-export-native"]')).toContainText('Native 纸面标注已修改')
    await expect(player.locator('[data-m16-mixed-runtime="true"] h2')).toHaveText('Runtime 改后标题')
    await mode.getByRole('button', { name: '编辑状态', exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(async id => window.desktopAPI!.documents!.read(id), documentId)).dirty).toBe(false)

    await page.locator('.workspace-document-tabs').getByRole('button', { name: `关闭 ${name}`, exact: true }).click()
    await tree.getByRole('button', { name, exact: true }).dblclick()
    const reopenedId = await frame.getAttribute('data-document-id')
    if (!reopenedId || reopenedId === documentId) throw new Error('Course did not reopen in a new DocumentSession')
    await expect(page.getByTestId('flow-paper').getByText('Flow 正文已修改', { exact: true })).toBeVisible()
    await expect(page.locator(`[data-layer-item-id="${nativeId}"]`)).toContainText('Native 纸面标注已修改')
    await expect(page.locator('[data-m16-mixed-runtime="true"] h2')).toHaveText('Runtime 改后标题')
    const saved = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    const savedFlow = saved.project.surfaces.find(surface => surface.type === 'flow')
    expect(savedFlow).toMatchObject({ type: 'flow', blocks: expect.arrayContaining([expect.objectContaining({ type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Flow 正文已修改' }] } })]) })
    if (!savedFlow || savedFlow.type !== 'flow') throw new Error('Saved Flow surface missing')
    expect(savedFlow.surfaceLayerItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: expect.objectContaining({ layerItemId: nativeId, kind: 'native', content: expect.objectContaining({ data: expect.objectContaining({ text: 'Native 纸面标注已修改' }) }) }) }),
      expect.objectContaining({ item: expect.objectContaining({ layerItemId: runtimeId, kind: 'runtime', runtime: expect.objectContaining({ source: runtimeSource }) }) }),
    ]))

    await page.getByTestId('light-export-menu-trigger').click()
    await page.getByTestId('light-export-single-html').click()
    await page.getByRole('button', { name: '继续导出', exact: true }).click()
    await expect(page.getByTestId('light-export-menu-trigger')).toHaveAttribute('aria-disabled', 'false')
    const html = readFileSync(exportPath, 'utf8')
    expect(html).toContain('Flow 正文已修改')
    expect(html).toContain('Native 纸面标注已修改')
    // Runtime content is serialized in the published payload; verify it in the rendered preview below.
    const opened = app.waitForEvent('window')
    await app.evaluate(async ({ BrowserWindow }, path) => {
      const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
      await window.loadFile(path)
    }, exportPath)
    const preview = await opened
    await expect(preview.locator('#course-root')).not.toBeEmpty()
    await expect(preview.getByText('Flow 正文已修改', { exact: true })).toBeVisible()
    await expect(preview.getByText('Native 纸面标注已修改', { exact: true })).toBeVisible()
    await expect(preview.locator('[data-m16-mixed-runtime="true"] h2')).toHaveText('Runtime 改后标题')
    await preview.locator('[data-m16-mixed-run="true"]').click()
    await expect(preview.locator('[data-m16-mixed-run="true"]')).toHaveAttribute('data-ran', 'true')
    const previewImage = await preview.screenshot({ fullPage: true })
    writeFileSync(join(directory, 'export-preview.png'), previewImage)
    await info.attach('M16-T04 mixed Flow export preview', { body: previewImage, contentType: 'image/png' })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ documentId, reopenedId, savedRevision: edited.revision + 1, exportPath, checks: ['body', 'paper Native', 'Runtime', 'undo-redo', 'save-reopen', 'offline HTML preview interaction'] }, null, 2))
    await info.attach('M16-T04 mixed Flow evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
})
