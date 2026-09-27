import { expect, test, type ElectronApplication, type FrameLocator, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { unpackHtmlDocumentRuntimeSource } from '../../src/shared/runtime/htmlDocumentSource'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, selectionServer, setupSelectionUI } from './helpers/g20SelectionHarness'
import { root } from './helpers/g20M19Harness'

const courseName = 'M17 高度确认使用验收.h5lesson'
const anchorId = 'm17-confirmation-anchor'
const tailId = 'm17-confirmation-tail'

function course() {
  const project = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('Flow fixture missing')
  flow.blocks.push(
    { id: anchorId, type: 'paragraph', content: { inlines: [{ type: 'text', text: 'HTML 页面之前的正文' }] } },
    { id: tailId, type: 'paragraph', content: { inlines: [{ type: 'text', text: 'HTML 页面之后的正文' }] } },
  )
  return createCourseProjectArchive({ project: courseProjectDocumentSchema.parse(project), assetFiles: {}, componentFiles: {} })
}

function interactiveHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    html,body{margin:0}body{font:20px sans-serif;color:#16324f;background:#eff6ff}
    main{box-sizing:border-box;width:100%;padding:24px}h1{margin:0 0 16px;font-size:30px}
    button{font:20px sans-serif;padding:8px 12px;margin:0 12px 12px 0}#expanded{display:none;box-sizing:border-box;height:300px;padding:16px;background:#bfdbfe}#expanded.open{display:block}
    #expanded p{margin:0}#clock,#clicks{display:inline-block;min-width:110px}
  </style></head><body><main id="fixture"><h1>自然排版的互动讲义</h1>
    <p>先预测，再展开观察，最后解释。</p>
    <button id="start" type="button">开始计时</button><output id="clock" data-ticks="0">计时 0</output>
    <button id="toggle" type="button">展开或收起</button><output id="clicks" data-clicks="0">操作 0</output>
    <div id="expanded" data-open="false"><p>展开后增加 300 像素，原有正文和按钮继续工作。</p></div>
    <p id="ending">讲义末尾仍然可见。</p>
  </main><script>
    var ticks=0,clicks=0,started=false,opened=false;
    document.getElementById('start').addEventListener('click',function(){
      if(started)return;started=true;
      setInterval(function(){ticks++;var clock=document.getElementById('clock');clock.dataset.ticks=String(ticks);clock.textContent='计时 '+ticks},250)
    });
    document.getElementById('toggle').addEventListener('click',function(){
      opened=!opened;clicks++;
      var expanded=document.getElementById('expanded');expanded.classList.toggle('open',opened);expanded.dataset.open=String(opened);
      var output=document.getElementById('clicks');output.dataset.clicks=String(clicks);output.textContent='操作 '+clicks
    });
  </script></body></html>`
}

function erasingHtml() {
  return '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}main{min-height:200px}</style></head><body><main><h1>缩放后必须保留的正文</h1><p>观察并解释。</p></main><script>addEventListener("resize",function(){if(innerHeight<500)document.querySelector("main").textContent=""})</script></body></html>'
}

function nonconvergingHtml() {
  const heights = Array.from({ length: 100 }, (_, index) => `main.h${index}{height:${200 + index}px}`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}${heights}</style></head><body><main class="h0">持续改变高度</main><script>var n=0;function change(){document.querySelector("main").className="h"+(++n%100);requestAnimationFrame(change)}requestAnimationFrame(change)</script></body></html>`
}

async function snapshot(page: Page, id: string) {
  const value = await page.evaluate(documentId => window.desktopAPI.documents!.read(documentId), id)
  if (value.model.kind !== 'course-v9') throw new Error('Course Project V9 missing')
  const flow = value.model.project.surfaces.find(surface => surface.type === 'flow')
  if (flow?.type !== 'flow') throw new Error('Flow surface missing')
  const imported = flow.surfaceLayerItems.filter(entry => entry.item.kind === 'runtime' && entry.item.label === 'HTML 页面')
  return { revision: value.revision, undoDepth: value.undoDepth, dirty: value.dirty, imported,
    assets: value.model.project.assets, blocks: flow.blocks.map(block => block.id) }
}

