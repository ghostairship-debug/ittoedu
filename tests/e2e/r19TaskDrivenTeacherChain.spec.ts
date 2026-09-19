import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openReferenceSelect } from './chatReferenceTarget'

const root = resolve(__dirname, '../..')
const evidenceRoot = process.env.R19_050_EVIDENCE
test.describe.configure({ mode: 'serial' })

async function launch(profile: string) {
  return electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: '', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', [BACKGROUND_E2E_ENV]: '1' } })
}

async function dismissOverlays(page: Page) {
  const backdrop = page.locator('.lesson-popover-backdrop')
  if (await backdrop.count()) await backdrop.first().click({ force: true })
  const reopen = page.getByRole('button', { name: '展开资源与会话侧栏', exact: true })
  if (await reopen.isVisible().catch(() => false)) await reopen.click({ force: true })
}

async function revealWorkbench(page: Page) {
  const closed = page.locator('.lesson-workspace-columns[data-content-closed="true"]')
  if (await closed.count()) {
    await page.getByLabel('布局').click()
    await page.getByRole('button', { name: '展开内容区', exact: true }).click({ force: true })
  }
  await dismissOverlays(page)
  const workbenchTab = page.getByRole('tab', { name: '文档与课件' })
  if (await workbenchTab.count()) await workbenchTab.click({ force: true })
}

async function openWorkspaceAndSession(app: ElectronApplication, workspace: string) {
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }) }, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
  await expect(page.locator('.lesson-workspace-toolbar')).toContainText('workspace')
  await page.getByRole('button', { name: '新建工作空间会话' }).first().click()
  await expect(page.locator('.course-chat--embedded')).toBeVisible()
  await expect(page.getByRole('button', { name: '开始自动创作' })).toHaveCount(0)
  await revealWorkbench(page)
  return page
}

async function firstSave(app: ElectronApplication, page: Page, firstPath: string) {
  const saveButton = page.getByRole('button', { name: '保存（Ctrl+S）', exact: true })
  await expect(saveButton).toBeVisible()
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, firstPath)
  await saveButton.click({ force: true })
  await page.keyboard.press('Control+s')
  await expect.poll(() => existsSync(firstPath), { timeout: 20_000 }).toBe(true)
}

async function configureLuna(page: Page) {
  const directory = await page.evaluate(() => window.desktopAPI!.localAgent({ operation: 'capabilities', adapter: 'codex', refresh: true }))
  const luna = directory.capabilities?.models.find(model => /luna/i.test(model.id))
  expect(luna, 'Actual native catalog must offer Luna').toBeTruthy()
  const fast = luna!.serviceTiers?.find(tier => /fast|priority/i.test(`${tier.id} ${tier.name}`))
  const configuration = { model: luna!.id, effort: luna!.effort.kind === 'supported' ? (luna!.effort.values.includes('medium') ? 'medium' : luna!.effort.default ?? luna!.effort.values[0]!) : null, ...(fast ? { serviceTier: fast.id } : {}) }
  const configured = await page.evaluate(configuration => window.desktopAPI!.localAgent({ operation: 'configure', adapter: 'codex', configuration }), configuration)
  expect(configured.enabled).toBe(true)
  console.log('050 luna route', JSON.stringify({ id: luna!.id, effort: configuration.effort, serviceTier: (configuration as { serviceTier?: string }).serviceTier ?? null, fast: Boolean(fast) }))
  return configuration
}

async function choosePageTarget(chat: ReturnType<Page['getByRole']>) {
  const scope = await openReferenceSelect(chat)
  await scope.selectOption('page')
  await expect(scope).toHaveValue('page')
}

