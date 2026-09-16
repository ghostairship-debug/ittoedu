import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { r19LessonMaterials } from '../fixtures/r19LessonMaterials'

const goal = '为八年级初学者设计15分钟的闭合电路探究。请依据教材与附图，先用演示页解释电源、导线、灯泡和开关如何形成完整回路，让学生先预测再操作开关，错误后能重试并看到原因；再留一份可滚动的探究记录帮助学生解释现象；最后在可缩放的关系图中比较串联电路两个不同断点，解释为什么两盏灯会一起熄灭。学生完成观察和正确解释后再进入下一环节。文字清楚、图形科学，教师能够继续编辑。'
const facts = '闭合电路探究教材。电源提供电能，导线连接电源、灯泡与开关。从电源一端经过用电器回到另一端，形成完整闭合回路，灯泡才发光。开关断开时有真实断点，灯泡熄灭；闭合时导线连续，灯泡发光。附图左侧画闭合开关及发光灯泡，右侧画抬起的开关与熄灭灯泡。串联电路的两灯在同一条路径上，任一连接点断开，两灯都熄灭。比较不同断点时每次只改变一个位置，先恢复再验证另一个。不能按开关离哪盏灯更近来判断控制范围。课堂使用低压电池，禁止用导线直接连接电源两端。'
const diagram = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="440" viewBox="0 0 960 440"><rect width="960" height="440" fill="white"/><g stroke="#25364a" stroke-width="5" fill="none"><path d="M70 110H190M230 110H370V340H230M210 340H70V110"/><path d="M190 110H230M210 315V365M230 325V355"/><circle cx="370" cy="230" r="32" fill="#ffd75e"/><path d="M347 207L393 253M393 207L347 253"/><path d="M570 110H690M730 110H870V340H730M710 340H570V110"/><path d="M690 110L730 75M710 315V365M730 325V355"/><circle cx="870" cy="230" r="32" fill="#e2e8f0"/><path d="M847 207L893 253M893 207L847 253"/></g><g font-family="Arial,sans-serif" font-size="26" fill="#25364a"><text x="150" y="48">CLOSED: lamp ON</text><text x="640" y="48">OPEN: lamp OFF</text><text x="120" y="407">Battery + closed switch</text><text x="620" y="407">Battery + open switch</text></g></svg>`

test('r19 current teacher GUI automatic Luna: natural goal and normal repair controls', async () => {
 test.skip(process.env.R19_CURRENT_TEACHER_LUNA_RUN !== '1', 'Explicitly authorized named Luna case only')
 test.setTimeout(70 * 60_000)
 const root = resolve(__dirname, '../..'), evidence = process.env.R19_CURRENT_TEACHER_EVIDENCE ?? join(root, 'output/r19-current-teacher-luna', new Date().toISOString().replace(/[:.]/g, '-'))
 const workspace = join(evidence, 'workspace'), name = '电路探究三种学习空间'
 mkdirSync(workspace, { recursive: true })
 writeFileSync(join(evidence, 'teacher-input.txt'), goal)
 writeFileSync(join(evidence, 'material-facts.txt'), facts)
 writeFileSync(join(evidence, 'material-diagram.svg'), diagram)
 const png = await sharp(Buffer.from(diagram)).png().toBuffer()
 writeFileSync(join(evidence, 'material-diagram.png'), png)
 const docx = unzipSync(r19LessonMaterials().find(item => item.format === 'docx')!.bytes)
 docx['word/document.xml'] = strToU8(strFromU8(docx['word/document.xml']!).replace('Series circuit teaching material', facts).replaceAll('cx="914400" cy="914400"', 'cx="7315200" cy="3352800"'))
 docx['word/media/diagram.png'] = png
 const materialPath = join(evidence, '闭合电路图文教材.docx')
 writeFileSync(materialPath, zipSync(docx))
 const app = await electron.launch({ args: ['.', `--user-data-dir=${join(evidence, 'profile')}`], cwd: root, env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
 const page = await app.firstWindow()
 try {
  const directory = await page.evaluate(() => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter: 'codex', refresh: true }))
  const luna = directory.capabilities?.models.find(model => /luna/i.test(model.id))
  expect(luna, 'Actual native catalog must offer Luna').toBeTruthy()
  const fast = luna!.serviceTiers?.find(tier => /fast|priority/i.test(`${tier.id} ${tier.name}`))
  expect(luna!.effort.kind === 'supported' && luna!.effort.values.includes('medium')).toBe(true)
  const configuration = { model: luna!.id, effort: 'medium', ...(fast ? { serviceTier: fast.id } : {}) }
  const configured = await page.evaluate(configuration => window.desktopAPI!.localAgent({ operation: 'configure', adapter: 'codex', configuration }), configuration)
  writeFileSync(join(evidence, 'actual-native-route.json'), JSON.stringify({ directory, configuration, configured }, null, 2))
  expect(configured.enabled, 'Configured native Luna route must be enabled before starting').toBe(true)
  await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }) }, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
  await page.getByRole('button', { name: '新建课例', exact: true }).click()
  await page.getByRole('textbox', { name: '课例名称' }).fill(name)
  await page.getByRole('button', { name: '创建课例', exact: true }).click()
  await expect(page.locator('.lesson-workspace-lessons').getByRole('button', { name })).toBeVisible()
  const lesson = await page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons![0]!, workspace)
  const conversation = await page.evaluate(async lesson => (await window.desktopAPI!.lesson!({ operation: 'list-conversations', lesson })).conversations![0]!, lesson.identity)
  const context = { lesson: lesson.identity, conversationId: conversation.conversationId }
  writeFileSync(join(evidence, 'context.json'), JSON.stringify(context, null, 2))
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, materialPath)
  await page.getByRole('tab', { name: '材料', exact: true }).click()
  await page.getByRole('button', { name: /^添加材料（PDF/ }).click()
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: '闭合电路图文教材.docx', exact: true }) }).last().getByRole('checkbox', { name: '用于本课例创作（整份材料）', exact: true }).check()
  const panel = page.getByRole('region', { name: '课例创作流程' })
  await page.getByRole('combobox', { name: '创作流程 CLI', exact: true }).selectOption('codex')
  await panel.getByRole('button', { name: '根据材料自动创作', exact: true }).click()
  await expect(panel.getByRole('button', { name: '根据材料自动创作', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('textbox', { name: '课例创作目标' }).fill(goal)
  const outputPath = join(lesson.identity.normalizedDirectory, 'course.h5lesson')
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, outputPath)
  await page.screenshot({ path: join(evidence, 'before-normal-start.png') })
  await panel.getByRole('button', { name: '生成当前阶段', exact: true }).click()
  // A test-driver instruction chooses only a visible teacher action. It never writes a candidate,
  // injects tool contracts, changes application metadata, or substitutes an extra model loop.
  let previous = '', done = false
  const actions: Record<string, string> = { 'repair-build': '请助手修复当前构建', 'repair-document': '修复当前阶段文档', 'continue-build': '修正模块后继续当前构建', retry: '重试当前构建', 'save-edit': '保存并继续编辑当前课件', stop: '停止' }
  for (let iteration = 0; iteration < 1300; iteration++) {
   const current = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
   writeFileSync(join(evidence, 'current-stage.json'), JSON.stringify(current, null, 2))
   const signature = JSON.stringify([current.run, current.application, current.failure])
   if (signature !== previous) { previous = signature; writeFileSync(join(evidence, `stage-${Date.now()}.json`), JSON.stringify(current, null, 2)); await page.screenshot({ path: join(evidence, 'current-workspace.png') }) }
   if (current.run?.status === 'completed') { done = true; break }
   const commandPath = join(evidence, 'teacher-action.json')
   if (existsSync(commandPath)) {
    const action = JSON.parse(readFileSync(commandPath, 'utf8')) as { action: string; instruction?: string }
    renameSync(commandPath, join(evidence, `teacher-action-${Date.now()}.json`))
    if (!actions[action.action]) throw new Error('Unknown teacher UI action')
    if (action.instruction) await panel.getByRole('textbox', { name: '课例创作目标' }).fill(action.instruction)
    await panel.getByRole('button', { name: actions[action.action], exact: true }).click()
   }
   await page.waitForTimeout(3000)
  }
  expect(done, 'A running native task or retained failure is not an accepted course').toBe(true)
  expect(existsSync(outputPath)).toBe(true)
  const archive = unzipSync(readFileSync(outputPath))
  writeFileSync(join(evidence, 'saved-archive-entries.json'), JSON.stringify(Object.keys(archive), null, 2))
  writeFileSync(join(evidence, 'saved-project-path.txt'), outputPath)
  const scope = { version: 1 as const, kind: 'lesson' as const, lessonId: lesson.identity.lessonId, normalizedDirectory: lesson.identity.normalizedDirectory, conversationId: conversation.conversationId }
  const records = await page.evaluate(workspace => window.desktopAPI!.localAgent({ operation: 'lesson-list', workspace }), scope)
  const details = await page.evaluate(async ({ workspace, ids }) => Promise.all(ids.map(sessionId => window.desktopAPI!.localAgent({ operation: 'lesson-read', workspace, sessionId, after: 0 }))), { workspace: scope, ids: records.records!.map(record => record.id) })
  writeFileSync(join(evidence, 'actual-native-tasks.json'), JSON.stringify(details, null, 2))
  expect(details.length).toBeGreaterThanOrEqual(5)
  for (const item of details) {
   const config = item.records![0]!.events.find(event => event.kind === 'session' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && event.payload.status === 'configuration')
   expect(JSON.stringify(config)).toMatch(/luna/i)
  }
  await page.screenshot({ path: join(evidence, 'actual-saved.png') })
 } finally { await app.close() }
})
