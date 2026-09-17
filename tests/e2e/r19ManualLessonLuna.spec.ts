import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { LocalAgentId } from '../../src/shared/localAgentContract'
import { r19ParallelLessonMaterials } from '../fixtures/r19ParallelLessonMaterials'

const root = resolve(__dirname, '../..')
const newEvidence = () => process.env.R19_MANUAL_LUNA_ROOT ?? join(root, 'output', 'r19-manual-luna', new Date().toISOString().replace(/[:.]/g, '-'))
async function launch(evidence: string) {
  mkdirSync(evidence, { recursive: true })
  return electron.launch({ args: ['.', `--user-data-dir=${join(evidence, 'profile')}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
}

test('r19 native directories: Luna routing without model turns', async ({}, testInfo) => {
  test.setTimeout(240_000)
  const evidence = newEvidence(), app = await launch(evidence), page = await app.firstWindow()
  try {
    for (const adapter of ['codex', 'opencode', 'claude'] as const) {
      const directory = await page.evaluate(adapter => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter, refresh: true }), adapter)
      writeFileSync(join(evidence, `${adapter}-native-directory.json`), JSON.stringify(directory, null, 2))
      console.log(JSON.stringify({ adapter, luna: directory.capabilities?.models.filter(model => /luna/i.test(model.id)).map(model => ({ id: model.id, effort: model.effort, serviceTiers: model.serviceTiers })), message: directory.probe?.message }))
    }
    await testInfo.attach('native-directory-evidence', { body: evidence, contentType: 'text/plain' })
  } finally { await app.close() }
})

test('r19 manual Luna: PDF and PPTX, inspect and confirm each actual stage', async ({}, testInfo) => {
  test.skip(process.env.R19_MANUAL_LUNA_RUN !== '1', 'Explicit sequencing gate: directory-only preparation until automatic chain completes')
  test.setTimeout(40 * 60_000)
  const evidence = newEvidence(), workspace = join(evidence, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const app = await launch(evidence), page = await app.firstWindow()
  try {
    const adapter = (process.env.R19_MANUAL_LUNA_ADAPTER ?? 'opencode') as LocalAgentId
    expect(['codex', 'opencode', 'claude']).toContain(adapter)
    const directory = await page.evaluate(adapter => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter, refresh: true }), adapter)
    writeFileSync(join(evidence, 'selected-native-directory.json'), JSON.stringify(directory, null, 2))
    const lunaModels = directory.capabilities?.models.filter(model => /luna/i.test(model.id) && !/astra/i.test(model.id)) ?? []
    const luna = adapter === 'opencode'
      ? lunaModels.find(model => model.id === 'openai/gpt-5.6-luna-fast') ?? lunaModels.find(model => model.id === 'openai/gpt-5.6-luna')
      : lunaModels[0]
    expect(luna, 'Selected native CLI must advertise Luna; never substitute another model').toBeTruthy()
    const fast = luna!.serviceTiers?.find(tier => /fast|priority/i.test(`${tier.id} ${tier.name}`))
    let configuration = { model: luna!.id, effort: luna!.effort.kind === 'supported' ? luna!.effort.default ?? luna!.effort.values[0]! : null, ...(fast ? { serviceTier: fast.id } : {}) }
    let configured = await page.evaluate(({ adapter, configuration }) => window.desktopAPI!.localAgent({ operation: 'configure', adapter, configuration }), { adapter, configuration })
    const selected = configured.capabilities?.models.find(model => model.id === luna!.id)
    if (selected?.effort.kind === 'supported' && selected.effort.values.includes('medium')) {
      configuration = { ...configuration, effort: 'medium' }
      configured = await page.evaluate(({ adapter, configuration }) => window.desktopAPI!.localAgent({ operation: 'configure', adapter, configuration }), { adapter, configuration })
    }
    writeFileSync(join(evidence, 'configuration.json'), JSON.stringify({ adapter, configuration, fastAvailable: !!fast || /luna-fast$/.test(luna!.id), configured }, null, 2))
    expect(configured.enabled).toBe(true)
    expect(configured.capabilities).toBeTruthy()
    await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }) }, workspace)
    // V3.1：保留 profile 重开自动回到上次工作空间，全新运行才出现「打开工作空间」
    const openWorkspace = page.getByRole('button', { name: '打开工作空间', exact: true }).first()
    if (await openWorkspace.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) await openWorkspace.click()
    await expect(page.locator('.lesson-workspace-toolbar')).toBeVisible()
    if (!existsSync(join(workspace, '并联支路证据推理手动课例', '.courseware', 'lesson.json'))) {
      await page.getByRole('button', { name: '新建课件', exact: true }).click()
      await page.getByRole('textbox', { name: '课件名称' }).fill('并联支路证据推理手动课例')
      await page.getByRole('button', { name: '创建课件', exact: true }).click()
      // 课例段已从导航移除：创建后直接激活课例上下文
      await expect(page.locator('.lesson-workflow')).toBeVisible()
    } else {
      // V3.1：课例入口已从「更多」菜单移除，经目录树点选 .h5lesson 恢复课例上下文
      await page.locator('.lesson-directory-tree').getByRole('button', { name: '并联支路证据推理手动课例', exact: true }).click()
      await page.locator('.lesson-directory-tree').getByRole('button', { name: 'course.h5lesson', exact: true }).click()
      await expect(page.locator('.lesson-workflow')).toBeVisible()
    }
    const lesson = await page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons![0]!, workspace)
    const conversation = await page.evaluate(async lesson => (await window.desktopAPI!.lesson!({ operation: 'list-conversations', lesson })).conversations![0]!, lesson.identity)
    const context = { lesson: lesson.identity, conversationId: conversation.conversationId }
    await page.getByLabel('创作流程 CLI', { exact: true }).selectOption(adapter)
    await page.getByRole('tab', { name: '材料', exact: true }).click()
    for (const fixture of r19ParallelLessonMaterials()) {
      const filename = join(evidence, fixture.name); writeFileSync(filename, fixture.bytes)
      const records = await page.evaluate(async lesson => window.desktopAPI!.lessonMaterials!.list({ lessonId: lesson.lessonId, rootPath: lesson.normalizedDirectory }), lesson.identity)
      if (!records.some(record => record.title === fixture.name)) {
        await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, filename)
        await page.getByRole('button', { name: /^添加材料（PDF/ }).click()
      }
      const article = page.getByRole('article').filter({ has: page.getByRole('heading', { name: fixture.name, exact: true }) })
      await expect(article).toBeVisible()
      await article.getByRole('checkbox', { name: '用于本课例创作' }).check()
    }
    const panel = page.getByRole('region', { name: '课例创作流程' })
    await panel.getByRole('button', { name: '手动模式', exact: true }).click()
    await expect(panel.getByRole('button', { name: '手动模式', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)).view.state.materials.length).toBe(2)
    await panel.getByRole('textbox', { name: '课例创作目标' }).fill('八年级已学闭合回路的学生，20分钟探究课。采用课例PDF与PPTX的正文和真实电路图，以并联支路的独立性为新知识：先沿公共节点A、B追踪两条经电源的闭合路径，预测取下L1后L2是否仍亮，再用断开干路开关S的对照解释为什么两灯都灭；比较串联只有一条通路。使用理想电源，只比较亮灭。最后给出L1不亮而L2亮的诊断情境，让学生选择检查位置并用闭合路径证据解释。图必须真实表达两条支路和干路开关，不能把占位色块当电路。每次仅产出当前阶段真实文件，等我查看确认后再进入下一阶段。')
    const roles = ['teaching-brief', 'teaching-plan', 'presentation-brief', 'presentation-script'] as const
    const labels = ['教学简报', '教学策划', '呈现简报', '呈现脚本']
    for (let index = 0; index < roles.length; index++) {
      const role = roles[index]!
      const previous = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
      const existing = previous.view.documents.find(item => item.role === role)
      if (previous.view.state.documents[role] && !existing) throw new Error(`已保存的${labels[index]}当前被恢复稿或诊断阻断，须先修复当前稿，禁止重生成：${previous.view.issues.join('；')}`)
      if (existing?.status === 'confirmed') continue
      if (!existing) {
        await panel.getByRole('button', { name: '生成当前阶段', exact: true }).click()
        await expect.poll(async () => {
          const result = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
          writeFileSync(join(evidence, `${role}-state.json`), JSON.stringify(result, null, 2))
          if (result.run?.status === 'failed' || result.run?.status === 'stopped') throw new Error(result.run.message)
          return result.run?.status
        }, { timeout: 8 * 60_000, intervals: [2000] }).toBe('waiting-confirmation')
      }
      const result = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
      const document = result.view.documents.find(item => item.role === role)!
      expect(document).toBeTruthy(); expect(result.view.currentStage).toBe(role)
      const source = readFileSync(join(lesson.identity.normalizedDirectory, document.relativePath), 'utf8')
      expect(source.trim().length).toBeGreaterThan(80)
      await panel.getByRole('button', { name: `${labels[index]} · ${document.status === 'review' ? '待复核' : '查看当前稿'}`, exact: true }).click()
      const editor = page.getByRole('region', { name: `教学文档 ${document.relativePath}`, exact: true })
      await expect(editor).toBeVisible()
      await expect(editor.locator('.shared-document-editor')).toBeVisible()
      const sourceButton = editor.getByRole('button', { name: '源文', exact: true })
      if (!(await sourceButton.isVisible())) {
        await editor.getByRole('button', { name: '排版', exact: true }).click()
        await expect(editor.getByRole('textbox', { name: '正文排版编辑' })).toBeVisible()
      }
      await sourceButton.click()
      // CodeMirror renders only its viewport; real Select All / Copy reads the full current source.
      await editor.locator('.cm-content').click()
      await page.keyboard.press('Control+a')
      await page.keyboard.press('Control+c')
      await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(source)
      await page.keyboard.press('ArrowLeft')
      await page.screenshot({ path: join(evidence, `${role}-reviewed.png`) })
      writeFileSync(join(evidence, `${role}-reviewed.md`), source)
      await panel.getByRole('button', { name: '确认已查看的当前稿', exact: true }).click()
      await expect(panel.getByRole('button', { name: `${labels[index]} · 已确认`, exact: true })).toBeVisible()
    }
    const outputPath = join(lesson.identity.normalizedDirectory, 'course.h5lesson')
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, outputPath)
    await panel.getByRole('button', { name: '构建课件', exact: true }).click()
    await expect.poll(async () => {
      const result = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
      writeFileSync(join(evidence, 'final-state.json'), JSON.stringify(result, null, 2))
      if (result.run?.status === 'failed' || result.run?.status === 'stopped') throw new Error(result.run.message)
      return result.run?.status
    }, { timeout: 15 * 60_000, intervals: [3000] }).toBe('completed')
    expect(readFileSync(outputPath).byteLength).toBeGreaterThan(100)
    const scope = { version: 1 as const, kind: 'lesson' as const, lessonId: lesson.identity.lessonId, normalizedDirectory: lesson.identity.normalizedDirectory, conversationId: conversation.conversationId }
    const records = await page.evaluate(workspace => window.desktopAPI!.localAgent({ operation: 'lesson-list', workspace }), scope)
    const details = await page.evaluate(async ({ scope, ids }) => Promise.all(ids.map(sessionId => window.desktopAPI!.localAgent({ operation: 'lesson-read', workspace: scope, sessionId, after: 0 }))), { scope, ids: records.records!.map(record => record.id) })
    writeFileSync(join(evidence, 'native-tasks.json'), JSON.stringify(details, null, 2))
    expect(details.filter(result => result.records?.[0]?.status === 'completed').length).toBeGreaterThanOrEqual(5)
    for (const detail of details) {
      const configurationEvent = detail.records![0]!.events.find(event => event.kind === 'session' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && event.payload.status === 'configuration')
      expect(JSON.stringify(configurationEvent), 'Every actual stage must report the selected Luna route').toContain(luna!.id)
    }
    await page.screenshot({ path: join(evidence, 'completed.png') })
    await testInfo.attach('manual-evidence', { body: evidence, contentType: 'text/plain' })
  } finally { await app.close() }
})


test('r19 manual teacher removes leaked validator headings through the source UI', async () => {
  test.skip(!process.env.R19_MANUAL_LUNA_ROOT, 'Requires the retained real manual lesson')
  test.setTimeout(180_000)
  const evidence = newEvidence(), workspace = join(evidence, 'workspace')
  const app = await launch(evidence), page = await app.firstWindow()
  const edits: { role: string; before: string; after: string }[] = []
  try {
    await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }) }, workspace)
    // V3.1：保留 profile 重开自动回到上次工作空间，全新运行才出现「打开工作空间」
    const openWorkspace = page.getByRole('button', { name: '打开工作空间', exact: true }).first()
    if (await openWorkspace.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) await openWorkspace.click()
    await expect(page.locator('.lesson-workspace-toolbar')).toBeVisible()
    const restore = page.getByRole('button', { name: '恢复课件', exact: true })
    const hasRecovery = await restore.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)
    if (hasRecovery) {
      await restore.click()
      await expect(restore).not.toBeVisible()
      const partialPath = join(evidence, 'partial-build.h5lesson')
      await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, partialPath)
      await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click()
      await expect.poll(() => existsSync(partialPath)).toBe(true)
    }
    // V3.1：课例入口已从「更多」菜单移除，经目录树点选 .h5lesson 恢复课例上下文
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '并联支路证据推理手动课例', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: 'course.h5lesson', exact: true }).click()
    await expect(page.locator('.lesson-workflow')).toBeVisible()
    const lesson = await page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons![0]!, workspace)
    const conversation = await page.evaluate(async lesson => (await window.desktopAPI!.lesson!({ operation: 'list-conversations', lesson })).conversations![0]!, lesson.identity)
    const context = { lesson: lesson.identity, conversationId: conversation.conversationId }
    const panel = page.getByRole('region', { name: '课例创作流程' })
    const labels = { 'teaching-brief': '教学简报', 'teaching-plan': '教学策划', 'presentation-brief': '呈现简报', 'presentation-script': '呈现脚本' } as const
    for (const role of Object.keys(labels) as (keyof typeof labels)[]) {
      const state = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
      const document = state.view.documents.find(document => document.role === role)
      if (!document) throw new Error(`Current ${role} is unavailable; do not regenerate`)
      const source = readFileSync(join(lesson.identity.normalizedDirectory, document.relativePath), 'utf8')
      if (!source.startsWith('# 课例 Markdown 候选校验\n\n')) continue
      await panel.getByRole('button', { name: new RegExp(`^${labels[role]} ·`) }).click()
      const editor = page.getByRole('region', { name: `教学文档 ${document.relativePath}`, exact: true })
      await expect(editor).toBeVisible()
      await expect(editor.locator('.shared-document-editor')).toBeVisible()
      const sourceButton = editor.getByRole('button', { name: '源文', exact: true })
      if (await sourceButton.isVisible()) await sourceButton.click()
      await editor.locator('.cm-content').click()
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('Shift+End')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Delete')
      await page.keyboard.press('Delete')
      await editor.getByRole('button', { name: '保存', exact: true }).click()
      const expected = source.replace(/^# 课例 Markdown 候选校验\n\n/, '')
      await expect.poll(() => readFileSync(join(lesson.identity.normalizedDirectory, document.relativePath), 'utf8')).toBe(expected)
      await editor.getByRole('button', { name: '排版', exact: true }).click()
      await expect(editor.getByRole('textbox', { name: '正文排版编辑' })).toBeVisible()
      edits.push({ role, before: source, after: expected })
    }
    const result = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
    writeFileSync(join(evidence, 'teacher-heading-edits.json'), JSON.stringify({ edits, result }, null, 2))
    await page.screenshot({ path: join(evidence, 'teacher-heading-edits.png') })
    expect(edits.length).toBeGreaterThan(0)
  } finally { await app.close() }
})
