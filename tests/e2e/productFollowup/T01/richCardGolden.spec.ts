import { expect, test, type ElectronApplication } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CourseV10Driver } from '../../../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createFormulaComponentData, createTextComponentData, type TextComponentData } from '../../../../src/components/text/data'
import { modelToolWireName } from '../../../../src/main/workbench/providers/OpenAIChatProvider'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, readSelectionDocument, setupSelectionUI } from '../../helpers/g20SelectionHarness'
import { chooseM23Workspace } from '../../helpers/g20M23Harness'

test('actual rich card rewrites from material, preserves links formulas and neighboring layout, then undoes redoes saves and cold reopens', async ({}, info) => {
  const root = resolve(__dirname, '../../../..'), output = join(root, 'output/content-revision/t01-golden')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const filename = '富段落黄金链.h5lesson', project = createBlankCourseProjectV10('富段落黄金链')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  const original = createTextComponentData({ inlines: [
    { type: 'text', text: '正方形面积', style: { bold: true }, link: { href: 'https://example.org/source' } },
    { type: 'text', text: '：原说明 ' }, createFormulaComponentData('kept-formula', 'x^2').formula, { type: 'text', text: '。' },
  ] })
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: original }
  project.instances.tail = { id: 'tail', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('未选正文保留') }
  project.instances.overlay = { id: 'overlay', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('人工定位保留'),
    frame: { width: 180, height: 60, transform: [1, 0, 0, 1, 470, 220] }, style: { opacity: .65 }, flowPlacement: { space: 'paper', plane: 'overlay' } }
  project.surfaces = [{ id: 'flow', title: '讲义', kind: 'flow', childIds: ['body', 'tail', 'overlay'] }]
  writeFileSync(join(workspace, filename), new CourseV10Driver().serialize({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }))
  writeFileSync(join(workspace, '资料.md'), '教师材料：正方形面积是边长的平方。\n')
  const requests: any[] = [], serverErrors: string[] = [], pageErrors: string[] = []
  const sse = (delta: unknown, finish: string) => `data: ${JSON.stringify({ id: 'rich-golden', model: 'fixture-selection', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error('Unexpected local fixture route')
    let bytes = ''; for await (const chunk of request) bytes += chunk.toString()
    const input = JSON.parse(bytes); requests.push(input)
    expect(JSON.stringify(input.messages)).toContain('https://example.org/source')
    const tools = requests.length === 1 ? [{ name: 'file.read', args: { path: '资料.md' } }] : requests.length === 2 ? [
      { name: 'text.replace', args: { content: '<a href="https://example.org/source"><strong>正方形面积是边长的平方</strong></a>\\(x^2\\)。' } },
      { name: 'task.finish', args: {} },
    ] : (() => { throw new Error('Unexpected additional provider request after explicit completion') })()
    if (requests.length === 2) {
      const returned = input.messages.filter((message: any) => message.role === 'tool').at(-1)
      expect(JSON.parse(returned.content)).toMatchObject({ kind: 'read' })
      expect(returned.content).toContain('正方形面积是边长的平方')
    }
    for (const tool of tools) expect(input.tools.some((value: any) => value.function.name === modelToolWireName(tool.name)), tool.name).toBe(true)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(sse({ role: 'assistant', content: '根据资料改写；这是对话说明。', tool_calls: tools.map((tool, index) => ({ index, id: `golden-${requests.length}-${index}`, type: 'function',
      function: { name: modelToolWireName(tool.name), arguments: JSON.stringify(tool.args) } })) }, 'tool_calls'))
    response.end('data: [DONE]\n\n')
  })().catch(error => { serverErrors.push(String(error)); response.destroy() }) })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  let app: ElectronApplication | undefined
  const facts: Record<string, unknown> = { scope: 'actual Electron UI, HTTP/SSE provider adapter, Engine and Session; controlled model content; supplier not tested', directory }
  try {
    app = await launchSelectionApp(directory); let page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    await setupSelectionUI(app, page, endpoint, workspace)
    const opened = await openSelectionFile(page, workspace, filename)
    const frame = page.locator('.course-editor-frame:visible')
    const paragraph = frame.locator('.ProseMirror p').filter({ hasText: '原说明' })
    await expect(paragraph).toBeVisible()
    // The browser creates the selection via real mouse/keyboard; no PM/controller/selection IPC injection.
    await paragraph.click({ clickCount: 3 }); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End')
    await frame.getByRole('button', { name: 'AI 修改', exact: true }).click()
    const instruction = page.getByLabel('AI 修改要求', { exact: true }).filter({ visible: true })
    await instruction.fill('按本工作区资料.md改写所选整段，保链接与公式，完成后结束任务。')
    await instruction.locator('xpath=ancestor::form').getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, opened.documentId)).undoDepth).toBe(1)
    const committed = await readSelectionDocument(page, opened.documentId)
    if (committed.model.kind !== 'course-v10') throw new Error('V10 required')
    const inlines = (committed.model.project.instances.body.data as TextComponentData).content.inlines
    expect(inlines.some(value => value.link?.href === 'https://example.org/source')).toBe(true)
    expect(inlines.find(value => value.type === 'math' && value.latex === 'x^2')?.formulaId).toBe('kept-formula')
    expect(inlines.some(value => value.type === 'text' && value.text.includes('对话说明'))).toBe(false)
    expect(committed.model.project.instances.tail).toEqual(project.instances.tail)
    expect(committed.model.project.instances.overlay).toEqual(project.instances.overlay)
    expect(requests).toHaveLength(2)
    await frame.locator('.course-light-tools').getByRole('button', { name: '撤销', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, opened.documentId)).model).toMatchObject({ project: { instances: { body: { data: original } } } })
    await frame.locator('.course-light-tools').getByRole('button', { name: '重做', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, opened.documentId)).model).toMatchObject({ kind: 'course-v10', project: {
      instances: committed.model.project.instances, definitions: committed.model.project.definitions, surfaces: committed.model.project.surfaces,
    }, resources: committed.model.resources })
    const redone = await readSelectionDocument(page, opened.documentId)
    await frame.locator('.course-light-tools').getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(async () => (await readSelectionDocument(page, opened.documentId)).dirty).toBe(false)
    await info.attach('Rich card committed UI', { body: await page.screenshot(), contentType: 'image/png' })
    facts.committed = { revision: committed.revision, undoDepth: committed.undoDepth, instances: committed.model.project.instances }
    await closeSelectionApp(app); app = undefined
    app = await launchSelectionApp(directory); page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    await chooseM23Workspace(app, page, workspace)
    const reopened = await openSelectionFile(page, workspace, filename)
    const cold = await readSelectionDocument(page, reopened.documentId)
    expect(cold.model).toEqual(redone.model)
    expect(cold.epoch).not.toBe(committed.epoch)
    await expect(page.locator('.course-editor-frame:visible .ProseMirror')).toContainText('正方形面积是边长的平方')
    await info.attach('Rich card cold reopened UI', { body: await page.screenshot(), contentType: 'image/png' })
    expect(serverErrors).toEqual([]); expect(pageErrors).toEqual([])
    facts.coldReopened = { documentId: cold.documentId, epoch: cold.epoch, preserved: true }
  } finally {
    facts.requests = requests.map(value => ({ model: value.model, offeredTools: value.tools?.map((tool: any) => tool.function.name) }))
    facts.serverErrors = serverErrors; facts.pageErrors = pageErrors
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(facts, null, 2) + '\n')
    await info.attach('Rich GUI golden chain facts', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    if (app) await closeSelectionApp(app)
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()))
  }
})
