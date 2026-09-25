import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { USER_QUESTION_TOOL } from '../../src/shared/workbench/userQuestion'
import { closeSelectionApp, launchSelectionApp, markdownSource, openSelectionFile, readSelectionDocument, selectVisibleText, selectionFixtures, setupSelectionUI } from './helpers/g20SelectionHarness'

// M09-T04 (Owner 2026-09-24): in the real window the AI's question pops up as an option card.
// One click continues the same run; stopping or closing the bound document leaves it unanswered.
const event = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'question-fixture', model: 'fixture-selection', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const prefix = '本次固定文档与权限（切换界面不改变它们）：'
const questions = {
  answer: { question: '乙段改成哪种写法？', options: [{ label: '简洁版' }, { label: '详细版', description: '加一句例子' }] },
  stop: { question: '甲段要不要加提示？', options: [{ label: '加' }, { label: '不加' }] },
  close: { question: '关闭前还要改标题吗？', options: [{ label: '要' }, { label: '不要' }] },
}

test('M09-T04 option-card question: answer continues the run; stop and document close leave it unanswered', async ({}, info) => {
  test.setTimeout(300_000)
  const fixture = selectionFixtures(), filename = join(fixture.workspace, 'selection.md')
  const requests: { messages: { role: string; content: string; tool_call_id?: string }[]; tools: { function: { name: string } }[] }[] = []
  const serverErrors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    let raw = ''; for await (const chunk of request) raw += chunk.toString()
    const data = JSON.parse(raw); requests.push(data)
    if (!data.tools.some((tool: { function: { name: string } }) => tool.function.name === USER_QUESTION_TOOL)) throw new Error('ask_user was not offered to the built-in model')
    const frozen = data.messages.find((message: { content?: unknown }) => typeof message.content === 'string' && message.content.startsWith(prefix))
    const target = frozen ? JSON.parse(frozen.content.slice(prefix.length))[0]?.writable[0]?.target : undefined
    const call = (id: string, name: string, args: unknown) => response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function',
      function: { name: modelToolWireName(name), arguments: JSON.stringify(args) } }] }, 'tool_calls'))
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const reply = (id: string) => { const message = data.messages.find((item: { tool_call_id?: string }) => item.tool_call_id === id); return message ? JSON.parse(message.content) : undefined }
    switch (requests.length) {
      case 1: call('ask-answer', USER_QUESTION_TOOL, questions.answer); break
      case 2: {
        const answer = reply('ask-answer')
        if (answer?.data?.selected?.[0]?.label !== '详细版') throw new Error(`Unexpected answer ${JSON.stringify(answer)}`)
        if (!target) throw new Error('Missing frozen writable selection')
        call('edit-answer', 'text.replace', { target, content: '详细版改写' }); break
      }
      case 3: response.write(event({ role: 'assistant', content: '已按你的选择改写。' }, 'stop')); break
      case 4: call('ask-stop', USER_QUESTION_TOOL, questions.stop); break
      case 5: call('ask-close', USER_QUESTION_TOOL, questions.close); break
      default: throw new Error('Unexpected model turn after an unanswered question')
    }
    response.end('data: [DONE]\n\n')
  })().catch(error => { serverErrors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const app = await launchSelectionApp(fixture.directory), page = await app.firstWindow(), pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const evidence: Record<string, unknown> = { caseId: 'M09-T04', layer: 'real Electron window, real ExecutionEngine/Gateway, local SSE model', steps: [] }
  const step = (value: Record<string, unknown>) => (evidence.steps as unknown[]).push(value)
  const assistant = page.getByRole('region', { name: '创作助手', exact: true })
  const card = page.getByRole('region', { name: 'AI 的提问', exact: true })
  const ask = async (text: string, instruction: string) => {
    await selectVisibleText(page, page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true }), text)
    const target = page.getByLabel('当前编辑目标', { exact: true })
    await target.getByLabel('AI 指令', { exact: true }).fill(instruction)
    await target.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
  }
  const settleRequests = async (count: number) => { await expect.poll(() => requests.length).toBe(count); await page.waitForTimeout(1_500); expect(requests.length).toBe(count) }
  try {
    await setupSelectionUI(app, page, `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, fixture.workspace)
    const opened = await openSelectionFile(page, fixture.workspace, 'selection.md')

    // 1. The card pops up; the run waits without sending anything; one click continues the same run.
    await ask('保持原样', '先问我用哪种写法，再改写')
    await expect(card).toBeVisible()
    await expect(card).toContainText(questions.answer.question)
    const options = card.getByRole('group', { name: '可选答案', exact: true }).getByRole('button')
    await expect(options).toHaveText(['简洁版', '详细版加一句例子'])
    await expect(assistant.getByRole('button', { name: '停止', exact: true })).toBeVisible()
    await expect(page.getByRole('article', { name: 'AI 提问', exact: true }).last()).toContainText('等待你选择')
    await expect(page.locator('.execution-timeline__activity')).toContainText('1 个任务等待你的选择')
    await settleRequests(1)
    await page.screenshot({ path: join(fixture.directory, 'question-card.png') })
    // A narrow window keeps the card and every option on screen and hit-testable.
    const resize = (width: number, height: number) => app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]!; window.setMinimumSize(600, 500); window.setContentSize(size.width, size.height) }, { width, height })
    await resize(900, 640)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(950)
    const panes = page.getByRole('tablist', { name: '工作台区域', exact: true })
    if (await panes.isVisible()) await panes.getByRole('tab', { name: 'AI 助手', exact: true }).click()
    await expect(card).toBeVisible()
    const narrow = await card.evaluate(element => {
      const buttons = [...element.querySelectorAll<HTMLButtonElement>('.execution-question__option')]
      return { scrollWidth: document.documentElement.scrollWidth, innerWidth, buttons: buttons.map(button => {
        button.scrollIntoView({ block: 'nearest' })
        const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return { inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, hits: !!hit && button.contains(hit), height: Math.round(box.height),
          hitBy: hit && !button.contains(hit) ? hit.closest('[aria-label]')?.getAttribute('aria-label') ?? String(hit.className) : null }
      }) }
    })
    await page.screenshot({ path: join(fixture.directory, 'question-card-narrow.png') })
    expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.innerWidth + 2)
    expect(narrow.buttons).toHaveLength(2)
    for (const button of narrow.buttons) expect(button, JSON.stringify(button)).toMatchObject({ inside: true, hits: true })
    step({ phase: 'narrow-window', window: { width: 900, height: 640 }, ...narrow })
    await resize(1600, 1000)
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(1200)
    await options.filter({ hasText: '详细版' }).click()
    await expect(card).toHaveCount(0, { timeout: 30_000 })
    await expect.poll(() => requests.length).toBe(3)
    await expect.poll(async () => (await readSelectionDocument(page, opened.documentId)).model).toMatchObject({ source: markdownSource.replace('保持原样', '详细版改写') })
    const answered = page.getByRole('article', { name: 'AI 提问', exact: true }).last()
    await expect(answered).toContainText('已回答')
    await expect(answered.locator('li[data-chosen="true"]')).toHaveText(/详细版/)
    await expect(page.getByText('已按你的选择改写。', { exact: true })).toBeVisible()
    step({ phase: 'answered', requests: requests.length, chosen: '详细版', source: (await readSelectionDocument(page, opened.documentId)).model })

    // 2. Stop while waiting: the card closes unanswered and nothing more is sent.
    await ask('再观察', '先问我要不要加提示')
    await expect(card).toContainText(questions.stop.question)
    await settleRequests(4)
    await assistant.getByRole('button', { name: '停止', exact: true }).click()
    await expect(card).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByRole('article', { name: 'AI 提问', exact: true }).last()).toContainText('未回答')
    await settleRequests(4)
    expect((await readSelectionDocument(page, opened.documentId)).model).toMatchObject({ source: markdownSource.replace('保持原样', '详细版改写') })
    step({ phase: 'stopped-while-waiting', requests: requests.length })

    // 3. Close the bound document while waiting: the task stops, and a late answer cannot write.
    await ask('再观察', '先问我还要不要改标题')
    await expect(card).toContainText(questions.close.question)
    await settleRequests(5)
    const key = await page.getByRole('article', { name: 'AI 提问', exact: true }).last().getAttribute('data-execution-item')
    const runId = key!.slice(0, key!.indexOf(':')), callId = key!.slice(key!.indexOf(':') + 1)
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args.at(-1) as { title: string }
        return { response: options.title === '关闭正在修改的文档' ? 0 : options.title === '保存文档更改' ? 0 : 2, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    })
    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 selection.md', exact: true }).click()
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: /^selection\.md/ })).toHaveCount(0, { timeout: 30_000 })
    await expect(card).toHaveCount(0, { timeout: 30_000 })
    const late = await page.evaluate(async input => window.desktopAPI.execution!.answer!({ runId: input.runId, callId: input.callId, answer: { choices: [0] } })
      .then(() => 'accepted', (error: Error) => error.message), { runId, callId })
    expect(late).toContain('任务已停止或已结束，这个问题不能再回答。')
    await settleRequests(5)
    expect(readFileSync(filename, 'utf8')).toBe(markdownSource.replace('保持原样', '详细版改写'))
    step({ phase: 'closed-while-waiting', requests: requests.length, lateAnswer: late, savedSource: readFileSync(filename, 'utf8') })
    expect(serverErrors).toEqual([])
    expect(pageErrors).toEqual([])
    await page.screenshot({ path: join(fixture.directory, 'after-close.png') })
    evidence.requests = requests.length
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error)
    await page.screenshot({ path: join(fixture.directory, 'failure.png') }).catch(() => undefined)
    throw error
  } finally {
    evidence.serverErrors = serverErrors; evidence.pageErrors = pageErrors
    const path = join(fixture.directory, 'm09-t04-evidence.json'); writeFileSync(path, JSON.stringify(evidence, null, 2))
    await info.attach('M09-T04 option-card evidence', { path, contentType: 'application/json' }).catch(() => undefined)
    await closeSelectionApp(app)
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
