import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, selectionServer, setupSelectionUI } from './helpers/g20SelectionHarness'
import { root, solidPng } from './helpers/g20M19Harness'

const courseName = 'M17 Flow 长页导入.h5lesson'
const htmlName = 'flow-long-page.html'
const anchorId = 'm17-flow-anchor'
const tailId = 'm17-flow-tail'
const picture = solidPng(64, 48, [23, 105, 189])

async function closeFlowImportApp(app: ElectronApplication) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    closeSelectionApp(app).then(() => 'closed' as const),
    new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), 8_000) }),
  ])
  if (timer) clearTimeout(timer)
  if (result === 'timeout') { try { app.process()?.kill() } catch { /* preserve the original test failure */ } }
}

function flowCourse() {
  const project = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('Flow fixture missing')
  flow.blocks.push(
    { id: anchorId, type: 'paragraph', content: { inlines: [{ type: 'text', text: 'M17 HTML 锚点段落' }] } },
    { id: tailId, type: 'paragraph', content: { inlines: [{ type: 'text', text: '长页之后的正文应继续显示' }] } },
  )
  return createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project), assetFiles: {}, componentFiles: {} })
}

function longHtml() {
  const rows = Array.from({ length: 18 }, (_, index) => `<p class="lesson-row">第 ${index + 1} 段：保留纵向长页的正文布局。</p>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    body{margin:0;font:20px sans-serif;background:#eff6ff;color:#123052}
    main{box-sizing:border-box;width:100%;padding:24px}
    h1{margin:0 0 16px;font-size:32px}.lesson-row{box-sizing:border-box;height:76px;margin:0;border-bottom:1px solid #93c5fd}
    img{display:block;width:64px;height:48px}button{margin-top:20px;padding:10px 20px;font-size:20px}
  </style></head><body><main><h1 id="page-heading">纵向 HTML 讲义</h1><img id="picture" alt="受管图片" src="data:image/png;base64,${Buffer.from(picture).toString('base64')}">
    ${rows}<button id="advance" type="button">显示结论</button><output id="result">等待操作</output>
  </main><script>document.getElementById('advance').addEventListener('click',function(){document.getElementById('result').textContent='观察后得到结论'})</script></body></html>`
}

async function flowSnapshot(page: Page, documentId: string) {
  const snapshot = await page.evaluate(id => window.desktopAPI.documents!.read(id), documentId)
  if (snapshot.model.kind !== 'course-v9') throw new Error('Course Project V9 missing')
  const flow = snapshot.model.project.surfaces.find(surface => surface.type === 'flow')
  if (flow?.type !== 'flow') throw new Error('Flow surface missing')
  const imported = flow.surfaceLayerItems.filter(entry => entry.item.kind === 'runtime' && entry.item.label === 'HTML 页面')
  return { revision: snapshot.revision, undoDepth: snapshot.undoDepth, dirty: snapshot.dirty, imported,
    assets: snapshot.model.project.assets, blocks: flow.blocks.map(block => block.id) }
}

test('M17 Flow insert menu imports a managed long HTML page that runs after save and reopen', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows Electron host acceptance path.')
  test.setTimeout(360_000)
  const base = join(root, 'output/g20/m17/flow-html-import')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  writeFileSync(join(workspace, courseName), flowCourse())
  writeFileSync(join(workspace, htmlName), longHtml(), 'utf8')
  const server = await selectionServer()
  const errors: string[] = []
  const evidence: Record<string, unknown> = { run: directory, pageErrors: errors }
  let app: ElectronApplication | undefined
  try {
    app = await launchSelectionApp(directory)
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => errors.push(error.message))
    await setupSelectionUI(app, page, server.endpoint, workspace)
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, join(workspace, htmlName))
    const opened = await openSelectionFile(page, workspace, courseName)
    const before = await flowSnapshot(page, opened.documentId)
    expect(before.imported).toHaveLength(0)
    expect(before.blocks).toContain(anchorId)
    const paper = page.getByTestId('flow-paper')
    const tail = paper.locator(`[data-flow-block-id="${tailId}"]`)
    const tailBefore = await tail.boundingBox()
    if (!tailBefore) throw new Error('Flow tail was not laid out before import')

    await page.getByRole('button', { name: '插入', exact: true }).click()
    await page.getByRole('button', { name: '导入 HTML 页面', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导入 HTML 页面' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('导入目标页面').selectOption({ index: 0 })
    await expect(dialog.getByLabel('导入目标页面').locator('option:checked')).toContainText('流式讲义')
    await dialog.getByLabel('HTML 正文位置').selectOption(anchorId)
    await dialog.getByRole('button', { name: '导入', exact: true }).click()
    const importOutcome = await Promise.race([
      expect(dialog).toHaveCount(0, { timeout: 90_000 }).then(() => 'closed' as const),
      dialog.getByRole('alert').toBeVisible({ timeout: 90_000 }).then(async () => ({
        error: (await dialog.getByRole('alert').innerText()).trim(),
      })),
    ])
    if (importOutcome !== 'closed') {
      throw new Error(importOutcome.error || 'HTML import was rejected without a visible error message')
    }
    await expect(page.getByText('HTML 页面已导入到所选位置')).toBeVisible()
    await expect.poll(async () => (await flowSnapshot(page, opened.documentId)).imported.length).toBe(1)
    const committed = await flowSnapshot(page, opened.documentId)
    expect(committed.revision).toBeGreaterThan(before.revision)
    expect(committed.undoDepth).toBe(before.undoDepth + 1)
    const entry = committed.imported[0]!
    if (entry.item.kind !== 'runtime') throw new Error('Imported item was not a Runtime')
    expect(entry.item.paperSpace).toBe('paper')
    expect(entry.paragraphAnchor?.blockId).toBe(anchorId)
    expect(entry.item.runtime.protocol).toBe('surface-runtime')
    expect(entry.item.runtime.runtimeApiVersion).toBe(3)
    const payload = unpackHtmlDocumentRuntimeSource(entry.item.runtime.source)
    expect(payload?.html).toContain('纵向 HTML 讲义')
    expect(payload?.html).not.toContain('data:image/png;base64,')
    expect(payload?.resourceKeys).toHaveLength(1)
    const binding = entry.item.runtime.assets[payload!.resourceKeys[0]!]
    expect(binding).toBeTruthy()
    expect(committed.assets[binding!.assetId]).toBeTruthy()
    const runtimeCard = paper.getByTestId(`flow-layer-card-${entry.item.layerItemId}`)
    const importedFrame = runtimeCard.locator('iframe[data-html-document-runtime="true"]')
    await expect(importedFrame).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })
    const document = importedFrame.contentFrame()
    await expect(document.locator('#page-heading')).toHaveText('纵向 HTML 讲义')
    await expect(document.locator('.lesson-row')).toHaveCount(18)
    await expect(document.locator('#picture')).toHaveJSProperty('naturalWidth', 64)
    const height = await runtimeCard.evaluate(element => element.getBoundingClientRect().height)
    expect(height).toBeGreaterThan(1_300)
    await expect.poll(async () => {
      const rect = await tail.boundingBox()
      return rect ? rect.y - tailBefore.y : 0
    }).toBeGreaterThan(1_000)
    evidence.import = { revision: committed.revision, runtimeId: entry.item.layerItemId, anchorId,
      resourceKey: payload!.resourceKeys[0], assetId: binding!.assetId, cardHeight: height }
    await page.screenshot({ path: join(directory, 'flow-imported.png') })

    await page.getByLabel('常用工具').getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await flowSnapshot(page, opened.documentId)).dirty).toBe(false)
    const saved = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, courseName))))
    const savedFlow = saved.project.surfaces.find(surface => surface.type === 'flow')
    if (savedFlow?.type !== 'flow') throw new Error('Saved Flow surface missing')
    const savedEntry = savedFlow.surfaceLayerItems.find(value => value.item.layerItemId === entry.item.layerItemId)
    if (savedEntry?.item.kind !== 'runtime') throw new Error('Saved Flow Runtime missing')
    expect(savedEntry.paragraphAnchor?.blockId).toBe(anchorId)
    expect(savedEntry.item.runtime.source).toBe(entry.item.runtime.source)
    expect(saved.assetFiles[binding!.assetId]).toEqual(picture)
    const fallbackId = savedEntry.item.runtime.staticFallback?.assetId
    expect(fallbackId).toBeTruthy()
    expect(saved.assetFiles[fallbackId!]?.byteLength).toBeGreaterThan(100)
    evidence.saved = { resourceBytes: saved.assetFiles[binding!.assetId]?.byteLength, fallbackId,
      fallbackBytes: saved.assetFiles[fallbackId!]?.byteLength }

    await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${courseName}`, exact: true }).click()
    const reopened = await openSelectionFile(page, workspace, courseName)
    expect(reopened.documentId).not.toBe(opened.documentId)
    await expect(importedFrame).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })
    await expect(document.locator('#page-heading')).toHaveText('纵向 HTML 讲义')
    await expect(document.locator('#picture')).toHaveJSProperty('naturalWidth', 64)
    await page.getByRole('group', { name: '画布模式' }).getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const runningFrame = page.getByTestId('flow-try-run-host').locator('iframe[data-html-document-runtime="true"]')
    await expect(runningFrame).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })
    const running = runningFrame.contentFrame()
    await expect(running.locator('#page-heading')).toHaveText('纵向 HTML 讲义')
    await expect(running.locator('#picture')).toHaveJSProperty('naturalWidth', 64)
    await running.locator('#advance').click()
    await expect(running.locator('#result')).toHaveText('观察后得到结论')
    await page.screenshot({ path: join(directory, 'flow-try-run.png') })
    evidence.reopenedDocumentId = reopened.documentId
    expect(server.requests).toHaveLength(0)
    expect(errors).toEqual([])
  } finally {
    evidence.modelRequests = server.requests.length
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await info.attach('M17 Flow HTML import evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    if (app) await closeFlowImportApp(app)
    await server.close()
  }
})
