import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import PptxGenJS from 'pptxgenjs'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { launchM20, chooseM20Workspace, m20Row, closeM20 } from './helpers/g20M20Harness'

type Format = 'docx' | 'xlsx' | 'pptx'
type Sample = { trial: number; name: string; ms: number; format?: Format; detail?: unknown }
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function fileSha(filename: string) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filename)) digest.update(chunk)
  return digest.digest('hex')
}
const round = (n: number) => Math.round(n * 10) / 10
const samplesCount = Math.max(1, Math.min(5, Math.trunc(Number(process.env.OFFICE_PERF_SAMPLES) || 3)))
const poll = { timeout: 45000, intervals: [25, 50] }
function inspection(filename: string, format: Format) { return inspectOfficeContent(readFileSync(filename), format) }
function wordText(filename: string) {
  const data = inspection(filename, 'docx')
  if (data.format !== 'docx') throw new Error('Expected DOCX')
  return data.paragraphs[0].text
}
function excelValue(filename: string, cell: string) {
  const data = inspection(filename, 'xlsx')
  if (data.format !== 'xlsx') throw new Error('Expected XLSX')
  return data.sheets[0].cells.find(value => value.cell === cell)?.value
}
function pptFont(filename: string) {
  const data = inspection(filename, 'pptx')
  if (data.format !== 'pptx') throw new Error('Expected PPTX')
  return data.slides[0].shapes.find(shape => shape.name === 'perf-title-1')?.runs[0]?.[0]?.style.fontSize
}
async function clean(editor: Locator, format: Format) {
  await expect(editor.locator(format === 'pptx' ? '.pptx-editor__status' : '.office-leaf-status')).toHaveText('已保存')
  if (format !== 'pptx') await expect(editor).toHaveAttribute('aria-busy', 'false')
  else await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
}
function editorOf(page: Page, format: Format) {
  return page.locator(format === 'docx' ? '.office-word-editor' : format === 'xlsx' ? '.office-sheet-editor' : '.pptx-editor').filter({ visible: true })
}

