import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { closeSelectionApp, launchSelectionApp, openSelectionFile, readSelectionDocument,
  selectVisibleText, selectionFixtures, setupSelectionUI } from './helpers/g20SelectionHarness'

const second = '第二段：待生成😀。'
const generated = '第二段：生成前半😀，后续生成并解释。'
const fifth = '第五段：人工原文。'
const humanFifth = '第五段：人工保留。'
const markdown = '# 五段正文\n\n第一段：保持原样。\n\n' + second
  + '\n\n第三段：保持原样。\n\n第四段：保持原样。\n\n' + fifth + '\n'
const frame = (delta: unknown, finish: string | null = null) => 'data: ' + JSON.stringify({
  id: 's06-concurrent-fixture', model: 'fixture-selection', choices: [{ index: 0, delta, finish_reason: finish }],
}) + '\n\n'
function gate() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}
function flowParagraphs(snapshot: DocumentSnapshot): string[] {
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected V9 course')
  const flow = snapshot.model.project.surfaces.find(surface => surface.type === 'flow')
  if (!flow || flow.type !== 'flow') throw new Error('Expected Flow surface')
  return flow.blocks.filter(block => block.type === 'paragraph')
    .map(block => block.content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join(''))
}
function businessBody(snapshot: DocumentSnapshot): string | string[] {
  return snapshot.model.kind === 'markdown' ? snapshot.model.source : flowParagraphs(snapshot)
}

