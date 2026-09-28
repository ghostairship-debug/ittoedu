import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { chooseG20M24Workspace, closeG20M24App, configureG20M24Roles, createG20M24Connection,
  launchG20M24App } from './helpers/g20M24Harness'
import { m23Row, openM23Html } from './helpers/g20M23Harness'
import { M18_HTML, M18_MATERIAL, M18_MODEL, M18_PLAN, M18_REPRESENTATION, M18_SCRIPT,
  startG20M18Model } from './helpers/g20M18Model'

const root = resolve(__dirname, '../..')

for (const mode of ['default', 'automatic'] as const) {
  test(`M18-T04 local fake model completes ${mode} course creation through real tools and save/reopen`, async ({}, info) => {
    test.skip(process.platform !== 'win32', 'M18-T04 requires the Windows Electron workbench.')
    test.setTimeout(480_000)
    const base = join(root, 'output/g20/m18/creation-chain')
    mkdirSync(base, { recursive: true })
    const directory = mkdtempSync(join(base, `${mode}-`))
    const workspace = join(directory, 'workspace')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'material.md'), M18_MATERIAL, 'utf8')
    const fixture = { directory, workspace, profile: join(directory, 'profile'), courseFile: join(workspace, 'assembled.h5lesson') }
    const model = await startG20M18Model(mode)
    const evidence: Record<string, unknown> = { case: 'M18-T04', mode, workspace, status: 'running' }
    let app: Awaited<ReturnType<typeof launchG20M24App>>['app'] | undefined
    let page: Awaited<ReturnType<typeof launchG20M24App>>['page'] | undefined
    let capture: Awaited<ReturnType<typeof launchG20M24App>>['capture'] | undefined
    try {
      const launched = await launchG20M24App(fixture); app = launched.app; page = launched.page; capture = launched.capture
      const connectionId = await createG20M24Connection(page, model.endpoint)
      await configureG20M24Roles(page, connectionId, M18_MODEL, M18_MODEL, true)
      await chooseG20M24Workspace(app, page, workspace)
      const instruction = mode === 'automatic'
        ? '请根据 material.md 根据材料自动创作两页互动课件，完成中间文件、按页导入、逐页视觉精修、保存，并列出假设。'
        : '请根据 material.md 创作两页互动课件；当前教学策划和框架 HTML 各给我审阅确认一次，然后完成后置表示规划、按页组装、视觉精修与保存。'
      await page.getByLabel('给创作助手发消息', { exact: true }).fill(instruction)
      await page.getByRole('button', { name: '发送', exact: true }).click()
      const conversation = await page.evaluate(async path => {
        const scope = await window.desktopAPI.execution!.workspace(path)
        return scope.conversations[0] ?? await window.desktopAPI.execution!.createConversation(scope.workspace.workspaceId)
      }, workspace)
      const runId = await expect.poll(async () => (await page!.evaluate(async input =>
        (await window.desktopAPI.execution!.conversation(input.workspaceId, input.conversationId))?.runIndex.builtinRunIds.at(-1) ?? null,
      { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId })), { timeout: 60_000 }).not.toBeNull()
        .then(() => page!.evaluate(async input => (await window.desktopAPI.execution!.conversation(input.workspaceId, input.conversationId))!
          .runIndex.builtinRunIds.at(-1)!, { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }))
      evidence.runId = runId

      const card = page.getByRole('region', { name: 'AI 的提问', exact: true })
      if (mode === 'default') {
        await expect(card).toBeVisible({ timeout: 90_000 })
        await expect(card).toContainText('01-teaching-plan.md')
        expect(readFileSync(join(workspace, '01-teaching-plan.md'), 'utf8')).toBe(M18_PLAN)
        await card.getByRole('group', { name: '可选答案', exact: true })
          .getByRole('button', { name: '确认当前教学策划', exact: true }).click()
        await expect(card).toContainText('02-course-frame.html', { timeout: 90_000 })
      } else {
        await expect.poll(() => model.error ?? model.previewReady, { timeout: 90_000 }).toBe(true)
        if (model.error) throw new Error(model.error)
        await expect(card).toHaveCount(0)
      }

      const htmlRegion = await openM23Html(page, '02-course-frame.html')
      const preview = htmlRegion.frameLocator('iframe[title="HTML 预览"]')
      const toolbar = htmlRegion.getByRole('toolbar', { name: 'HTML 分页', exact: true })
      await expect(toolbar).toContainText('1 / 2')
      await expect(preview.locator('#predict')).toBeVisible()
      await toolbar.getByRole('button', { name: '下一页', exact: true }).click()
      await expect(toolbar).toContainText('2 / 2')
      await expect(preview.locator('#explain')).toBeVisible()
      await expect(preview.getByRole('button', { name: '揭示结论' })).toBeVisible()
      evidence.preview = { pages: 2, interactiveControl: 'present in live workbench preview', currentHtmlConfirmed: mode === 'default' }
      await info.attach(`M18 ${mode} HTML preview`, { body: await htmlRegion.locator('iframe[title="HTML 预览"]').screenshot(), contentType: 'image/png' })
      expect(readFileSync(join(workspace, '02-course-frame.html'), 'utf8')).toBe(M18_HTML)
      expect(readFileSync(join(workspace, '02-presentation-script.md'), 'utf8')).toBe(M18_SCRIPT)
      if (mode === 'default') {
        await card.getByRole('group', { name: '可选答案', exact: true })
          .getByRole('button', { name: '确认当前框架 HTML', exact: true }).click()
      } else model.releasePreview()

      await expect.poll(async () => (await page!.evaluate(id => window.desktopAPI.execution!.run(id), runId))?.status,
        { timeout: 300_000, intervals: [500] }).toMatch(/^(completed|partial|failed|stopped|interrupted)$/)
      const run = await page.evaluate(id => window.desktopAPI.execution!.run(id), runId)
      if (!run) throw new Error('Completed run was not readable')
      evidence.status = run.status
      evidence.tools = run.tools.map(tool => ({ name: tool.call.name, kind: tool.result?.kind,
        status: tool.result?.kind === 'document-operation' ? tool.result.result.status :
          tool.result?.kind === 'read' ? (tool.result.data as { status?: string })?.status : undefined,
        code: tool.result?.kind === 'error' ? tool.result.code : undefined }))
      evidence.error = model.error
      expect(run.status, JSON.stringify(evidence.tools)).toBe('completed')
      expect(model.error).toBeUndefined()
      const names = run.tools.map(tool => tool.call.name)
      const ask = run.tools.filter(tool => tool.call.name === 'ask_user')
      expect(ask).toHaveLength(mode === 'default' ? 2 : 0)
      expect(names[0]).toBe('skills.read')
      const capability = run.tools.findIndex(tool => tool.call.name === 'skills.read'
        && (tool.call.input as { path?: string }).path === 'references/representation-capabilities.md')
      expect(capability).toBeGreaterThan(0)
      expect(capability).toBeLessThan(names.indexOf('html.import'))
      expect(names.indexOf('html.import')).toBeGreaterThan(names.indexOf('tools.load'))
      expect(names.filter(name => name === 'view.observe')).toHaveLength(2)
      expect(names.filter(name => name === 'native.insert')).toHaveLength(2)
      expect(names.filter(name => name === 'file.save')).toHaveLength(5)
      expect(names).not.toContain('build.write')
      expect(names).not.toContain('image.generate')
      expect(run.tools.filter(tool => tool.call.name === 'html.import' || tool.call.name === 'native.insert')
        .every(tool => tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied')).toBe(true)
      expect(run.tools.filter(tool => tool.call.name === 'file.save')
        .every(tool => tool.result?.kind === 'read' && (tool.result.data as { status?: string }).status === 'saved')).toBe(true)
      if (mode === 'default') {
        expect(ask.every(tool => tool.result?.kind === 'read' && (tool.result.data as { status?: string }).status === 'answered')).toBe(true)
        expect(names.indexOf('ask_user')).toBeLessThan(names.indexOf('html.import'))
      }
      expect(readFileSync(join(workspace, '03-representation-plan.md'), 'utf8')).toBe(M18_REPRESENTATION)
      expect(existsSync(fixture.courseFile)).toBe(true)
      const persisted = openCourseProjectArchive(new Uint8Array(readFileSync(fixture.courseFile)))
      const slide = persisted.project.surfaces.find(surface => surface.type === 'slide')
      if (!slide || slide.type !== 'slide') throw new Error('Saved course lacks a Slide surface')
      expect(slide.scenes).toHaveLength(2)
      for (const scene of slide.scenes) {
        expect(scene.layerItems.some(item => item.kind === 'runtime')).toBe(true)
        expect(scene.layerItems.some(item => item.kind === 'native')).toBe(true)
      }
      await m23Row(page, 'assembled.h5lesson').dblclick()
      const tab = page.locator('.workspace-document-tabs').getByRole('tab', { name: /^assembled\.h5lesson/ })
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('button', { name: '关闭 assembled.h5lesson', exact: true }).click()
      await m23Row(page, 'assembled.h5lesson').dblclick()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
      const reopened = await page.evaluate(async filename => (await window.desktopAPI.documents!.list())
        .find(item => item.binding.kind === 'file' && item.binding.path.endsWith(filename)), 'assembled.h5lesson')
      expect(reopened?.model.kind).toBe('course-v9')
      expect(reopened?.dirty).toBe(false)
      expect(capture.pageErrors).toEqual([])
      evidence.reopened = { revision: reopened?.revision, dirty: reopened?.dirty, pages: slide.scenes.length }
      evidence.status = 'passed'
    } catch (error) {
      evidence.status = 'failed'
      evidence.failure = error instanceof Error ? error.stack ?? error.message : String(error)
      throw error
    } finally {
      model.releasePreview()
      evidence.modelCalls = model.calls
      evidence.modelError = model.error
      writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8')
      await info.attach(`M18 ${mode} evidence`, { path: join(directory, 'evidence.json'), contentType: 'application/json' })
      if (app) await closeG20M24App(app)
      await model.close()
    }
  })
}
