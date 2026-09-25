import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { createCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

// Preserved manual path: project folder, material import and explicit fragment selection.
// The removed lesson-stage/embedded CLI run is not part of this scenario.
const root = resolve(__dirname, '../..')
// 证据图默认写未跟踪的 output/：docs 下那份是已跟踪的历史原件，同名 PNG 会被每次重跑逐字节覆盖
// （2026-09-19 的扫描就这样刷掉了 09-17 的 17 张，只剩 git 里还有旧字节）。要归档某一轮结果时,
// 用 R19_FRONTEND_EVIDENCE_DIR 显式指向一个带当次日期的新目录，让归档成为有意识的动作。
const evidence = process.env.R19_FRONTEND_EVIDENCE_DIR
  ? resolve(process.env.R19_FRONTEND_EVIDENCE_DIR)
  : join(root, 'output/playwright/frontend-special-evidence')
mkdirSync(evidence, { recursive: true })

test('material workspace: project folder, multi-select import and explicit fragment selection', async () => {
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

    const lesson = await page.evaluate(async directory => {
      const result = await window.desktopAPI!.lesson!({ operation: 'create-lesson', directory, name: '闭合电路' })
      if (!result.lesson) throw new Error('Lesson fixture missing')
      return result.lesson
    }, workspace)
    const project = createBlankCourseProject({ title: '闭合电路', includeDefaultController: false, controls: 'none' })
    writeFileSync(join(lesson.identity.normalizedDirectory, 'course.h5lesson'), createCourseProjectArchive({ project, assetFiles: {}, componentFiles: {} }))
    writeFileSync(join(lesson.identity.normalizedDirectory, '.courseware', 'lesson.json'), JSON.stringify({ ...lesson.manifest, coursePath: 'course.h5lesson' }))
    await page.reload()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: '闭合电路', exact: true }).click()
    await page.locator('.lesson-directory-tree').getByRole('button', { name: 'course.h5lesson', exact: true }).click()
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

    await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: '教材甲.txt', exact: true }) }).getByRole('checkbox', { name: '用于本课例创作（整份材料）' })).toBeChecked()
    await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: '教案乙.md', exact: true }) }).getByRole('checkbox', { name: '采用片段 1' })).toBeChecked()
    const records = await page.evaluate(async lesson => window.desktopAPI!.lessonMaterials!.list({ lessonId: lesson.identity.lessonId, rootPath: lesson.identity.normalizedDirectory }), lesson)
    expect(records.map(record => record.title).sort()).toEqual(['教材甲.txt', '教案乙.md'].sort())
    for (const record of records) expect(readFileSync(join(lesson.identity.normalizedDirectory, record.sourcePath)).length).toBeGreaterThan(0)
  } finally {
    if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app?.close().catch(() => {})
    if (!resolve(directory).startsWith(resolve(tmpdir()) + require('node:path').sep) || !directory.includes('r19-f08-pathB-')) throw new Error('Unsafe test directory')
    rmSync(directory, { recursive: true, force: true })
  }
})
