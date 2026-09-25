import { expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createNamedSelectionFixture } from '../helpers/g20NamedSelectionFixture'
import { buildSlideEditorView } from '../../src/core/tools/slideLayerView'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, readSelectionDocument } from './helpers/g20SelectionHarness'

// S04 actual Native auto-height host proof, not model/Provider acceptance.
// Uses the app's Main Gateway, actual bundled fonts and Chromium Canvas.
test('S04 real Native measurement updates a background base/named object once, survives undo and save/reopen, and matches painted geometry', async ({}, info) => {
  test.setTimeout(120_000)
  const root = resolve(__dirname, '../..'), base = join(root, 'output/g20/native-measurement'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const f = createNamedSelectionFixture(), text = f.scene.layerItems[0]
  if (text.kind !== 'native' || text.content.nativeType !== 'text') throw new Error('fixture')
  text.frame.width = 180; text.content.data.style = { ...text.content.data.style, overflow: 'auto-height', fontFamily: '"Noto Sans SC", sans-serif', fontSize: 32 }
  text.content.data.runs = [{ start: 0, end: 2, style: { bold: true, fontSize: 44 } }]
  f.scene.presentation!.states[0].layerItemOverrides['scene-text'].frame = { x: 160, width: 220 }
  const driver = new CourseV9Driver(), filename = join(workspace, 'auto-height.h5lesson')
  writeFileSync(filename, driver.serialize(f.model)); writeFileSync(join(workspace, 'foreground.md'), '前台文档保持原样。')
  const app = await launchSelectionApp(directory), page = await app.firstWindow()
  const hostPath = join(root, 'dist-electron/main/workbench/documentHost.js')
  try {
    await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const original = await openSelectionFile(page, workspace, 'auto-height.h5lesson')
    const foreground = await openSelectionFile(page, workspace, 'foreground.md')
    const baseText = '中文😀与英文 WiMi\n第二行继续观察\n第三行解释结论'
    const namedText = '命名态专有文字😀\n保留其他状态\n字号与行高同步增长'
    const result = await app.evaluate(async (_electron, input) => {
      // Playwright evaluates this callback in Electron Main without a dynamic-import hook.
      const { documentHost } = process.mainModule!.require(input.hostPath)
      const host = documentHost(), runId = 'native-measurement-gui'
      await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: input.documentId, writable: [{ kind: 'document' }] }] })
      const target = { kind: 'course-object', locationId: input.locationId, itemId: 'scene-text' }
      try {
        const base = await host.tools.issueTarget(runId, input.documentId, target)
        const baseResult = await host.tools.execute(runId, 'base-text', { name: 'text.replace', input: { target: base, content: input.baseText } })
        const named = await host.tools.issueTarget(runId, input.documentId, { ...target, stateId: 'named-a' })
        const namedResult = await host.tools.execute(runId, 'named-text-style', { name: 'batch', input: { operations: [
          { name: 'text.replace', input: { target: named, content: input.namedText } },
          { name: 'object.update', input: { target: named, properties: { nativeTextStyle: { fontSize: 42, fontFamily: '"Noto Sans SC", sans-serif' } } } },
        ] } })
        return { baseResult, namedResult, snapshot: host.registry.get(input.documentId).read() }
      } finally { await host.tools.stop(runId) }
    }, { hostPath, documentId: original.documentId, locationId: f.locationId, baseText, namedText })
    expect(result.baseResult).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(result.namedResult, JSON.stringify(result.namedResult)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(result.snapshot.undoDepth).toBe(original.undoDepth + 2)
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /^foreground\.md/ })).toHaveAttribute('aria-selected', 'true')
    expect((await readSelectionDocument(page, foreground.documentId)).model).toEqual(foreground.model)
    const course = result.snapshot.model
    if (course.kind !== 'course-v9') throw new Error('course')
    const itemAt = (stateId: string | null) => buildSlideEditorView({ project: course.project, locationId: f.locationId, stateId }).layers.find(layer => layer.selectionId === 'scene-text')!.item
    const baseItem = itemAt(null), namedItem = itemAt('named-a')
    expect(baseItem.frame.width).toBe(180); expect(baseItem.frame.height).toBeGreaterThan(90)
    expect(namedItem.frame.width).toBe(220); expect(namedItem.frame.height).toBeGreaterThan(90)
    expect(itemAt('named-b')).toMatchObject({ content: { data: { text: '命名态 B 正文' } } })
    const environment = await app.evaluate(async ({ BrowserWindow }) => {
      const worker = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/native-text-measurement.html'))
      if (!worker) throw new Error('Real native measurement host was not used')
      return { hidden: !worker.isVisible(), state: await worker.webContents.executeJavaScript(`({faces:Array.from(document.fonts).map(face=>({family:face.family,status:face.status})),canvas:Boolean(document.createElement('canvas').getContext('2d')),desktopAPI:typeof globalThis.desktopAPI})`) }
    })
    expect(environment.hidden).toBe(true); expect(environment.state.canvas).toBe(true); expect(environment.state.desktopAPI).toBe('undefined')
    expect(environment.state.faces.length).toBeGreaterThan(0)
    expect(environment.state.faces.every((face: { status: string }) => face.status === 'loaded')).toBe(true)
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^auto-height\.h5lesson/ }).click()
    const tools = page.getByLabel('课件常用工具', { exact: true })
    await tools.getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, original.documentId)).undoDepth).toBe(original.undoDepth + 1)
    await tools.getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, original.documentId)).undoDepth).toBe(original.undoDepth + 2)
    await tools.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, original.documentId)).dirty).toBe(false)
    const saved = driver.load(readFileSync(filename)); expect(saved).toEqual((await readSelectionDocument(page, original.documentId)).model)
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 auto-height.h5lesson', exact: true }).click()
    const reopened = await openSelectionFile(page, workspace, 'auto-height.h5lesson'); expect(reopened.model).toEqual(saved)
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    const states = page.getByRole('region', { name: '场景状态', exact: true })
    const paint = page.locator('[data-slide-layer-item="scene-text"]:visible').first()
    for (const [label, expectedText, item] of [[/^基础场景，/, baseText, baseItem], [/^命名态 A，命名状态/, namedText, namedItem]] as const) {
      await states.getByRole('button', { name: label }).click()
      await expect(paint).toContainText(expectedText)
      await expect.poll(() => paint.evaluate(element => Number.parseFloat((element as HTMLElement).style.height))).toBeCloseTo(item.frame.height, 2)
      // Independent foreground Player layout uses its own real Canvas and loaded
      // fonts. Its last measured line + padding must fill the saved automatic axis.
      await expect.poll(() => paint.evaluate(element => {
        const rows = [...element.querySelectorAll<HTMLElement>('[data-text-line]')]
        if (!rows.length) return -1
        const bottom = Math.max(...rows.map(row => Number.parseFloat(row.style.top) + Number.parseFloat(row.style.height)))
        return bottom + Number.parseFloat(getComputedStyle(rows[0].parentElement!.parentElement!).paddingBottom)
      })).toBeCloseTo(item.frame.height, 1)
      await page.screenshot({ path: join(directory, label.source.startsWith('^基础') ? 'base.png' : 'named.png') })
    }
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ result, environment, baseFrame: baseItem.frame, namedFrame: namedItem.frame, reopened }, null, 2))
    await info.attach('Native named measured result', { path: join(directory, 'named.png'), contentType: 'image/png' })
  } catch (error) { await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => {}); throw error }
  finally { await closeSelectionApp(app) }
})
