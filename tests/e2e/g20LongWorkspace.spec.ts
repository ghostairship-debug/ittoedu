import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'

const root = resolve(__dirname, '../..')
function slideItemCount(filename: string) {
  const project = openCourseProjectArchive(new Uint8Array(readFileSync(filename))).project
  return project.surfaces.reduce((total, surface) => surface.type === 'slide'
    ? total + surface.scenes.reduce((count, scene) => count + scene.layerItems.length, 0) : total, 0)
}
/** Deterministic durable-history workload. No Provider/model calls; root runs after the integrated build. */
test('M14 keeps 10000 facts accessible while switching 10 documents, two courses and four attachment snapshots', async ({}, info) => {
  test.setTimeout(300000)
  const output = join(root, 'output/g20/b01/long-workspace'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'), profile = join(directory, 'profile')
  mkdirSync(workspace)
  const names = Array.from({ length: 8 }, (_, i) => `压力教案${i + 1}.md`).concat(['压力课件1.h5lesson', '压力课件2.h5lesson'])
  const originalSources = names.slice(0, 8).map((_, i) => `# 中文教案 ${i + 1}\n\n` + '保留独立正文与附件引用。\n'.repeat(200))
  names.forEach((name, i) => i < 8 ? writeFileSync(join(workspace, name), originalSources[i]!) : copyFileSync(join(root, 'tests/fixtures/course-project-v9/multi-asset.h5lesson'), join(workspace, name)))
  let app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const timings: { round: number; name: string; visibleMs: number }[] = [], editTimings: { name: string; saveMs: number }[] = [], metrics: unknown[] = [], errors: string[] = []
  const expectedSources = names.slice(0, 8).map((name, i) => `${originalSources[i]}\n连续编辑 ${name}：第一轮。`)
  const expectedCourseItems = names.slice(8).map(name => slideItemCount(join(workspace, name)) + 1)
  try {
    let page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const prepared = await page.evaluate(async ({ workspace, names }) => {
      const api = window.desktopAPI!, execution = api.execution!, documents = api.documents!
      const space = await execution.workspace(workspace), conversation = space.conversations[0] ?? await execution.createConversation(space.workspace.workspaceId)
      const attachments = []
      for (let i = 0; i < 4; i++) { const snapshot = await api.attachments!.receive({ name: `资料${i + 1}.txt`, bytes: new TextEncoder().encode(`资料${i + 1}：原始快照不可变。`.repeat(1000)), source: 'file', mediaType: 'text/plain' }); const rep = snapshot.representations.find(value => value.kind === 'text')!; attachments.push({ attachmentId: snapshot.id, representationId: rep.id }) }
      const drafts = []
      for (const name of names) { const snapshot = await documents.open(`${workspace}/${name}`); drafts.push({ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, writable: [{ kind: 'document' as const }] }) }
      await execution.draft({ workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: conversation.revision, text: '十文档切换压力草稿，保留中文输入。', documents: drafts, attachments })
      return { conversationId: conversation.conversationId, workspaceId: space.workspace.workspaceId, drafts, attachments }
    }, { workspace, names })
    // Seed actual durable fact records, not a replacement execution/UI implementation.
    const store = new ExecutionEventStore({ directory: join(profile, 'workbench-v2/events') })
    for (let start = 0; start < 10000; start += 500) await store.batchAppend(Array.from({ length: 500 }, (_, offset) => { const i = start + offset; return { eventId: `stress-${i}`, conversationId: prepared.conversationId, taskId: 'stress-readonly', runId: 'stress-run', itemId: `item-${i}`, time: i, source: 'builtin' as const, type: i === 9999 ? 'run.end' as const : 'text' as const, update: 'snapshot' as const, data: { status: 'completed', text: i === 14 ? '早期唯一可找回记录' : `历史中文事件 ${i}` } } }))
    await page.reload()
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue('十文档切换压力草稿，保留中文输入。')
    await expect(page.locator('[data-execution-item]')).toHaveCount(100)
    const tree = page.locator('.lesson-directory-tree')
    for (let round = 0; round < 3; round++) {
      for (const [index, name] of names.entries()) {
        const begin = performance.now(); await tree.getByRole('button', { name, exact: true }).dblclick()
        if (name.endsWith('.md')) await expect(page.getByRole('region', { name: `教学文档 ${name}`, exact: true })).toBeVisible()
        else { await expect(page.getByTestId('canvas-stage')).toBeVisible(); await expect(page.locator('.canvas-viewport[data-observation-source="authoring"]')).toHaveAttribute('data-observation-ready', 'true') }
        timings.push({ round, name, visibleMs: performance.now() - begin })
        if (round === 0) {
          const saveBegin = performance.now()
          if (index < 8) {
            const editor = page.getByRole('region', { name: `教学文档 ${name}`, exact: true })
            await editor.getByRole('button', { name: '源文', exact: true }).click()
            await editor.getByLabel('正文源文编辑').fill(expectedSources[index]!)
            await editor.getByRole('button', { name: '保存', exact: true }).click()
            await expect.poll(() => readFileSync(join(workspace, name), 'utf8')).toBe(expectedSources[index])
          } else {
            await page.getByRole('button', { name: '添加文字', exact: true }).click()
            await page.getByRole('button', { name: '保存', exact: true }).click()
            await expect.poll(() => slideItemCount(join(workspace, name))).toBe(expectedCourseItems[index - 8])
          }
          editTimings.push({ name, saveMs: performance.now() - saveBegin })
        }
        expect(await page.getByTestId('canvas-stage').count()).toBeLessThanOrEqual(1)
        await expect(page.getByLabel('给创作助手发消息')).toHaveValue('十文档切换压力草稿，保留中文输入。')
      }
      metrics.push(await app.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ type: metric.type, memory: metric.memory, cpu: metric.cpu }))))
    }
    await page.locator('.execution-assistant__more > summary').click()
    await page.locator('.execution-assistant__more-menu').getByRole('button', { name: '搜索历史' }).click()
    await page.getByLabel('历史关键词').fill('早期唯一可找回记录')
    await page.getByRole('button', { name: '搜索全部历史', exact: true }).click()
    await expect(page.getByText(/历史事件 15/)).toBeVisible()
    expect(await page.locator('[data-execution-item]').count()).toBe(100)
    const retained = await page.evaluate(async input => { const api = window.desktopAPI!, conversation = await api.execution!.conversation(input.workspaceId, input.conversationId); return { attachments: conversation?.inputAttachments, documents: await Promise.all(input.drafts.map(ref => api.documents!.read(ref.documentId))), facts: (await api.execution!.timeline(input.conversationId)).cursor } }, prepared)
    expect(retained.attachments).toEqual(prepared.attachments); expect(retained.documents).toHaveLength(10); expect(retained.facts).toBe(10000)
    expect(retained.documents.every(document => !document.dirty)).toBe(true)
    for (let i = 0; i < 8; i++) expect(retained.documents[i]!.model).toMatchObject({ kind: 'markdown', source: expectedSources[i] })
    for (let i = 0; i < 2; i++) { expect(retained.documents[i + 8]!.model.kind).toBe('course-v9'); expect(slideItemCount(join(workspace, names[i + 8]!))).toBe(expectedCourseItems[i]) }

    // A real app close/relaunch exercises Main's durable documents and event index,
    // beyond the renderer reload above. The profile belongs only to this test.
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) })
    await app.close()
    const reopenBegin = performance.now()
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const reopenedTree = page.locator('.lesson-directory-tree')
    await reopenedTree.getByRole('button', { name: names[0]!, exact: true }).dblclick()
    const reopenedEditor = page.getByRole('region', { name: `教学文档 ${names[0]}`, exact: true })
    await expect(reopenedEditor).toBeVisible()
    await reopenedEditor.getByRole('button', { name: '源文', exact: true }).click()
    const reopenedSource = reopenedEditor.getByLabel('正文源文编辑')
    const reopenedDocument = await page.evaluate(async file => window.desktopAPI!.documents!.open(file), join(workspace, names[0]!))
    expect(reopenedDocument.model).toMatchObject({ kind: 'markdown', source: expectedSources[0] })
    const continuedSource = `${expectedSources[0]}\n关闭重开后继续编辑。`
    await reopenedSource.fill(continuedSource)
    await reopenedEditor.getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => readFileSync(join(workspace, names[0]!), 'utf8')).toBe(continuedSource)
    await reopenedTree.getByRole('button', { name: names[8]!, exact: true }).dblclick()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    await expect(page.getByRole('button', { name: '添加文字', exact: true })).toBeVisible()
    expect(slideItemCount(join(workspace, names[8]!))).toBe(expectedCourseItems[0])
    await page.locator('.execution-assistant__more > summary').click()
    await page.locator('.execution-assistant__more-menu').getByRole('button', { name: '搜索历史' }).click()
    await page.getByLabel('历史关键词').fill('早期唯一可找回记录')
    await page.getByRole('button', { name: '搜索全部历史', exact: true }).click()
    await expect(page.getByText(/历史事件 15/)).toBeVisible()
    const reopened = await page.evaluate(async input => { const api = window.desktopAPI!, conversation = await api.execution!.conversation(input.workspaceId, input.conversationId); return { attachments: conversation?.inputAttachments, facts: (await api.execution!.timeline(input.conversationId)).cursor } }, prepared)
    expect(reopened).toMatchObject({ attachments: prepared.attachments, facts: 10000 })
    metrics.push(await app.evaluate(({ app }) => app.getAppMetrics().map(metric => ({ type: metric.type, memory: metric.memory, cpu: metric.cpu }))))
    expect(errors).toEqual([])
    const evidence = join(directory, 'evidence.json'); writeFileSync(evidence, JSON.stringify({ machine: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, memory: os.totalmem() }, workload: { events: 10000, documents: 10, courses: 2, attachments: 4, savedEdits: 10 }, timings, editTimings, reopenMs: performance.now() - reopenBegin, metrics, retainedFacts: retained.facts, reopenedFacts: reopened.facts, continuedSource, errors, providerRequests: 0 }, null, 2))
    await page.screenshot({ path: join(directory, 'history-and-documents.png'), fullPage: true }); await info.attach('long-workspace', { path: evidence, contentType: 'application/json' })
  } catch (error) { await app.windows()[0]?.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined); throw error }
  finally { await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined); await app.close().catch(() => undefined) }
})
