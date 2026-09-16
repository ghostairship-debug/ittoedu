import { _electron as electron, expect, test } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { lessonAgentWorkspaceSchema } from '../../src/shared/workspaceIdentity'
import type { LocalAgentRecord } from '../../src/shared/localAgentContract'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import { componentPackagesFromArchive } from '../../src/renderer/components/componentPackageStore'

const inputSchema = z.object({ profile: z.string().min(1), lessonDirectory: z.string().min(1),
  lessonWorkspace: lessonAgentWorkspaceSchema,
  projectPath: z.string().min(1), projectId: z.string().min(1), packageId: z.literal('closed-circuit-switch'),
}).strict()

// One CourseChatPanel task only. Collection/preparation cannot spend tokens.
// The original profile must be explicitly released by the prior delivery Owner.
test('r19 existing mechanism Luna: B retry canonical commit, one Undo, Redo and reopen', async ({}, testInfo) => {
  test.skip(process.env.R19_MECHANISM_LUNA_RUN !== '1', 'Explicit one-task native Luna gate')
  test.setTimeout(20 * 60_000)
  expect(process.env.R19_MECHANISM_PROFILE_RELEASED).toBe('1')
  expect(process.env.R19_MECHANISM_INPUT).toBeTruthy()
  const input = inputSchema.parse(JSON.parse(readFileSync(process.env.R19_MECHANISM_INPUT!, 'utf8')))
  for (const path of [input.profile, input.lessonDirectory, input.projectPath]) realpathSync(path)
  const output = testInfo.outputPath('evidence'); mkdirSync(output, { recursive: true })
  const evidence = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2))
  const readArchive = () => openCourseProjectArchive(new Uint8Array(readFileSync(input.projectPath)))
  const before = readArchive()
  expect(before.project.id).toBe(input.projectId)
  const surface = before.project.surfaces.find(value => value.type === 'slide' && value.scenes.some(scene => scene.layerItems.some(item => item.kind === 'component' && item.component.packageId === input.packageId)))
  if (!surface || surface.type !== 'slide') throw new Error('Original B component must exist in a Slide')
  const scene = surface.scenes.find(value => value.layerItems.some(item => item.kind === 'component' && item.component.packageId === input.packageId))!
  const target = scene.layerItems.find(item => item.kind === 'component' && item.component.packageId === input.packageId)!
  const location = before.project.locations.find(value => value.kind === 'slide-scene' && value.surfaceId === surface.id && value.sceneId === scene.id)
  if (!location) throw new Error('B must have a real saved course location')
  const baselinePackages = componentPackagesFromArchive(before.project, before.componentFiles)
  expect(baselinePackages[input.packageId].runtimeSource).not.toContain('重新预测')
  const workspace = input.lessonWorkspace
  expect(realpathSync(workspace.normalizedDirectory).toLowerCase()).toBe(realpathSync(input.lessonDirectory).toLowerCase())
  const root = resolve(__dirname, '../..')
  let app = await electron.launch({ args: ['.', `--user-data-dir=${input.profile}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  // Failed verification must never block hidden Electron behind a native save modal.
  const installClosePreservation = async () => app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBoxSync.bind(dialog)
    dialog.showMessageBoxSync = ((window: any, options: any) => options?.title === '保存未完成的修改？' ? 0 : original(window, options)) as typeof dialog.showMessageBoxSync
  })
  await installClosePreservation()
  let undoPendingRedo = false
  let page = await app.firstWindow()
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
  async function verifyBehavior(retry: boolean, name: string) {
    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    const overlay = page.getByTestId('course-preview-overlay'), host = page.getByTestId('course-preview-host')
    try {
      const expand = host.getByRole('button', { name: '展开教师控制器', exact: true })
      if (await expand.isVisible()) await expand.click()
      await host.getByRole('button', { name: '场景目录', exact: true }).click()
      const picker = host.getByRole('dialog', { name: '场景目录', exact: true })
      const entry = picker.getByRole('button', { name: location!.label, exact: true })
      if (await entry.getAttribute('aria-current') === 'page') await picker.getByRole('button', { name: '关闭面板', exact: true }).click()
      else {
        await entry.click()
        await expect(picker).toHaveCount(0)
        await host.getByRole('button', { name: '场景目录', exact: true }).click()
        await expect(picker.getByRole('button', { name: location!.label, exact: true })).toHaveAttribute('aria-current', 'page')
        await picker.getByRole('button', { name: '关闭面板', exact: true }).click()
      }
      await expect(picker).toHaveCount(0)
      // The current B page has one prediction component; real open shadow DOM.
      // No runtime state injection, synthetic state mutation or private JS calls.
      const collapse = host.getByRole('button', { name: '收起教师控制器', exact: true })
      if (await collapse.isVisible()) await collapse.click()
      const controls = host
      await expect(controls.getByRole('button', { name: '预测：熄灭', exact: true })).toBeVisible()
      await expect(controls.getByRole('button', { name: '拨到闭合', exact: true })).toHaveCount(0)
      await controls.getByRole('button', { name: '预测：熄灭', exact: true }).click()
      await controls.getByRole('button', { name: '拨到闭合', exact: true }).click()
      await expect(controls.getByText('开关：闭合 ｜ 回路：接通 ｜ 灯泡：发光', { exact: true })).toBeVisible()
      await expect(controls.locator('circle[fill="#fde68a"]').first()).toBeVisible()
      if (retry) {
        await controls.getByRole('button', { name: '重新预测', exact: true }).click()
        await expect(controls.getByRole('button', { name: '预测：发光', exact: true })).toBeVisible()
        await expect(controls.getByRole('button', { name: '预测：熄灭', exact: true })).toBeVisible()
        await expect(controls.getByRole('button', { name: '拨到闭合', exact: true })).toHaveCount(0)
        await expect(controls.getByRole('button', { name: '拨回断开', exact: true })).toHaveCount(0)
        await expect(controls.locator('circle[fill="#e5e7eb"]').first()).toBeVisible()
        // The existing declarative progression guard must again reject advancement.
        await host.getByText(/继续到串联/).click()
        await expect(controls.getByRole('button', { name: '预测：熄灭', exact: true })).toBeVisible()
        await controls.getByRole('button', { name: '预测：熄灭', exact: true }).click()
        await controls.getByRole('button', { name: '拨到闭合', exact: true }).click()
        await expect(controls.getByText('开关：闭合 ｜ 回路：接通 ｜ 灯泡：发光', { exact: true })).toBeVisible()
      } else await expect(controls.getByRole('button', { name: '重新预测', exact: true })).toHaveCount(0)
      await controls.getByRole('button', { name: '拨回断开', exact: true }).click()
      await expect(controls.getByText('开关：断开 ｜ 回路：中断 ｜ 灯泡：熄灭', { exact: true })).toBeVisible()
      await page.screenshot({ path: join(output, `${name}.png`) })
    } finally { await overlay.getByRole('button', { name: '关闭预览', exact: true }).click() }
  }
  try {
    await openOriginal()
    const prior = await list()
    expect(prior.records?.some(record => record.status === 'running')).toBe(false)
    await verifyBehavior(false, 'baseline')
    const tree = page.getByTestId('course-page-tree')
    await tree.locator('button.course-page-tree__label').filter({ hasText: location.label }).click()
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
    const prompt = '请只修改当前课例B“先预测，再拨动开关”的互动，补上脚本里要求的重试功能。正确预测后，在开关操作区增加一个“重新预测”按钮。点击它后，开关回到断开，两道预测选项重新出现，学生需要重新预测正确才能拨动开关；之前已经观察过的记录也重置，所以要再次拨动观察后才能继续到串联。其他片段已完成的学习进度不要清除。保留现在闭合灯亮、断开灯暗的行为，以及现有文字、图示、布局和其他所有内容，不要重新生成课件。';
    evidence('request.json', { prompt, projectId: input.projectId, beforeRevision: before.project.revision, targetId: target.layerItemId })
    await chat.getByLabel('发送给创作助手', { exact: true }).fill(prompt)
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
      if (record?.hostResult?.status === 'committed' && record.task && ['completed', 'partial', 'failed', 'cancelled'].includes(record.task.status)) return true
      if (record?.status === 'failed' || record?.status === 'cancelled' || record?.task?.status === 'failed') throw new Error(`Native task failed: ${record.hostResult?.summary ?? record.status}`)
      return record?.hostResult?.status === 'committed' && record.task?.status === 'completed'
    }, { timeout: 12 * 60_000, intervals: [2000] }).toBe(true)
    const record = await read((await readLatest())!.id)
    expect(record.lessonWorkspace ?? record.workspace).toEqual(workspace)
    evidence('postcommit-native-record.json', record)
    expect(record.adapter).toBe('codex')
    expect(record.hostResult?.beforeRevision).toBe(before.project.revision)
    expect(record.hostResult?.afterRevision).toBe(before.project.revision + 1)
    expect(record.task?.committedStages).toBe(1)
    await verifyBehavior(true, 'committed-retry')
    await page.getByRole('button', { name: '撤销最近一次 AI 修改', exact: true }).click()
    undoPendingRedo = true
    await verifyBehavior(false, 'one-undo-original')
    await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    undoPendingRedo = false
    await verifyBehavior(true, 'redo-retry')
    await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
    await expect.poll(() => readArchive().project.revision).toBe(record.hostResult!.afterRevision)
    const saved = readArchive()
    expect(saved.project.id).toBe(before.project.id)
    expect(saved.project.locations).toEqual(before.project.locations)
    const savedSurface = saved.project.surfaces.find(value => value.id === surface.id)
    if (savedSurface?.type !== 'slide') throw new Error('Slide preserved')
    const savedTarget = savedSurface.scenes.find(value => value.id === scene.id)!.layerItems.find(item => item.layerItemId === target.layerItemId)
    if (savedTarget?.kind !== 'component') throw new Error('Existing component identity preserved')
    expect(savedTarget.frame).toEqual(target.frame)
    const unchangedProject = structuredClone(saved.project)
    const repositoryRoot = join(input.profile, 'local-agent/v3')
    const recordPaths = readdirSync(repositoryRoot, { recursive: true }).filter(name => String(name).endsWith(`${record.id}.json`))
    expect(recordPaths).toHaveLength(1)
    const stored = JSON.parse(readFileSync(join(repositoryRoot, String(recordPaths[0])), 'utf8'))
    const committed = stored.hostResults.find((result: any) => result.status === 'committed' && result.candidateId === record.hostResult!.candidateId)
    expect(committed.receipts).toHaveLength(1)
    const resources = z.object({ assetIds: z.array(z.string()), packageIds: z.array(z.string()) }).parse(committed.receipts[0].resources)
    expect(Object.keys(saved.project.assets).filter(id => !before.project.assets[id]).sort()).toEqual([...resources.assetIds].sort())
    expect(Object.keys(saved.project.componentPackages).filter(id => !before.project.componentPackages[id]).sort()).toEqual([...resources.packageIds].sort())
    evidence('committed-receipt.json', committed)
    unchangedProject.revision = before.project.revision
    unchangedProject.updatedAt = before.project.updatedAt
    unchangedProject.assets = before.project.assets
    unchangedProject.componentPackages = before.project.componentPackages
    const unchangedSurface = unchangedProject.surfaces.find(value => value.id === surface.id)
    if (unchangedSurface?.type !== 'slide') throw new Error('Slide preserved')
    const unchangedTarget = unchangedSurface.scenes.find(value => value.id === scene.id)!.layerItems.find(item => item.layerItemId === target.layerItemId)
    if (unchangedTarget?.kind !== 'component' || target.kind !== 'component') throw new Error('Component preserved')
    unchangedTarget.component = target.component
    unchangedTarget.staticFallbackAssetId = target.staticFallbackAssetId
    expect(unchangedProject).toEqual(before.project)
    for (const [id, bytes] of Object.entries(before.assetFiles)) expect(saved.assetFiles[id]).toEqual(bytes)
    for (const id of resources.assetIds) expect(saved.assetFiles[id]?.byteLength).toBe(saved.project.assets[id]!.byteLength)
    const savedPackages = componentPackagesFromArchive(saved.project, saved.componentFiles)
    for (const [id, pkg] of Object.entries(baselinePackages)) {
      expect(savedPackages[id]).toEqual(pkg)
    }
    expect(componentPackagesFromArchive(saved.project, saved.componentFiles)[savedTarget.component.packageId].runtimeSource).toContain('重新预测')
    evidence('final.json', { record, project: saved.project })
    await app.close()
    app = await electron.launch({ args: ['.', `--user-data-dir=${input.profile}`], cwd: root,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    await installClosePreservation()
    page = await app.firstWindow()
    await openOriginal()
    await verifyBehavior(true, 'saved-reopened-retry')
    // Artifact preservation and behavioral success do not turn a partial native task green.
    expect(record.task?.status, 'Committed artifact preserved; native continuation must separately complete').toBe('completed')
  } finally {
    if (undoPendingRedo) await page.getByRole('button', { name: '重做（Ctrl+Y / Ctrl+Shift+Z）', exact: true }).click()
    await app.close()
  }
})
