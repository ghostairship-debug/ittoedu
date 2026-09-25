import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { addCourseScene } from '../../src/core/tools/courseLocations'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { ExecutionEventInput } from '../../src/shared/workbench/executionEvents'

const root = resolve(__dirname, '../..')
const eventCount = 10_000, sceneCount = 40, markdownBytes = 256 * 1024, rounds = 10
const earlyPhrase = '早期唯一历史记录', toolHeading = '性能工具详情', toolBody = '工具详情开头'

function fixedMarkdown() {
  const head = '# 长文本性能样本\n\n'
  const line = '课堂观察记录：学生先预测，再操作、观察并解释所得证据。\n'
  const count = Math.floor((markdownBytes - Buffer.byteLength(head)) / Buffer.byteLength(line))
  const source = head + line.repeat(count)
  return source + 'x'.repeat(markdownBytes - Buffer.byteLength(source))
}

function fixedCourse() {
  let project = createBlankCourseProject({ title: '四十场景性能样本', includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('No Slide surface')
  for (let index = 2; index <= sceneCount; index++) {
    const added = addCourseScene(project, { surfaceId: surface.id, title: `场景 ${index}` })
    if (!added.ok) throw new Error(added.reason)
    project = added.project
  }
  return createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} })
}

function courseFacts(filename: string) {
  const project = openCourseProjectArchive(new Uint8Array(readFileSync(filename))).project
  return { scenes: project.surfaces.reduce((count, surface) => count + (surface.type === 'slide' ? surface.scenes.length : 0), 0),
    items: project.surfaces.reduce((count, surface) => count + (surface.type === 'slide'
      ? surface.scenes.reduce((sum, scene) => sum + scene.layerItems.length, 0) : 0), 0) }
}

function summary(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right)
  const percentile = (fraction: number) => ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? null
  return { count: ordered.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: ordered.at(-1) ?? null }
}

/** Both timestamps live in the renderer's performance.now clock; Playwright scheduling is excluded. */
async function armLatency(trigger: Locator, input: { event: 'beforeinput' | 'click' | 'dblclick'; kind: 'value' | 'text' | 'visible'; marker?: string; selector?: string; finalInput?: string }) {
  await trigger.evaluate((element, options) => {
    const root = document.documentElement
    delete root.dataset.g20S11Latency
    const onTrigger = (event: Event) => {
      if (options.finalInput && (event as InputEvent).data !== options.finalInput) return
      element.removeEventListener(options.event, onTrigger)
      const started = performance.now()
      const tick = () => {
        const target = options.selector ? document.querySelector<HTMLElement>(options.selector) : element as HTMLElement
        const rect = target?.getBoundingClientRect()
        const visible = Boolean(target && rect && rect.width > 0 && rect.height > 0)
        const content = options.kind === 'value' ? (target as HTMLTextAreaElement | null)?.value : target?.textContent
        const observed = visible && (options.kind === 'visible' ? !options.marker || Boolean(content?.includes(options.marker))
          : options.kind === 'value' ? Boolean(content?.endsWith(options.marker ?? '')) : Boolean(content?.includes(options.marker ?? '')))
        if (observed || performance.now() - started >= 15_000) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            root.dataset.g20S11Latency = JSON.stringify({ ms: performance.now() - started, observed })
          }))
        } else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
    element.addEventListener(options.event, onTrigger)
  }, input)
}

async function readLatency(page: Page, name: string, round: number | null, samples: { name: string; round: number | null; ms: number; observed: boolean }[]) {
  await page.waitForFunction(() => Boolean(document.documentElement.dataset.g20S11Latency), null, { timeout: 20_000 })
  const result = await page.evaluate(() => JSON.parse(document.documentElement.dataset.g20S11Latency!) as { ms: number; observed: boolean })
  samples.push({ name, round, ...result })
  if (!result.observed) {
    const editor = await page.evaluate(() => {
      const node = document.querySelector<HTMLElement>('[aria-label="正文源文编辑"]')
      return { activeTag: document.activeElement?.tagName, activeClass: document.activeElement?.className,
        sourceTag: node?.tagName, editable: node?.getAttribute('contenteditable'), sourceTail: node?.textContent?.slice(-100),
        visibleMarker: Boolean(node?.textContent?.includes('S11PERF')) }
    })
    throw new Error(`${name} did not echo visibly: ${JSON.stringify(editor)}`)
  }
  expect(Number.isFinite(result.ms) && result.ms >= 0).toBe(true)
}

