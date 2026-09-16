import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'vite'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '..', '..')
test('copies image and cw object through real Flow and Markdown UI, reopens and undoes the return paste once', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const runRoot = mkdtempSync(join(tmpdir(), 'courseware-r19-coauthor-'))
  const server = await createServer({ configFile: join(root, 'vite.renderer.config.ts'), server: { host: '127.0.0.1', port: 0, hmr: false, watch: { ignored: ['**/output/**', '**/test-results/**'] } } })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing renderer address')
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(runRoot, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${address.port}/`, [BACKGROUND_E2E_ENV]: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } })
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => console.error('renderer:', error.message))
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().waitFor()
    // Fixture creation uses the actual factory/archive and lesson service. Every
    // copy/paste/edit/save/close/reopen/undo below goes through the mounted UI.
    const fixture = await page.evaluate(async directory => {
      const load = (path: string): Promise<any> => import(path)
      const { createBlankFlowCourseProject } = await load('/src/renderer/project/createFlowCourseProject.ts')
      const { createImageAssetImport } = await load('/src/renderer/project/assetManager.ts')
      const { createCourseProjectArchive } = await load('/src/renderer/project/courseProjectArchive.ts')
      const made = await window.desktopAPI!.lesson!({ operation: 'create-lesson', directory, name: '跨正文复制课例' })
      if (!made.lesson || !made.conversation) throw new Error('Fixture lesson creation failed')
      const project = createBlankFlowCourseProject({ id: 'r19-cross-owner', title: '跨正文复制', includeDefaultController: false, controls: 'none' })
      const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 32
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#2468db'; ctx.fillRect(0, 0, 48, 32); ctx.fillStyle = '#ffdd33'; ctx.fillRect(8, 6, 24, 18)
      const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => { if (blob) resolve(blob) }, 'image/png'))
      const bytes = new Uint8Array(await png.arrayBuffer())
      const asset = createImageAssetImport({ name: '真实图片.png', mimeType: 'image/png', bytes }, { id: 'copy-image', dimensions: { width: 48, height: 32 } })
      project.assets[asset.meta.id] = asset.meta
      const surface = project.surfaces[0], first = surface.blocks[0]
      surface.blocks = [{ ...first, content: { inlines: [{ type: 'text', text: '跨归属复制起点' }] } },
        { id: 'source-image', type: 'media', assetId: asset.meta.id, mediaKind: 'image', altText: '蓝底黄方块', layout: 'content-width' },
        { id: 'source-callout', type: 'callout', tone: 'example', title: { inlines: [{ type: 'text', text: '复制对象标题' }] }, body: { inlines: [{ type: 'text', text: '对象正文保持可编辑' }] } },
        { id: 'source-end', type: 'paragraph', content: { inlines: [{ type: 'text', text: '复制终点' }] } }]
      return { lesson: made.lesson, conversation: made.conversation, projectId: project.id, archive: Array.from(createCourseProjectArchive({ project, assetFiles: { [asset.meta.id]: asset.bytes }, componentFiles: {} })) as number[] }
    }, runRoot)
    const directory = fixture.lesson.identity.normalizedDirectory
    await testInfo.attach('retained-lesson-directory', { body: directory, contentType: 'text/plain' })
    const projectPath = join(directory, 'course.h5lesson'), markdownPath = join(directory, 'copy.md')
    writeFileSync(projectPath, Uint8Array.from(fixture.archive)); writeFileSync(markdownPath, '', 'utf8')
    await page.evaluate(async ({ fixture, projectPath }) => { await window.desktopAPI!.lesson!({ operation: 'bind-project', lesson: fixture.lesson.identity, conversationId: fixture.conversation.conversationId, projectId: fixture.projectId, projectPath, saveAs: false }) }, { fixture, projectPath })
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [directory] })) as typeof dialog.showOpenDialog }, runRoot)
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().click()
    await page.locator('.lesson-workspace-lessons button').filter({ hasText: '跨正文复制课例' }).click()
    const flow = page.getByTestId('flow-paper').getByRole('textbox', { name: '正文排版编辑' })
    await expect(flow).toContainText('跨归属复制起点')
    await expect.poll(() => flow.locator('img').first().evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(48)
    const readFlow = () => page.evaluate(async () => {
      const load = (path: string): Promise<any> => import(path)
      const { useEditorStore, selectActiveCourseProjectDocument } = await load('/src/renderer/store/editorStore.ts')
      const project = selectActiveCourseProjectDocument(useEditorStore.getState())
      return { blocks: project.surfaces[0].blocks, assets: Object.keys(project.assets).sort() }
    })
    const original = await readFlow()
    await flow.click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c')
    await page.locator('.lesson-directory-tree button').filter({ hasText: '跨正文复制课例' }).click()
    await page.locator('.lesson-directory-tree button').filter({ hasText: 'copy.md' }).click()
    const file = page.getByRole('region', { name: '教学文档 copy.md' })
    const fileBody = file.getByRole('textbox', { name: '正文排版编辑' })
    await fileBody.click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v')
    await expect(fileBody).toContainText('对象正文保持可编辑')
    await expect.poll(() => fileBody.locator('img').first().evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(48)
    await file.getByRole('button', { name: '保存', exact: true }).click()
    await expect(file.getByRole('status').first()).toHaveText('已保存')
    const saved = readFileSync(markdownPath, 'utf8')
    expect(saved).toContain('cw-object-v1'); expect(saved).toContain('复制对象标题')
    const persisted = await page.evaluate(async source => {
      const load = (path: string): Promise<any> => import(path)
      const { parseDocumentMarkdown } = await load('/src/shared/document/markdown.ts')
      const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => crypto.randomUUID() })
      if (parsed.status !== 'valid') throw new Error(JSON.stringify(parsed.diagnostics))
      return parsed.document
    }, saved)
    expect(persisted.content.blocks.some((block: any) => block.type === 'media')).toBe(true)
    expect(persisted.content.blocks.some((block: any) => block.type === 'callout')).toBe(true)
    for (const asset of persisted.resources.assets) { expect(asset.source.kind).toBe('relative'); expect(existsSync(join(directory, asset.source.path))).toBe(true) }
    await page.screenshot({ path: testInfo.outputPath('markdown-saved-image-object.png'), fullPage: true })
    await page.getByRole('button', { name: '关闭 copy.md', exact: true }).click()
    await expect(file).toHaveCount(0)
    await page.locator('.lesson-directory-tree button').filter({ hasText: 'copy.md' }).click()
    await expect(fileBody).toContainText('对象正文保持可编辑')
    await expect.poll(() => fileBody.locator('img').first().evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(48)
    await fileBody.click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c')
    await page.getByRole('tab', { name: /^课件/ }).click()
    await flow.getByText('复制终点', { exact: true }).click(); await page.keyboard.press('End')
    await expect.poll(() => page.evaluate(async () => { const load = (path: string): Promise<any> => import(path); const { useEditorStore } = await load('/src/renderer/store/editorStore.ts'); return useEditorStore.getState().flowSession?.selection.textRange })).toMatchObject({ blockId: 'source-end', start: 4, end: 4 })
    await page.keyboard.press('Control+v')
    await expect.poll(async () => (await readFlow()).blocks.filter((block: any) => block.type === 'media').length).toBe(2)
    const pasted = await readFlow()
    expect(pasted.blocks.filter((block: any) => block.type === 'callout')).toHaveLength(2)
    expect(new Set(pasted.blocks.map((block: any) => block.id)).size).toBe(pasted.blocks.length)
    await page.screenshot({ path: testInfo.outputPath('cross-owner-pasted.png'), fullPage: true })
    await page.keyboard.press('Control+z')
    await expect.poll(readFlow).toEqual(original)
    await testInfo.attach('saved-markdown', { body: saved, contentType: 'text/markdown' })
  } catch (error) {
    const page = app.windows()[0]
    if (page) {
      await page.screenshot({ path: testInfo.outputPath('failure-ui.png'), fullPage: true }).catch(() => {})
      const text = await page.locator('body').innerText().catch(() => '')
      await testInfo.attach('failure-ui-text', { body: text, contentType: 'text/plain' })
      console.error(text.slice(-7000))
    }
    throw error
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
    await server.close()
  }
})
