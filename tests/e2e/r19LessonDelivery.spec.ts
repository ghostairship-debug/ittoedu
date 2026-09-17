import { _electron as electron, chromium, expect, test, type Page, type Locator } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve, relative, isAbsolute, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'
import { analyzeCourseAssetReferences } from '../../src/shared/contracts/course-project-v9/assetReferences'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

/** Original lesson only; never substitutes a generated test project or calls a model.
 * R19_DELIVERY_PROFILE, R19_DELIVERY_LESSON, R19_DELIVERY_PROJECT are real paths.
 * R19_DELIVERY_EXPECTATIONS is a JSON file reviewed against the current four drafts:
 * {projectId, terms:string[], diagramAssets:[{id,origin:'material'|'generated-from-reviewed-text',basis}], surfaceTypes:string[],
 *  pages:[{locationId, visibleText?, arrival?:'controller'|'body', interactions?:[
 *    {click, afterSelector?, afterText?} | {textbox, fill} | {textbox, toHaveValue} |
 *    {selector, visibility?:'visible'|'hidden', enabled?:boolean, text?:string}
 *  ]}]}.
 * CSS interaction selectors address the actual produced mechanism, including open
 * component shadow roots. Textbox actions use their accessible names and normal
 * pointer/keyboard input. Screenshots still require a visual acceptance review.
 */
function realpathEqual(left: string, right: string) {
  return realpathSync(left).toLowerCase() === realpathSync(right).toLowerCase()
}

interface DeliveryClickInteraction {
  click: string
  afterSelector?: string
  afterText?: string
}

interface DeliveryTextboxFillInteraction {
  textbox: string
  fill: string
}

interface DeliveryTextboxValueInteraction {
  textbox: string
  toHaveValue: string
}

interface DeliveryStateInteraction {
  selector: string
  visibility?: 'visible' | 'hidden'
  enabled?: boolean
  text?: string
}

type DeliveryInteraction =
  | DeliveryClickInteraction
  | DeliveryTextboxFillInteraction
  | DeliveryTextboxValueInteraction
  | DeliveryStateInteraction

interface DeliveryPage {
  locationId: string
  visibleText?: string
  arrival?: 'controller' | 'body'
  interactions?: DeliveryInteraction[]
}
interface Expectations {
  projectId: string
  terms: string[]
  diagramAssets: Array<{ id: string; origin: 'material' | 'generated-from-reviewed-text'; basis: string }>
  surfaceTypes: string[]
  pages: DeliveryPage[]
}

