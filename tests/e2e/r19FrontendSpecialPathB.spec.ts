import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

// F08 路径 B（ bounded 段）：项目文件夹、材料多选导入与采用、自动模式真实启动到 running 后停止。
// 手动四阶段全量确认由 r19ManualLessonLuna.spec.ts 承载，受单次命令时长限制不在此处重跑。
const root = resolve(__dirname, '../..')
const evidence = join(root, 'docs/development-plan/reviews/2026-09-17-frontend-special-evidence')
mkdirSync(evidence, { recursive: true })

test('F08 path B: project folder, multi-select materials, adoption, real automatic start and stop', async () => {
  test.setTimeout(280_000)
  const directory = mkdtempSync(join(tmpdir(), 'r19-f08-pathB-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const materialA = join(directory, '教材甲.txt'), materialB = join(directory, '教案乙.md')
  writeFileSync(materialA, '闭合回路：电源、导线、灯泡、开关形成完整路径，灯泡才发光。')
  writeFileSync(materialB, '# 串联电路教案\n\n两个灯泡依次连接在同一条电流路径上，任一断开两灯同灭。')
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root,
      env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, workspace)
    const openButton = page.getByRole('button', { name: '打开工作空间', exact: true }).first()
    await expect(openButton).toBeVisible()
    await openButton.click()
    await expect(page.locator('.lesson-workspace-toolbar')).toContainText('workspace')

    // 项目：弹系统对话框选择工作空间内的真实文件夹，确认条默认名 = 文件夹名
    const projectFolder = join(workspace, '九年级物理'); mkdirSync(projectFolder)
    await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, projectFolder)
    await page.getByRole('button', { name: '新建项目' }).first().click()
    await expect(page.getByRole('textbox', { name: '项目名称' })).toHaveValue('九年级物理')
    await page.getByRole('button', { name: '创建项目', exact: true }).click()
    await expect(page.locator('.lesson-project-group', { hasText: '九年级物理' })).toBeVisible()
    expect(existsSync(join(workspace, '九年级物理'))).toBe(true)

    // 课件 + 材料多选导入（一次对话框选两个真实文件）；课例段已从导航移除，空对话区的「新建课件」直达模态框
    await page.getByRole('button', { name: '新建课件', exact: true }).click()
    await page.getByRole('textbox', { name: '课件名称' }).fill('闭合电路')
    await page.getByRole('button', { name: '创建课件' }).click()
    // 课例段已从导航移除：创建后直接激活课例上下文（创作流程面板出现）
    await expect(page.locator('.lesson-workflow')).toBeVisible()
    await page.getByRole('tab', { name: '材料', exact: true }).click()
    await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: input }) }, [materialA, materialB])
    await page.getByRole('button', { name: /^添加材料（PDF/ }).click()
    await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: '教材甲.txt', exact: true }) })).toBeVisible()
    await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: '教案乙.md', exact: true }) })).toBeVisible()
    await page.screenshot({ path: join(evidence, 'B1-multi-select-materials.png') })

    // 多选采用：整份采用甲、按片段采用乙
    await page.getByRole('article').filter({ has: page.getByRole('heading', { name: '教材甲.txt', exact: true }) }).getByRole('checkbox', { name: '用于本课例创作（整份材料）' }).check()
    await page.getByRole('article').filter({ has: page.getByRole('heading', { name: '教案乙.md', exact: true }) }).getByRole('checkbox', { name: '采用片段 1' }).check()
    await page.screenshot({ path: join(evidence, 'B2-adopted-selections.png') })

    // 自动模式真实启动：开始自动创作 → running → 停止
    const panel = page.getByRole('region', { name: '课例创作流程' })
    await panel.getByRole('button', { name: '自动模式（按材料）', exact: true }).click()
    await expect(panel.getByText(/自动模式已就绪/)).toBeVisible()
    await page.getByRole('textbox', { name: '课例创作目标' }).fill('为八年级学生讲闭合电路与串联电路，15 分钟，基于所选材料。')
    await panel.getByRole('button', { name: '开始自动创作', exact: true }).click()
    const context = await page.evaluate(async directory => {
      const lesson = (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons![0]!
      const conversation = (await window.desktopAPI!.lesson!({ operation: 'list-conversations', lesson: lesson.identity })).conversations![0]!
      return { lesson: lesson.identity, conversationId: conversation.conversationId }
    }, workspace)
    let status = ''
    for (let attempt = 0; attempt < 60; attempt++) {
      const current = await page.evaluate(async context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
      status = current.run?.status ?? ''
      if (status === 'running' || status === 'waiting-confirmation') break
      if (status === 'failed' || status === 'stopped') throw new Error(`自动启动失败：${current.run?.message}`)
      await page.waitForTimeout(2000)
    }
    expect(['running', 'waiting-confirmation']).toContain(status)
    await page.screenshot({ path: join(evidence, 'B3-automatic-running.png') })
    await panel.getByRole('button', { name: '停止', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(async context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)).run?.status).toBe('stopped')
    await page.screenshot({ path: join(evidence, 'B4-automatic-stopped.png') })
  } finally {
    if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app?.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
})
