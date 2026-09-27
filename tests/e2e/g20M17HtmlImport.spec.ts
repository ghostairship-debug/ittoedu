import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { selectionServer, launchSelectionApp, setupSelectionUI, openSelectionFile } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const benchmark = 'D:/g20-work/b14-core/output/g20/m17/benchmark/Starter-Unit-1-Hello-standalone.html'
const benchmarkSha256 = 'e0dbf76c6a837e3466b6d777944b6139c5945fc47d57875f44cf7cf35bbc4383'
const courseName = 'M17 导入验收.h5lesson'
const editingCourseName = 'M17 轻编辑验收.h5lesson'
const imageOne = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOwmHvxPwAFXQKmZX6V9QAAAABJRU5ErkJggg=='
const imageTwo = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8AARMAgYKSgAAAABJRU5ErkJggg=='

function fixtureHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#e8f6ff;font:24px sans-serif}main{padding:40px}img{width:180px;height:180px}</style></head><body><main><h1>M17 interactive fixture</h1><p id="sentence">Original greeting</p><img id="picture" alt="Classroom picture" src="data:image/png;base64,${imageOne}"><button id="advance">Next sentence</button><output id="answer">Ready</output></main><script>document.getElementById('advance').addEventListener('click',()=>{document.getElementById('answer').textContent='Interaction survived'})</script></body></html>`
}

function makeCourse() {
  const project = createBlankCourseProject({ title: 'M17 导入验收', canvas: { width: 1280, height: 720 }, includeDefaultController: false, controls: 'none' })
  return new CourseV9Driver().serialize({ kind: 'course-v9', project, resources: { assets: {}, components: {} } })
}

async function setFilePicker(app: ElectronApplication, path: string) {
  await app.evaluate((_electron, value) => { (globalThis as unknown as { m17FilePicker?: string }).m17FilePicker = value }, path)
}

async function importDialog(page: Page, sourceName: string | null) {
  const dialog = page.getByRole('dialog', { name: '导入 HTML 页面' })
  await expect(dialog).toBeVisible()
  if (sourceName) await expect(dialog).toContainText(`来源：${sourceName}`)
  await dialog.getByLabel('导入目标页面').selectOption({ index: 0 })
  await expect(dialog.getByLabel('导入目标页面').locator('option:checked')).toContainText('演示页')
  await dialog.getByRole('button', { name: '导入', exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 60_000 })
  await expect(page.getByText('HTML 页面已导入到所选位置')).toBeVisible()
}

async function importedFrame(page: Page, position: 'first' | 'last' = 'first') {
  const frames = page.locator('.published-authoring-host iframe')
  const host = position === 'first' ? frames.first() : frames.last()
  await expect(host).toHaveAttribute('data-html-document-ready', 'true', { timeout: 60_000 })
  return host.contentFrame()
}

