import { _electron as electron, expect, test } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { lessonAgentWorkspaceSchema } from '../../src/shared/workspaceIdentity'
import type { LocalAgentRecord } from '../../src/shared/localAgentContract'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'

const inputSchema = z.object({ profile: z.string().min(1), lessonDirectory: z.string().min(1),
  lessonWorkspace: lessonAgentWorkspaceSchema,
  projectPath: z.string().min(1), projectId: z.string().min(1), packageId: z.literal('parallel-path-evidence'),
}).strict()

// One CourseChatPanel task only. Collection/preparation cannot spend tokens.
// The original profile must be explicitly released by the prior delivery Owner.
test('r19 manual contrast Luna: readable Spatial controls, canonical save and reopen', async ({}, testInfo) => {
  test.skip(process.env.R19_MANUAL_CONTRAST_LUNA_RUN !== '1', 'Explicit one-task native Luna gate')
  test.setTimeout(20 * 60_000)
  expect(process.env.R19_MANUAL_CONTRAST_PROFILE_RELEASED).toBe('1')
  expect(process.env.R19_MANUAL_CONTRAST_INPUT).toBeTruthy()
  const input = inputSchema.parse(JSON.parse(readFileSync(process.env.R19_MANUAL_CONTRAST_INPUT!, 'utf8')))
  for (const path of [input.profile, input.lessonDirectory, input.projectPath]) realpathSync(path)
  const output = testInfo.outputPath('evidence'); mkdirSync(output, { recursive: true })
  const evidence = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2))
  const readArchive = () => openCourseProjectArchive(new Uint8Array(readFileSync(input.projectPath)))
  const before = readArchive()
  expect(before.project.id).toBe(input.projectId)
  const surface = before.project.surfaces.find(value => value.type === 'spatial-2d' && value.world.layerItems.some(item => item.kind === 'component' && item.component.packageId === input.packageId))
  if (!surface || surface.type !== 'spatial-2d') throw new Error('Original Spatial component must exist')
  const target = surface.world.layerItems.find(item => item.kind === 'component' && item.component.packageId === input.packageId)!
  const location = before.project.locations.find(value => value.kind === 'spatial-camera' && value.surfaceId === surface.id)
  if (!location) throw new Error('Spatial must have a saved course location')
  const baselinePackages = componentPackagesFromArchive(before.project, before.componentFiles)
  const workspace = input.lessonWorkspace
  expect(realpathSync(workspace.normalizedDirectory).toLowerCase()).toBe(realpathSync(input.lessonDirectory).toLowerCase())
  const root = resolve(__dirname, '../..')
  let app = await electron.launch({ args: ['.', `--user-data-dir=${input.profile}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  let page = await app.firstWindow()
  let safelySaved = true
  let taskStarted = false
  let originalPaths: { stroke: string | null; length: number; points: { x: number; y: number }[] }[] | undefined
  const list = () => page.evaluate(workspace => window.desktopAPI!.localAgent({ operation: 'lesson-list', workspace }), workspace)
  const read = async (sessionId: string) => {
    let after = 0, record: LocalAgentRecord | undefined
    const events: LocalAgentRecord['events'] = []
    for (;;) {
      const response = await page.evaluate(({ workspace, sessionId, after }) => window.desktopAPI!.localAgent({ operation: 'lesson-read', workspace, sessionId, after }), { workspace, sessionId, after })
      record = response.records?.[0]
      if (!record) throw new Error('Task missing from the current lesson conversation')
      const incoming = record.events.filter(event => event.sequence > after)
      events.push(...incoming)
      if (record.events.length < 200) break
      expect(incoming.length).toBeGreaterThan(0)
      after = Math.max(...incoming.map(event => event.sequence))
    }
    return { ...record, events }
  }
  async function openOriginal() {
    const opened = await page.evaluate(directory => window.desktopAPI!.lesson!({ operation: 'open-lesson', directory }), input.lessonDirectory)
    if (!opened.lesson) throw new Error('Original lesson missing')
    expect(opened.lesson.identity.lessonId).toBe(workspace.lessonId)
    const conversation = opened.conversations?.find(value => value.conversationId === workspace.conversationId)
    if (!conversation?.projectTarget) throw new Error('Original conversation has no bound project')
    expect(conversation.projectTarget.projectId).toBe(input.projectId)
    expect(realpathSync(conversation.projectTarget.normalizedPath).toLowerCase()).toBe(realpathSync(input.projectPath).toLowerCase())
    const history = await list()
    evidence('lesson-history-before-open.json', history)
    expect(history.records?.some(record => record.status === 'running' || record.task && !['completed', 'failed', 'cancelled', 'partial'].includes(record.task.status)), 'Original lesson conversation must be idle before UI or model work').toBe(false)
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, dirname(input.lessonDirectory))
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    const open = page.getByRole('button', { name: '打开课例', exact: true })
    await expect(open).toBeVisible()
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, input.lessonDirectory)
    await open.click()
    await page.getByRole('region', { name: '课例对话导航' }).getByRole('button', { name: conversation.title, exact: true }).and(page.locator('[aria-pressed]')).click()
    await page.getByRole('tab', { name: /^课件/ }).click()
    await expect(page.getByRole('button', { name: '整课预览', exact: true })).toBeVisible()
  }
  async function verifyBehavior(requireContrast: boolean, name: string) {
    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    const overlay = page.getByTestId('course-preview-overlay'), host = page.getByTestId('course-preview-host')
    try {
      const expand = host.getByRole('button', { name: '展开教师控制器', exact: true })
      if (await expand.isVisible()) await expand.click()
      await host.getByRole('button', { name: '场景目录', exact: true }).click()
      const picker = host.getByRole('dialog', { name: '场景目录', exact: true })
      const entry = picker.getByRole('button', { name: location!.label, exact: true })
      if (await entry.getAttribute('aria-current') === 'page') await picker.getByRole('button', { name: '关闭面板', exact: true }).click()
      else await entry.click()
      await expect(picker).toHaveCount(0)
      const labels = ['▶ 逐段示范 L1 路径', '清除示范（保留已确认）', '选择 L1 路径', '确认 L1 路径', '选择 L2 路径', '确认 L2 路径', '开始预测 →']
      const styles = []
      for (const label of labels) {
        const button = host.getByRole('button', { name: label, exact: true })
        await expect(button).toBeVisible()
        const style = await button.evaluate(element => {
          const style = getComputedStyle(element)
          const luminance = (color: string) => {
            const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
              const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
            })
            return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
          }
          const foreground = luminance(style.color), background = luminance(style.backgroundColor)
          return { color: style.color, background: style.backgroundColor, contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05), darkText: foreground < background }
        })
        styles.push({ label, ...style })
        if (requireContrast) { expect(style.darkText, label).toBe(true); expect(style.contrast, label).toBeGreaterThanOrEqual(4.5) }
      }
      evidence(`${name}-colors.json`, styles)
      await page.screenshot({ path: join(output, `${name}-controls.png`) })
      const pathGeometry = () => host.locator('svg path[stroke]').evaluateAll(elements => elements.map(element => {
        const path = element as SVGPathElement, length = path.getTotalLength()
        return { stroke: path.getAttribute('stroke'), length, points: [0, .2, .4, .6, .8, 1].map(fraction => { const point = path.getPointAtLength(length * fraction); return { x: point.x, y: point.y } }) }
      }))
      if (!originalPaths) originalPaths = await pathGeometry()
      expect(originalPaths).toHaveLength(2)
      await host.getByRole('button', { name: '▶ 逐段示范 L1 路径', exact: true }).click()
      // Interrupt after the first actual drawn segment, before all seven finish.
      await expect.poll(async () => (await pathGeometry())[0].length, { timeout: 1200, intervals: [20] }).toBeLessThan(originalPaths[0].length)
      await host.getByRole('button', { name: '清除示范（保留已确认）', exact: true }).click()
      await host.getByRole('button', { name: '选择 L1 路径', exact: true }).click()
      await host.getByRole('button', { name: '确认 L1 路径', exact: true }).click()
      await expect(host.getByText('L1 路径已确认并保留。请选择 L2。', { exact: true })).toBeVisible()
      await host.getByRole('button', { name: '选择 L2 路径', exact: true }).click()
      await host.getByRole('button', { name: '确认 L2 路径', exact: true }).click()
      await expect(host.getByText('两条经过电源的闭合路径均已确认。现在可以开始预测。', { exact: true })).toBeVisible()
      await expect(host.locator('svg path[opacity="0.9"]')).toHaveCount(2)
      const confirmedPaths = await pathGeometry()
      evidence(`${name}-path-geometry.json`, { originalPaths, confirmedPaths })
      if (requireContrast) for (let index = 0; index < originalPaths.length; index++) {
        expect(confirmedPaths[index].stroke).toBe(originalPaths[index].stroke)
        expect(confirmedPaths[index].length).toBeCloseTo(originalPaths[index].length, 1)
        for (let point = 0; point < originalPaths[index].points.length; point++) {
          expect(confirmedPaths[index].points[point].x).toBeCloseTo(originalPaths[index].points[point].x, 1)
          expect(confirmedPaths[index].points[point].y).toBeCloseTo(originalPaths[index].points[point].y, 1)
        }
      }
      await page.screenshot({ path: join(output, `${name}-both-paths.png`) })
      await host.getByRole('button', { name: '开始预测 →', exact: true }).click()
      await expect(host.getByText('B. L1 亮，L2 灭', { exact: true })).toBeVisible()
      await page.screenshot({ path: join(output, `${name}-prediction.png`) })
    } finally { await overlay.getByRole('button', { name: '关闭预览', exact: true }).click() }
  }
  try {
    await openOriginal()
    const prior = await list()
    expect(prior.records?.some(record => record.status === 'running')).toBe(false)
    await verifyBehavior(false, 'baseline')
    const tree = page.getByTestId('course-page-tree')
    const structurePanel = page.getByRole('button', { name: '页面与图层', exact: true })
    if (await structurePanel.isVisible() && !(await tree.isVisible())) await structurePanel.click()
    await expect(tree).toBeVisible()
    await tree.getByTestId(`spatial-camera-${location.id}`).click()
    if (await structurePanel.isVisible() && await structurePanel.getAttribute('aria-expanded') === 'true') await structurePanel.click()
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手', exact: true })
    await expect(chat).toBeVisible()
    const directory = await page.evaluate(() => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter: 'codex', refresh: true }))
    const model = directory.capabilities?.models.find(model => model.id === 'gpt-5.6-luna')
    if (!model || model.effort.kind !== 'supported' || !model.effort.values.includes('medium')) throw new Error('Native Luna medium required')
    const tier = model.serviceTiers?.find(tier => /fast|priority/i.test(`${tier.id} ${tier.name}`))
    if (!tier) throw new Error('Native Luna Fast required for this named gate')
    await chat.getByLabel('会话', { exact: true }).selectOption('')
    await chat.getByLabel('CLI', { exact: true }).selectOption('codex')
    const configPanel = chat.getByRole('region', { name: 'CLI 模型配置' })
    await configPanel.locator('summary').click()
    await chat.getByLabel('模型', { exact: true }).selectOption(model.id)
    await chat.getByLabel('强度', { exact: true }).selectOption('medium')
    await chat.getByLabel('速度', { exact: true }).selectOption(tier.id)
    await expect(configPanel).toHaveAttribute('aria-busy', 'false')
    await expect(chat.getByLabel('模型', { exact: true })).toHaveValue(model.id)
    await expect(chat.getByLabel('强度', { exact: true })).toHaveValue('medium')
    await expect(chat.getByLabel('速度', { exact: true })).toHaveValue(tier.id)
    evidence('native-route.json', { directory, model: model.id, effort: 'medium', serviceTier: tier.id })
    await chat.getByLabel('意图', { exact: true }).selectOption('edit')
    await chat.getByLabel('应用方式', { exact: true }).selectOption('auto')
    await chat.getByLabel('本轮引用', { exact: true }).selectOption('page')
    const prompt = '请只修正当前并联路径观察页面右侧按钮的文字颜色：现在浅蓝底上的白字看不清，请改成清晰的深色文字。还有一个问题：路径示范中途清除后，再选择并确认 L1、L2，确认时都应显示整条完整通路，已经确认的路径不要被清除。请一并修好。保持按钮底色、大小和位置，保留原来的电路图、路径选择与确认、提示反馈、开始预测功能，以及课件其他所有内容，不要重新生成课件。'
    evidence('request.json', { prompt, projectId: input.projectId, beforeRevision: before.project.revision, targetId: target.layerItemId })
    await chat.getByLabel('发送给创作助手', { exact: true }).fill(prompt)
    safelySaved = false
    taskStarted = true
    await chat.getByRole('button', { name: '发送', exact: true }).click() // The only paid task in this test.
    const readLatest = async () => {
      const response = await list()
      const added = response.records?.filter(record => !prior.records?.some(old => old.id === record.id)) ?? []
      expect(added.length).toBeLessThanOrEqual(1)
      return added[0]
    }
    await expect.poll(async () => {
      const record = await readLatest()
      if (record) evidence('live-record.json', record)
      // A partial native verdict may follow a valid canonical commit. Save that
      // commit before any verdict assertion or close; never discard its History.
      if (record?.hostResult?.status === 'committed') return true
      if (record && ['failed', 'cancelled'].includes(record.task?.status ?? record.status)) throw new Error(`Native terminal without commit: ${record.task?.status ?? record.status}`)
      return false
    }, { timeout: 12 * 60_000, intervals: [2000] }).toBe(true)
    const record = await read((await readLatest())!.id)
    evidence('committed-native-record.json', record)
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).focus()
    await page.keyboard.press('Control+s')
    await expect.poll(() => readArchive().project.revision).toBe(record.hostResult!.afterRevision)
    safelySaved = true
    await expect.poll(async () => {
      const latest = await readLatest()
      if (latest) evidence('terminal-native-record.json', latest)
      return !!latest && ['completed', 'partial', 'failed', 'cancelled'].includes(latest.task?.status ?? latest.status)
    }, { timeout: 120_000, intervals: [1000] }).toBe(true)
    expect(record.lessonWorkspace ?? record.workspace).toEqual(workspace)
    expect(record.adapter).toBe('codex')
    expect(record.hostResult?.beforeRevision).toBe(before.project.revision)
    expect(record.hostResult?.afterRevision).toBe(before.project.revision + 1)
    await verifyBehavior(true, 'committed')
    const saved = readArchive()
    expect(saved.project.id).toBe(before.project.id)
    expect(saved.project.locations).toEqual(before.project.locations)
    const savedSurface = saved.project.surfaces.find(value => value.id === surface.id)
    if (savedSurface?.type !== 'spatial-2d') throw new Error('Spatial preserved')
    const savedTarget = savedSurface.world.layerItems.find(item => item.layerItemId === target.layerItemId)
    if (savedTarget?.kind !== 'component' || target.kind !== 'component') throw new Error('Existing component identity preserved')
    expect(savedTarget.frame).toEqual(target.frame)
    const unchangedProject = structuredClone(saved.project)
    unchangedProject.revision = before.project.revision
    unchangedProject.updatedAt = before.project.updatedAt
    unchangedProject.componentPackages = before.project.componentPackages
    // Canonical package fork may add its static fallback. Every original asset
    // and package must remain intact; no unrelated structural change is allowed.
    for (const [id, meta] of Object.entries(before.project.assets)) expect(saved.project.assets[id]).toEqual(meta)
    unchangedProject.assets = before.project.assets
    const unchangedSurface = unchangedProject.surfaces.find(value => value.id === surface.id)
    if (unchangedSurface?.type !== 'spatial-2d') throw new Error('Spatial preserved')
    const unchangedTarget = unchangedSurface.world.layerItems.find(item => item.layerItemId === target.layerItemId)
    if (unchangedTarget?.kind !== 'component') throw new Error('Component preserved')
    unchangedTarget.component = target.component
    unchangedTarget.staticFallbackAssetId = target.staticFallbackAssetId
    expect(unchangedProject).toEqual(before.project)
    for (const [path, bytes] of Object.entries(before.assetFiles)) expect(saved.assetFiles[path]).toEqual(bytes)
    const savedPackages = componentPackagesFromArchive(saved.project, saved.componentFiles)
    for (const [id, pkg] of Object.entries(baselinePackages)) {
      if (id !== input.packageId || savedTarget.component.packageId !== input.packageId) expect(savedPackages[id]).toEqual(pkg)
    }
    evidence('final.json', { record, project: saved.project })
    await app.close()
    app = await electron.launch({ args: ['.', `--user-data-dir=${input.profile}`], cwd: root,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    page = await app.firstWindow()
    await openOriginal()
    await verifyBehavior(true, 'saved-reopened')
    const finalRecord = await read(record.id)
    evidence('saved-reopened-native-record.json', finalRecord)
    expect(finalRecord.task?.status, 'Artifact preserved; ordinary native task must also complete normally').toBe('completed')
  } finally {
    if (safelySaved || !taskStarted) await app.close()
    else evidence('live-window-preserved.json', { reason: 'Native task started but current commit not confirmed saved; preserve original renderer and History', pid: app.process().pid })
  }
})
