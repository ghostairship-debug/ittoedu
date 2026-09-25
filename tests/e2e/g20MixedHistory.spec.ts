import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'

const root = resolve(__dirname, '../..')
const chunk = (id: string, delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id, model: 'fixture-mixed-history',
  choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const toolMessages = (payload: any) => payload.messages.filter((message: any) => message.role === 'tool').map((message: any) => JSON.parse(message.content))
const wire = (payload: any, toolName: string) => {
  const name = modelToolWireName(toolName)
  const found = payload.tools.find((tool: any) => tool.function.name === name)
  if (!found) throw new Error(`missing tool: ${toolName}`)
  return found.function.name as string
}
function tools(response: ServerResponse, id: string, calls: Array<{ id: string; name: string; input: unknown }>) {
  response.write(chunk(id, { role: 'assistant', tool_calls: calls.map((call, index) => ({ index, id: call.id, type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.input) } })) }, 'tool_calls'))
  response.end('data: [DONE]\n\n')
}
function final(response: ServerResponse, id: string, text: string) {
  response.write(chunk(id, { role: 'assistant', content: text }, 'stop'))
  response.end('data: [DONE]\n\n')
}

test('S02-T03/S03-T03 real Engine reads two dirty documents and preserves AI-human-AI History plus course resources', async ({}, info) => {
  test.setTimeout(180_000)
  const output = join(root, 'output/g20/b01/mixed-history'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const markdownPath = join(workspace, '双目标教案.md'), coursePath = join(workspace, '双目标课件.h5lesson')
  writeFileSync(markdownPath, '# 磁盘初稿\n'); copyFileSync(join(root, 'tests/fixtures/course-project-v9/multi-asset.h5lesson'), coursePath)

  const requests: any[] = [], serverErrors: string[] = []
  const state = [{ md: '', location: '', object: '' }, { md: '', location: '', object: '' }]
  const expectedRead = [
    { markdown: '# 未保存准备稿\n\n需要 AI A 同时读取。\n', course: '未保存准备页' },
    { markdown: '# 人工 B\n\nAI A 后的人工改稿。\n', course: '人工 B 课件标题' },
  ]
  const replacement = [
    { markdown: '# AI A\n\n两份未保存文档已共同读取。\n', course: 'AI A 课件标题', final: 'AI A 已应用到两份文档。' },
    { markdown: '# AI C\n\n已读取人工 B 后继续完成。\n', course: 'AI C 课件标题', final: 'AI C 已在人工 B 之后应用。' },
  ]
  let requestNumber = 0
  const server = createServer(async (request, response) => {
    try {
      let body = ''; for await (const part of request) body += part.toString()
      const payload = JSON.parse(body); requests.push(payload); requestNumber += 1
      expect(request.method).toBe('POST'); expect(request.url).toBe('/v1/chat/completions'); expect(payload.model).toBe('fixture-mixed-history')
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const run = requestNumber <= 5 ? 0 : 1, phase = (requestNumber - 1) % 5 + 1, id = `mixed-${run}-${phase}`
      if (phase === 1) {
        const fixed = payload.messages.find((message: any) => typeof message.content === 'string' && message.content.startsWith('本次固定文档与权限'))
        const references = JSON.parse(fixed.content.slice(fixed.content.indexOf('：') + 1)) as Array<{ name: string; target: string }>
        const markdown = references.find(reference => reference.name.endsWith('.md'))!, course = references.find(reference => reference.name.endsWith('.h5lesson'))!
        expect(markdown).toBeTruthy(); expect(course).toBeTruthy()
        tools(response, id, [
          { id: `${id}-md-children`, name: wire(payload, 'listChildren'), input: { target: markdown.target } },
          { id: `${id}-course-children`, name: wire(payload, 'listChildren'), input: { target: course.target } },
        ])
      } else if (phase === 2) {
        const results = toolMessages(payload).slice(-2)
        state[run]!.md = results[0].data[0].target; state[run]!.location = results[1].data[0].target
        tools(response, id, [
          { id: `${id}-read-md`, name: wire(payload, 'read'), input: { target: state[run]!.md } },
          { id: `${id}-list-course`, name: wire(payload, 'listChildren'), input: { target: state[run]!.location } },
        ])
      } else if (phase === 3) {
        const results = toolMessages(payload).slice(-2)
        expect(results[0].data.text).toBe(expectedRead[run]!.markdown)
        state[run]!.object = results[1].data.find((item: any) => item.label === 'slide-title').target
        tools(response, id, [{ id: `${id}-read-course`, name: wire(payload, 'read'), input: { target: state[run]!.object, limit: 100 } }])
      } else if (phase === 4) {
        const course = toolMessages(payload).at(-1)
        expect(course.data.truncated).toBe(false)
        expect(JSON.parse(course.data.text).item.content).toMatchObject({ nativeType: 'text', data: { text: expectedRead[run]!.course } })
        tools(response, id, [
          { id: `${id}-write-md`, name: wire(payload, 'text.replace'), input: { target: state[run]!.md, content: replacement[run]!.markdown } },
          { id: `${id}-write-course`, name: wire(payload, 'text.replace'), input: { target: state[run]!.object, content: replacement[run]!.course } },
        ])
      } else {
        const results = toolMessages(payload).slice(-2)
        expect(results).toHaveLength(2)
        expect(results.every((result: any) => result.kind === 'document-operation' && result.result?.status === 'applied')).toBe(true)
        final(response, id, replacement[run]!.final)
      }
    } catch (error) {
      serverErrors.push(error instanceof Error ? error.stack ?? error.message : String(error))
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' })
      response.end('fixture provider assertion failed')
    }
  })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15_000)
    const rendererErrors: string[] = []; page.on('pageerror', error => rendererErrors.push(error.message))
    await page.evaluate(async endpoint => {
      const settings = window.desktopAPI!.executionSettings!
      const connection = await settings.saveConnection({ apiKey: 'fixture-key-not-a-real-account', connection: {
        provider: 'fixture-controlled-http', protocol: 'openai-chat', baseURL: endpoint, accountId: 'local-fixture', authKind: 'api-key', billing: { kind: 'unknown' },
      } })
      await settings.saveProfile({ expectedRevision: 0, roles: {
        conversation: { connectionId: connection.connection.id, model: 'fixture-mixed-history' }, vision: null, imageGenerate: null, imageEdit: null,
      } })
    }, endpoint)
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.locator('.lesson-directory-tree')
    await expect(tree.getByRole('button', { name: '双目标教案.md', exact: true })).toBeVisible()

    const prepared = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!, execution = window.desktopAPI!.execution!
      const markdown = await documents.open(input.markdownPath), course = await documents.open(input.coursePath)
      const mdReceipt = await documents.dispatch({ documentId: markdown.documentId, epoch: markdown.epoch, baseRevision: markdown.revision,
        actor: 'human', operationId: 'prepare-dirty-markdown', mutation: { type: 'command', command: { type: 'markdown.replace', source: '# 未保存准备稿\n\n需要 AI A 同时读取。\n' } } })
      const courseReceipt = await documents.dispatch({ documentId: course.documentId, epoch: course.epoch, baseRevision: course.revision,
        actor: 'human', operationId: 'prepare-dirty-course', mutation: { type: 'command', command: { type: 'course.object.patch', locationId: 'location-scene-1', itemId: 'slide-title', patch: { nativeData: { text: '未保存准备页' } } } } })
      if (mdReceipt.status !== 'applied' || courseReceipt.status !== 'applied') throw new Error('dirty preparation failed')
      const [md, cw] = await Promise.all([documents.read(markdown.documentId), documents.read(course.documentId)])
      const space = await execution.workspace(input.workspace), conversation = space.conversations[0] ?? await execution.createConversation(space.workspace.workspaceId)
      const saved = await execution.draft({ workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: conversation.revision,
        text: 'AI A：先读取两份未保存文档，再分别修改正文和课件标题。', documents: [md, cw].map(snapshot => ({ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision, writable: [{ kind: 'document' as const }] })), attachments: [] })
      return { workspaceId: space.workspace.workspaceId, conversationId: saved.conversationId, markdownId: md.documentId, courseId: cw.documentId,
        dirty: { markdown: md.dirty, course: cw.dirty } }
    }, { workspace, markdownPath, coursePath })
    expect(prepared.dirty).toEqual({ markdown: true, course: true })
    await page.reload()
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue('AI A：先读取两份未保存文档，再分别修改正文和课件标题。')
    await expect(page.getByLabel('本条消息的引用', { exact: true })).toContainText('双目标教案.md')
    await expect(page.getByLabel('本条消息的引用', { exact: true })).toContainText('双目标课件.h5lesson')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('AI A 已应用到两份文档。', { exact: true })).toBeVisible()
    await expect.poll(() => requests.length).toBe(5); expect(serverErrors).toEqual([])
    await expect.poll(() => page.evaluate(async input => {
      const conversation = await window.desktopAPI!.execution!.conversation(input.workspaceId, input.conversationId)
      return conversation?.messages.some(message => message.role === 'assistant' && message.text === 'AI A 已应用到两份文档。') ?? false
    }, prepared)).toBe(true)

    const humanB = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!
      const markdown = await documents.read(input.markdownId), course = await documents.read(input.courseId)
      const md = await documents.dispatch({ documentId: markdown.documentId, epoch: markdown.epoch, baseRevision: markdown.revision,
        actor: 'human', operationId: 'human-b-markdown', mutation: { type: 'command', command: { type: 'markdown.replace', source: '# 人工 B\n\nAI A 后的人工改稿。\n' } } })
      const cw = await documents.dispatch({ documentId: course.documentId, epoch: course.epoch, baseRevision: course.revision,
        actor: 'human', operationId: 'human-b-course', mutation: { type: 'command', command: { type: 'course.object.patch', locationId: 'location-scene-1', itemId: 'slide-title', patch: { nativeData: { text: '人工 B 课件标题' } } } } })
      return { md, cw }
    }, prepared)
    expect(humanB).toMatchObject({ md: { status: 'applied' }, cw: { status: 'applied' } })

    await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!, execution = window.desktopAPI!.execution!
      const [md, cw, conversation] = await Promise.all([documents.read(input.markdownId), documents.read(input.courseId), execution.conversation(input.workspaceId, input.conversationId)])
      if (!conversation) throw new Error('conversation missing')
      await execution.draft({ workspaceId: input.workspaceId, conversationId: input.conversationId, expectedRevision: conversation.revision,
        text: 'AI C：读取人工 B 的结果后继续修改两份文档。', documents: [md, cw].map(snapshot => ({ documentId: snapshot.documentId, epoch: snapshot.epoch,
          revision: snapshot.revision, writable: [{ kind: 'document' as const }] })), attachments: [] })
    }, prepared)
    await page.reload()
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue('AI C：读取人工 B 的结果后继续修改两份文档。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('AI C 已在人工 B 之后应用。', { exact: true })).toBeVisible()
    await expect.poll(() => requests.length).toBe(10); expect(serverErrors).toEqual([]); expect(rendererErrors).toEqual([])
    await expect.poll(() => page.evaluate(async input => {
      const conversation = await window.desktopAPI!.execution!.conversation(input.workspaceId, input.conversationId)
      return conversation?.messages.some(message => message.role === 'assistant' && message.text === 'AI C 已在人工 B 之后应用。') ?? false
    }, prepared)).toBe(true)

    // Human B and the per-item undo/redo below use the formal DocumentHost IPC.
    // AI A/C are the two real ExecutionEngine HTTP/tool loops above.
    const history = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!
      const text = (snapshot: any) => snapshot.model.kind === 'markdown' ? snapshot.model.source
        : snapshot.model.project.surfaces[0].scenes[0].layerItems.find((item: any) => item.layerItemId === 'slide-title').content.data.text
      const walk = async (documentId: string) => {
        const undo: string[] = [], redo: string[] = []
        for (let index = 0; index < 3; index += 1) {
          const snapshot = await documents.read(documentId)
          await documents.dispatch({ documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, actor: 'human', operationId: `history-undo-${documentId}-${index}`, mutation: { type: 'undo' } })
          undo.push(text(await documents.read(documentId)))
        }
        for (let index = 0; index < 3; index += 1) {
          const snapshot = await documents.read(documentId)
          await documents.dispatch({ documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, actor: 'human', operationId: `history-redo-${documentId}-${index}`, mutation: { type: 'redo' } })
          redo.push(text(await documents.read(documentId)))
        }
        return { undo, redo }
      }
      return { markdown: await walk(input.markdownId), course: await walk(input.courseId) }
    }, prepared)
    expect(history.markdown.undo).toEqual(['# 人工 B\n\nAI A 后的人工改稿。\n', '# AI A\n\n两份未保存文档已共同读取。\n', '# 未保存准备稿\n\n需要 AI A 同时读取。\n'])
    expect(history.markdown.redo).toEqual(['# AI A\n\n两份未保存文档已共同读取。\n', '# 人工 B\n\nAI A 后的人工改稿。\n', '# AI C\n\n已读取人工 B 后继续完成。\n'])
    expect(history.course.undo).toEqual(['人工 B 课件标题', 'AI A 课件标题', '未保存准备页'])
    expect(history.course.redo).toEqual(['AI A 课件标题', '人工 B 课件标题', 'AI C 课件标题'])

    const reopened = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!
      await documents.save(input.markdownId); await documents.save(input.courseId)
      await documents.close(input.markdownId); await documents.close(input.courseId)
      return { markdown: await documents.open(input.markdownPath), course: await documents.open(input.coursePath) }
    }, { ...prepared, markdownPath, coursePath })
    expect(reopened.markdown).toMatchObject({ dirty: false, model: { kind: 'markdown', source: '# AI C\n\n已读取人工 B 后继续完成。\n' } })
    expect(reopened.course).toMatchObject({ dirty: false, model: { kind: 'course-v9', project: { assets: {
      photo: expect.any(Object), diagram: expect.any(Object), voice: expect.any(Object), clip: expect.any(Object),
    } } } })
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    expect(Object.keys(archive.assetFiles).sort()).toEqual(['clip', 'diagram', 'photo', 'voice'])
    for (const bytes of Object.values(archive.assetFiles)) expect(bytes.byteLength).toBeGreaterThan(0)
    const surface = archive.project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('reopened fixture is not slide')
    expect(surface.scenes[0]!.backgroundAssetId).toBe('diagram')
    expect(surface.scenes[0]!.layerItems.find(item => item.layerItemId === 'slide-title')).toMatchObject({ content: { data: { text: 'AI C 课件标题' } } })
    expect(surface.scenes[0]!.layerItems.find(item => item.layerItemId === 'slide-photo')).toMatchObject({ content: { data: { assetId: 'photo' } } })

    await tree.getByRole('button', { name: '双目标教案.md', exact: true }).dblclick()
    const editor = page.getByRole('region', { name: '教学文档 双目标教案.md', exact: true })
    await expect(editor).toBeVisible()
    await editor.getByRole('button', { name: '源文', exact: true }).click()
    await expect(editor.getByLabel('正文源文编辑')).toContainText('AI C')
    await tree.getByRole('button', { name: '双目标课件.h5lesson', exact: true }).dblclick()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    await expect(page.locator('.canvas-viewport[data-observation-source="authoring"]')).toHaveAttribute('data-observation-ready', 'true')
    await expect(page.getByText('正在准备编辑画布', { exact: true })).toHaveCount(0)
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) })
    await page.screenshot({ path: join(directory, 'reopened-ai-human-ai.png'), fullPage: true })
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ provider: 'fixture-controlled-http', model: 'fixture-mixed-history',
      requests: requests.length, history, resources: Object.fromEntries(Object.entries(archive.assetFiles).map(([id, bytes]) => [id, bytes.byteLength])), rendererErrors, serverErrors }, null, 2))
    await info.attach('mixed-history-evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    await info.attach('reopened-ui', { path: join(directory, 'reopened-ai-human-ai.png'), contentType: 'image/png' })
  } catch (error) {
    const page = app.windows()[0]
    if (page) await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
    writeFileSync(join(directory, 'failure.json'), JSON.stringify({ requests: requests.length, serverErrors }, null, 2))
    throw error
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
    server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  }
})
