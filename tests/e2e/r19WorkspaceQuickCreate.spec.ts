import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { destroyEditor, launchEditor, revealWorkbench, runDirectory } from './r19ChatSpecSupport'

const NEW_TAB = '[aria-label="新建标签页"]'
const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase()

async function chooseDirectory(app: ElectronApplication, directory: string) {
  await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, directory)
}

/**
 * V06 快速新建：＋新建 Markdown 真实落盘 + 标签选中 + 干净关闭与脏标签先落盘再关。
 * 「新建课件」只证入口接通同一流程（真正建课例由 r19LessonWorkspace 覆盖），属浅证据。
 */
test('r19 V06 快速新建: ＋新建 MD/课件入口与标签关闭', async () => {
  test.setTimeout(4 * 60_000)
  const directory = runDirectory('r19-v06-create-')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  let app: ElectronApplication | undefined
  try {
    app = await launchEditor(profile)
    const page = await app.firstWindow()
    await chooseDirectory(app, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await expect(page.locator('.lesson-workspace-switcher > summary strong')).toHaveText(basename(workspace))
    await revealWorkbench(page)

    await page.locator(NEW_TAB).click()
    const popover = page.locator('.lesson-new-tab-popover')
    await expect(popover).toBeVisible()
    await expect(popover.getByLabel('Markdown 文档名')).toBeVisible()
    await expect(popover.getByRole('button', { name: '创建文档' })).toBeVisible()
    await popover.getByRole('button', { name: '新建课件' }).click()
    const createDialog = page.getByRole('dialog', { name: '新建课件' })
    await expect(createDialog).toBeVisible()
    await createDialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(createDialog).toHaveCount(0)

    const stamp = Date.now()
    const first = `新笔记${stamp}`
    await page.locator(NEW_TAB).click()
    await expect(popover).toBeVisible()
    await popover.getByLabel('Markdown 文档名').fill(first)
    await popover.getByRole('button', { name: '创建文档' }).click()
    await expect(page.getByRole('tab', { name: `${first}.md`, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('region', { name: `教学文档 ${first}.md` })).toBeVisible()
    expect(readFileSync(join(workspace, `${first}.md`), 'utf8'), '主进程 create-file 实测写 # 名称 加空行').toBe(`# ${first}\n\n`)

    await page.getByRole('button', { name: `关闭 ${first}.md`, exact: true }).click()
    await expect(page.getByRole('tab', { name: `${first}.md`, exact: true })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '新建课件', exact: true })).toHaveAttribute('aria-selected', 'true')

    const second = `新笔记2${stamp}`
    await page.locator(NEW_TAB).click()
    await expect(popover).toBeVisible()
    await popover.getByLabel('Markdown 文档名').fill(second)
    await popover.getByRole('button', { name: '创建文档' }).click()
    const secondEditor = page.getByRole('region', { name: `教学文档 ${second}.md` })
    await expect(secondEditor).toBeVisible()
    await secondEditor.getByRole('button', { name: '源文', exact: true }).click()
    await secondEditor.getByRole('textbox', { name: '正文源文编辑' }).fill(`# ${second}\n\n教师新增一行。\n`)
    await page.getByRole('button', { name: `关闭 ${second}.md`, exact: true }).click()
    await expect(page.getByRole('tab', { name: `${second}.md`, exact: true })).toHaveCount(0)
    await expect.poll(() => readFileSync(join(workspace, `${second}.md`), 'utf8'), { timeout: 15_000 }).toContain('教师新增一行。')
    console.log('V06 create', JSON.stringify({ first: readFileSync(join(workspace, `${first}.md`), 'utf8'), second: readFileSync(join(workspace, `${second}.md`), 'utf8') }))
  } finally {
    await destroyEditor(app, directory)
  }
})

/**
 * V06 最近列表：可证的真值只有「主进程已持久化」与「跨启动左上切换器可见」。
 * 刻意不断言「同会话内弹层立即出现 B」—— 控制器只在挂载拉取 recent，openWorkspace 成功后不重取。
 */
test('r19 V06 最近列表: 跨启动真值与顺序', async () => {
  test.setTimeout(4 * 60_000)
  const directory = runDirectory('r19-v06-recent-')
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const other = join(directory, 'other'); mkdirSync(other)
  const profile = join(directory, 'profile')
  let app: ElectronApplication | undefined
  try {
    app = await launchEditor(profile)
    let page = await app.firstWindow()
    await chooseDirectory(app, workspace)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await expect(page.locator('.lesson-workspace-switcher > summary strong')).toHaveText(basename(workspace))
    const firstRecent = await page.evaluate(async () => (await window.desktopAPI!.lesson!({ operation: 'recent-workspaces' })).recent ?? [])
    expect(firstRecent.map(normalize), '打开工作空间后主进程必须已持久化').toContain(normalize(workspace))

    await app.close(); app = undefined
    app = await launchEditor(profile)
    page = await app.firstWindow()
    await expect(page.locator('.lesson-workspace-switcher > summary strong')).toHaveText(basename(workspace))
    const recent = await page.evaluate(async () => (await window.desktopAPI!.lesson!({ operation: 'recent-workspaces' })).recent ?? [])
    const remembered = recent.find(value => normalize(value) === normalize(workspace))!
    expect(remembered, '跨启动必须能取回上次工作空间的 realpath 真值').toBeTruthy()

    await page.locator('.lesson-workspace-switcher > summary').click()
    const switcher = page.locator('.lesson-workspace-switcher-popover')
    await expect(switcher).toBeVisible()
    await expect(switcher.getByTitle(remembered)).toHaveAttribute('aria-pressed', 'true')

    await chooseDirectory(app, other)
    await page.getByRole('button', { name: '选择其他工作空间文件夹…' }).click()
    await expect(page.locator('.lesson-workspace-switcher > summary strong')).toHaveText(basename(other))
    const afterSwitch = await page.evaluate(async () => (await window.desktopAPI!.lesson!({ operation: 'recent-workspaces' })).recent ?? [])
    expect(afterSwitch).toHaveLength(2)
    expect(normalize(afterSwitch[0]!), '切到 B 后 recent 首位必须是 B').toBe(normalize(other))
    expect(normalize(afterSwitch[1]!)).toBe(normalize(workspace))
    console.log('V06 recent', JSON.stringify({ before: recent, after: afterSwitch }))
  } finally {
    await destroyEditor(app, directory)
  }
})