async function typeAndSubmit(chat: ReturnType<Page['getByRole']>, text: string) {
  await expect(chat.getByRole('button', { name: '正在保存配置…' })).toHaveCount(0)
  await chat.getByRole('textbox', { name: '发送给创作助手' }).fill(text)
  await expect(chat.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await chat.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
}

async function submitChat(chat: ReturnType<Page['getByRole']>, text: string) {
  await typeAndSubmit(chat, text)
  await expect(chat.getByRole('button', { name: '停止', exact: true })).toBeEnabled({ timeout: 30_000 })
}

function readArchiveProject(path: string) {
  const files = unzipSync(readFileSync(path))
  const json = files['project.json']
  if (!json) throw new Error(`archive missing project.json: ${path}`)
  return JSON.parse(Buffer.from(json).toString('utf8')) as { title?: string; surfaces?: unknown }
}

function archiveHasMarker(path: string, marker: string) {
  return JSON.stringify(readArchiveProject(path)).includes(marker)
}

function publishedHasMarker(html: string, marker: string) {
  if (html.includes(marker)) return true
  const escaped = [...marker].map(character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')).join('')
  return html.includes(escaped)
}

/** Whole apply phase (first run + bounded retries) must fit the test budget. */
const APPLY_BUDGET_MS = 16 * 60_000

/**
 * Commit receipt only — never chat-scroll / user prompt / legacyInstruction.
 * 「停止」可用 = 任务仍在运行。此时的「本阶段未应用」或错误提示是宿主把失败诊断反馈给 CLI 后
 * 同一任务内的自修（GenerationTaskController 在 rejected 后进入 feeding-back 并继续），不是终态；
 * 只有任务结束（停止不可用）后仍无提交才算失败。已提交的回执以「实际应用结果」或「撤销最近一次 AI 修改」为准。
 */
async function readApplyState(page: Page) {
  return page.evaluate(() => {
    const chat = document.querySelector('.course-chat')
    const strong = chat?.querySelector('[aria-label="实际应用结果"] strong')?.textContent ?? ''
    const alert = chat?.querySelector('[role="alert"]')?.textContent ?? ''
    const notice = chat?.querySelector('[role="status"]')?.textContent ?? ''
    const buttons = [...(chat?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]
    const busy = buttons.some(button => button.textContent === '停止' && !button.disabled)
    const apply = buttons.some(button => button.textContent === '应用候选' && !button.disabled)
    const committed = strong.includes('已应用课件修改') || buttons.some(button => button.textContent === '撤销最近一次 AI 修改')
    if (committed) return busy ? 'COMMITTED-BUSY' : 'COMMITTED'
    if (apply) return 'PREVIEW'
    if (busy) return `WAIT:${strong}|${alert}`
    if (strong.includes('已核对，无需修改')) return 'UNCHANGED'
    if (strong.includes('本阶段未应用') || alert) return `REJECTED:${strong}|${alert}`
    return `ENDED:${strong}|${notice}`
  })
}

function applyStateKind(state: string) { return state.split(':')[0]! }

/** Poll until a terminal class; an idle terminal read is re-confirmed once so a render gap cannot end the wait early. */
async function waitApplyState(page: Page, timeout: number) {
  await expect.poll(async () => {
    const state = await readApplyState(page)
    const kind = applyStateKind(state)
    if (kind === 'REJECTED' || kind === 'ENDED' || kind === 'UNCHANGED') {
      await page.waitForTimeout(2_000)
      const again = await readApplyState(page)
      if (again.startsWith('WAIT:')) return again
      return applyStateKind(again)
    }
    return kind === 'WAIT' ? state : kind
  }, { timeout, intervals: [3_000, 5_000] }).toMatch(/^(COMMITTED|COMMITTED-BUSY|UNCHANGED|PREVIEW|REJECTED|ENDED)$/)
  return readApplyState(page)
}

/** 已应用与已保存分开：提交后任务可能继续核对，给有界收尾；超时则明确停止（已应用阶段保留），再保存。 */
async function settleAfterCommit(page: Page, chat: ReturnType<Page['getByRole']>) {
  const stop = chat.getByRole('button', { name: '停止', exact: true })
  try { await expect(stop).toBeDisabled({ timeout: 3 * 60_000 }) }
  catch {
    console.log('050 task still busy 3m after commit; stopping explicitly, the applied stage is kept')
    await stop.click({ force: true })
    await expect(stop).toBeDisabled({ timeout: 60_000 })
  }
  const final = await readApplyState(page)
  expect(final, 'commit receipt must survive task wind-down').toMatch(/^COMMITTED/)
}

async function ensureCommittedApply(page: Page, chat: ReturnType<Page['getByRole']>, instruction: string) {
  const deadline = Date.now() + APPLY_BUDGET_MS
  const stop = chat.getByRole('button', { name: '停止', exact: true })
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) {
      if (Date.now() + 4 * 60_000 > deadline) throw new Error(`050 apply did not commit and no time budget is left for retry ${attempt}`)
      console.log(`050 retry apply after ${attempt} failed attempt`)
      // Terminal failure leaves 停止 disabled already; a still-busy task is stopped first so 会话 becomes selectable.
      if (await stop.isEnabled().catch(() => false)) await stop.click({ force: true })
      await expect(stop).toBeDisabled({ timeout: 60_000 })
      const session = chat.getByLabel('会话')
      await expect(session).toBeEnabled({ timeout: 30_000 })
      await session.selectOption('')
      await typeAndSubmit(chat, instruction)
      await expect(stop).toBeEnabled({ timeout: 30_000 })
    }
    let state = await waitApplyState(page, Math.min(8 * 60_000, Math.max(60_000, deadline - Date.now())))
    if (state === 'PREVIEW') {
      await chat.getByRole('button', { name: '应用候选' }).click({ force: true, timeout: 10_000 })
      await expect.poll(async () => applyStateKind(await readApplyState(page)).replace(/-BUSY$/, ''), { timeout: 60_000, intervals: [1_000, 2_000] }).toBe('COMMITTED')
      state = await readApplyState(page)
    }
    if (state.startsWith('COMMITTED')) { await settleAfterCommit(page, chat); return }
    if (state === 'UNCHANGED') throw new Error('AI 未改课件（已核对，无需修改）')
    console.log(`050 task ended without commit: ${state}`)
  }
}

async function saveReopenPreviewExport(app: ElectronApplication, page: Page, projectPath: string, htmlPath: string, marker: string, evidenceLabel: string) {
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, projectPath)
  await page.getByRole('button', { name: '保存（Ctrl+S）', exact: true }).click({ force: true })
  await expect.poll(() => archiveHasMarker(projectPath, marker), { timeout: 20_000 }).toBe(true)
  console.log(`050 archive marker ${JSON.stringify(marker)} title=${JSON.stringify(readArchiveProject(projectPath).title)}`)
  await page.reload()
  const restoreRecovery = page.getByRole('button', { name: '恢复课件', exact: true })
  if (await restoreRecovery.isVisible().catch(() => false)) await restoreRecovery.click()
  await expect(page.locator('.lesson-workspace-toolbar')).toContainText('workspace')
  expect(archiveHasMarker(projectPath, marker), 'reopened archive lost the applied marker').toBe(true)
  await revealWorkbench(page)
  const savedName = projectPath.split(/[/\\]/).pop()!
  const fileButton = page.getByRole('button', { name: savedName, exact: true })
  await expect(fileButton).toBeVisible({ timeout: 15_000 })
  await fileButton.click({ force: true })
  const previewButton = page.getByRole('button', { name: '整课预览', exact: true })
  await expect(previewButton).toBeEnabled({ timeout: 15_000 })
  await dismissOverlays(page)
  const preview = page.locator('.course-preview-shell')
  await expect(async () => {
    await dismissOverlays(page)
    await previewButton.click({ force: true })
    await expect(preview).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 30_000 })
  await preview.getByRole('button', { name: '关闭预览', exact: true }).click({ force: true })
  await expect(page.getByTestId('course-preview-overlay')).toHaveCount(0)
  await dismissOverlays(page)
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, htmlPath)
  await page.getByTestId('export-menu-trigger').click({ force: true })
  await page.getByTestId('export-single-html').click({ force: true })
  const preflight = page.getByRole('alertdialog', { name: /导出预检/ })
  await expect(preflight).toBeVisible({ timeout: 30_000 })
  await preflight.getByRole('button', { name: '继续导出', exact: true }).click({ force: true })
  const sizeWarn = page.getByRole('alertdialog', { name: '单 HTML 文件较大' })
  if (await sizeWarn.isVisible().catch(() => false)) {
    await sizeWarn.getByRole('button', { name: '仍导出单 HTML' }).click({ force: true })
  }
  await expect.poll(() => existsSync(htmlPath), { timeout: 60_000 }).toBe(true)
  keepEvidence(evidenceLabel, [projectPath, htmlPath])
  const html = readFileSync(htmlPath)
  expect(html.byteLength).toBeGreaterThan(1000)
  expect(publishedHasMarker(html.toString('utf8'), marker), `exported HTML missing marker ${marker}`).toBe(true)
}

