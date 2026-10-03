import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import type { BuildImportArtifact, BuildLogEntry } from '../../src/shared/workbench/build'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, selectionServer, setupSelectionUI } from './helpers/g20SelectionHarness'

// This is an acceptance-only carrier for the AGENTS audit. It deliberately uses
// the existing Electron selection harness and does not add a product pathway.
const root = join(__dirname, '../..')
const courseName = 'AGENTS 审查 v2 代表页.h5lesson'
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/3S5jGQAAAABJRU5ErkJggg=='

function makeCourse() {
  const project = createBlankCourseProject({ title: 'AGENTS 审查 v2 代表页', canvas: { width: 1280, height: 720 }, includeDefaultController: false, controls: 'none' })
  return new CourseV9Driver().serialize({ kind: 'course-v9', project, resources: { assets: {}, components: {} } })
}

async function close(app: ElectronApplication | undefined) {
  if (app) await closeSelectionApp(app)
}

test('AGENTS audit v2: representative HTML imports, runs, saves, reopens, and preserves CSP diagnostics in Electron', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(300_000)
  const base = join(root, 'output/g20/audit-v2/representative-electron')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  writeFileSync(join(workspace, 'pic.png'), Buffer.from(image, 'base64'))
  writeFileSync(join(workspace, 'theme.css'), '.layered{color:rgb(17,34,51)}')
  writeFileSync(join(workspace, 'q.json'), '{"answer":42}')
  writeFileSync(join(workspace, 'first.js'), "window.deferOrder=['first'];document.getElementById('x').textContent='ok'")
  writeFileSync(join(workspace, 'second.js'), "window.deferOrder.push('second')")
  writeFileSync(join(workspace, 'a.vtt'), 'WEBVTT\n')
  const dataUri = `data:image/png;base64,${image}`
  const html = `<!doctype html><html><head>
<meta charset="utf-8">
<style>@import url("theme.css") layer(base) supports(display: grid);</style>
<script defer src="first.js"></script><script defer src="second.js"></script>
</head><body onload="window.bodyLoaded=true">
<script>window.__violations=[];document.addEventListener('securitypolicyviolation',e=>window.__violations.push(e.violatedDirective+' <- '+e.blockedURI))</script>
<p id="x" class="layered">pending</p>
<div id="drop" ondragover="event.preventDefault();window.dragged=true" ondrop="window.dropped=true">drop</div>
<button class="option">answer</button><button class="option">answer</button>
<img id="static" src="pic.png" onload="window.imageLoaded=true"><img id="dynamic">
<video><track src="a.vtt" kind="captions"></video>
<script>class Lesson{constructor(){this.count=0}};window.lesson=new Lesson();const opts=document.querySelectorAll('.option');for(let i=0;i<opts.length;i++){opts[i].onclick=()=>{lesson.count++;opts[i].textContent='answer '+lesson.count}}fetch('q.json').then(response=>response.json()).then(data=>window.localDataLoaded=data.answer===42).catch(error=>{window.localFetchUnpacked=true;window.localFetchError=String(error)});function setImage(img,uri){img.src=uri}setImage(document.getElementById('dynamic'),${JSON.stringify(dataUri)});</script>
<script src="https://cdn.example.invalid/library.js"></script>
</body></html>`
  writeFileSync(join(workspace, 'representative.html'), html)
  writeFileSync(join(workspace, courseName), makeCourse())
  const modelServer = await selectionServer()
  let app: ElectronApplication | undefined
  const evidence: Record<string, unknown> = { directory }
  try {
    app = await launchSelectionApp(directory, ['--remote-debugging-port=0'])
    const page = await app.firstWindow()
    page.setDefaultTimeout(20_000)
    await setupSelectionUI(app, page, modelServer.endpoint, workspace)
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.find(value => value && typeof value === 'object' && 'properties' in (value as object)) as { properties?: string[] } | undefined
        return { canceled: false, filePaths: [(options?.properties ?? []).includes('openDirectory') ? folder : (globalThis as unknown as { auditPicker?: string }).auditPicker ?? ''] }
      }
    }, workspace)
    const opened = await openSelectionFile(page, workspace, courseName)
    const readDocument = () => page.evaluate(id => window.desktopAPI.documents!.read(id), opened.documentId)
    await app.evaluate((_electron, source) => { (globalThis as unknown as { auditPicker?: string }).auditPicker = source }, join(workspace, 'representative.html'))
    await page.getByRole('button', { name: '插入', exact: true }).click()
    await page.getByRole('button', { name: '导入 HTML 页面', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导入 HTML 页面' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('导入目标页面').selectOption({ index: 0 })
    await dialog.getByRole('button', { name: '导入', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 60_000 })
    await expect(page.getByText(/HTML 页面已导入/)).toBeVisible()
    const admission = await app.evaluate(async ({ app }) => {
      const fs = process.getBuiltinModule('node:fs')!
      const path = process.getBuiltinModule('node:path')!
      const v8 = process.getBuiltinModule('node:v8')!
      const folder = path.join(app.getPath('userData'), 'workbench-v2', 'builds')
      return Promise.all((await fs.promises.readdir(folder)).filter(jobId => /^[a-f0-9-]{36}$/.test(jobId)).map(async jobId => {
        const state = v8.deserialize(await fs.promises.readFile(path.join(folder, jobId, 'state.bin'))) as {
          status: string; artifact: BuildImportArtifact; logs: BuildLogEntry[]
        }
        return { jobId, status: state.status, admission: state.artifact.admission,
          logs: state.logs, ownerProcessId: process.pid }
      }))
    })
    expect(admission).toHaveLength(1)
    expect(admission[0].status).toBe('ready')
    expect(admission[0].admission.ok).toBe(true)
    expect(admission[0].admission.processId).toBeGreaterThan(0)
    expect(admission[0].admission.processId).not.toBe(admission[0].ownerProcessId)
    expect(admission[0].admission.behaviorEvidence?.length).toBeGreaterThan(0)
    evidence.admission = admission

    const authoring = page.locator('.published-authoring-host iframe').last()
    await expect(authoring).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })
    const frame = authoring.contentFrame()
    await expect(frame.locator('#x')).toHaveText('ok')
    await expect.poll(() => frame.locator('#static').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect.poll(() => frame.locator('#dynamic').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect.poll(() => frame.locator('body').evaluate(() => {
      const w = window as Window & { deferOrder?: string[]; bodyLoaded?: boolean; imageLoaded?: boolean; localFetchUnpacked?: boolean; __violations?: string[] }
      return { deferOrder: w.deferOrder, bodyLoaded: w.bodyLoaded, imageLoaded: w.imageLoaded, localFetchUnpacked: w.localFetchUnpacked, violations: w.__violations }
    })).toMatchObject({ deferOrder: ['first', 'second'], bodyLoaded: true, imageLoaded: true, localFetchUnpacked: true })
    await expect.poll(() => frame.locator('#x').evaluate(element => getComputedStyle(element).color)).toBe('rgb(17, 34, 51)')
    const runtimeState = await frame.locator('body').evaluate(() => {
      const w = window as Window & { deferOrder?: string[]; __violations?: string[]; libraryLoaded?: boolean; localFetchError?: string; localDataLoaded?: boolean }
      return { deferOrder: w.deferOrder, violations: w.__violations ?? [], libraryLoaded: w.libraryLoaded === true,
        localFetchError: w.localFetchError, localDataLoaded: w.localDataLoaded === true }
    })
    expect(runtimeState.deferOrder).toEqual(['first', 'second'])
    expect(runtimeState.libraryLoaded).toBe(false)
    expect(runtimeState.localDataLoaded).toBe(false)
    expect(runtimeState.violations.some(item => item.includes('script-src') && item.includes('cdn.example.invalid'))).toBe(true)
    evidence.authoring = runtimeState
    await page.screenshot({ path: join(shots, '01-authoring.png') })

    const runMode = page.getByRole('group', { name: '画布模式' }).getByRole('button', { name: '当前位置试运行', exact: true })
    await runMode.click()
    const tryRun = page.getByTestId('course-try-run-host')
    await expect(tryRun).toHaveAttribute('data-course-player-ready', 'true', { timeout: 60_000 })
    const running = page.locator('.course-try-run-host iframe').last().contentFrame()
    await expect(running.locator('#x')).toHaveText('ok')
    await running.locator('.option').first().click(); await running.locator('.option').nth(1).click()
    await expect(running.locator('.option').first()).toHaveText('answer 1')
    await expect(running.locator('.option').nth(1)).toHaveText('answer 2')
    const drag = await running.locator('#drop').evaluate(element => {
      const child = element.ownerDocument.defaultView!
      element.dispatchEvent(new child.Event('dragover', { bubbles: true, cancelable: true }))
      element.dispatchEvent(new child.Event('drop', { bubbles: true }))
      const w = child as Window & { dragged?: boolean; dropped?: boolean }
      return { dragged: w.dragged, dropped: w.dropped }
    })
    expect(drag).toEqual({ dragged: true, dropped: true })
    await page.getByLabel('常用工具').getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await readDocument()).dirty).toBe(false)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, courseName))))
    const assetBytes = Object.values(archive.assetFiles).map(bytes => Buffer.from(bytes))
    expect(assetBytes.some(bytes => bytes.equals(Buffer.from(image, 'base64')))).toBe(true)
    const slide = archive.project.surfaces.find(surface => surface.type === 'slide')
    const runtime = slide?.type === 'slide' ? slide.scenes[0]?.layerItems.find(item => item.kind === 'runtime') : undefined
    if (!runtime || runtime.kind !== 'runtime') throw new Error('Representative Runtime was not saved')
    expect(runtime.runtime.source).toContain('@layer base')
    expect(runtime.runtime.source).toContain('@supports (display: grid)')
    expect(runtime.runtime.source).not.toContain('href="theme.css"')
    expect(runtime.runtime.source).not.toContain('src="pic.png"')
    expect(runtime.runtime.source).toContain('cdn.example.invalid/library.js')
    await page.context().setOffline(true)
    await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${courseName}`, exact: true }).click()
    await openSelectionFile(page, workspace, courseName)
    const reopened = page.locator('.published-authoring-host iframe').last()
    await expect(reopened).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })
    const reopenedFrame = reopened.contentFrame()
    await expect(reopenedFrame.locator('#x')).toHaveText('ok')
    await expect.poll(() => reopenedFrame.locator('#static').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect.poll(() => reopenedFrame.locator('#dynamic').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect.poll(() => reopenedFrame.locator('#x').evaluate(element => getComputedStyle(element).color)).toBe('rgb(17, 34, 51)')
    await expect.poll(() => reopenedFrame.locator('body').evaluate(() => {
      const w = window as Window & { deferOrder?: string[]; bodyLoaded?: boolean; imageLoaded?: boolean; localFetchUnpacked?: boolean }
      return { deferOrder: w.deferOrder, bodyLoaded: w.bodyLoaded, imageLoaded: w.imageLoaded, localFetchUnpacked: w.localFetchUnpacked }
    })).toMatchObject({ deferOrder: ['first', 'second'], bodyLoaded: true, imageLoaded: true, localFetchUnpacked: true })
    await runMode.click()
    await expect(page.getByTestId('course-try-run-host')).toHaveAttribute('data-course-player-ready', 'true', { timeout: 60_000 })
    const reopenedRunning = page.locator('.course-try-run-host iframe').last().contentFrame()
    await reopenedRunning.locator('.option').first().click(); await reopenedRunning.locator('.option').nth(1).click()
    await expect(reopenedRunning.locator('.option').first()).toHaveText('answer 1')
    await expect(reopenedRunning.locator('.option').nth(1)).toHaveText('answer 2')
    const reopenedState = await reopenedRunning.locator('body').evaluate(() => {
      const drop = document.getElementById('drop')!
      drop.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
      drop.dispatchEvent(new Event('drop', { bubbles: true }))
      const w = window as Window & { dragged?: boolean; dropped?: boolean; lesson?: { count: number }; deferOrder?: string[] }
      return { dragged: w.dragged, dropped: w.dropped, answers: w.lesson?.count, deferOrder: w.deferOrder }
    })
    expect(reopenedState).toEqual({ dragged: true, dropped: true, answers: 2, deferOrder: ['first', 'second'] })
    evidence.reopened = { ...reopenedState, offline: true, savedManagedImage: true }
    await page.screenshot({ path: join(shots, '02-offline-reopened.png') })
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await close(app)
    await modelServer.close()
  }
})