async function chooseHtml(app: ElectronApplication, path: string) {
  await app.evaluate((_electron, filename) => { (globalThis as unknown as { m17ConfirmationFile?: string }).m17ConfirmationFile = filename }, path)
}

async function buildJobs(app: ElectronApplication, profile: string) {
  return app.evaluate(async ({ app }, expectedProfile) => {
    const fs = process.getBuiltinModule('node:fs')!
    const path = process.getBuiltinModule('node:path')!
    const v8 = process.getBuiltinModule('node:v8')!
    if (path.resolve(app.getPath('userData')).toLowerCase() !== path.resolve(expectedProfile).toLowerCase())
      throw new Error('Build logs are outside this isolated Electron profile')
    const folder = path.join(expectedProfile, 'workbench-v2', 'builds')
    let entries: import('node:fs').Dirent[]
    try { entries = await fs.promises.readdir(folder, { withFileTypes: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    return Promise.all(entries.filter(entry => entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)).map(async entry => {
      const statePath = path.join(folder, entry.name, 'state.bin')
      const state = v8.deserialize(await fs.promises.readFile(statePath)) as {
        jobId: string; status: string; logs: { stage: string; level: string; message: string }[]
      }
      if (state.jobId !== entry.name || !Array.isArray(state.logs)) throw new Error('Controlled build log is corrupt')
      return { jobId: state.jobId, statePath, status: state.status,
        admissionErrors: state.logs.filter(log => log.stage === 'admission' && log.level === 'error').map(log => log.message) }
    }))
  }, profile)
}

async function openImport(page: Page) {
  await page.getByRole('button', { name: '插入', exact: true }).click()
  await page.getByRole('button', { name: '导入 HTML 页面', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导入 HTML 页面' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('导入目标页面').selectOption({ index: 0 })
  await expect(dialog.getByLabel('导入目标页面').locator('option:checked')).toContainText('流式讲义')
  await dialog.getByLabel('HTML 正文位置').selectOption(anchorId)
  await dialog.getByRole('button', { name: '导入', exact: true }).click()
  return dialog
}

async function imported(page: Page, app: ElectronApplication, workspace: string, filename: string) {
  await chooseHtml(app, join(workspace, filename))
  const dialog = await openImport(page)
  let reason = ''
  await expect.poll(async () => {
    if (await dialog.count() === 0) return 'closed'
    const alert = dialog.getByRole('alert')
    if (await alert.count() && await alert.isVisible()) reason = (await alert.innerText()).trim()
    return reason ? 'rejected' : 'pending'
  }, { timeout: 120_000 }).not.toBe('pending')
  return { dialog, reason }
}

async function geometry(frame: Locator, content: FrameLocator, host: Locator, tail?: Locator) {
  const { iframeHeight, iframeScale } = await frame.evaluate(element => {
    const clientHeight = element.clientHeight
    if (!clientHeight) throw new Error('Runtime iframe has no client height')
    const iframeHeight = element.getBoundingClientRect().height
    return { iframeHeight, iframeScale: iframeHeight / clientHeight }
  })
  const hostHeight = await host.evaluate(element => element.getBoundingClientRect().height)
  const contentHeight = await content.locator('#fixture').evaluate(element => element.getBoundingClientRect().height)
  const ticks = Number(await content.locator('#clock').getAttribute('data-ticks'))
  const clicks = Number(await content.locator('#clicks').getAttribute('data-clicks'))
  const fallbackCount = await host.locator('[data-runtime-fallback="true"]').count()
  const tailY = tail && await tail.count() ? (await tail.first().boundingBox())?.y ?? null : null
  return { iframeHeight, iframeScale, hostHeight, contentHeight, ticks, clicks, fallbackCount, tailY }
}

async function exercise(page: Page, label: string, frame: Locator, host: Locator, rounds: number, shots: string, evidence: Record<string, unknown>, tail?: Locator) {
  await expect(frame).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })
  const content = frame.contentFrame()
  await expect(content.locator('#fixture')).toBeVisible()
  const original = await frame.elementHandle()
  if (!original) throw new Error(`${label}: iframe handle missing`)
  await content.locator('#start').scrollIntoViewIfNeeded()
  await content.locator('#start').click()
  await expect.poll(async () => Number(await content.locator('#clock').getAttribute('data-ticks'))).toBeGreaterThanOrEqual(2)
  const baseline = await geometry(frame, content, host, tail)
  expect(baseline.fallbackCount).toBe(0)
  const steps: Record<string, unknown>[] = []
  evidence[label] = { baseline, steps }
  for (let round = 0; round < rounds; round++) {
    for (const open of [true, false]) {
      const button = content.locator('#toggle')
      await button.scrollIntoViewIfNeeded()
      await button.click()
      await expect(content.locator('#expanded')).toHaveAttribute('data-open', String(open))
      await expect.poll(async () => (await geometry(frame, content, host, tail)).contentHeight - baseline.contentHeight,
        { timeout: 10_000 }).toBe(open ? 300 : 0)
      const tolerance = Math.max(8, 300 * baseline.iframeScale * 0.03)
      await expect.poll(async () => {
        const current = await geometry(frame, content, host, tail)
        return Math.abs(current.iframeHeight - baseline.iframeHeight - (open ? 300 * current.iframeScale : 0))
      }, { timeout: 10_000 }).toBeLessThanOrEqual(tolerance)
      const current = await geometry(frame, content, host, tail)
      expect(current.clicks).toBe(round * 2 + (open ? 1 : 2))
      expect(current.fallbackCount).toBe(0)
      expect(await frame.evaluate((node, first) => node === first, original)).toBe(true)
      steps.push({ round: round + 1, open, ...current })
      if (round === 0) await page.screenshot({ path: join(shots, `${label}-${open ? 'expanded' : 'collapsed'}.png`) })
    }
  }
  await expect.poll(async () => Number(await content.locator('#clock').getAttribute('data-ticks'))).toBeGreaterThan(baseline.ticks + 1)
  const after = await geometry(frame, content, host, tail)
  expect(after.clicks).toBe(rounds * 2)
  expect(after.fallbackCount).toBe(0)
  evidence[label] = { baseline, steps, after, sameIframe: true }
}

async function closeApp(app: ElectronApplication) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    closeSelectionApp(app).then(() => 'closed' as const),
    new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), 8_000) }),
  ])
  if (timer) clearTimeout(timer)
  if (result === 'timeout') { try { app.process()?.kill() } catch { /* preserve the original failure */ } }
}

