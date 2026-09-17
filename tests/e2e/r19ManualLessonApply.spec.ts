import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { LessonBuildTarget } from '../../src/shared/lessonAuthoringDesktop'
import type { LessonIdentity } from '../../src/shared/lessonWorkspace'

test('manual reviewed current documents apply the repaired native module on an observed empty target', async ({}, testInfo) => {
 test.skip(process.env.R19_MANUAL_APPLY !== '1', 'Requires explicit retained-profile handoff and new empty target recovery authorization')
 test.setTimeout(10 * 60_000)
 const root = resolve(__dirname, '../..'), evidence = join(root, 'output/r19-manual-luna/manual-parallel-20260915-170551')
 const output = join(evidence, 'manual-apply', new Date().toISOString().replace(/[:.]/g, '-')); mkdirSync(output, { recursive: true })
 const workspace = join(evidence, 'workspace'), profile = join(evidence, 'profile')
 const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root, env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
 const page = await app.firstWindow()
 try {
  // V3.1：保留 profile 重开自动回到上次工作空间
  await expect(page.locator('.lesson-workspace-toolbar')).toBeVisible()
  await expect(page.locator('.lesson-workspace-navigation')).toBeVisible()
  const restore = page.getByRole('button', { name: '恢复课件', exact: true })
  const recoveryVisible = await restore.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)
  writeFileSync(join(output, 'recovery-observation.json'), JSON.stringify({ recoveryVisible, observedAt: new Date().toISOString() }, null, 2))
  if (recoveryVisible) throw new Error('A real recovery is available; preserve and inspect it before selecting a new target')
  // V3.1：课例入口已从「更多」菜单移除，经目录树点选 .h5lesson 恢复课例上下文
  await page.locator('.lesson-directory-tree').getByRole('button', { name: '并联支路证据推理手动课例', exact: true }).click()
  await page.locator('.lesson-directory-tree').getByRole('button', { name: 'course.h5lesson', exact: true }).click()
  const panel = page.getByRole('region', { name: '课例创作流程' }); await expect(panel).toBeVisible()
  const lesson = await page.evaluate(async directory => (await window.desktopAPI!.lesson!({ operation: 'list-lessons', directory })).lessons!.find(value => value.identity.lessonId === '30965ee9-8925-427d-bfa4-b5fedef5e86a')!, workspace)
  const conversationId = '9f30c84d-b856-467c-962d-ac265297f4ba'
  const context = { lesson: lesson.identity, conversationId }
  const observed = await page.evaluate(({ lesson, conversationId }) => {
   const observe = (window as unknown as { __COURSEWARE_E2E_OBSERVE_EMPTY_BUILD__?: (lesson: LessonIdentity, conversationId: string) => LessonBuildTarget }).__COURSEWARE_E2E_OBSERVE_EMPTY_BUILD__
   if (!observe) throw new Error('Canonical empty-project observer unavailable')
   return observe(lesson, conversationId)
  }, context)
  const prior = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
  writeFileSync(join(output, 'explicit-new-target-recovery.json'), JSON.stringify({ reason: 'Old unsaved empty project was lost and no recovery was offered. Root explicitly authorized continuing the repaired module on this currently observed new empty project. This is not restoration of the old identity or proof of first-save continuity.', target: observed, prior }, null, 2))
  expect(prior.run?.status).toBe('ready-to-build'); expect(prior.application).toBe('has-changes'); expect(prior.failure).toBeUndefined()
  await page.evaluate(({ context, ticketId, target }) => window.desktopAPI!.lessonAuthoring!({ operation: 'fail-application', ...context, ticketId, hasCommittedChanges: true, failure: { target, committedStepCount: 0 } }), { context, ticketId: prior.run!.ticketId, target: observed })
  const roles = ['teaching-plan', 'presentation-brief', 'presentation-script'] as const
  const labels = { 'teaching-plan': '教学策划', 'presentation-brief': '呈现简报', 'presentation-script': '呈现脚本' }
  for (const role of roles) {
   const state = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
   const document = state.view.documents.find(value => value.role === role)
   if (!document) throw new Error(`${role} blocked; do not regenerate`)
   if (document.status === 'confirmed') continue
   expect(state.view.currentStage).toBe(role)
   await panel.getByRole('button', { name: new RegExp(`^${labels[role]} ·`) }).click()
   const editor = page.getByRole('region', { name: `教学文档 ${document.relativePath}`, exact: true })
   await expect(editor.locator('.shared-document-editor')).toBeVisible()
   const source = readFileSync(join(lesson.identity.normalizedDirectory, document.relativePath), 'utf8')
   const sourceButton = editor.getByRole('button', { name: '源文', exact: true })
   if (await sourceButton.isVisible()) await sourceButton.click()
   await editor.locator('.cm-content').click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c')
   await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(source)
   await page.keyboard.press('ArrowLeft')
   await editor.getByRole('button', { name: '排版', exact: true }).click()
   await expect(editor.getByRole('textbox', { name: '正文排版编辑' })).toBeVisible()
   await page.screenshot({ path: join(output, `${role}-reviewed.png`) })
   writeFileSync(join(output, `${role}-reviewed.md`), source)
   await panel.getByRole('button', { name: '确认已查看的当前稿', exact: true }).click()
   await expect(panel.getByRole('button', { name: `${labels[role]} · 已确认`, exact: true })).toBeVisible()
  }
  const projectPath = join(lesson.identity.normalizedDirectory, 'course.h5lesson')
  expect(existsSync(projectPath)).toBe(false)
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, projectPath)
  await panel.getByRole('button', { name: '按当前稿重新准备原构建', exact: true }).click()
  const prepared = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
  writeFileSync(join(output, 'prepared-current-ticket.json'), JSON.stringify(prepared, null, 2))
  expect(prepared.failure?.target).toEqual(observed)
  await panel.getByRole('button', { name: '修正模块后继续当前构建', exact: true }).click()
  await expect.poll(async () => {
   const state = await page.evaluate(context => window.desktopAPI!.lessonAuthoring!({ operation: 'read', ...context }), context)
   writeFileSync(join(output, 'application-state.json'), JSON.stringify(state, null, 2))
   return state.run?.status
  }, { timeout: 6 * 60_000, intervals: [2000] }).toBe('completed')
  expect(existsSync(projectPath)).toBe(true)
  const archive = unzipSync(readFileSync(projectPath)), project = JSON.parse(strFromU8(archive['project.json']!))
  expect(project.id).toBe(observed.projectId)
  expect(project.locations.length).toBeGreaterThan(3)
  writeFileSync(join(output, 'saved-project.json'), JSON.stringify({ projectPath, id: project.id, revision: project.revision, locations: project.locations, surfaces: project.surfaces, assets: project.assets }, null, 2))
  await page.screenshot({ path: join(output, 'saved-current-project.png') })
  await testInfo.attach('manual-apply-evidence', { body: output, contentType: 'text/plain' })
 } finally { await app.close() }
})
