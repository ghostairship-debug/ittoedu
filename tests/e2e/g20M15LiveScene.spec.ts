import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { openInWorkbench, root, solidPng } from './helpers/g20M19Harness'
import { canvasReady } from './helpers/g20M21Harness'
import { liveCourse, liveCourseState, QUESTIONS, QUIZ_SOURCE } from './helpers/g20M15Harness'

const COURSE = 'm15-live.h5lesson'
const state = (page: Page) => liveCourseState(page, COURSE)
const creates = (page: Page) => page.evaluate(() => (window as unknown as { __m15Quiz?: { creates: number } }).__m15Quiz?.creates ?? 0)

async function centreOf(locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error('no box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('M15-T01 and T04: edit a Runtime and a component on the canvas, and where the try-run is, then carry on running', async () => {
  test.skip(process.platform !== 'win32', 'Windows desktop acceptance path.')
  test.setTimeout(900_000)
  const base = join(root, 'output/g20/m15/live-scene'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workspace = join(directory, 'workspace'), shots = join(directory, 'shots')
  mkdirSync(workspace); mkdirSync(shots)
  writeFileSync(join(workspace, COURSE), liveCourse())
  const cardPicture = join(directory, '新卡片图.png'), quizPicture = join(directory, '新题图.png')
  writeFileSync(cardPicture, solidPng(160, 90, [220, 38, 38]))
  writeFileSync(quizPicture, solidPng(256, 144, [124, 58, 237]))
  const evidence: Record<string, unknown> = { run: directory }
  const errors: string[] = []
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    // The folder picker answers with the workspace; a file picker with the file the step named.
    await app.evaluate(({ dialog }, folder) => {
      const pick = globalThis as unknown as { m15Pick?: string }
      dialog.showOpenDialog = async (...args: unknown[]) => {
        const options = args.find(value => value && typeof value === 'object' && 'properties' in (value as object)) as { properties?: string[] } | undefined
        return { canceled: false, filePaths: [(options?.properties ?? []).includes('openDirectory') ? folder : pick.m15Pick ?? ''] }
      }
    }, workspace)
    const pick = (file: string) => app!.evaluate((_electron, path) => { (globalThis as unknown as { m15Pick?: string }).m15Pick = path }, file)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await expect(page.getByRole('tree', { name: '工作空间文件' }).getByRole('button', { name: COURSE, exact: true })).toBeVisible()
    await openInWorkbench(page, COURSE)
    await canvasReady(page)

    const modes = page.getByRole('group', { name: '画布模式' })
    const editMode = modes.getByRole('button', { name: '编辑状态', exact: true })
    const runMode = modes.getByRole('button', { name: '当前位置试运行', exact: true })
    const tryRun = page.getByTestId('course-try-run-host')
    const liveBar = page.getByTestId('live-scene-bar')
    const editor = page.getByTestId('canvas-plain-text-editor').locator('input, textarea')
    const authoring = (selector: string) => page.locator(`.published-authoring-host ${selector}`).first()
    const running = (selector: string) => page.locator(`.course-try-run-host ${selector}`).first()
    const targets = page.getByTestId('runtime-authoring-targets')
    const editAt = async (element: Locator, from: string, to: string) => {
      const point = await centreOf(element)
      await page.mouse.dblclick(point.x, point.y)
      await expect(editor).toBeVisible()
      await expect(editor).toHaveValue(from)
      await editor.fill(to)
      await editor.press('Enter')
      await expect(editor).toHaveCount(0)
    }
    const redo = page.getByLabel('常用工具').getByRole('button', { name: '重做', exact: true })
    const start = await state(page)
    evidence.start = { revision: start.revision, creates: await creates(page) }

    // ---------------------------------------------------------------- T04 on the editing canvas
    await test.step('M15-T04 a scene Runtime and a component are edited the same way on the canvas; locked ones are not', async () => {
      await expect(targets.getByRole('button', { name: new RegExp(`^${QUESTIONS[0]}`) })).toBeVisible({ timeout: 60_000 })
      await expect(targets.getByRole('button', { name: /^词语卡片/ })).toBeVisible()
      // The Runtime's own heading: the same in-place editor, written as a rule on the Runtime item.
      await editAt(authoring('[data-m15-question]'), QUESTIONS[0], '听录音，选出你听到的图片')
      await expect.poll(async () => (await state(page)).quiz.overrides).toEqual([{ original: QUESTIONS[0], region: 'div>h2', text: '听录音，选出你听到的图片' }])
      await expect(authoring('[data-m15-question]')).toHaveText('听录音，选出你听到的图片')
      // The component's own title: the same editor, a rule on the component item.
      await editAt(authoring('[data-m15-card-title]'), '词语卡片', '词语卡片：水果')
      await expect.poll(async () => (await state(page)).card.textOverrides).toEqual([{ original: '词语卡片', region: 'section>h3', text: '词语卡片：水果' }])
      await expect(authoring('[data-m15-card-title]')).toHaveText('词语卡片：水果')
      // The component's own picture: replaced by a managed image; the package is untouched.
      await pick(cardPicture)
      const cardBefore = await authoring('[data-m15-card-picture]').getAttribute('src')
      const picturePoint = await centreOf(authoring('[data-m15-card-picture]'))
      await page.mouse.dblclick(picturePoint.x, picturePoint.y)
      await expect.poll(async () => Object.keys((await state(page)).card.assetOverrides)).toEqual(['pic'])
      await expect.poll(async () => authoring('[data-m15-card-picture]').getAttribute('src')).not.toBe(cardBefore)
      await page.screenshot({ path: join(shots, 't04-edited.png') })
      const edited = await state(page)
      expect(edited.quiz.source).toBe(QUIZ_SOURCE)
      evidence.t04 = { quizRules: edited.quiz.overrides, cardRules: edited.card.textOverrides, cardPicture: edited.card.assetOverrides }

      // Locked, the component offers nothing to edit: a double-click writes nothing.
      const cardTitle = await centreOf(authoring('[data-m15-card-title]'))
      await page.mouse.click(cardTitle.x, cardTitle.y, { button: 'right' })
      const menu = page.locator('.command-menu--context').filter({ visible: true })
      await menu.getByRole('menuitem', { name: '锁定', exact: true }).click()
      await expect.poll(async () => (await state(page)).card.locked).toBe(true)
      await expect(targets.getByRole('button', { name: /^词语卡片/ })).toHaveCount(0)
      const lockedRevision = (await state(page)).revision
      await page.mouse.dblclick(cardTitle.x, cardTitle.y)
      await expect(editor).toHaveCount(0)
      expect((await state(page)).revision).toBe(lockedRevision)
      await page.keyboard.press('Control+Z')
      await expect.poll(async () => (await state(page)).card.locked).toBe(false)
      await expect(targets.getByRole('button', { name: /^词语卡片/ })).toBeVisible()
    })

    // ---------------------------------------------------------------- T01 where the try-run is
    await test.step('M15-T01 back from the try-run the page stays where it is, is edited in place and carries on', async () => {
      await runMode.click()
      await expect(tryRun).toHaveAttribute('data-course-player-ready', 'true', { timeout: 60_000 })
      await expect(running('[data-m15-question]')).toHaveText('听录音，选出你听到的图片')
      const instances = await creates(page)
      // Run to the second question and open the card's answer: state the Runtime and the component keep themselves.
      await running('[data-m15-next]').click()
      await expect(running('[data-m15-question]')).toHaveText(QUESTIONS[1])
      await expect(running('[data-m15-count]')).toHaveText('已作答 1 题')
      await running('[data-m15-card-toggle]').click()
      await expect(running('[data-m15-card-answer]')).toBeVisible()
      // Marks on the running instance's own elements tell whether it is still the same one.
      await running('[data-m15-question]').evaluate(element => { element.setAttribute('data-m15-mark', 'same') })
      await running('[data-m15-card-title]').evaluate(element => { element.setAttribute('data-m15-mark', 'same') })
      const same = async () => {
        await expect(running('[data-m15-question]')).toHaveAttribute('data-m15-mark', 'same')
        await expect(running('[data-m15-card-title]')).toHaveAttribute('data-m15-mark', 'same')
      }

      // 编辑状态: the page stays paused where it is; nothing is created again.
      await editMode.click()
      await expect(liveBar).toBeVisible()
      await expect(liveBar).toContainText('运行现场')
      await expect(running('[data-m15-question]')).toHaveText(QUESTIONS[1])
      await expect(running('[data-m15-card-answer]')).toBeVisible()
      await expect(tryRun).toHaveAttribute('inert', '')
      await expect(page.locator('.published-authoring-host')).toHaveCount(0)
      expect(await creates(page)).toBe(instances)
      await same()
      await page.screenshot({ path: join(shots, 't01-live.png') })

      // The text it shows now is edited where it is: the same element and instance, the same progress.
      await editAt(running('[data-m15-question]'), QUESTIONS[1], '跟读：How are you?')
      await expect(running('[data-m15-question]')).toHaveText('跟读：How are you?')
      await expect(running('[data-m15-question]')).toHaveAttribute('data-m15-mark', 'same')
      await expect(running('[data-m15-count]')).toHaveText('已作答 1 题')
      expect(await creates(page)).toBe(instances)
      await expect.poll(async () => (await state(page)).quiz.overrides).toContainEqual({ original: QUESTIONS[1], region: 'div>h2', text: '跟读：How are you?' })
      // The component's answer, shown only after the teacher opened it, too.
      await editAt(running('[data-m15-card-answer]'), '答案：苹果', '答案：红苹果')
      await expect(running('[data-m15-card-answer]')).toHaveText('答案：红苹果')
      await expect(running('[data-m15-card-answer]')).toBeVisible()
      // Undo and redo go into the paused page in place.
      await page.keyboard.press('Control+Z')
      await expect(running('[data-m15-card-answer]')).toHaveText('答案：苹果')
      await redo.click()
      await expect(running('[data-m15-card-answer]')).toHaveText('答案：红苹果')
      await same()
      await page.screenshot({ path: join(shots, 't01-live-edited.png') })

      // 继续运行: the same instance carries on from the second question; its button still works.
      await liveBar.getByRole('button', { name: '继续运行', exact: true }).click()
      await expect(liveBar).toHaveCount(0)
      await expect(runMode).toHaveAttribute('aria-pressed', 'true')
      await running('[data-m15-next]').click()
      await expect(running('[data-m15-question]')).toHaveText(QUESTIONS[2])
      await expect(running('[data-m15-count]')).toHaveText('已作答 2 题')
      await expect(running('[data-m15-card-answer]')).toHaveText('答案：红苹果')
      await same()
      expect(await creates(page)).toBe(instances)
      evidence.t01Hot = { instances, rules: (await state(page)).quiz.overrides, cardRules: (await state(page)).card.textOverrides }
    })

    await test.step('M15-T01 an edit the page cannot take in place is announced, then the page loads again with its course state', async () => {
      const instances = await creates(page)
      await editMode.click()
      await expect(liveBar).toBeVisible()
      await expect(running('[data-m15-question]')).toHaveText(QUESTIONS[2])
      const oldPicture = await running('[data-m15-picture]').getAttribute('src')
      await pick(quizPicture)
      const picturePoint = await centreOf(running('[data-m15-picture]'))
      await page.mouse.dblclick(picturePoint.x, picturePoint.y)
      await expect.poll(async () => (await state(page)).quiz.assets.hero?.assetId).not.toBe('hero')
      // The picture needs a reload: the bar says what that means, and running on waits for it.
      await expect(liveBar).toContainText('要重新加载这一页后才会显示这项修改')
      await expect(liveBar).toContainText('页面位置和课程状态保留')
      await expect(liveBar.getByRole('button', { name: '继续运行', exact: true })).toBeDisabled()
      expect(await running('[data-m15-picture]').getAttribute('src')).toBe(oldPicture)
      await page.screenshot({ path: join(shots, 't01-reload-prompt.png') })
      await liveBar.getByRole('button', { name: '重新加载', exact: true }).click()
      await expect(liveBar.getByRole('button', { name: '重新加载', exact: true })).toHaveCount(0, { timeout: 60_000 })
      await expect(liveBar).toContainText('已停在试运行的这一刻')
      // Loaded again: a new instance (the marks are gone) starts over with its own counter; the course state it kept says
      // 2 answered; the new picture shows.
      expect(await creates(page)).toBeGreaterThan(instances)
      await expect(running('[data-m15-question]')).not.toHaveAttribute('data-m15-mark', 'same')
      await expect(running('[data-m15-question]')).toHaveText('听录音，选出你听到的图片')
      await expect(running('[data-m15-count]')).toHaveText('已作答 2 题')
      await expect.poll(async () => running('[data-m15-picture]').getAttribute('src')).not.toBe(oldPicture)
      await page.screenshot({ path: join(shots, 't01-reloaded.png') })
      await liveBar.getByRole('button', { name: '继续运行', exact: true }).click()
      await running('[data-m15-next]').click()
      await expect(running('[data-m15-count]')).toHaveText('已作答 3 题')
      await expect(running('[data-m15-question]')).toHaveText('跟读：How are you?')
      // Back to the editing canvas from a paused page.
      await editMode.click()
      await expect(liveBar).toBeVisible()
      await liveBar.getByRole('button', { name: '回到编辑画面', exact: true }).click()
      await expect(liveBar).toHaveCount(0)
      await canvasReady(page)
      await expect(page.locator('.published-authoring-host')).toHaveCount(1)
      evidence.t01Reload = { instancesBefore: instances, instancesAfter: await creates(page) }
    })

    await test.step('M15-T01 save and reopen keep the rules and pictures, never the run', async () => {
      await page.keyboard.press('Control+S')
      await expect.poll(async () => (await state(page)).dirty).toBe(false)
      const saved = await state(page)
      const disk = openCourseProjectArchive(new Uint8Array(readFileSync(join(workspace, COURSE))))
      const slide = disk.project.surfaces.find(surface => surface.type === 'slide')
      if (slide?.type !== 'slide') throw new Error('slide surface')
      const quiz = slide.scenes[0]!.layerItems.find(item => item.layerItemId === 'quiz')!
      const card = slide.scenes[0]!.layerItems.find(item => item.layerItemId === 'card')!
      if (quiz.kind !== 'runtime' || card.kind !== 'component') throw new Error('quiz and card')
      expect(quiz.runtime.source).toBe(QUIZ_SOURCE)
      expect(quiz.runtime.content).toEqual({ values: {}, overrides: saved.quiz.overrides })
      expect(quiz.runtime.assets).toEqual(saved.quiz.assets)
      expect(card.textOverrides).toEqual(saved.card.textOverrides)
      expect(card.assetOverrides).toEqual(saved.card.assetOverrides)
      // Nothing of the run is in the file: no course state was declared or stored, no progress.
      expect(disk.project.courseState).toEqual([])
      expect(quiz.runtime.content.values).toEqual({})
      await page.getByRole('tablist', { name: '打开的文件' }).getByRole('button', { name: `关闭 ${COURSE}`, exact: true }).click()
      await openInWorkbench(page, COURSE)
      await canvasReady(page)
      expect((await state(page)).quiz.overrides).toEqual(saved.quiz.overrides)
      await expect(authoring('[data-m15-question]')).toHaveText('听录音，选出你听到的图片')
      await expect(authoring('[data-m15-card-title]')).toHaveText('词语卡片：水果')
      await page.screenshot({ path: join(shots, 't01-reopened.png') })
      evidence.saved = saved
    })
    evidence.errors = errors
    expect(errors).toEqual([])
  } finally {
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    await app?.evaluate(({ app: electronApp, BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
      electronApp.exit(0)
    }).catch(() => {})
  }
})
