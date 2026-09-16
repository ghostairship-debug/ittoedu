import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { r19LessonMaterials } from '../fixtures/r19LessonMaterials'

test('r19 automatic Luna: actual material through four files and same-window Builder', async ({}, testInfo) => {
  test.skip(process.env.R19_AUTOMATIC_LUNA_RUN !== '1', 'Explicit R19_AUTOMATIC_LUNA_RUN=1 is required for paid native validation')
  test.setTimeout(35 * 60_000)
  const root = resolve(__dirname, '../..'), evidence = process.env.R19_LUNA_RESUME_ROOT ?? join(root, 'output', 'r19-authoring-luna', new Date().toISOString().replace(/[:.]/g, '-'))
  const workspace = join(evidence, 'workspace'); mkdirSync(workspace, { recursive: true })
  const app = await electron.launch({ args: ['.', `--user-data-dir=${join(evidence, 'profile')}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
  const page = await app.firstWindow()
  try {
    if (process.env.R19_LUNA_EMPTY_PROJECT_RETRY === '1') {
      await app.evaluate(({ dialog }) => {
        const original = dialog.showMessageBox
        dialog.showMessageBox = async (...args: [Electron.MessageBoxOptions] | [Electron.BaseWindow, Electron.MessageBoxOptions]) => {
          const options = args.at(-1) as { title?: string; buttons?: string[] }
          if (options.title === '放弃未保存的修改？' && options.buttons?.[0] === '放弃修改') return { response: 0, checkboxChecked: false }
          return args.length === 1 ? original(args[0]) : original(args[0], args[1])
        }
      })
      writeFileSync(join(evidence, 'known-empty-project-retry.json'), JSON.stringify({ acknowledged: true, reason: 'Explicitly authorized retry of created/renamed empty project before any teaching content was committed; never use for partial teaching output.' }))
    }
    const directory = await page.evaluate(() => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter: 'codex', refresh: true }))
    const luna = directory.capabilities?.models.find(model => /luna/i.test(model.id) && !/astra/i.test(model.id))
    writeFileSync(join(evidence, 'native-directory.json'), JSON.stringify(directory, null, 2))
    expect(luna, 'Native directory must advertise Luna before any model call').toBeTruthy()
    const fast = luna!.serviceTiers?.find(tier => /fast|priority/i.test(`${tier.id} ${tier.name}`))
    const configuration = { model: luna!.id, effort: luna!.effort.kind === 'supported' ? luna!.effort.default ?? luna!.effort.values[0]! : null, ...(fast ? { serviceTier: fast.id } : {}) }
    const configured = await page.evaluate(configuration => window.desktopAPI!.localAgent({ operation: 'configure', adapter: 'codex', configuration }), configuration)
    writeFileSync(join(evidence, 'requested-configuration.json'), JSON.stringify({ configuration, fastAvailable: !!fast, configured }, null, 2))
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, join(workspace, '闭合电路自动课例', 'course.h5lesson'))
    await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }) }, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    const existing = await page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons!, workspace)
    if (!existing.length) {
      await page.getByRole('button', { name: '新建课例', exact: true }).click()
      await page.getByRole('textbox', { name: '课例名称' }).fill('闭合电路自动课例')
      await page.getByRole('button', { name: '创建课例', exact: true }).click()
    }
    await expect(page.locator('.lesson-workspace-lessons').getByRole('button', { name: /闭合电路自动课例/ })).toBeVisible()
    if (existing.length) {
      const restore = page.getByRole('button', { name: '恢复课件', exact: true })
      await restore.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
      if (await restore.isVisible()) await restore.click()
      await page.locator('.lesson-workspace-lessons').getByRole('button', { name: /闭合电路自动课例/ }).click()
    }
    const lesson = await page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons![0]!, workspace)
    const conversation = await page.evaluate(async lesson => (await window.desktopAPI!.lesson!({ operation: 'list-conversations', lesson })).conversations![0]!, lesson.identity)
    const panel = page.getByRole('region', { name: '课例创作流程' })
    const restored = await page.evaluate(async context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), { lesson: lesson.identity, conversationId: conversation.conversationId })
    if (process.env.R19_LUNA_REPAIR_CURRENT_DOCUMENTS === '1') {
      for (const name of ['teaching-brief.md', '01-teaching-plan.md', 'presentation-brief.md', '02-presentation-script.md']) {
        const retained = join(evidence, `original-before-format-repair-${name}`)
        if (!existsSync(retained)) writeFileSync(retained, readFileSync(join(lesson.identity.normalizedDirectory, name)))
      }
      const roles = ['teaching-brief', 'teaching-plan', 'presentation-brief', 'presentation-script'] as const
      for (const role of roles) {
        const current = await page.evaluate(async context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), { lesson: lesson.identity, conversationId: conversation.conversationId })
        if (current.view.currentStage === 'build') break
        if (current.view.currentStage !== role) continue
        writeFileSync(join(evidence, `before-native-repair-${role}.json`), JSON.stringify(current, null, 2))
        await panel.getByRole('textbox', { name: '课例创作目标' }).fill('仅修当前阶段真实文档，不重生成教学内容。先实际读取本轮baseline.md/request.json、当前前置阶段文件和所选教材正文；保留原15分钟目标、电路事实、图像引用及教师已明确纠正的附图只是色块事实。删除正文开头和其他位置的内部lessonId/hash/候选与尚未提交等流程状态信息。只将复杂多段引用、嵌套列表等解析器不支持结构改成可表达相同语义的正式Markdown；保留全部教学解释与布局操作。遵循本轮request.json输出协议，优先将修复后的完整当前稿写入指定replacement.md，由宿主生成精确修改并CAS保存；不要手工计算偏移，也不要把校验器标题或工具说明抄入正文。不要写其他正式文件或构建模块。')
        const stageLabels = { 'teaching-brief': '教学简报', 'teaching-plan': '教学策划', 'presentation-brief': '呈现简报', 'presentation-script': '呈现脚本' }
        await expect(panel.getByText(`当前阶段：${stageLabels[role]}`, { exact: true })).toBeVisible()
        await panel.getByRole('button', { name: '修复当前阶段文档', exact: true }).click()
        await expect.poll(async () => {
          const value = await page.evaluate(async context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), { lesson: lesson.identity, conversationId: conversation.conversationId })
          writeFileSync(join(evidence, `native-repair-${role}.json`), JSON.stringify(value, null, 2))
          const errors = await panel.getByRole('alert').allTextContents()
          if (errors.length) throw new Error(errors.join('；'))
          return value.view.currentStage !== role && !value.repairTicket
        }, { timeout: 10 * 60_000, intervals: [2000] }).toBe(true)
        await page.screenshot({ path: join(evidence, `native-repair-${role}.png`) })
      }
    }
    if (!restored.run) {
    const fixture = r19LessonMaterials().find(item => item.format === 'docx')!, filename = join(evidence, '闭合与串联电路教材.docx')
    const source = unzipSync(fixture.bytes)
    const facts = '闭合与串联电路教材。电源提供电能，导线连接电源、灯泡和开关。只有从电源一端经过用电器回到另一端形成完整闭合回路时，灯泡才会发光。开关断开使回路中断，灯泡熄灭；闭合开关后回路接通，灯泡发光。串联电路中两个灯泡依次连接在同一条电流路径上，开关放在回路中任一位置都能控制所有灯泡。任一灯泡接触不良都会中断整个回路，使两灯同时熄灭。不要把“开关靠近哪个灯泡就只控制哪个灯泡”当成规则，应沿整条回路判断。故障诊断先检查回路是否闭合，再逐个检查连接点。课堂操作使用低压电池，禁止将导线直接连接电源两端。'
    source['word/document.xml'] = strToU8(strFromU8(source['word/document.xml']!).replace('Series circuit teaching material', facts))
    writeFileSync(filename, zipSync(source))
    writeFileSync(join(evidence, 'material-facts.txt'), facts)
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, filename)
    await page.getByRole('tab', { name: '材料', exact: true }).click()
    await page.getByRole('button', { name: /^添加材料（PDF/ }).click()
    await page.getByRole('article').filter({ has: page.getByRole('heading', { name: '闭合与串联电路教材.docx', exact: true }) }).last().getByRole('checkbox').check()
    if (await panel.getByRole('button', { name: '根据材料自动创作', exact: true }).getAttribute('aria-pressed') !== 'true') await panel.getByRole('button', { name: '根据材料自动创作', exact: true }).click()
    await expect(panel.getByRole('button', { name: '根据材料自动创作', exact: true })).toHaveAttribute('aria-pressed', 'true')
    }
    await panel.getByRole('textbox', { name: '课例创作目标' }).fill('为八年级初学者讲解闭合电路和串联电路，15分钟。基于所选教材，先从电源、导线、灯泡和开关建立电流路径，再对比开关断开与闭合，让学生预测并操作验证灯泡变化，最后解释串联回路的共同通断。需要可读的图示和一个开关互动，教师可以编辑和再次使用。')
    const outputPath = join(lesson.identity.normalizedDirectory, 'course.h5lesson')
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, outputPath)
    await page.screenshot({ path: join(evidence, 'workspace-before-generation.png') })
    const priorRun = await page.evaluate(async context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), { lesson: lesson.identity, conversationId: conversation.conversationId })
    if (process.env.R19_LUNA_REPAIR_CURRENT_DOCUMENTS === '1' && priorRun.view.currentStage === 'build' && priorRun.run?.status === 'ready-to-build' && !priorRun.assembly) await panel.getByRole('button', { name: '按当前稿重新准备原构建', exact: true }).click()
    if (!priorRun.run || !['running', 'ready-to-build', 'completed'].includes(priorRun.run.status)) await panel.getByRole('button', { name: priorRun.view.currentStage === 'build' ? '构建课件' : '生成当前阶段', exact: true }).click()
    await expect.poll(async () => {
      const result = await page.evaluate(async context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), { lesson: lesson.identity, conversationId: conversation.conversationId })
      writeFileSync(join(evidence, 'current-stage.json'), JSON.stringify(result, null, 2))
      if (result.run?.status === 'failed' || result.run?.status === 'stopped') throw new Error(result.run.message)
      return result.run?.status
    }, { timeout: 30 * 60_000, intervals: [3000] }).toBe('completed')
    const manifest = JSON.parse(readFileSync(join(lesson.identity.normalizedDirectory, '.courseware', 'lesson.json'), 'utf8'))
    expect(Object.keys(manifest.documents)).toHaveLength(4)
    const documents = Object.fromEntries(Object.entries(manifest.documents as Record<string, string>).map(([role, relativePath]) => [role, readFileSync(join(lesson.identity.normalizedDirectory, relativePath), 'utf8')]))
    for (const role of ['teaching-plan', 'presentation-script']) { expect(documents[role]).toContain('闭合'); expect(documents[role]).toContain('串联'); expect(documents[role]).toContain('开关') }
    writeFileSync(join(evidence, 'current-documents.json'), JSON.stringify(documents, null, 2))
    expect(existsSync(outputPath)).toBe(true); expect(readFileSync(outputPath).byteLength).toBeGreaterThan(100)
    const records = await page.evaluate(async scope => window.desktopAPI!.localAgent({ operation: 'lesson-list', workspace: scope }), { version: 1 as const, kind: 'lesson' as const, lessonId: lesson.identity.lessonId, normalizedDirectory: lesson.identity.normalizedDirectory, conversationId: conversation.conversationId })
    const scope = { version: 1 as const, kind: 'lesson' as const, lessonId: lesson.identity.lessonId, normalizedDirectory: lesson.identity.normalizedDirectory, conversationId: conversation.conversationId }
    const details = await page.evaluate(async ({ scope, ids }) => Promise.all(ids.map(sessionId => window.desktopAPI!.localAgent({ operation: 'lesson-read', workspace: scope, sessionId, after: 0 }))), { scope, ids: records.records!.map(record => record.id) })
    writeFileSync(join(evidence, 'native-tasks.json'), JSON.stringify(details, null, 2))
    expect(details.filter(result => result.records?.[0]?.status === 'completed').length).toBeGreaterThanOrEqual(5)
    for (const result of details) {
      const record = result.records![0]!
      const config = record.events.find(event => event.kind === 'session' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && event.payload.status === 'configuration')
      expect(JSON.stringify(config), 'Each actual native turn must report Luna configuration').toMatch(/luna/i)
    }
    await page.screenshot({ path: join(evidence, 'completed.png') })
    await testInfo.attach('evidence-path', { body: evidence, contentType: 'text/plain' })
  } finally { await app.close() }
})
