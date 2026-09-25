import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, readSelectionDocument, selectVisibleText, selectionFixtures, setupSelectionUI } from './helpers/g20SelectionHarness'

// M12-T02 through the real window: real Service/Engine/Gateway, a local HTTP model
// whose failure mode the test switches. No supplier account or paid request is used.
type Fault = 'auth' | 'quota' | 'quota429' | 'rate429' | 'disconnect'
const body = (page: Page) => page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })

async function recoveryServer() {
  let fault: Fault | null = null
  const requests: { fault: Fault | null; text: string }[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const text = Buffer.concat(chunks).toString(), current = fault
    requests.push({ fault: current, text })
    if (current === 'disconnect') { response.destroy(); return }
    if (current) {
      const status = current === 'auth' ? 401 : current === 'quota' ? 402 : 429
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: current === 'quota429' ? { code: 'insufficient_quota' }
        : current === 'rate429' ? { code: 'rate_limit_exceeded', message: 'Request quota exceeded per minute; retry after 60 seconds' }
          : { message: 'fixture failure' } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: `recovered-${requests.length}`, model: 'fixture-selection', choices: [{ index: 0,
      delta: { role: 'assistant', content: `连接已恢复 ${requests.length}` }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })().catch(() => response.destroy()) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, requests,
    fail(next: Fault) { fault = next }, recover() { fault = null },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}

// Owner 2026-09-24: sending never shows a service notice.
async function expectNoServiceNotice(page: Page) {
  await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
}

test('M12-T02 login, quota and network failures keep the input and continue exactly once after recovery', async ({}, info) => {
  test.setTimeout(300_000)
  const fixture = selectionFixtures(), server = await recoveryServer()
  const app = await launchSelectionApp(fixture.directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const attachmentPath = join(fixture.directory, '教师参考材料.txt')
  writeFileSync(attachmentPath, 'M12 附件正文：先观察现象，再解释原因。')
  const rounds = [
    { fault: 'auth' as const, reason: '模型连接认证失败（HTTP 401）', text: '只润色选中的句子，保持原意', selection: true, attachment: true },
    { fault: 'quota' as const, reason: '模型服务拒绝本次额度或付款（HTTP 402）', text: '再给一个课堂提问', selection: false, attachment: false },
    { fault: 'quota429' as const, reason: '模型服务拒绝本次额度或付款（HTTP 429）', text: '准备下一段导入', selection: false, attachment: false },
    { fault: 'rate429' as const, reason: '模型服务暂时限制请求（HTTP 429）', text: '概括本页要点', selection: false, attachment: false },
    { fault: 'disconnect' as const, reason: '模型连接中断，本次请求结果尚未确认；不会自动重发。', text: '总结这段的教学目的', selection: false, attachment: false },
  ]
  const evidence: Record<string, unknown>[] = []
  try {
    await setupSelectionUI(app, page, server.endpoint, fixture.workspace)
    const document = await openSelectionFile(page, fixture.workspace, 'selection.md')
    const assistant = page.getByRole('region', { name: '创作助手', exact: true })
    const composer = page.getByLabel('给创作助手发消息', { exact: true })
    const chips = page.locator('.attachment-composer').getByRole('button', { name: '预览发送内容', exact: true })
    const continueButton = assistant.getByRole('button', { name: '连接恢复后继续此任务', exact: true })
    const identity = async () => page.evaluate(async root => {
      const opened = await window.desktopAPI.execution!.workspace(root)
      const list = await window.desktopAPI.execution!.conversations(opened.workspace.workspaceId)
      return { workspaceId: opened.workspace.workspaceId, conversationId: list[0].conversationId, count: list.length }
    }, fixture.workspace)

    for (const round of rounds) {
      const before = server.requests.length
      if (round.selection) {
        await selectVisibleText(page, body(page), '先预测😀')
        await assistant.getByRole('button', { name: '添加', exact: true }).click()
        await assistant.getByRole('menuitem', { name: '引用当前选区', exact: true }).click()
        await expect(assistant.getByLabel('本条消息的引用', { exact: true })).toContainText('选区 1 处')
      }
      if (round.attachment) {
        await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, attachmentPath)
        await page.locator('.attachment-composer').getByRole('button', { name: '添加', exact: true }).click(); await page.locator('.attachment-composer').getByRole('menuitem', { name: '添加附件（图片或文档）', exact: true }).click()
        await expect(chips).toHaveCount(1)
      }
      await composer.fill(round.text)
      server.fail(round.fault)
      await assistant.getByRole('button', { name: '发送', exact: true }).click()
      await expectNoServiceNotice(page)

      // Exact reason, and the teacher's input (text and attachment) is back in the composer.
      await expect(assistant.getByRole('alert').filter({ hasText: round.reason })).toBeVisible()
      await expect(composer).toHaveValue(round.text)
      await expect(chips).toHaveCount(round.attachment ? 1 : 0)
      // No automatic resend while the connection is still broken.
      await page.waitForTimeout(2_000)
      expect(server.requests.length).toBe(before + 1)
      expect(server.requests[before].fault).toBe(round.fault)

      server.recover()
      await expect(continueButton).toBeEnabled()
      await continueButton.click()
      await expectNoServiceNotice(page)
      await expect(assistant.getByText(`连接已恢复 ${before + 2}`, { exact: true })).toBeVisible()
      await page.waitForTimeout(1_000)
      expect(server.requests.length).toBe(before + 2)
      expect(server.requests[before + 1].text).toContain(JSON.stringify(round.text).slice(1, -1))
      if (round.attachment) expect(server.requests[before + 1].text).toContain('先观察现象，再解释原因')
      await expect(composer).toHaveValue('')
      await expect(chips).toHaveCount(0)
      await expect(assistant.getByRole('article', { name: '用户消息' }).filter({ hasText: round.text })).toHaveCount(1)

      const { workspaceId, conversationId } = await identity()
      const submissions = await page.evaluate(input => window.desktopAPI.execution!.submissions(input), { workspaceId, conversationId })
      const own = submissions.filter(item => item.text === round.text)
      expect(own).toHaveLength(2)
      const [failed, continued] = [...own].sort((a, b) => a.createdAt - b.createdAt)
      expect(continued.retryOfRunId).toBe(failed.runId)
      const runs = await page.evaluate(ids => Promise.all(ids.map(id => window.desktopAPI.execution!.run(id))), [failed.runId!, continued.runId!])
      expect(runs.map(run => run?.status)).toEqual(['failed', 'completed'])
      if (round.selection) expect(continued.documents[0]?.selection?.map(item => item.kind)).toEqual(['markdown-range'])
      if (round.attachment) expect(continued.attachments).toEqual(failed.attachments)
      evidence.push({ fault: round.fault, reason: round.reason, requestsBefore: before, requestsAfter: server.requests.length,
        failedRunId: failed.runId, continuedRunId: continued.runId, retryOfRunId: continued.retryOfRunId, runStatuses: runs.map(run => run?.status),
        selectionKinds: continued.documents[0]?.selection?.map(item => item.kind) ?? [], attachments: continued.attachments.length })
    }
    const conversationCount = (await identity()).count
    expect(conversationCount).toBe(1)
    expect((await readSelectionDocument(page, document.documentId)).revision).toBe(document.revision)
    expect(errors).toEqual([])
    const path = join(fixture.directory, 'm12-t02-ui-evidence.json')
    writeFileSync(path, JSON.stringify({ caseId: 'M12-T02', carrier: 'electron + local HTTP model', rounds: evidence,
      requests: server.requests.map(item => item.fault ?? 'ok'), conversationCount, errors }, null, 2))
    await info.attach('M12-T02 UI recovery evidence', { path, contentType: 'application/json' })
  } finally { await closeSelectionApp(app); await server.close() }
})