test('r19 original saved lesson: resource closure, reopen, both previews and offline delivery', async ({}, testInfo) => {
  const names = ['PROFILE', 'LESSON', 'PROJECT', 'EXPECTATIONS'] as const
  test.skip(names.some(name => !process.env[`R19_DELIVERY_${name}`]), 'Requires the released original profile, saved lesson and reviewed expectations')
  // All three players exercise the full reviewed student path, including repeated visits.
  test.setTimeout(1_800_000)
  const paths = Object.fromEntries(names.map(name => [name, realpathSync(process.env[`R19_DELIVERY_${name}`]!)])) as Record<typeof names[number], string>
  const scoped = relative(paths.LESSON, paths.PROJECT)
  expect(scoped && !isAbsolute(scoped) && scoped !== '..' && !scoped.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)).toBeTruthy()
  const expected = JSON.parse(readFileSync(paths.EXPECTATIONS, 'utf8')) as Expectations
  expect(expected.projectId).toBeTruthy()
  expect(expected.terms.length).toBeGreaterThan(0)
  // Native/Component teaching diagrams need no image asset. Every reviewed
  // image that is actually required is still checked for bytes and placement.
  expect(Array.isArray(expected.diagramAssets)).toBe(true)
  expect(expected.pages.length).toBeGreaterThan(0)
  const root = resolve(__dirname, '../..')
  const output = join(root, 'output/r19-lesson-delivery', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(output, { recursive: true })
  const archive = openCourseProjectArchive(new Uint8Array(readFileSync(paths.PROJECT)))
  const project = archive.project
  const priorEvidence = process.env.R19_DELIVERY_PRIOR_EVIDENCE
  const previewStart = Number(process.env.R19_DELIVERY_PREVIEW_START ?? 0)
  expect(Number.isInteger(previewStart) && previewStart >= 0 && previewStart <= expected.pages.length).toBe(true)
  if (previewStart > 0) {
    const locationIds = expected.pages.map(entry => entry.locationId)
    if (new Set(locationIds).size !== locationIds.length) throw new Error('Partial continuation does not support repeated lesson locations; run the reviewed path from the beginning')
    if (!priorEvidence) throw new Error('Partial continuation requires the original passed page evidence')
    const evidencePages = new Set<string>()
    let cursor: string | undefined = priorEvidence
    const seen = new Set<string>()
    while (cursor) {
      if (seen.has(cursor)) throw new Error('Cyclic prior evidence chain')
      seen.add(cursor)
      const prior = JSON.parse(readFileSync(join(cursor, 'progress.json'), 'utf8'))
      expect(prior.projectId).toBe(project.id)
      expect(prior.revision).toBe(project.revision)
      expect({ ...prior.expected, pages: [] }).toEqual({ ...expected, pages: [] })
      for (const locationId of prior.wholePreviewCompleted) {
        expect(prior.expected.pages.find((entry: DeliveryPage) => entry.locationId === locationId)).toEqual(expected.pages.find(entry => entry.locationId === locationId))
        evidencePages.add(locationId)
      }
      cursor = prior.priorEvidence
    }
    for (const entry of expected.pages.slice(0, previewStart)) expect(evidencePages.has(entry.locationId)).toBe(true)
  }
  const completed: string[] = []
  expect(project.id).toBe(expected.projectId)
  const components = componentPackagesFromArchive(project, archive.componentFiles)
  const graph = analyzeCourseAssetReferences(project, { componentPackages: components, includeDisabledRuntimes: true })
  for (const term of expected.terms) expect(JSON.stringify(project)).toContain(term)
  for (const type of expected.surfaceTypes) {
    expect(project.surfaces.some(surface => surface.type === type)).toBe(true)
    expect(expected.pages.some(page => project.surfaces.find(surface => surface.id === project.locations.find(location => location.id === page.locationId)?.surfaceId)?.type === type)).toBe(true)
  }
  for (const [id, meta] of Object.entries(project.assets)) {
    expect(archive.assetFiles[id]?.byteLength, `Missing or incomplete asset ${id}`).toBe(meta.byteLength)
  }
  expect(graph.missingComponentContexts).toEqual([])
  for (const id of graph.graph.keys()) expect(project.assets[id], `Dangling project asset ${id}`).toBeDefined()
  for (const diagram of expected.diagramAssets) {
    const { id } = diagram
    expect(['material', 'generated-from-reviewed-text']).toContain(diagram.origin)
    expect(diagram.basis.trim().length, 'Record the reviewed source or text basis; a generated diagram does not prove source-image understanding').toBeGreaterThan(0)
    expect(project.assets[id]?.kind, `Reviewed teaching diagram ${id}`).toBe('image')
    expect(archive.assetFiles[id]?.byteLength).toBeGreaterThan(0)
    expect(graph.graph.get(id)?.some(reference => !['component-context-unavailable', 'runtime-source', 'component-runtime-source'].includes(reference.kind)), `Teaching diagram ${id} must have a concrete persisted placement, binding or prop`).toBe(true)
    writeFileSync(join(output, `diagram-${expected.diagramAssets.indexOf(diagram)}${extname(project.assets[id]!.filename) || '.bin'}`), archive.assetFiles[id]!)
  }
  const controller = project.globalLayerItems.find(entry => entry.item.kind === 'component' && entry.item.role === 'teacher-controller')?.item
  if (!controller || controller.kind !== 'component') throw new Error('The actual lesson must provide its formal navigation controller')
  const configured = controller.props.buttons as Array<{ label: string; action: { type: string } }> | undefined
  const directoryLabel = configured?.find(button => button.action.type === 'scene.open-picker')?.label ?? '场景目录'
  const errors: string[] = [], external: string[] = []
  const html = join(output, 'lesson-offline.html')
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${paths.PROFILE}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  async function exercisePage(host: Locator, entry: DeliveryPage, screen: string, owner: Page, visitIndex: number) {
    if (entry.visibleText) await expect(host.getByText(entry.visibleText, { exact: true }).first()).toBeVisible()
    for (const [index, interaction] of (entry.interactions ?? []).entries()) {
      if ('click' in interaction) {
        if (interaction.afterText !== undefined && !interaction.afterSelector) throw new Error(`Interaction ${index + 1} requires afterSelector for its text assertion`)
        await host.locator(interaction.click).click()
        if (interaction.afterSelector) {
          const result = host.locator(interaction.afterSelector)
          await expect(result).toBeVisible()
          if (interaction.afterText !== undefined) await expect(result).toHaveText(interaction.afterText)
        }
      } else if ('textbox' in interaction) {
        const textbox = host.getByRole('textbox', { name: interaction.textbox, exact: true })
        await expect(textbox).toBeVisible()
        if ('fill' in interaction) {
          await textbox.click()
          await owner.keyboard.press('Control+A')
          await owner.keyboard.press('Backspace')
          if (interaction.fill) await owner.keyboard.insertText(interaction.fill)
          await expect(textbox).toHaveValue(interaction.fill)
        } else {
          await expect(textbox).toHaveValue(interaction.toHaveValue)
        }
      } else {
        if (interaction.visibility === undefined && interaction.enabled === undefined && interaction.text === undefined) throw new Error(`Interaction ${index + 1} must declare a state assertion`)
        if (!interaction.selector.trim()) throw new Error(`Interaction ${index + 1} requires a state assertion selector`)
        if (interaction.visibility !== undefined && interaction.visibility !== 'visible' && interaction.visibility !== 'hidden') throw new Error(`Interaction ${index + 1} has an unknown visibility assertion`)
        if (interaction.enabled !== undefined && typeof interaction.enabled !== 'boolean') throw new Error(`Interaction ${index + 1} enabled assertion must be boolean`)
        if (interaction.text !== undefined && typeof interaction.text !== 'string') throw new Error(`Interaction ${index + 1} text assertion must be a string`)
        const target = host.locator(interaction.selector)
        if (interaction.visibility === 'visible') await expect(target).toBeVisible()
        if (interaction.visibility === 'hidden') await expect(target).toBeHidden()
        if (interaction.enabled === true) await expect(target).toBeEnabled()
        if (interaction.enabled === false) await expect(target).toBeDisabled()
        if (interaction.text !== undefined) await expect(target).toHaveText(interaction.text)
      }
      await owner.screenshot({ path: join(output, `${screen}-visit-${visitIndex + 1}-location-${project.locations.findIndex(location => location.id === entry.locationId)}-step-${index + 1}.png`), fullPage: true })
    }
  }
  async function navigation(host: Locator, entry: DeliveryPage, screen: string, owner: Page, visitIndex: number) {
    if (entry.arrival !== undefined && entry.arrival !== 'controller' && entry.arrival !== 'body') throw new Error(`Unknown arrival mode for reviewed visit ${visitIndex + 1}`)
    const location = project.locations.find(value => value.id === entry.locationId)
    if (!location) throw new Error(`Unknown reviewed location ${entry.locationId}`)
    const expand = host.getByRole('button', { name: '展开教师控制器', exact: true })
    if (await expand.isVisible()) await expand.click()
    await host.getByRole('button', { name: directoryLabel, exact: true }).click()
    const dialog = host.getByRole('dialog', { name: '场景目录', exact: true })
    const destination = dialog.getByRole('button', { name: location.label, exact: true })
    const alreadyCurrent = await destination.getAttribute('aria-current') === 'page'
    if (entry.arrival === 'body' && !alreadyCurrent) {
      await dialog.getByRole('button', { name: '关闭面板', exact: true }).click()
      throw new Error(`Reviewed body navigation did not arrive at ${location.label}`)
    }
    if (alreadyCurrent) {
      // The current directory already proves a body arrival; do not reopen it
      // merely to repeat the same unchanged state assertion.
      await dialog.getByRole('button', { name: '关闭面板', exact: true }).click()
    } else {
      await destination.click()
      await expect(dialog).toHaveCount(0)
      await host.getByRole('button', { name: directoryLabel, exact: true }).click()
      await expect(dialog.getByRole('button', { name: location.label, exact: true })).toHaveAttribute('aria-current', 'page')
      await dialog.getByRole('button', { name: '关闭面板', exact: true }).click()
    }
    await expect(dialog).toHaveCount(0)
    const collapseController = host.getByRole('button', { name: '收起教师控制器', exact: true })
    if (await collapseController.isVisible()) await collapseController.click()
    await exercisePage(host, entry, screen, owner, visitIndex)
    await owner.screenshot({ path: join(output, `${screen}-visit-${visitIndex + 1}-location-${project.locations.indexOf(location)}.png`), fullPage: true })
  }
  try {
    // V3.1：保留 profile 重开自动回到上次工作空间；课例入口已从「更多」菜单移除，经目录树点选 .h5lesson 激活
    await expect(page.locator('.lesson-workspace-toolbar')).toBeVisible()
    const lessons = await page.evaluate(directory => window.desktopAPI!.lesson!({ operation: 'list-lessons', directory }), dirname(paths.LESSON))
    const lesson = lessons.lessons?.find(value => realpathEqual(value.identity.normalizedDirectory, paths.LESSON))
    if (!lesson?.manifest.coursePath) throw new Error('Original lesson is not bound to a saved project')
    expect(realpathSync(join(paths.LESSON, lesson.manifest.coursePath))).toBe(paths.PROJECT)
    await page.locator('.lesson-directory-tree').getByRole('button', { name: basename(paths.LESSON), exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: basename(paths.PROJECT), exact: true }).click()
    await expect(page.locator('.lesson-workflow')).toBeVisible()
    await page.getByRole('tab', { name: /course|新建课件/ }).click()
    await expect(page.getByRole('button', { name: '整课预览', exact: true })).toBeVisible()
    // Save through the actual UI, wait for its acknowledgement, then reopen
    // the same lesson through its real open command, preserving lesson identity.
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, paths.PROJECT)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect(page.locator('.lesson-course-tab .status-bar')).toContainText('已保存到')
    const saved = openCourseProjectArchive(new Uint8Array(readFileSync(paths.PROJECT)))
    expect(saved.project).toEqual(project)
    expect(saved.assetFiles).toEqual(archive.assetFiles)
    expect(saved.componentFiles).toEqual(archive.componentFiles)
    await page.locator('.lesson-directory-tree').getByRole('button', { name: basename(paths.PROJECT), exact: true }).click()
    await expect(page.locator('.lesson-course-tab .status-bar')).toContainText(`已打开“${project.title}”`)
    await expect(page.getByRole('button', { name: '撤销（Ctrl+Z）', exact: true })).toBeDisabled()
    await page.screenshot({ path: join(output, 'reopened-authoring.png'), fullPage: true })
    // Reuse this original lesson for the real narrow Electron workspace check.
    // Both mode buttons and all tab labels below are current product UI.
    const checkNarrowWorkspace = process.env.R19_DELIVERY_CHECK_NARROW !== '0'
    let narrowMeasurements: unknown = null
    let wideMeasurements: unknown = null
    if (checkNarrowWorkspace) {
    const originalSize = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const size = window.getContentSize(); window.unmaximize(); window.setContentSize(1200, 900); return size
    })
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1320)
    narrowMeasurements = { requestedContentSize: [1200, 900], actualContentBounds: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds()), innerSize: await page.evaluate(() => [innerWidth, innerHeight]) }
    const noOuterOverflow = async () => {
      const bounds = await page.evaluate(() => ({ width: innerWidth, body: document.body.scrollWidth, root: document.documentElement.scrollWidth }))
      expect(Math.max(bounds.body, bounds.root), 'The narrow host must not require horizontal page scrolling').toBeLessThanOrEqual(bounds.width + 2)
      if (await page.locator('.lesson-course-tab').isVisible()) {
        const embedded = await page.locator('.lesson-course-tab .app-shell').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }))
        expect(embedded.scroll, 'Embedded editor content must fit its actual workbench').toBeLessThanOrEqual(embedded.client + 2)
        const canvas = await page.locator('.lesson-course-tab .editor-center').boundingBox()
        expect(canvas!.width, 'Collapsed panels must leave useful canvas width').toBeGreaterThanOrEqual(300)
      }
    }
    const mode = page.getByRole('group', { name: '编辑模式', exact: true })
    const initialMode = await mode.getByRole('button', { pressed: true }).innerText()
    for (const label of ['简洁', '专业']) {
      await mode.getByRole('button', { name: label, exact: true }).click()
      await expect(mode.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
      await noOuterOverflow()
      const toolbar = page.locator('.lesson-course-tab .toolbar')
      const toolbarBounds = await toolbar.boundingBox()
      for (const control of await toolbar.locator(':scope > *').all()) {
        if (!await control.isVisible()) continue
        const box = await control.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(toolbarBounds!.x - 2)
        expect(box!.x + box!.width).toBeLessThanOrEqual(toolbarBounds!.x + toolbarBounds!.width + 2)
      }
      for (const [button, region] of [['页面与图层', '课程结构'], ['属性与素材', '编辑面板']]) {
        const toggle = page.getByRole('button', { name: button, exact: true })
        await toggle.click()
        const ownerPanel = page.getByRole('complementary', { name: region, exact: true })
        await expect(ownerPanel).toBeVisible()
        if (label === '专业' && region === '编辑面板') {
          const selectedTab = await ownerPanel.locator('.sidebar-tab[aria-selected="true"]').innerText()
          await ownerPanel.getByRole('tab', { name: '开发', exact: true }).click()
          await expect(ownerPanel.getByRole('tab', { name: '开发', exact: true })).toHaveAttribute('aria-selected', 'true')
          await page.screenshot({ path: join(output, 'narrow-developer-panel.png'), fullPage: false })
          await ownerPanel.getByRole('tab', { name: selectedTab, exact: true }).click()
        }
        await page.keyboard.press('Escape')
        await expect(page.getByRole('complementary', { name: region, exact: true })).toBeHidden()
        await expect(toggle).toBeFocused()
      }
      await page.screenshot({ path: join(output, `narrow-mode-${label}.png`), fullPage: false })
    }
    const docPath = Object.values(lesson.manifest.documents)[0]
    if (!docPath) throw new Error('The original completed lesson must contain a real teaching document')
    const docSource = readFileSync(join(paths.LESSON, docPath), 'utf8')
    const tree = page.locator('.lesson-workspace-files > .lesson-directory-tree')
    const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase()
    const clickFilePath = async (filename: string) => {
      await expect.poll(async () => (await tree.locator('button[title]').evaluateAll(elements => elements.map(element => element.getAttribute('title')!))).some(title => normalize(title) === normalize(filename))).toBe(true)
      const title = (await tree.locator('button[title]').evaluateAll(elements => elements.map(element => element.getAttribute('title')!))).find(title => normalize(title) === normalize(filename))!
      await tree.getByTitle(title, { exact: true }).click()
    }
    const nav = page.getByRole('navigation', { name: '目录与课例', exact: true })
    await expect(nav).toBeVisible()
    await clickFilePath(paths.LESSON)
    const pieces = docPath.replace(/\\/g, '/').split('/')
    for (let length = 1; length <= pieces.length; length++) await clickFilePath(join(paths.LESSON, ...pieces.slice(0, length)))
    const docEditor = page.getByRole('region', { name: `教学文档 ${docPath}`, exact: true })
    await expect(docEditor).toBeVisible()
    await expect(docEditor.getByRole('textbox', { name: '正文排版编辑', exact: true })).toBeVisible()
    await noOuterOverflow()
    await page.screenshot({ path: join(output, 'narrow-document.png'), fullPage: false })
    const tabs = page.getByRole('tablist', { name: '材料、教学文档与课件', exact: true })
    await tabs.getByRole('tab', { name: '材料', exact: true }).click()
    await expect(tabs.getByRole('tab', { name: '材料', exact: true })).toHaveAttribute('aria-selected', 'true')
    const materials = page.getByRole('region', { name: '课例材料', exact: true })
    await expect(materials).toBeVisible()
    await materials.getByRole('button', { name: /^(第 \d+ 页 · )?(正文|图像|表格|公式原式)/ }).first().click()
    await expect(materials.getByRole('article', { name: '材料片段内容', exact: true })).toBeVisible()
    await noOuterOverflow()
    await page.screenshot({ path: join(output, 'narrow-materials.png'), fullPage: false })
    await tabs.getByRole('tab', { name: /^课件/ }).click()
    await expect(tabs.getByRole('tab', { name: /^课件/ })).toHaveAttribute('aria-selected', 'true')
    // Desktop keeps three columns; each navigation section has its own fold control.
    for (const label of ['资源管理器', '课例与对话']) {
      const heading = nav.getByRole('button', { name: label, exact: true })
      await expect(heading).toHaveAttribute('aria-expanded', 'true')
      await heading.click()
      await expect(heading).toHaveAttribute('aria-expanded', 'false')
      await heading.click()
      await expect(heading).toHaveAttribute('aria-expanded', 'true')
    }
    await expect(page.getByRole('main', { name: '课例对话', exact: true })).toBeVisible()
    await noOuterOverflow()
    await page.screenshot({ path: join(output, 'narrow-course-navigation.png'), fullPage: false })
    expect(readFileSync(join(paths.LESSON, docPath), 'utf8')).toBe(docSource)
    await mode.getByRole('button', { name: initialMode, exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(1400)
    wideMeasurements = { requestedContentSize: [1440, 900], actualContentBounds: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds()), innerSize: await page.evaluate(() => [innerWidth, innerHeight]) }
    await noOuterOverflow()
    await page.screenshot({ path: join(output, 'wide-three-columns.png'), fullPage: false })
    await expect(nav).toBeVisible()
    await expect(page.getByRole('main', { name: '课例对话', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '课例工作台', exact: true })).toBeVisible()
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size[0]!, size[1]!), originalSize)

    }

    if (process.env.R19_DELIVERY_ONLY_WORKSPACE === '1') {
      if (!checkNarrowWorkspace) throw new Error('Workspace-only verification must execute the workspace checks')
      expect(openCourseProjectArchive(new Uint8Array(readFileSync(paths.PROJECT))).project).toEqual(project)
      writeFileSync(join(output, 'workspace-verification.json'), JSON.stringify({ paths, projectId: project.id, revision: project.revision, narrowMeasurements, wideMeasurements, previewsAndExport: 'not-repeated' }, null, 2))
      return
    }
    await page.getByRole('button', { name: '当前位置试运行', exact: true }).click()
    const startType = project.surfaces.find(surface => surface.id === project.locations.find(location => location.id === project.startLocationId)?.surfaceId)!.type
    const trialId = startType === 'spatial-2d' ? 'spatial-try-run-host' : startType === 'flow' ? 'flow-try-run-host' : 'course-try-run-host'
    await expect(page.getByTestId(trialId)).toBeVisible()
    if (expected.pages[0]?.locationId !== project.startLocationId) throw new Error('Reviewed expectations must start at the reopened start location')
    for (const [visitIndex, entry] of expected.pages.entries()) await navigation(page.getByTestId(trialId), entry, 'current-location-preview', page, visitIndex)
    await page.screenshot({ path: join(output, 'current-location-preview.png'), fullPage: true })
    await page.getByRole('button', { name: '编辑状态', exact: true }).click()
    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    const preview = page.getByTestId('course-preview-overlay'), host = page.getByTestId('course-preview-host')
    await expect(host).toBeVisible()
    for (const [offset, entry] of expected.pages.slice(previewStart).entries()) {
      await navigation(host, entry, 'whole-preview', page, previewStart + offset)
      completed.push(entry.locationId)
      writeFileSync(join(output, 'progress.json'), JSON.stringify({ projectId: project.id, revision: project.revision, expected, wholePreviewCompleted: completed, priorEvidence }, null, 2))
    }
    await preview.getByRole('button', { name: '关闭预览', exact: true }).click()
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, html)
    await page.getByTestId('export-menu-trigger').click()
    await page.getByTestId('export-single-html').click()
    const preflight = page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
    await expect(preflight).toContainText('0 个错误')
    await preflight.getByRole('button', { name: '继续导出' }).click()
    await expect.poll(() => existsSync(html), { timeout: 30_000 }).toBe(true)
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 900 } })
    const offline = await context.newPage()
    offline.on('pageerror', error => errors.push(error.message))
    offline.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    offline.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()) })
    await offline.goto(pathToFileURL(html).href)
    for (const [visitIndex, entry] of expected.pages.entries()) await navigation(offline.locator('body'), entry, 'offline', offline, visitIndex)
    expect(errors).toEqual([])
    expect(external).toEqual([])
    expect(openCourseProjectArchive(new Uint8Array(readFileSync(paths.PROJECT))).project).toEqual(project)
    writeFileSync(join(output, 'verification.json'), JSON.stringify({ paths, expected, priorEvidence, previewStart, projectId: project.id, revision: project.revision, errors, external, desktopNarrowViewport: checkNarrowWorkspace ? { measurements: narrowMeasurements, desktop760Supported: false } : { status: 'deferred-known-embedded-layout-defect', desktop760Supported: false }, screenshotsRequireVisualReview: true, generatedDiagramsDoNotProveSourceImageUnderstanding: expected.diagramAssets.some(diagram => diagram.origin === 'generated-from-reviewed-text') }, null, 2))
    await testInfo.attach('original-lesson-delivery-evidence', { body: output, contentType: 'text/plain' })
  } catch (error) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
    writeFileSync(join(output, 'failure-ui.txt'), await page.locator('body').innerText().catch(() => ''))
    throw error
  } finally {
    await browser?.close()
    await app.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