async function saveAndReopen(page: Page, workspace: string, name: string) {
  await page.keyboard.press('Control+S')
  await expect.poll(() => page.evaluate(async filename => {
    const documents = await window.desktopAPI.documents!.list()
    return documents.find(item => item.binding.kind === 'file' && item.binding.path.endsWith(filename))?.dirty
  }, name)).toBe(false)
  await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${name}`, exact: true }).click()
  return openSelectionFile(page, workspace, name)
}

test('M17-T01/T02/T03: both UI entries import without model calls; benchmark runs; imported text and image survive save/reopen', async () => {
  test.skip(process.platform !== 'win32', 'Windows Electron acceptance path.')
  test.setTimeout(600_000)
  const bytes = readFileSync(benchmark)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(benchmarkSha256)
  const base = join(root, 'output/g20/m17/electron-acceptance')
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  writeFileSync(join(workspace, courseName), makeCourse())
  writeFileSync(join(workspace, editingCourseName), makeCourse())
  writeFileSync(join(workspace, 'right-click.html'), fixtureHtml())
  writeFileSync(join(workspace, 'menu.html'), fixtureHtml())
  const replacement = join(directory, 'replacement.png')
  writeFileSync(replacement, Buffer.from(imageTwo, 'base64'))
  const server = await selectionServer()
  let app: ElectronApplication | undefined
  const errors: string[] = []
  try {
    app = await launchSelectionApp(directory)
    const page = await app.firstWindow()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    await setupSelectionUI(app, page, server.endpoint, workspace)
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.find(value => value && typeof value === 'object' && 'properties' in (value as object)) as { properties?: string[] } | undefined
        return { canceled: false, filePaths: [(options?.properties ?? []).includes('openDirectory') ? folder : (globalThis as unknown as { m17FilePicker?: string }).m17FilePicker ?? ''] }
      }
    }, workspace)
    const opened = await openSelectionFile(page, workspace, courseName)
    const frame = page.locator('.course-editor-frame:visible')
    await expect(frame).toHaveAttribute('data-document-id', opened.documentId)

    // T01: the file-row context action resolves that exact HTML; the insert menu uses the native picker.
    const tree = page.getByRole('tree', { name: '工作空间文件' })
    await tree.getByRole('button', { name: 'right-click.html', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '作为互动页导入', exact: true }).click()
    await importDialog(page, 'right-click.html')
    // Import is a document edit; disk is updated only after Save.
    await page.keyboard.press('Control+S')
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, courseName))))
    expect(archive.project.surfaces[0]?.type).toBe('slide')
    expect(Object.keys(archive.project.assets).length).toBeGreaterThan(0)
    await page.screenshot({ path: join(shots, '01-right-click-import.png') })

    await setFilePicker(app, join(workspace, 'menu.html'))
    await page.getByRole('button', { name: '插入', exact: true }).click()
    await page.getByRole('button', { name: '导入 HTML 页面', exact: true }).click()
    await importDialog(page, null)
    await page.screenshot({ path: join(shots, '02-insert-menu-import.png') })
    await page.keyboard.press('Control+S')
    const afterMenu = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, courseName))))
    const slide = afterMenu.project.surfaces.find(surface => surface.type === 'slide')
    if (slide?.type !== 'slide') throw new Error('Expected Slide surface')
    expect(slide.scenes[0]?.layerItems.filter(item => item.kind === 'runtime')).toHaveLength(2)
    expect(server.requests).toHaveLength(0)

    // T02: use only the immutable, ignored original, never a copied or rewritten stand-in.
    await setFilePicker(app, benchmark)
    await page.getByRole('button', { name: '插入', exact: true }).click()
    await page.getByRole('button', { name: '导入 HTML 页面', exact: true }).click()
    await importDialog(page, null)
    const original = await importedFrame(page, 'last')
    await expect(original.getByText('Choose a line to begin listening.')).toBeVisible()
    await expect(original.getByText('Ready to listen')).toBeVisible()
    await expect(original.getByRole('button', { name: 'Play line 1' })).toBeVisible()
    await expect(original.locator('.audio-player .timecode').last()).toHaveText('1:01')
    await expect.poll(() => original.locator('.classroom-photo img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const frameBounds = await page.locator('.published-authoring-host iframe').last().boundingBox()
    if (!frameBounds) throw new Error('Imported benchmark has no visible frame')
    expect(frameBounds.width / frameBounds.height).toBeGreaterThan(1.7)
    expect(frameBounds.width / frameBounds.height).toBeLessThan(1.85)
    await page.screenshot({ path: join(shots, '03-benchmark-initial.png') })
    const progress = original.getByRole('slider', { name: 'Audio progress' })
    const before = Number(await progress.inputValue())
    await original.getByRole('button', { name: 'Play line 1' }).click()
    await expect(original.getByText('Good morning, class.')).toBeVisible()
    await expect(original.getByText('Ms Gao is speaking')).toBeVisible()
    await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(before)
    const line = original.locator('.dialogue-row.is-active')
    await line.locator('button.text-toggle').last().click()
    await expect(line.locator('.chinese')).toBeVisible()
    await page.screenshot({ path: join(shots, '04-benchmark-line-translation-audio.png') })
    await original.getByRole('button', { name: 'Conversation 2' }).click()
    await expect(original.getByText('Hello, Peter.')).toBeVisible()
    await expect(original.getByRole('button', { name: 'Play line 5' })).toBeVisible()
    await page.screenshot({ path: join(shots, '05-benchmark-conversation-2.png') })
    expect(server.requests).toHaveLength(0)

    // T03: a separate course makes the edited Runtime unambiguous and preserves the benchmark state.
    await openSelectionFile(page, workspace, editingCourseName)
    await tree.getByRole('button', { name: 'right-click.html', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '作为互动页导入', exact: true }).click()
    await importDialog(page, 'right-click.html')
    const fixture = await importedFrame(page)
    await expect(fixture.locator('#sentence')).toHaveText('Original greeting')
    await fixture.locator('#sentence').dblclick()
    const editor = page.getByTestId('canvas-plain-text-editor').locator('input, textarea')
    await expect(editor).toBeVisible()
    await editor.fill('Edited greeting')
    await editor.press('Enter')
    await expect(fixture.locator('#sentence')).toHaveText('Edited greeting')
    await setFilePicker(app, replacement)
    const previousImage = await fixture.locator('#picture').getAttribute('src')
    await fixture.locator('#picture').dblclick()
    await expect.poll(async () => fixture.locator('#picture').getAttribute('src')).not.toBe(previousImage)
    await page.screenshot({ path: join(shots, '06-fixture-light-edited.png') })
    await saveAndReopen(page, workspace, editingCourseName)
    const persisted = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, editingCourseName))))
    const persistedRuntime = persisted.project.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.layerItems) : []).find(item => item.kind === 'runtime')
    if (!persistedRuntime || persistedRuntime.kind !== 'runtime') throw new Error('Imported Runtime was not saved')
    expect(JSON.stringify(persistedRuntime.runtime.content)).toContain('Edited greeting')
    expect(Object.values(persisted.assetFiles).some(bytes => Buffer.compare(Buffer.from(bytes), Buffer.from(imageTwo, 'base64')) === 0)).toBe(true)
    const reopened = await importedFrame(page)
    await expect(reopened.locator('#sentence')).toHaveText('Edited greeting')
    await expect(reopened.locator('#picture')).not.toHaveAttribute('src', previousImage ?? '')
    await page.getByRole('group', { name: '画布模式' }).getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const running = page.locator('.course-try-run-host iframe').first().contentFrame()
    await expect(running.locator('#sentence')).toHaveText('Edited greeting')
    await running.locator('#advance').click()
    await expect(running.locator('#answer')).toHaveText('Interaction survived')
    await page.screenshot({ path: join(shots, '07-reopened-running.png') })
    expect(server.requests).toHaveLength(0)
    expect(errors).toEqual([])
  } finally {
    await app?.close()
    await server.close()
  }
})
