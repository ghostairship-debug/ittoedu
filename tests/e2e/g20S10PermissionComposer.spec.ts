import { expect, test, type Locator, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { closeSelectionApp, launchSelectionApp, markdownSource, openSelectionFile, readSelectionDocument, selectVisibleText, selectionFixtures, setupSelectionUI } from './helpers/g20SelectionHarness'

// M07-T07 / S10-T05 / S10-T07 / S04-T06 (Owner 2026-09-24) in the real window: "+" left of the input, permission
// bottom-left, model bottom-right; no write checkbox or service notice; four permission levels enforced by Main,
// with an approval card for "修改前询问"; the selected text travels with the task so an edit needs no first read.
const event = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'permission-fixture', model: 'fixture-selection', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const prefix = '本次固定文档与权限（切换界面不改变它们）：'
type Phase = 'allow' | 'deny' | 'read-only' | 'workspace'
interface Frozen { documentId: string; writable: { kind: string; target: string }[]; selection: { kind: string; target: string; writableTarget?: string; content?: { text: string; truncated: boolean } }[] }
interface Body { messages: { role: string; content: string; tool_call_id?: string }[]; tools?: { function: { name: string } }[] }

async function box(control: Locator) {
  return control.evaluate(element => {
    const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return { x: Math.round(rect.left), y: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), hits: !!hit && (hit === element || element.contains(hit)) }
  })
}