for (const kind of ['Markdown', 'Flow'] as const) {
  test('S06-T03 ' + kind + ' keeps a fifth-paragraph human edit while second-paragraph generation continues', async ({}, info) => {
    test.setTimeout(150_000)
    const fixture = selectionFixtures(), name = kind === 'Markdown' ? 'selection.md' : 'flow.h5lesson'
    const filename = join(fixture.workspace, name)
    if (kind === 'Markdown') writeFileSync(filename, markdown)
    else {
      const driver = new CourseV9Driver(), model = driver.load(new Uint8Array(readFileSync(filename)))
      if (model.kind !== 'course-v9') throw new Error('Expected Flow fixture')
      const flow = model.project.surfaces.find(surface => surface.type === 'flow')
      if (!flow || flow.type !== 'flow') throw new Error('Expected Flow fixture surface')
      const paragraphs = flow.blocks.filter(block => block.type === 'paragraph')
      if (paragraphs.length !== 2) throw new Error('Expected two original Flow paragraphs')
      paragraphs[0]!.content = { inlines: [{ type: 'text', text: '第一段：保持原样。' }] }
      paragraphs[1]!.content = { inlines: [{ type: 'text', text: second }] }
      flow.blocks.push(...['第三段：保持原样。', '第四段：保持原样。', fifth].map((text, index) => ({
        id: 's06-extra-' + index, type: 'paragraph' as const, content: { inlines: [{ type: 'text' as const, text }] },
      })))
      writeFileSync(filename, driver.serialize(model))
    }
    const continueBody = gate(), finishStream = gate()
    const state: { phase: string; requestCount: number; target?: string; receipt?: unknown; errors: string[] } = {
      phase: 'idle', requestCount: 0, errors: [],
    }
    const server = createServer((request, response) => { void (async () => {
      if (request.url === '/v1/models') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] }))
        return
      }
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error('Unexpected fixture route')
      let raw = ''
      for await (const bytes of request) raw += bytes.toString()
      const data = JSON.parse(raw) as { messages: { role: string; content: string; tool_call_id?: string }[];
        tools: { function: { name: string } }[] }
      state.requestCount++
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (state.requestCount === 1) {
        const prefix = '本次固定文档与权限（切换界面不改变它们）：'
        const frozen = data.messages.find(message => message.content?.startsWith(prefix))
        if (!frozen) throw new Error('Missing frozen document reference')
        const references = JSON.parse(frozen.content.slice(prefix.length)) as { writable: { kind: string; target: string }[] }[]
        const expectedKind = kind === 'Markdown' ? 'markdown-range' : 'flow-range'
        if (references.length !== 1 || references[0]?.writable.length !== 1
          || references[0].writable[0].kind !== expectedKind) throw new Error('Wrong frozen second-paragraph target')
        const target = references[0].writable[0].target
        state.target = target
        const wire = modelToolWireName('text.replace')
        if (!data.tools.some(tool => tool.function.name === wire)) throw new Error('Missing canonical text.replace')
        const args = JSON.stringify({ target, content: generated }), split = args.indexOf('后续生成')
        if (split < 0) throw new Error('No meaningful second body fragment')
        response.write(frame({ role: 'assistant', tool_calls: [{ index: 0, id: 's06-edit', type: 'function',
          function: { name: wire, arguments: args.slice(0, split) } }] }))
        state.phase = 'first-fragment'
        await continueBody.wait
        response.write(frame({ tool_calls: [{ index: 0, function: { arguments: args.slice(split) } }] }))
        state.phase = 'continued'
        await finishStream.wait
        response.write(frame({}, 'tool_calls'))
      } else if (state.requestCount === 2) {
        const tool = data.messages.find(message => message.role === 'tool' && message.tool_call_id === 's06-edit')
        state.receipt = tool ? JSON.parse(tool.content) : null
        if (!state.receipt || (state.receipt as { result?: { status?: string } }).result?.status !== 'applied')
          throw new Error('Generation was not formally applied')
        response.write(frame({ role: 'assistant', content: 'S06 并发编辑完成。' }, 'stop'))
      } else throw new Error('Unexpected extra model request')
      response.end('data: [DONE]\n\n')
    })().catch(error => {
      state.errors.push(String(error))
      if (!response.headersSent) response.writeHead(500)
      response.end()
    }) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    let app: Awaited<ReturnType<typeof launchSelectionApp>> | undefined
    try {
      app = await launchSelectionApp(fixture.directory)
      const page = await app.firstWindow(), pageErrors: string[] = []
      page.on('pageerror', error => pageErrors.push(error.message))
      const endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1'
      await setupSelectionUI(app, page, endpoint, fixture.workspace)
      const document = await openSelectionFile(page, fixture.workspace, name)
      const before = await readSelectionDocument(page, document.documentId)
      const body = page.getByRole('textbox', { name: '正文编辑', exact: true }).filter({ visible: true })
      await selectVisibleText(page, body, second)
      const card = page.getByLabel('当前编辑目标', { exact: true })
      await card.getByLabel('AI 指令', { exact: true }).fill('仅改写第二段，保留其他段落')
      await card.getByRole('button', { name: '发送', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
      await expect.poll(() => state.phase).toBe('first-fragment')
      const preview = body.locator('[data-edit-preview]')
      await expect(preview).toContainText('第二段：生成前半😀，')
      expect(businessBody(await readSelectionDocument(page, document.documentId))).toEqual(businessBody(before))
      await selectVisibleText(page, body, fifth)
      await page.keyboard.insertText(humanFifth)
      const afterHuman = await expect.poll(async () => readSelectionDocument(page, document.documentId))
        .toMatchObject({ revision: before.revision + 1, undoDepth: before.undoDepth + 1 })
      void afterHuman
      const human = await readSelectionDocument(page, document.documentId)
      if (kind === 'Markdown') expect(human.model).toMatchObject({ source: markdown.replace(fifth, humanFifth) })
      else expect(flowParagraphs(human)).toEqual(['第一段：保持原样。', second, '第三段：保持原样。',
        '第四段：保持原样。', humanFifth])
      await expect(preview).toContainText('第二段：生成前半😀，')
      continueBody.release()
      await expect(preview).toContainText(generated)
      expect(businessBody(await readSelectionDocument(page, document.documentId))).toEqual(businessBody(human))
      finishStream.release()
      await expect(page.getByText('S06 并发编辑完成。', { exact: true })).toBeVisible()
      await expect(preview).toHaveCount(0)
      const after = await readSelectionDocument(page, document.documentId)
      expect(after.revision).toBe(before.revision + 2)
      expect(after.undoDepth).toBe(before.undoDepth + 2)
      if (kind === 'Markdown') expect(after.model).toMatchObject({ source: markdown.replace(second, generated).replace(fifth, humanFifth) })
      else expect(flowParagraphs(after)).toEqual(['第一段：保持原样。', generated, '第三段：保持原样。',
        '第四段：保持原样。', humanFifth])
      const undo = kind === 'Markdown'
        ? page.getByRole('region', { name: '教学文档 ' + name, exact: true }).getByRole('button', { name: '撤销', exact: true })
        : page.getByLabel('课件常用工具', { exact: true }).getByRole('button', { name: '撤销', exact: true })
      await undo.click()
      await expect.poll(async () => businessBody(await readSelectionDocument(page, document.documentId))).toEqual(businessBody(human))
      await expect.poll(async () => {
        const snapshot = await readSelectionDocument(page, document.documentId)
        return { undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth }
      }).toEqual({ undoDepth: before.undoDepth + 1, redoDepth: before.redoDepth + 1 })
      await undo.click()
      await expect.poll(async () => businessBody(await readSelectionDocument(page, document.documentId))).toEqual(businessBody(before))
      await expect.poll(async () => {
        const snapshot = await readSelectionDocument(page, document.documentId)
        return { undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth }
      }).toEqual({ undoDepth: before.undoDepth, redoDepth: before.redoDepth + 2 })
      expect(state.receipt).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      expect(state.requestCount).toBe(2)
      expect(state.errors).toEqual([])
      expect(pageErrors).toEqual([])
      const evidence = join(fixture.directory, 's06-t03-' + kind.toLowerCase() + '.json')
      writeFileSync(evidence, JSON.stringify({ kind, beforeRevision: before.revision, humanRevision: human.revision,
        finalRevision: after.revision, undoDepth: after.undoDepth, requestCount: state.requestCount,
        target: state.target, receipt: state.receipt, pageErrors }, null, 2))
      await info.attach('S06-T03 ' + kind + ' concurrent edit', { path: evidence, contentType: 'application/json' })
    } finally {
      continueBody.release(); finishStream.release()
      if (app) await closeSelectionApp(app)
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
}