async function selectWorkspace(app: ElectronApplication, page: Page, workspace: string) {
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
}

async function closeApp(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}

test('S11-T04 records long-history input, echo, expansion, switching and memory without dropping facts', async ({}, info) => {
  test.setTimeout(360_000)
  const output = join(root, 'output/g20/s11/long-record'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'), profile = join(directory, 'profile')
  mkdirSync(workspace)
  const markdownName = '长文本.md', courseName = '四十场景.h5lesson'
  const markdownPath = join(workspace, markdownName), coursePath = join(workspace, courseName)
  let expectedMarkdown = fixedMarkdown()
  let initialCourse: { scenes: number; items: number } | null = null
  const samples: { name: string; round: number | null; ms: number; observed: boolean }[] = []
  const memory: { checkpoint: string; metrics: unknown[] }[] = [], pageErrors: string[] = []
  let status = 'running', failure: string | null = null, observedFacts: number | null = null, reopenedFacts: number | null = null
  let windowVisible = false, rendererVisibility = 'unknown'
  let app: ElectronApplication | null = null, page: Page | null = null
  const evidencePath = join(directory, 'evidence.json')
  const persist = () => {
    const grouped = Object.fromEntries([...new Set(samples.map(sample => sample.name))].map(name => [name, summary(samples.filter(sample => sample.name === name).map(sample => sample.ms))]))
    const comparableMemory = memory.filter(sample => sample.checkpoint !== 'reopened')
    const memoryTrend = ['Browser', 'Tab'].map(type => {
      const values = comparableMemory.map(sample => {
        const matches = (sample.metrics as { type: string; memory: { workingSetSize: number } }[]).filter(metric => metric.type === type)
        return { checkpoint: sample.checkpoint, workingSetSize: matches.length
          ? matches.reduce((total, metric) => total + metric.memory.workingSetSize, 0) : null }
      })
      return { type, values, delta: values.length && values[0]!.workingSetSize !== null && values.at(-1)!.workingSetSize !== null
        ? values.at(-1)!.workingSetSize! - values[0]!.workingSetSize! : null }
    })
    let finalCourse: { scenes: number; items: number } | null = null
    try { finalCourse = courseFacts(coursePath) } catch { /* Keep the original failure evidence if the file is damaged. */ }
    writeFileSync(evidencePath, JSON.stringify({ caseId: 'S11-T04', status, failure, machine: { platform: process.platform, arch: process.arch,
      cpu: os.cpus()[0]?.model, cpuCount: os.cpus().length, memoryBytes: os.totalmem() },
      workload: { events: eventCount, scenes: sceneCount, markdownBytes, rounds, providerRequests: 0 }, initialCourse,
      samples, summary: grouped, memory, memoryTrend, windowVisible, rendererVisibility, observedFacts, reopenedFacts,
      finalMarkdownBytes: Buffer.byteLength(expectedMarkdown), finalCourse, pageErrors }, null, 2))
  }
  const sampleMemory = async (checkpoint: string) => {
    if (!app) throw new Error('Electron not running')
    memory.push({ checkpoint, metrics: await app.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type,
      memory: metric.memory, cpu: metric.cpu }))) })
  }
  try {
    writeFileSync(markdownPath, expectedMarkdown)
    writeFileSync(coursePath, fixedCourse())
    const fixtureCourse = courseFacts(coursePath)
    initialCourse = fixtureCourse
    expect(Buffer.byteLength(expectedMarkdown)).toBe(markdownBytes)
    expect(fixtureCourse.scenes).toBe(sceneCount)
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '0' } })
    page = await app.firstWindow(); page.setDefaultTimeout(15_000); page.on('pageerror', error => pageErrors.push(error.message))
    await page.bringToFront()
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible()))).toBe(true)
    windowVisible = true
    rendererVisibility = await page.evaluate(() => document.visibilityState)
    expect(rendererVisibility).toBe('visible')
    await selectWorkspace(app, page, workspace)
    const active = await page.evaluate(async folder => {
      const execution = window.desktopAPI!.execution!
      const state = await execution.workspace(folder)
      const conversation = state.conversations[0] ?? await execution.createConversation(state.workspace.workspaceId)
      await execution.draft({ workspaceId: state.workspace.workspaceId, conversationId: conversation.conversationId,
        expectedRevision: conversation.revision, text: '长记录性能草稿', documents: [], attachments: [] })
      return { workspaceId: state.workspace.workspaceId, conversationId: conversation.conversationId }
    }, workspace)
    const store = new ExecutionEventStore({ directory: join(profile, 'workbench-v2/events') })
    for (let start = 0; start < eventCount; start += 500) {
      const batch: ExecutionEventInput[] = Array.from({ length: 500 }, (_, offset) => {
        const index = start + offset
        return { eventId: `s11-${index}`, conversationId: active.conversationId, taskId: 'long-record', runId: 'long-record-run',
          itemId: `item-${index}`, time: index, source: 'builtin', update: 'snapshot',
          type: index === 9_990 ? 'tool' : index === eventCount - 1 ? 'run.end' : 'text',
          data: index === 9_990 ? { label: toolHeading, toolName: 'fixture.read', status: 'completed', output: toolBody + '长输出'.repeat(20_000) }
            : index === eventCount - 1 ? { status: 'completed', text: '历史读取结束' }
              : { text: index === 13 ? earlyPhrase : `历史内容 ${index}` } }
      })
      await store.batchAppend(batch)
    }
    await page.reload()
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue('长记录性能草稿')
    await expect(page.locator('[data-execution-item]')).toHaveCount(100)
    await sampleMemory('seeded')

    const composer = page.getByLabel('给创作助手发消息')
    await composer.focus(); await composer.press('End')
    await armLatency(composer, { event: 'beforeinput', kind: 'value', marker: '测' })
    await page.keyboard.insertText('测')
    await readLatency(page, 'composer-input-echo', null, samples)

    const tree = page.locator('.lesson-directory-tree')
    for (let round = 0; round < rounds; round++) {
      const courseButton = tree.getByRole('button', { name: courseName, exact: true })
      await armLatency(courseButton, { event: 'dblclick', kind: 'visible', selector: '.canvas-viewport[data-observation-ready="true"]' })
      await courseButton.dblclick()
      await readLatency(page, 'course-switch-visible', round, samples)
      await page.getByRole('button', { name: '插入', exact: true }).click()
      await page.getByRole('button', { name: '添加文字', exact: true }).click()
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect.poll(() => courseFacts(coursePath).items).toBe(fixtureCourse.items + round + 1)

      const markdownButton = tree.getByRole('button', { name: markdownName, exact: true })
      await armLatency(markdownButton, { event: 'dblclick', kind: 'visible', selector: `section[aria-label="教学文档 ${markdownName}"]` })
      await markdownButton.dblclick()
      await readLatency(page, 'markdown-switch-visible', round, samples)
      const editor = page.getByRole('region', { name: `教学文档 ${markdownName}`, exact: true })
      const sourceToggle = editor.getByRole('button', { name: '源文', exact: true })
      if (await sourceToggle.count()) await sourceToggle.click()
      const source = editor.getByLabel('正文源文编辑')
      await source.click()
      const marker = `S11PERF${round}`
      await armLatency(source, { event: 'beforeinput', kind: 'text', marker, finalInput: marker.at(-1) })
      await source.pressSequentially(marker)
      await readLatency(page, 'markdown-input-echo', round, samples)
      await editor.getByRole('button', { name: '保存', exact: true }).click()
      await expect.poll(() => readFileSync(markdownPath, 'utf8').includes(marker)).toBe(true)
      const savedMarkdown = readFileSync(markdownPath, 'utf8')
      expect(savedMarkdown.split(marker)).toHaveLength(2)
      expect(savedMarkdown.replace(marker, '')).toBe(expectedMarkdown)
      expectedMarkdown = savedMarkdown
      await sampleMemory(`round-${round + 1}`)
    }

    const tool = page.locator('.execution-timeline__card--tool').filter({ hasText: toolHeading })
    const toolSummary = tool.locator('summary')
    await armLatency(toolSummary, { event: 'click', kind: 'visible', selector: '.execution-timeline__card--tool .execution-timeline__blob' })
    await toolSummary.click()
    await readLatency(page, 'tool-expand-visible', null, samples)
    const readFull = tool.getByRole('button', { name: /读取完整内容/ })
    await armLatency(readFull, { event: 'click', kind: 'visible', marker: toolBody, selector: '.execution-timeline__card--tool .execution-timeline__content' })
    await readFull.click()
    await readLatency(page, 'tool-blob-visible', null, samples)

    await page.locator('.execution-assistant__more > summary').click()
    await page.locator('.execution-assistant__more-menu').getByRole('button', { name: '搜索历史' }).click()
    await page.getByLabel('历史关键词').fill(earlyPhrase)
    const search = page.getByRole('button', { name: '搜索全部历史', exact: true })
    await armLatency(search, { event: 'click', kind: 'visible', marker: '历史事件 14', selector: '.execution-timeline__search details summary' })
    await search.click()
    await readLatency(page, 'history-search-visible', null, samples)
    await expect(page.getByText(/历史事件 14/)).toBeVisible()

    const earlier = page.getByRole('button', { name: /读取更早记录/ })
    await armLatency(earlier, { event: 'click', kind: 'text', marker: '历史内容 9800',
      selector: '[data-execution-item="long-record-run:item-9800"]' })
    await earlier.click()
    await readLatency(page, 'history-earlier-page-visible', null, samples)
    await expect(page.locator('[data-execution-item="long-record-run:item-9800"]')).toBeVisible()
    observedFacts = (await page.evaluate(async id => window.desktopAPI!.execution!.timeline(id), active.conversationId)).cursor
    expect(observedFacts).toBe(eventCount)
    expect(await page.locator('[data-execution-item]').count()).toBeLessThanOrEqual(100)
    expect(courseFacts(coursePath)).toEqual({ scenes: sceneCount, items: fixtureCourse.items + rounds })
    await sampleMemory('before-reopen')
    await page.screenshot({ path: join(directory, 'history-and-documents.png'), fullPage: true })

    await closeApp(app)
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '0' } })
    page = await app.firstWindow(); page.setDefaultTimeout(15_000); page.on('pageerror', error => pageErrors.push(error.message))
    await page.bringToFront()
    await selectWorkspace(app, page, workspace)
    const reopened = await page.evaluate(async input => {
      const api = window.desktopAPI!
      const markdown = await api.documents!.open(input.markdownPath)
      const course = await api.documents!.open(input.coursePath)
      const history = await api.execution!.timeline(input.conversationId)
      return { markdown, course, cursor: history.cursor }
    }, { markdownPath, coursePath, conversationId: active.conversationId })
    expect(reopened.markdown.model).toMatchObject({ kind: 'markdown', source: expectedMarkdown })
    expect(reopened.course.model.kind).toBe('course-v9')
    reopenedFacts = reopened.cursor
    expect(reopenedFacts).toBe(eventCount)
    await sampleMemory('reopened')
    expect(pageErrors).toEqual([])
    status = 'measured-and-correct'
    persist()
    await info.attach('s11-long-record-performance', { path: evidencePath, contentType: 'application/json' })
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    status = 'failed'
    if (page) await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
    persist()
    throw error
  } finally {
    if (app) await closeApp(app)
  }
})