test('M07-T07/S10-T07 composer layout and the four permission levels in the real window', async ({}, info) => {
  test.setTimeout(300_000)
  const fixture = selectionFixtures()
  const requests: { phase: Phase; body: Body }[] = [], serverErrors: string[] = []
  const frozenByPhase: Partial<Record<Phase, Frozen[]>> = {}, repliesByPhase: Partial<Record<Phase, unknown>> = {}
  let phase: Phase = 'allow', step = 0
  const replacement: Record<Phase, string> = { allow: '先猜想😀', deny: '不该写入的改写', 'read-only': '', workspace: '先推理😀' }
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    let raw = ''; for await (const chunk of request) raw += chunk.toString()
    const body: Body = JSON.parse(raw), current = phase, turn = step++; requests.push({ phase: current, body })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const say = (text: string) => response.write(event({ role: 'assistant', content: text }, 'stop'))
    if (turn === 0) {
      const frozen = body.messages.find(message => typeof message.content === 'string' && message.content.startsWith(prefix))
      if (!frozen) throw new Error('Missing frozen references')
      const references: Frozen[] = JSON.parse(frozen.content.slice(prefix.length)); frozenByPhase[current] = references
      if (current === 'read-only') {
        const offered = (body.tools ?? []).map(tool => tool.function.name)
        if (references.some(reference => reference.writable.length) || offered.includes(modelToolWireName('text.replace')) || offered.includes('batch'))
          throw new Error(`Read-only still offered writes: ${JSON.stringify({ writable: references.map(reference => reference.writable), offered })}`)
        say('只读模式下只回答，不修改。')
      } else {
        const selection = references[0]?.selection[0]
        // S04-T06: the first request already carries the selected text and its writable handle, so no read turn.
        if (!selection?.content || selection.content.truncated || !selection.writableTarget) throw new Error(`Selection content did not travel with the task: ${JSON.stringify(references)}`)
        response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id: `edit-${current}`, type: 'function',
          function: { name: modelToolWireName('text.replace'), arguments: JSON.stringify({ target: selection.writableTarget, content: replacement[current] }) } }] }, 'tool_calls'))
      }
    } else if (turn === 1 && current !== 'read-only') {
      const reply = body.messages.find(message => message.tool_call_id === `edit-${current}`)
      repliesByPhase[current] = reply ? JSON.parse(reply.content) : null
      say(current === 'deny' ? '好的，这次不改。' : `${current} 已改写。`)
    } else throw new Error(`Unexpected model turn ${turn} in ${current}`)
    response.end('data: [DONE]\n\n')
  })().catch(error => { serverErrors.push(String(error)); response.destroy() }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const app = await launchSelectionApp(fixture.directory), page = await app.firstWindow(), pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const evidence: Record<string, unknown> = { caseIds: ['M07-T07', 'S10-T05', 'S10-T07', 'S04-T06'], layer: 'real Electron window, real ExecutionEngine/Gateway, local SSE model' }
  const assistant = page.getByRole('region', { name: '创作助手', exact: true })
  const composer = assistant.getByRole('textbox', { name: '给创作助手发消息', exact: true })
  const approval = page.getByRole('region', { name: '修改请求', exact: true })
  const notice = page.getByRole('dialog', { name: '发送前的服务与范围说明' })
  const editor = (target: Page) => target.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
  const referenceSelection = async (text: string) => {
    await selectVisibleText(page, editor(page), text)
    await assistant.getByRole('button', { name: '添加', exact: true }).click()
    await page.getByRole('menu', { name: '添加内容', exact: true }).getByRole('menuitem', { name: '引用当前选区', exact: true }).click()
    await expect(assistant.getByLabel('本条消息的引用', { exact: true })).toContainText('选区 1 处')
  }
  const choose = async (label: string) => {
    await assistant.getByRole('button', { name: /^权限：/ }).click()
    const levels = page.getByRole('menu', { name: '权限模式', exact: true })
    // Exact label: "完全访问" must not also pick "完全访问（工作空间）" (labels hold no regex metacharacters).
    await levels.getByRole('menuitemradio').filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) }).click()
    await expect(assistant.getByRole('button', { name: `权限：${label}`, exact: true })).toBeVisible()
  }
  const send = async (next: Phase, text: string) => {
    phase = next; step = 0
    await composer.fill(text)
    await assistant.getByRole('button', { name: '发送', exact: true }).click()
    await expect(notice).toHaveCount(0)
  }
  try {
    await setupSelectionUI(app, page, `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, fixture.workspace)
    const opened = await openSelectionFile(page, fixture.workspace, 'selection.md')
    const source = async () => (await readSelectionDocument(page, opened.documentId)).model

    // M07-T07 layout: "+" left of the input; permission bottom-left; model and send bottom-right; old controls gone.
    await expect(assistant.getByRole('checkbox', { name: '允许修改已绑定文档' })).toHaveCount(0)
    await expect(assistant.getByText('选择范围', { exact: true })).toHaveCount(0)
    await expect(assistant.getByRole('button', { name: '添加附件', exact: true })).toHaveCount(0)
    const plus = assistant.getByRole('button', { name: '添加', exact: true }), permission = assistant.getByRole('button', { name: '权限：完全访问（工作空间）', exact: true })
    const model = assistant.getByRole('button', { name: '切换模型', exact: true }), sendButton = assistant.getByRole('button', { name: '发送', exact: true })
    const layout = { plus: await box(plus), input: await box(composer), permission: await box(permission), model: await box(model), send: await box(sendButton) }
    evidence.layout = layout
    expect(layout.plus.right).toBeLessThanOrEqual(layout.input.x)
    expect(layout.plus.y).toBeLessThan(layout.input.bottom)
    expect(layout.permission.y).toBeGreaterThanOrEqual(layout.input.bottom - 2)
    expect(layout.permission.right).toBeLessThan(layout.model.x)
    expect(layout.model.right).toBeLessThanOrEqual(layout.send.x + 2)
    for (const [name, value] of Object.entries(layout)) expect(value.hits, name).toBe(true)
    await plus.click()
    const menu = page.getByRole('menu', { name: '添加内容', exact: true })
    await expect(menu.getByRole('menuitem')).toHaveText(['添加附件（图片或文档）', '引用工作空间文件', '引用当前文档', '引用当前选区'])
    for (const item of await menu.getByRole('menuitem').all()) expect((await box(item)).hits).toBe(true)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await permission.click()
    const levels = page.getByRole('menu', { name: '权限模式', exact: true })
    await expect(levels.getByRole('menuitemradio').locator('span')).toHaveText(['完全访问', '完全访问（工作空间）', '修改前询问', '只读'])
    await expect(levels.getByRole('menuitemradio', { checked: true })).toContainText('完全访问（工作空间）')
    await page.keyboard.press('Escape')

    // 1. 修改前询问 → allow: nothing is written while the card is open; the change lands after "允许".
    await choose('修改前询问')
    await referenceSelection('先预测😀')
    await send('allow', '把选中的词改成先猜想')
    await expect(approval).toBeVisible()
    await expect(approval.getByLabel('修改内容')).toContainText('原文：先预测😀')
    await expect(approval.getByLabel('修改内容')).toContainText('改为：先猜想😀')
    for (const button of await approval.getByRole('group', { name: '是否允许' }).getByRole('button').all()) expect((await box(button)).hits).toBe(true)
    // S10-T05: changing the level now only affects later sends; the pending change still waits for this card.
    await choose('完全访问')
    await page.waitForTimeout(1_000)
    await expect(approval).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(await source()).toMatchObject({ source: markdownSource })
    await approval.getByRole('button', { name: '允许', exact: true }).click()
    await expect(page.getByText('allow 已改写。', { exact: true })).toBeVisible()
    await expect(approval).toHaveCount(0)
    const afterAllow = markdownSource.replace('先预测😀', '先猜想😀')
    expect(await source()).toMatchObject({ source: afterAllow })
    expect(repliesByPhase.allow).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })

    // 2. 修改前询问 → deny: zero writes and the model receives the refusal.
    await choose('修改前询问')
    await referenceSelection('保持原样')
    await send('deny', '把选中的词改掉')
    await expect(approval).toBeVisible()
    await approval.getByRole('button', { name: '拒绝', exact: true }).click()
    await expect(page.getByText('好的，这次不改。', { exact: true })).toBeVisible()
    expect(repliesByPhase.deny).toMatchObject({ kind: 'error', code: 'user-denied' })
    expect(await source()).toMatchObject({ source: afterAllow })

    // 3. 只读: Main strips every write and offers no modification tool.
    await choose('只读')
    await referenceSelection('先猜想😀')
    await send('read-only', '只看看这句，不要改')
    await expect(page.getByText('只读模式下只回答，不修改。', { exact: true })).toBeVisible()
    expect(frozenByPhase['read-only']?.[0]?.writable).toEqual([])
    expect(await source()).toMatchObject({ source: afterAllow })
    await expect(approval).toHaveCount(0)

    // 4. 完全访问（工作空间）: an in-workspace edit is applied without asking.
    await choose('完全访问（工作空间）')
    await referenceSelection('先猜想😀')
    await send('workspace', '把选中的词改成先推理')
    await expect(page.getByText('workspace 已改写。', { exact: true })).toBeVisible()
    await expect(approval).toHaveCount(0)
    expect(await source()).toMatchObject({ source: afterAllow.replace('先猜想😀', '先推理😀') })

    // Every edit took two model turns: the selected text came with the task, so no read turn was needed.
    const turns = Object.fromEntries((['allow', 'deny', 'read-only', 'workspace'] as const).map(value => [value, requests.filter(item => item.phase === value).length]))
    expect(turns).toEqual({ allow: 2, deny: 2, 'read-only': 1, workspace: 2 })
    evidence.turns = turns
    evidence.replies = repliesByPhase
    expect(serverErrors).toEqual([])
    expect(pageErrors).toEqual([])
    await page.screenshot({ path: join(fixture.directory, 'permission-composer.png') })
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error)
    await page.screenshot({ path: join(fixture.directory, 'failure.png') }).catch(() => undefined)
    throw error
  } finally {
    evidence.serverErrors = serverErrors; evidence.pageErrors = pageErrors; evidence.requests = requests.length
    const path = join(fixture.directory, 'permission-composer-evidence.json'); writeFileSync(path, JSON.stringify(evidence, null, 2))
    await info.attach('permission composer evidence', { path, contentType: 'application/json' }).catch(() => undefined)
    await closeSelectionApp(app)
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