function keepEvidence(label: string, files: string[]) {
  if (!evidenceRoot) return
  mkdirSync(evidenceRoot, { recursive: true })
  for (const file of files) {
    if (!existsSync(file)) continue
    copyFileSync(file, join(evidenceRoot, `${label}-${file.split(/[/\\]/).pop()}`))
  }
}

test('r19 050 task-driven path: directory first-save, ordinary CourseChatPanel edit, save reopen preview export', async () => {
  test.setTimeout(20 * 60_000)
  const directory = mkdtempSync(join(tmpdir(), 'r19-050-task-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const firstPath = join(workspace, 'task-driven.h5lesson')
  const htmlPath = join(workspace, 'task-driven.html')
  const marker = '闭合电路探究'
  let app: ElectronApplication | undefined
  try {
    app = await launch(profile)
    const page = await openWorkspaceAndSession(app, workspace)
    await firstSave(app, page, firstPath)
    expect(archiveHasMarker(firstPath, marker)).toBe(false)
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await expect(chat).toBeVisible({ timeout: 30_000 })
    await dismissOverlays(page)
    await expect(page.getByRole('button', { name: '开始自动创作' })).toHaveCount(0)
    await configureLuna(page)
    await choosePageTarget(chat)
    const instruction = '在当前空白演示页正中加入一行标题文字，文字必须精确为闭合电路探究。不要调用四阶段文稿。'
    await submitChat(chat, instruction)
    await ensureCommittedApply(page, chat, instruction)
    await saveReopenPreviewExport(app, page, firstPath, htmlPath, marker, 'task-driven')
  } finally {
    if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app?.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
})

test('r19 050 review-first path: 先审当前制品后再生成, save reopen preview export', async () => {
  test.setTimeout(20 * 60_000)
  const directory = mkdtempSync(join(tmpdir(), 'r19-050-review-'))
  const workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const profile = join(directory, 'profile')
  const firstPath = join(workspace, 'review-first.h5lesson')
  const htmlPath = join(workspace, 'review-first.html')
  const marker = '审阅闭合电路'
  let app: ElectronApplication | undefined
  try {
    app = await launch(profile)
    const page = await openWorkspaceAndSession(app, workspace)
    await firstSave(app, page, firstPath)
    expect(archiveHasMarker(firstPath, marker)).toBe(false)
    const chat = page.getByRole('complementary', { name: 'CLI 创作助手' })
    await expect(chat).toBeVisible({ timeout: 30_000 })
    await dismissOverlays(page)
    await expect(page.getByRole('button', { name: '开始自动创作' })).toHaveCount(0)
    await configureLuna(page)
    await chat.locator('.chat-task-settings > summary').click()
    await chat.getByText('先审当前制品再继续').click()
    const gate = chat.getByLabel('用户明确要求先看当前策划/脚本后再生成')
    await gate.click({ force: true })
    await expect(gate).toBeChecked()
    const instruction = '按当前策划在当前页加入标题文字：审阅闭合电路'
    await typeAndSubmit(chat, instruction)
    await expect(chat.getByRole('alert')).toContainText(/审阅并确认当前教学策划和呈现脚本/)
    await chat.getByLabel('当前策划 Markdown').fill('# 教学策划\n\n一页演示，标题文字：审阅闭合电路。')
    await chat.getByLabel('已审阅当前策划').click({ force: true })
    await expect(chat.getByLabel('已审阅当前策划')).toBeChecked()
    await chat.getByLabel('当前脚本 Markdown').fill('# 呈现脚本\n\n只保留标题文字审阅闭合电路，不要互动。')
    await chat.getByLabel('已审阅当前脚本').click({ force: true })
    await expect(chat.getByLabel('已审阅当前脚本')).toBeChecked()
    await expect(chat.getByRole('button', { name: '正在保存配置…' })).toHaveCount(0)
    await chat.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    await expect(chat.getByRole('button', { name: '停止', exact: true })).toBeEnabled({ timeout: 30_000 })
    await ensureCommittedApply(page, chat, instruction)
    await saveReopenPreviewExport(app, page, firstPath, htmlPath, marker, 'review-first')
  } finally {
    if (app) await app.evaluate(({ BrowserWindow, app: electronApp }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); electronApp.exit(0) }).catch(() => {})
    await app?.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
})
