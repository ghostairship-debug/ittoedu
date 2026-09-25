import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'

// F08 路径 C（bounded 段）：h5lesson 工作台与编辑器连续切换、场景状态管理、撤销重做、保存重开、整课预览真实运行。
const root = resolve(__dirname, '../..')
// 证据图默认写未跟踪的 output/：docs 下那份是已跟踪的历史原件，同名 PNG 会被每次重跑逐字节覆盖
// （2026-09-19 的扫描就这样刷掉了 09-17 的 17 张，只剩 git 里还有旧字节）。要归档某一轮结果时,
// 用 R19_FRONTEND_EVIDENCE_DIR 显式指向一个带当次日期的新目录，让归档成为有意识的动作。
const evidence = process.env.R19_FRONTEND_EVIDENCE_DIR
  ? resolve(process.env.R19_FRONTEND_EVIDENCE_DIR)
  : join(root, 'output/playwright/frontend-special-evidence')
mkdirSync(evidence, { recursive: true })

async function activateLesson(page: Page, folder: string, projectFile: string) {
  // V3.1：课例段已从导航移除，点树中的 .h5lesson 直接激活课例上下文。
  await page.locator('.lesson-directory-tree').getByRole('button', { name: folder, exact: true }).first().click()
  await page.locator('.lesson-directory-tree').getByRole('button', { name: projectFile, exact: true }).click()
  await expect(page.getByRole('tab', { name: /course|新建课件/ })).toBeVisible()
}