test('M17-T05 Flow HTML keeps measuring during use while admission remains strict', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows Electron host acceptance path.')
  test.setTimeout(600_000)
  const base = join(root, 'output/g20/m17/flow-html-confirmation')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  const coursePath = join(workspace, courseName), exportPath = join(directory, 'flow-confirmation.html')
  writeFileSync(coursePath, course())
  writeFileSync(join(workspace, 'interactive.html'), interactiveHtml(), 'utf8')
  writeFileSync(join(workspace, 'erasing.html'), erasingHtml(), 'utf8')
  writeFileSync(join(workspace, 'nonconverging.html'), nonconvergingHtml(), 'utf8')
  const server = await selectionServer()
  const errors: string[] = [], expectedRejections: Record<string, { ui: string; admission?: string; jobId?: string }> = {}
  const evidence: Record<string, unknown> = { run: directory, baseline: 'b0bcaa8b', actualCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    pageErrors: errors, expectedRejections, exportPath }
  let app: ElectronApplication | undefined
  try {
    app = await launchSelectionApp(directory)
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => errors.push(error.message))
    await setupSelectionUI(app, page, server.endpoint, workspace)
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.find(value => value && typeof value === 'object' && 'properties' in (value as object)) as { properties?: string[] } | undefined
        return { canceled: false, filePaths: [(options?.properties ?? []).includes('openDirectory') ? paths.workspace : (globalThis as unknown as { m17ConfirmationFile?: string }).m17ConfirmationFile ?? ''] }
      }
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.exportPath })
    }, { workspace, exportPath })
    const opened = await openSelectionFile(page, workspace, courseName)
    const before = await snapshot(page, opened.documentId)
    expect(before.imported).toHaveLength(0)
    const positive = await imported(page, app, workspace, 'interactive.html')
    if (positive.reason) throw new Error(`Normal Flow HTML rejected: ${positive.reason}`)
    await expect(positive.dialog).toHaveCount(0)
    await expect(page.getByText('HTML 页面已导入到所选位置')).toBeVisible()
    await expect.poll(async () => (await snapshot(page, opened.documentId)).imported.length).toBe(1)
    const committed = await snapshot(page, opened.documentId)
    expect(committed.revision).toBeGreaterThan(before.revision)
    expect(committed.undoDepth).toBe(before.undoDepth + 1)
    const entry = committed.imported[0]!
    if (entry.item.kind !== 'runtime') throw new Error('Imported item is not Runtime')
    const source = entry.item.runtime.source
    const payload = unpackHtmlDocumentRuntimeSource(source)
    expect(payload?.html).toContain('开始计时')
    expect(source).not.toContain('flowHtmlConfirmationMode')
    const card = page.getByTestId(`flow-layer-card-${entry.item.layerItemId}`)
    const editFrame = card.locator('iframe[data-html-document-runtime="true"]')
    await exercise(page, 'edit', editFrame, card, 10, shots, evidence, page.getByTestId('flow-paper').locator(`[data-flow-block-id="${tailId}"]`))
    const afterEdit = await snapshot(page, opened.documentId)
    expect(afterEdit.revision).toBe(committed.revision)
    expect(afterEdit.undoDepth).toBe(committed.undoDepth)
    await page.getByRole('group', { name: '画布模式' }).getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const trial = page.getByTestId('flow-try-run-host')
    const trialFrame = trial.locator('iframe[data-html-document-runtime="true"]')
    await exercise(page, 'try-run', trialFrame, trial, 10, shots, evidence, trial.locator(`[data-flow-block-id="${tailId}"]`))
    const afterTrial = await snapshot(page, opened.documentId)
    expect(afterTrial.revision).toBe(committed.revision)
    expect(afterTrial.undoDepth).toBe(committed.undoDepth)
    await page.getByRole('group', { name: '画布模式' }).getByRole('button', { name: '编辑状态', exact: true }).click()
    await page.getByLabel('常用工具').getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, opened.documentId)).dirty).toBe(false)
    const saved = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    const savedFlow = saved.project.surfaces.find(surface => surface.type === 'flow')
    if (savedFlow?.type !== 'flow') throw new Error('Saved Flow missing')
    const savedEntry = savedFlow.surfaceLayerItems.find(item => item.item.layerItemId === entry.item.layerItemId)
    if (savedEntry?.item.kind !== 'runtime') throw new Error('Saved Runtime missing')
    expect(savedEntry.item.runtime.source).toBe(source)
    expect(savedFlow.blocks.map(block => block.id)).toContain(tailId)
    await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${courseName}`, exact: true }).click()
    const reopened = await openSelectionFile(page, workspace, courseName)
    expect(reopened.documentId).not.toBe(opened.documentId)
    const reopenedSnapshot = await snapshot(page, reopened.documentId)
    expect(reopenedSnapshot.imported).toHaveLength(1)
    expect(reopenedSnapshot.undoDepth).toBe(0)
    await exercise(page, 'reopened', page.getByTestId(`flow-layer-card-${entry.item.layerItemId}`).locator('iframe[data-html-document-runtime="true"]'),
      page.getByTestId(`flow-layer-card-${entry.item.layerItemId}`), 1, shots, evidence)
    const afterReopen = await snapshot(page, reopened.documentId)
    expect(afterReopen.revision).toBe(reopenedSnapshot.revision)
    expect(afterReopen.undoDepth).toBe(reopenedSnapshot.undoDepth)
    evidence.saveReopen = { savedRuntimeSource: source, before: committed.revision, after: afterReopen.revision,
      undoDepth: afterReopen.undoDepth, reopenedDocumentId: reopened.documentId }

    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    const preview = page.getByTestId('course-preview-host')
    await expect(preview).toBeVisible()
    await exercise(page, 'whole-preview', preview.locator('iframe[data-html-document-runtime="true"]'), preview, 2, shots, evidence,
      preview.locator(`[data-flow-block-id="${tailId}"]`))
    await page.getByTestId('course-preview-overlay').getByRole('button', { name: '关闭预览' }).click()
    await page.getByTestId('light-export-menu-trigger').click()
    await page.getByTestId('light-export-single-html').click()
    await page.getByRole('button', { name: '继续导出', exact: true }).click()
    await expect.poll(() => existsSync(exportPath)).toBe(true)
    await expect.poll(() => readFileSync(exportPath).byteLength).toBeGreaterThan(10_000)
    const exported = app.waitForEvent('window')
    const loading = app.evaluate(async ({ BrowserWindow }, filename) => {
      const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
      await window.loadFile(filename)
    }, exportPath)
    const offline = await exported
    offline.on('pageerror', error => errors.push(`offline: ${error.message}`))
    await loading
    await expect(offline.locator('#course-root')).not.toBeEmpty()
    await exercise(offline, 'offline-export', offline.locator('iframe[data-html-document-runtime="true"]'), offline.locator('#course-root'), 2, shots,
      evidence, offline.locator(`[data-flow-block-id="${tailId}"]`))
    evidence.offlineExport = { file: exportPath, bytes: readFileSync(exportPath).byteLength }
    await offline.close()
    const afterAllUse = await snapshot(page, reopened.documentId)
    expect(afterAllUse.revision).toBe(reopenedSnapshot.revision)
    expect(afterAllUse.undoDepth).toBe(reopenedSnapshot.undoDepth)
    evidence.afterAllUse = { revision: afterAllUse.revision, undoDepth: afterAllUse.undoDepth }
    evidence.runtimeDiagnostics = await page.getByRole('alert').allTextContents()
    expect(evidence.runtimeDiagnostics).not.toEqual(expect.arrayContaining([expect.stringMatching(/Flow HTML.*(失败|错误|改变了正文)/)]))

    const stable = await snapshot(page, reopened.documentId)
    const disk = readFileSync(coursePath)
    const profile = join(directory, 'profile')
    for (const [name, pattern] of [['erasing.html', /改变了正文/], ['nonconverging.html', /持续失效|持续改变布局/]] as const) {
      const previousJobs = new Set((await buildJobs(app, profile)).map(job => job.jobId))
      const result = await imported(page, app, workspace, name)
      expectedRejections[name] = { ui: result.reason }
      expect(result.reason, `${name} unexpectedly committed`).not.toBe('')
      await expect(result.dialog).toBeVisible()
      const newJobs = (await buildJobs(app, profile)).filter(job => !previousJobs.has(job.jobId))
      expect(newJobs, `${name} must have exactly one new controlled build job`).toHaveLength(1)
      const job = newJobs[0]!
      expect(job.status).toBe('cancelled')
      expect(job.admissionErrors).toHaveLength(1)
      const admissionReason = job.admissionErrors[0]!
      expectedRejections[name] = { ui: result.reason, admission: admissionReason, jobId: job.jobId }
      expect(admissionReason).toMatch(pattern)
      if (name === 'nonconverging.html') expect(admissionReason).toMatch(/invalidations=13/)
      await page.screenshot({ path: join(shots, `${name}-rejected.png`) })
      const after = await snapshot(page, reopened.documentId)
      expect(after.revision).toBe(stable.revision)
      expect(after.undoDepth).toBe(stable.undoDepth)
      expect(after.imported).toEqual(stable.imported)
      expect(after.assets).toEqual(stable.assets)
      expect(after.blocks).toEqual(stable.blocks)
      expect(readFileSync(coursePath)).toEqual(disk)
      evidence[name] = { uiReason: result.reason, admissionReason, jobId: job.jobId, statePath: job.statePath,
        before: { revision: stable.revision, undoDepth: stable.undoDepth },
        after: { revision: after.revision, undoDepth: after.undoDepth }, runtimeCount: after.imported.length }
      await result.dialog.getByRole('button', { name: '取消', exact: true }).click()
    }
    expect(server.requests).toHaveLength(0)
    expect(errors).toEqual([])
  } finally {
    evidence.modelRequests = server.requests.length
    evidence.windowErrors = errors.length
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await info.attach('M17-T05 Flow HTML confirmation evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    if (app) await closeApp(app)
    await server.close()
  }
})
