import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, readSelectionDocument, selectVisibleText, setupSelectionUI } from './helpers/g20SelectionHarness'

const root = resolve(__dirname, '../..')
const sourceA = '甲文档前段。\n\n待修改原文\n\n甲文档后段。\n'
const sourceB = '乙文档必须保持原样。\n'
const committed = '已正式完成的修改'
const late = '停止之后迟到的修改'
const event = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'm02-close-fixture', model: 'fixture-selection',
  choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

test('M02-T04 closing a writable document stops its live AI run and preserves only committed dirty work', async () => {
  test.skip(process.platform !== 'win32', 'M02-T04 uses the Windows Electron document-close dialogs.')
  test.setTimeout(150_000)
  const output = join(root, 'output/g20/m02/close-during-run'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const fileA = join(workspace, '任务中关闭甲.md'), fileB = join(workspace, '另一文档乙.md')
  writeFileSync(fileA, sourceA); writeFileSync(fileB, sourceB)
  let releaseLate!: () => void
  const lateGate = new Promise<void>(resolve => { releaseLate = resolve })
  const requests: unknown[] = [], serverErrors: string[] = [], lateAttempts: string[] = []
  let frozenTarget = ''
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected fixture route ${request.method} ${request.url}`)
    let raw = ''; for await (const bytes of request) raw += bytes.toString()
    const data = JSON.parse(raw); requests.push(data)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requests.length === 1) {
      const prefix = '本次固定文档与权限（切换界面不改变它们）：'
      const frozen = data.messages.find((item: any) => typeof item.content === 'string' && item.content.startsWith(prefix))
      if (!frozen) throw new Error('Missing real frozen document authority')
      const refs = JSON.parse(frozen.content.slice(prefix.length))
      if (refs.length !== 1 || refs[0].writable.length !== 1 || refs[0].writable[0].kind !== 'markdown-range') throw new Error('Expected one writable Markdown range')
      frozenTarget = refs[0].writable[0].target
      const wire = modelToolWireName('read')
      if (!data.tools.some((tool: any) => tool.function.name === wire)) throw new Error('Canonical read tool was missing')
      response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id: 'read-target', type: 'function',
        function: { name: wire, arguments: JSON.stringify({ target: frozenTarget, limit: 100 }) } }] }, 'tool_calls'))
    } else if (requests.length === 2) {
      const read = data.messages.find((item: any) => item.role === 'tool' && item.tool_call_id === 'read-target')
      const receipt = read ? JSON.parse(read.content) : null
      if (receipt?.kind !== 'read' || receipt.data?.text !== '待修改原文' || receipt.data?.truncated) throw new Error('Formal source read failed')
      const wire = modelToolWireName('text.replace')
      if (!data.tools.some((tool: any) => tool.function.name === wire)) throw new Error('Canonical text.replace tool was missing')
      response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id: 'committed-edit', type: 'function',
        function: { name: wire, arguments: JSON.stringify({ target: frozenTarget, content: committed }) } }] }, 'tool_calls'))
    } else if (requests.length === 3) {
      const edit = data.messages.find((item: any) => item.role === 'tool' && item.tool_call_id === 'committed-edit')
      const receipt = edit ? JSON.parse(edit.content) : null
      if (receipt?.kind !== 'document-operation' || receipt.result?.status !== 'applied') throw new Error('First edit did not formally commit')
      const wire = modelToolWireName('text.replace')
      response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id: 'late-edit', type: 'function',
        function: { name: wire, arguments: JSON.stringify({ target: frozenTarget, content: late }) } }] }, 'tool_calls'))
      await lateGate
      lateAttempts.push(`after-close: ${response.destroyed ? 'stream-already-closed' : 'stream-open'}`)
      response.write(event({ role: 'assistant', content: '迟到完成事件。' }, 'stop'))
    } else throw new Error('Unexpected extra model turn')
    response.end('data: [DONE]\n\n')
  })().catch(error => { serverErrors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let app: Awaited<ReturnType<typeof launchSelectionApp>> | undefined
  const evidence: Record<string, unknown> = { fileA, fileB, dialogs: [], steps: [] }
  try {
    app = await launchSelectionApp(directory)
    const page = await app.firstWindow(), pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await setupSelectionUI(app, page, `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, workspace)
    const other = await openSelectionFile(page, workspace, '另一文档乙.md')
    const target = await openSelectionFile(page, workspace, '任务中关闭甲.md')
    const beforeA = await readSelectionDocument(page, target.documentId)
    const beforeB = await readSelectionDocument(page, other.documentId)
    await app.evaluate(({ dialog }) => {
      const main = globalThis as typeof globalThis & { m02CloseTrace?: { title: string; buttons: string[]; response: number }[]; m02StopChoices?: number[] }
      main.m02CloseTrace = []; main.m02StopChoices = [1, 0]
      dialog.showMessageBox = (async (...args: any[]) => {
        const options = args.at(-1) as { title: string; buttons: string[] }
        const response = options.title === '关闭正在修改的文档' ? main.m02StopChoices!.shift()!
          : options.title === '保存文档更改' ? 0 : 2
        main.m02CloseTrace!.push({ title: options.title, buttons: options.buttons, response })
        return { response, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    })
    const editor = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
    await selectVisibleText(page, editor, '待修改原文')
    const card = page.getByLabel('当前编辑目标', { exact: true })
    await card.getByLabel('AI 指令', { exact: true }).fill('先修改选中正文，再补充说明')
    await card.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect.poll(() => requests.length).toBe(3)
    await expect.poll(async () => (await readSelectionDocument(page, target.documentId)).model).toMatchObject({ source: sourceA.replace('待修改原文', committed) })
    const applied = await readSelectionDocument(page, target.documentId)
    expect(applied).toMatchObject({ revision: beforeA.revision + 1, undoDepth: beforeA.undoDepth + 1, dirty: true })
    expect(readFileSync(fileA, 'utf8')).toBe(sourceA)
    const tabs = page.locator('.workspace-document-tabs')
    const close = tabs.getByRole('button', { name: '关闭 任务中关闭甲.md', exact: true })
    await close.click()
    await expect.poll(async () => app!.evaluate(() => (globalThis as any).m02CloseTrace.length)).toBe(1)
    expect((await readSelectionDocument(page, target.documentId)).model).toMatchObject({ source: sourceA.replace('待修改原文', committed) })
    await expect(close).toBeVisible()
    const active = await page.evaluate(async () => {
      const documents = await window.desktopAPI.documents!.list()
      return documents.map(item => item.documentId)
    })
    expect(active).toContain(target.documentId)
    ;(evidence.steps as unknown[]).push({ phase: 'continue-editing', revision: applied.revision, documentIds: active })
    await close.click()
    await expect.poll(async () => app!.evaluate(() => (globalThis as any).m02CloseTrace.length)).toBe(3)
    await expect(tabs.getByRole('tab', { name: /^任务中关闭甲\.md/ })).toHaveCount(0)
    expect(readFileSync(fileA, 'utf8')).toBe(sourceA.replace('待修改原文', committed))
    expect(readFileSync(fileB, 'utf8')).toBe(sourceB)
    await expect.poll(async () => (await page.evaluate(() => window.desktopAPI.documents!.list())).some(item => item.documentId === target.documentId)).toBe(false)
    await page.screenshot({ path: join(directory, 'closed-before-late.png') })
    releaseLate()
    await expect.poll(() => lateAttempts.length).toBe(1)
    await expect.poll(async () => (await page.evaluate(() => window.desktopAPI.documents!.list())).map(item => item.documentId)).not.toContain(target.documentId)
    expect(readFileSync(fileA, 'utf8')).toBe(sourceA.replace('待修改原文', committed))
    expect(readFileSync(fileB, 'utf8')).toBe(sourceB)
    const afterB = await readSelectionDocument(page, other.documentId)
    expect(afterB).toMatchObject({ revision: beforeB.revision, undoDepth: beforeB.undoDepth, model: { source: sourceB } })
    const reopened = await openSelectionFile(page, workspace, '任务中关闭甲.md')
    expect(reopened.documentId).not.toBe(target.documentId)
    expect(reopened.model).toMatchObject({ source: sourceA.replace('待修改原文', committed) })
    expect(reopened.model).not.toMatchObject({ source: expect.stringContaining(late) })
    expect(requests).toHaveLength(3)
    expect(serverErrors).toEqual([])
    expect(pageErrors).toEqual([])
    const trace = await app.evaluate(() => (globalThis as any).m02CloseTrace)
    expect(trace).toEqual([
      { title: '关闭正在修改的文档', buttons: ['停止并关闭', '继续编辑'], response: 1 },
      { title: '关闭正在修改的文档', buttons: ['停止并关闭', '继续编辑'], response: 0 },
      { title: '保存文档更改', buttons: ['保存并关闭', '放弃未保存更改', '取消'], response: 0 },
    ])
    evidence.dialogs = trace; evidence.lateAttempts = lateAttempts
    evidence.steps = [...evidence.steps as unknown[], { phase: 'closed-and-reopened', oldId: target.documentId, newId: reopened.documentId,
      savedSource: readFileSync(fileA, 'utf8'), untouchedSource: readFileSync(fileB, 'utf8') }]
    await page.screenshot({ path: join(directory, 'reopened-after-late.png') })
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error)
    if (app) await app.firstWindow().then(page => page.screenshot({ path: join(directory, 'failure.png') })).catch(() => undefined)
    throw error
  } finally {
    releaseLate()
    evidence.requests = requests.length; evidence.serverErrors = serverErrors
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2))
    if (app) await closeSelectionApp(app)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