test('F08 path C: h5lesson workbench continuity, scene states, undo/redo, save/reopen, real preview', async () => {
  test.setTimeout(280_000)
  const directory = mkdtempSync(join(tmpdir(), 'r19-f08-pathC-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
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
    // Setup a real existing V9 lesson; opening it does not create an old CLI conversation.
    const lesson = await page.evaluate(async directory => {
      const made = await window.desktopAPI!.lesson!({ operation: 'create-lesson', directory, name: '场景状态课' })
      if (!made.lesson) throw new Error('Lesson fixture creation failed')
      return made.lesson
    }, workspace)
    const project = createBlankCourseProject({ title: '场景课课件', includeDefaultController: false, controls: 'none' })
    const projectPath = join(lesson.identity.normalizedDirectory, 'course.h5lesson')
    writeFileSync(projectPath, createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }))
    writeFileSync(join(lesson.identity.normalizedDirectory, '.courseware', 'lesson.json'), JSON.stringify({ ...lesson.manifest, coursePath: 'course.h5lesson' }))
    await page.reload()
    // 重载后自动回到上次的工作空间（localStorage 记录），无需再选
    await expect(page.locator('.lesson-workspace-toolbar')).toContainText('workspace')

    // 工作台中的完整编辑器
    await activateLesson(page, '场景状态课', 'course.h5lesson')
    await expect(page.getByRole('button', { name: /撤销/ })).toBeVisible()
    const strip = page.getByRole('region', { name: '场景状态' }).first()
    await expect(strip).toBeVisible()
    await expect(strip.getByRole('button', { name: /基础场景/ })).toBeVisible()
    await page.screenshot({ path: join(evidence, 'C1-editor-in-workbench.png') })

    // 连续切换：文档标签 ⇄ 课件标签、停靠切换，编辑器 DOM 不重建
    const probe = await page.evaluate(() => {
      const host = document.querySelector('.lesson-course-tab')
      const node = host?.firstElementChild ?? null
      ;(window as unknown as { __courseProbe: Element | null }).__courseProbe = node
      return node ? `${node.tagName}.${node.className}` : null
    })
    expect(probe).toBeTruthy()
    await page.getByRole('tab', { name: '材料', exact: true }).click()
    await page.getByRole('tab', { name: /course|新建课件/ }).click()
    const sameNode = await page.evaluate(() => {
      const probe = (window as unknown as { __courseProbe: Element | null }).__courseProbe
      const current = document.querySelector('.lesson-course-tab')?.firstElementChild ?? null
      return probe !== null && probe === current && probe.isConnected
    })
    expect(sameNode, '课件标签切换后编辑器应保持挂载，不得重建').toBe(true)
    await page.locator('.lesson-layout-menu > summary').click()
    await page.getByRole('button', { name: '左', exact: true }).click()
    const sameAfterDock = await page.evaluate(() => {
      const probe = (window as unknown as { __courseProbe: Element | null }).__courseProbe
      const current = document.querySelector('.lesson-course-tab')?.firstElementChild ?? null
      return probe !== null && probe === current && probe.isConnected
    })
    expect(sameAfterDock, '停靠切换后编辑器应保持挂载').toBe(true)
    await page.getByRole('button', { name: '右', exact: true }).click()
    await page.locator('.lesson-popover-backdrop').click()
    await page.screenshot({ path: join(evidence, 'C2-tab-and-dock-continuity.png') })

    // 场景状态管理：新建 → 重命名 → 切换
    await strip.getByRole('button', { name: '新建场景状态', exact: true }).click()
    await strip.getByRole('button', { name: '重命名当前状态', exact: true }).click()
    await page.getByRole('textbox', { name: '状态名称', exact: true }).fill('状态B')
    await page.getByRole('textbox', { name: '状态名称', exact: true }).press('Enter')
    await expect(strip.getByRole('button', { name: /状态B/ })).toBeVisible()
    await strip.getByRole('button', { name: /基础场景/ }).click()
    await strip.getByRole('button', { name: /状态B/ }).click()
    await page.screenshot({ path: join(evidence, 'C3-scene-states.png') })

    // 撤销 / 重做：状态增删真实进历史
    await page.getByRole('button', { name: /撤销/ }).click()
    await expect(strip.getByRole('button', { name: /状态B/ })).toHaveCount(0)
    await page.getByRole('button', { name: /重做/ }).click()
    await expect(strip.getByRole('button', { name: /状态B/ })).toBeVisible()

    // 保存 → 重开（页面重载）→ 状态仍在
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(1500)
    await page.reload()
    // 重载后若存在本地恢复副本，应用会按设计弹出恢复对话框；刚刚已 Ctrl+S 保存，按教师真实操作丢弃副本。
    const discardRecovery = page.getByRole('button', { name: '丢弃副本', exact: true })
    if (await discardRecovery.isVisible().catch(() => false)) await discardRecovery.click()
    // 重载后自动回到上次的工作空间
    await expect(page.locator('.lesson-workspace-toolbar')).toContainText('workspace')
    await activateLesson(page, '场景状态课', 'course.h5lesson')
    await expect(page.getByRole('region', { name: '场景状态' }).first().getByRole('button', { name: /状态B/ })).toBeVisible()
    expect(readFileSync(projectPath).length).toBeGreaterThan(0)
    await page.screenshot({ path: join(evidence, 'C4-save-reopen.png') })

    // 真实运行：整课预览打开播放器宿主
    await page.getByRole('button', { name: '整课预览', exact: true }).click()
    const preview = page.locator('.course-preview-shell')
    await expect(preview).toBeVisible()
    await expect(preview.getByRole('button', { name: '下一页', exact: true })).toBeVisible()
    await expect.poll(() => page.locator('.course-preview-host').evaluate(node => node.childElementCount), { timeout: 30_000 }).toBeGreaterThan(0)
    await page.screenshot({ path: join(evidence, 'C5-real-preview.png') })
    await preview.getByRole('button', { name: '关闭预览', exact: true }).click()
  } finally {
    if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app?.close().catch(() => {})
    if (!resolve(directory).startsWith(resolve(tmpdir()) + require('node:path').sep) || !directory.includes('r19-f08-pathC-')) throw new Error('Unsafe test directory')
    rmSync(directory, { recursive: true, force: true })
  }
})