test('records real visible Electron Office startup, opening, save, undo and memory observations', async ({}, info) => {
  test.skip(process.platform !== 'win32')
  test.setTimeout(600000)
  const base = resolve('output/office-coedit-20261103/performance'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE ? 'packaged-' : 'source-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const names: Record<Format, string> = { docx: '性能样本-200段.docx', xlsx: '性能样本-1000行.xlsx', pptx: '性能样本-20页.pptx' }
  const files = Object.fromEntries(Object.entries(names).map(([format, name]) => [format, join(workspace, name)])) as Record<Format, string>
  const firstWord = '性能样本：原始文档标题'
  const body = '本段用于检验实际文档编辑器的加载、输入和原件保存。保留正文、段落顺序和其他内容，记录操作的实际等待时间。'
  const wordBlocks = Array.from({ length: 200 }, (_, i) => ({ type: 'paragraph' as const,
    text: i ? '第 ' + (i + 1) + ' 段。' + body.repeat(3) : firstWord,
    ...(i === 0 ? { heading: 'title' as const } : i % 25 === 0 ? { heading: 'heading1' as const } : {}) }))
  const word = await applyOfficeContent(undefined, { format: 'docx', operation: 'create',
    blocks: [...wordBlocks, { type: 'table', rows: Array.from({ length: 12 }, (_, row) => Array.from({ length: 5 }, (_, column) => '表格 ' + (row + 1) + '-' + (column + 1))) }] })
  const rows = Array.from({ length: 1000 }, (_, i) => i === 0 ? ['项目', '数量', '单价', '小计', '折扣', '净额', '状态', '备注'] : [
    '项目 ' + i, i % 9 + 1, 10 + i % 35, { formula: 'B' + (i + 1) + '*C' + (i + 1) }, 1,
    { formula: 'D' + (i + 1) + '-E' + (i + 1) }, i % 2 ? '待核对' : '已核对', '保留行内容 ' + i,
  ])
  const excel = await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [{ name: '预算', rows }] })
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  for (let i = 0; i < 20; i++) {
    const slide = ppt.addSlide()
    slide.addText('性能演示 第 ' + (i + 1) + ' 页', { x: .6, y: .3, w: 11.8, h: .7, fontSize: 28, objectName: 'perf-title-' + (i + 1) })
    for (let j = 0; j < 6; j++) slide.addText('第 ' + (j + 1) + ' 项说明。' + body,
      { x: .7 + (j % 2) * 6.1, y: 1.3 + Math.floor(j / 2) * 1.2, w: 5.8, h: .9, fontSize: 16, objectName: 'perf-text-' + i + '-' + j })
    for (let j = 0; j < 5; j++) slide.addShape(ppt.ShapeType.rect, { x: .8 + j * 2.45, y: 5.4, w: 2.1, h: .8,
      fill: { color: ['5D7EA6', '829D78', 'B5976A', '8D80AA', 'A97773'][j] }, line: { color: 'FFFFFF' }, objectName: 'perf-shape-' + i + '-' + j })
  }
  const presentation = await ppt.write({ outputType: 'uint8array' }); if (!(presentation instanceof Uint8Array)) throw new Error('Expected PPTX bytes')
  writeFileSync(files.docx, word.bytes); writeFileSync(files.xlsx, excel.bytes); writeFileSync(files.pptx, presentation)
  const originals = Object.fromEntries(Object.entries(files).map(([format, filename]) => [format, sha(readFileSync(filename))]))
  const fixtureData = Object.fromEntries(Object.entries(files).map(([format, filename]) => {
    const data = inspection(filename, format as Format)
    const counts = data.format === 'docx' ? { inspectedParagraphs: data.paragraphs.length, paragraphsOutsideTable: 200, tableRows: 12, tableColumns: 5,
      textCharacters: data.paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0) }
      : data.format === 'xlsx' ? { sheets: data.sheets.length, worksheetRows: 1000, dataRows: 999, columns: 8,
        cells: data.sheets[0].cells.length, formulas: data.sheets[0].cells.filter(cell => cell.formula !== undefined).length }
        : { slides: data.slides.length, shapes: data.slides.reduce((sum, slide) => sum + slide.shapes.length, 0) }
    return [format, { path: filename, bytes: statSync(filename).size, sha256: originals[format], ...counts }]
  }))
  const samples: Sample[] = [], memory: unknown[] = [], identities: unknown[] = [], errors: { trial: number; message: string }[] = []
  const facts: Record<string, unknown> = { at: new Date().toISOString(), directory, status: 'prepared', phase: 'fixtures',
    kind: process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE ? 'packaged' : 'source-production-build',
    executable: process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE ?? 'repository Electron with dist-electron/main/index.js',
    ...(!process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE && existsSync('dist-electron/main/index.js') ? { sourceMainBuild: {
      path: resolve('dist-electron/main/index.js'), modifiedAt: statSync('dist-electron/main/index.js').mtime.toISOString(), sha256: sha(readFileSync('dist-electron/main/index.js')),
    } } : {}),
    samplesCount, privateSessionOffline: process.env.GUOLING_OFFICE_OFFLINE_ACCEPTANCE === '1',
    machine: { platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), node: process.version },
    fixtures: fixtureData, identities, samples, memory, errors,
    definitions: {
      cold: 'A fresh Electron process and private profile per trial. OS file cache is NOT cleared; this is not a cold-machine benchmark.',
      shellReady: 'Before launchM20 to visible/enabled workspace switch control in the real window; no workspace dialog automation included.',
      workspaceReady: 'Before launchM20 through actual workspace choice and all fixture rows present. Includes dialog-override and Playwright clicks.',
      openReady: 'Before file-tree double click to correct editable first paragraph/cell/canvas text, live input controls and saved status.',
      save: 'From Save click invocation through correct disk content and visible saved/ready state. Includes Playwright actionability, IPC and validation polling at 25/50 ms; not an isolated engine microbenchmark.',
      editCommit: 'From actual fill/select command invocation through the same verified save completion; selection before mutation is outside this duration.',
      undo: 'From shared Undo click invocation through original disk content and ready UI, with byte-for-byte original verification outside the timer.',
      memory: 'Electron app.getAppMetrics memory values are reported in KB; renderer Runtime.getHeapUsage and main process.memoryUsage are bytes. No forced GC. Summed WorkingSet is a sum of process reports, not unique physical RAM. Per-file snapshots include shared modules and caches from previously opened formats; they are not exclusive memory costs for a format.',
      interpretation: 'Three trials by default with rotated format order. Report every observation plus min/median/max only; no p95, statistical significance or leak claim.',
      providerRequests: 0,
    },
    sources: { electronMemory: 'https://www.electronjs.org/docs/latest/api/structures/memory-info', rendererHeap: 'https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage' },
  }
  const persist = () => {
    facts.summary = Object.fromEntries([...new Set(samples.map(s => s.name))].map(name => {
      const values = samples.filter(s => s.name === name).map(s => s.ms).sort((a, b) => a - b)
      return [name, { count: values.length, observationsMs: samples.filter(s => s.name === name).map(s => s.ms), minMs: values[0],
        medianMs: values.length % 2 ? values[(values.length - 1) / 2] : round((values[values.length / 2 - 1] + values[values.length / 2]) / 2), maxMs: values.at(-1) }]
    }))
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(facts, null, 2) + '\n')
    writeFileSync(join(base, process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE ? 'latest-packaged.json' : 'latest-source.json'),
      JSON.stringify({ directory, evidence: join(directory, 'evidence.json'), status: facts.status }, null, 2) + '\n')
  }
  const add = (trial: number, name: string, start: number, format?: Format, detail?: unknown, end = performance.now()) => {
    samples.push({ trial, name, ms: round(end - start), ...(format ? { format } : {}), ...(detail === undefined ? {} : { detail }) }); persist()
  }
  persist()
  let app: ElectronApplication | undefined, page: Page | undefined
  try {
    for (let trial = 1; trial <= samplesCount; trial++) {
      const trialDirectory = join(directory, 'trial-' + trial); mkdirSync(trialDirectory)
      const fixture = { directory: trialDirectory, workspace, profile: join(trialDirectory, 'profile') }
      facts.status = 'running'; facts.phase = 'trial-' + trial + '-launch'; persist()
      const launched = performance.now(); ({ app, page } = await launchM20(fixture, { visible: true }))
      page.on('pageerror', error => errors.push({ trial, message: error.message }))
      await page.bringToFront()
      await expect(page.getByLabel('切换工作空间', { exact: true })).toBeVisible({ timeout: 45000 })
      await expect(page.getByLabel('切换工作空间', { exact: true })).toBeEnabled()
      await expect.poll(() => page!.evaluate(() => document.visibilityState)).toBe('visible')
      add(trial, 'coldProcessToShellReady', launched)
      await chooseM20Workspace(app, page, workspace)
      for (const name of Object.values(names)) await expect(m20Row(page, name)).toBeVisible()
      add(trial, 'coldProcessToWorkspaceReady', launched)
      const identity = await app.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(),
        execPath: process.execPath, userData: app.getPath('userData'), version: app.getVersion(), versions: process.versions, pid: process.pid,
        visible: BrowserWindow.getAllWindows().some(window => window.isVisible()) }))
      expect(identity.visible).toBe(true)
      identities.push({ trial, ...identity, renderer: await page.evaluate(() => ({ url: location.href, scripts: [...document.scripts].map(script => script.src).filter(Boolean) })) })
      const cdp = await page.context().newCDPSession(page)
      const takeMemory = async (checkpoint: string, format?: Format) => {
        const [host, renderer] = await Promise.all([
          app!.evaluate(({ app }) => ({ processes: app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type,
            name: metric.name, serviceName: metric.serviceName, memoryKB: metric.memory, cpu: metric.cpu })), mainMemoryBytes: process.memoryUsage() })),
          cdp.send('Runtime.getHeapUsage'),
        ])
        memory.push({ trial, checkpoint, ...(format ? { format } : {}), processes: host.processes, mainMemoryBytes: host.mainMemoryBytes,
          sumWorkingSetKB: host.processes.reduce((sum, metric) => sum + metric.memoryKB.workingSetSize, 0),
          rendererHeapBytes: renderer, at: new Date().toISOString() }); persist()
      }
      await takeMemory('workspace-ready')
      const all: Format[] = ['docx', 'xlsx', 'pptx'], offset = (trial - 1) % all.length
      const order = [...all.slice(offset), ...all.slice(0, offset)]
      for (const format of order) {
        facts.phase = 'trial-' + trial + '-' + format + '-open'; persist()
        const started = performance.now(); await m20Row(page, names[format]).dblclick()
        const editor = editorOf(page, format), save = editor.getByRole('button', { name: '保存', exact: true })
        if (format === 'docx') {
          await expect(editor.getByRole('textbox', { name: '第 1 段', exact: true })).toHaveText(firstWord, { timeout: 45000 })
          await expect(editor.getByRole('textbox', { name: '第 1 段', exact: true })).toBeEditable()
        } else if (format === 'xlsx') {
          await expect(editor.getByRole('textbox', { name: '预算!B2', exact: true })).toHaveValue('2', { timeout: 45000 })
          await expect(editor.getByRole('textbox', { name: '预算!B2', exact: true })).toBeEditable()
        } else {
          await expect(editor.getByTestId('pptx-edit-surface')).toContainText('性能演示 第 1 页', { timeout: 45000 })
          await expect(editor.getByTestId('pptx-edit-surface').locator('[data-edit-id]')).toHaveCount(12)
          await expect(save).toBeEnabled()
        }
        await clean(editor, format); add(trial, format + '.openReady', started, format)
        await takeMemory('file-ready', format)

        facts.phase = 'trial-' + trial + '-' + format + '-edit-save'; persist()
        if (format === 'pptx') {
          await editor.getByTestId('pptx-edit-surface').locator('[data-edit-id]').first().click()
          await expect(editor.getByRole('combobox', { name: '字号', exact: true })).toHaveValue('28')
        }
        const editStart = performance.now(), newText = '性能试验 ' + trial + '：保存后应可撤销', newNumber = 100 + trial, newFont = [32, 40, 48, 60, 72][trial - 1]
        if (format === 'docx') await editor.getByRole('textbox', { name: '第 1 段', exact: true }).fill(newText)
        else if (format === 'xlsx') await editor.getByRole('textbox', { name: '预算!B2', exact: true }).fill(String(newNumber))
        else await editor.getByRole('combobox', { name: '字号', exact: true }).selectOption(String(newFont))
        const statusBeforeSave = await editor.locator(format === 'pptx' ? '.pptx-editor__status' : '.office-leaf-status').textContent()
        const saveStart = performance.now()
        await save.click()
        if (format === 'docx') await expect.poll(() => wordText(files.docx), poll).toBe(newText)
        else if (format === 'xlsx') {
          await expect.poll(() => excelValue(files.xlsx, 'B2'), poll).toBe(newNumber)
          expect(excelValue(files.xlsx, 'D2')).toBe(newNumber * 11)
          expect(excelValue(files.xlsx, 'F2')).toBe(newNumber * 11 - 1)
        } else await expect.poll(() => pptFont(files.pptx), poll).toBe(newFont)
        await clean(editor, format)
        const savedAt = performance.now()
        add(trial, format + '.saveVerified', saveStart, format, { statusBeforeSave }, savedAt)
        add(trial, format + '.editToVerifiedSave', editStart, format, undefined, savedAt)
        await takeMemory('after-save', format)

        facts.phase = 'trial-' + trial + '-' + format + '-undo'; persist()
        const undoStart = performance.now()
        await editor.getByRole('button', { name: '撤销', exact: true }).click()
        if (format === 'docx') {
          await expect.poll(() => wordText(files.docx), poll).toBe(firstWord)
          await expect(editor.getByRole('textbox', { name: '第 1 段', exact: true })).toHaveText(firstWord)
        } else if (format === 'xlsx') {
          await expect.poll(() => excelValue(files.xlsx, 'B2'), poll).toBe(2)
          await expect(editor.getByRole('textbox', { name: '预算!B2', exact: true })).toHaveValue('2')
        } else {
          await expect.poll(() => pptFont(files.pptx), poll).toBe(28)
          await expect(editor.getByRole('combobox', { name: '字号', exact: true })).toHaveValue('28')
        }
        await clean(editor, format); add(trial, format + '.undoVerified', undoStart, format)
        expect(sha(readFileSync(files[format]))).toBe(originals[format])
        await takeMemory('after-undo', format)
        if (trial === 1) {
          const shot = join(directory, format + '-ready.png'); await page.screenshot({ path: shot, fullPage: true })
          await info.attach(format + ' real product', { path: shot, contentType: 'image/png' })
        }
        await page.getByRole('button', { name: '关闭 ' + names[format], exact: true }).click()
        await expect(editor).toHaveCount(0)
        await takeMemory('after-file-close', format)
      }
      await cdp.detach()
      await closeM20(app); app = undefined; page = undefined
      facts.phase = 'trial-' + trial + '-complete'; persist()
    }
    // Verify the delivered payload after measured trials; reading the full ASAR
    // before launch would unnecessarily warm the OS file cache for this probe.
    if (process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE) {
      const executable = resolve(process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE)
      const asar = join(dirname(executable), 'resources', 'app.asar')
      const asarSha256 = await fileSha(asar), expectedAsarSha256 = process.env.OFFICE_PERF_EXPECTED_ASAR_SHA256?.toLowerCase()
      facts.packageArtifact = { executable, executableBytes: statSync(executable).size, asar, asarBytes: statSync(asar).size,
        asarSha256, ...(expectedAsarSha256 ? { expectedAsarSha256 } : {}), checkedAfterMeasurements: true }
      if (expectedAsarSha256) expect(asarSha256).toBe(expectedAsarSha256)
    }
    expect(errors).toEqual([])
    facts.status = 'passed'; facts.phase = 'complete'; persist()
    await info.attach('Office product performance observations', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } catch (error) {
    facts.status = 'failed'; facts.failure = error instanceof Error ? error.message : String(error)
    if (page) {
      facts.alerts = await page.getByRole('alert').allTextContents().catch(() => [])
      const shot = join(directory, 'failure.png')
      await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined)
      if (existsSync(shot)) await info.attach('Office performance failure', { path: shot, contentType: 'image/png' })
    }
    persist(); throw error
  } finally { if (app) await closeM20(app) }
})
