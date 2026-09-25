import { expect, test } from '@playwright/test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { closeSelectionApp, launchSelectionApp } from './helpers/g20SelectionHarness'

// M09-T01 against a real task: the TeamoRouter run recorded by M06 (run-s5fbst) carries
// actual reasoning deltas, tool calls and a document diff. A copy of that profile is opened
// read-only; nothing is sent, so no model or network request happens here.
const root = resolve(__dirname, '../..')
const source = join(root, 'output/g20/m06/real-first-visible/run-s5fbst')
const skipped = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'DevToolsActivePort'])
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

test('M09-T01 expanded cards of a real TeamoRouter task match its persisted reasoning, tool input, output and diff', async ({}, info) => {
  test.setTimeout(180_000)
  test.skip(!existsSync(join(source, 'profile')), 'Needs the recorded M06 real run profile')
  const base = join(root, 'output/g20/m09/real-task-cards'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  cpSync(join(source, 'profile'), join(directory, 'profile'), { recursive: true, filter: path => !skipped.has(path.split(/[\\/]/).at(-1)!) })
  const workspace = join(source, 'workspace')
  const workspaceBytes = Object.fromEntries(readdirSync(workspace).map(name => [name, readFileSync(join(workspace, name)).toString('base64')]))
  const runsDirectory = join(directory, 'profile', 'workbench-v2', 'runs')
  const runFilesBefore = readdirSync(runsDirectory).length
  const app = await launchSelectionApp(directory)
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    await expect(page.getByRole('article', { name: '用户消息' }).first()).toBeVisible({ timeout: 30_000 })

    // Persisted facts, read through the product's own event and run stores.
    const facts = await page.evaluate(async folder => {
      const api = window.desktopAPI.execution!
      const opened = await api.workspace(folder)
      const conversation = (await api.conversations(opened.workspace.workspaceId)).find(value => value.runIndex.builtinRunIds.length > 0)!
      const events: { runId?: string; itemId: string; type: string; update: string; data: Record<string, unknown> }[] = []
      for (let cursor = 0, more = true; more;) {
        const page = await api.events(conversation.conversationId, cursor)
        events.push(...page.events as unknown as typeof events); cursor = page.cursor; more = page.hasMore
      }
      const runs = await Promise.all(conversation.runIndex.builtinRunIds.map(id => api.run(id)))
      return { conversationId: conversation.conversationId, events, runs: runs.map(run => run && ({ runId: run.runId, status: run.status,
        tools: run.tools.map(tool => ({ name: tool.call.name, input: tool.call.input, result: tool.result })) })) }
    }, workspace)
    const run = facts.runs.find(value => value?.status === 'completed' && value.tools.some(tool => tool.name === 'text.replace'
      && tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied'))!
    expect(run).toBeTruthy()
    const edit = run.tools.find(tool => tool.name === 'text.replace')!
    const content = (edit.input as { content: string }).content
    const own = facts.events.filter(event => event.runId === run.runId)
    const joined = (type: string) => {
      const items = new Map<string, string>()
      for (const event of own.filter(value => value.type === type)) {
        const text = String(event.data.text ?? '')
        items.set(event.itemId, event.update === 'snapshot' ? text : (items.get(event.itemId) ?? '') + text)
      }
      return [...items.entries()]
    }
    const reasoning = joined('reasoning').filter(([, text]) => text.trim().length > 0)
    const replies = joined('text').filter(([, text]) => text.trim().length > 0)
    expect(reasoning.length).toBeGreaterThan(0)

    // Reasoning: every persisted reasoning item is fully readable in its expanded card, and
    // never mixed into the reply cards.
    const cards = page.locator(`article[data-execution-item^="${run.runId}:"]`)
    await expect(cards.first()).toBeAttached()
    const checked: Record<string, unknown>[] = []
    for (const [itemId, text] of reasoning) {
      const card = page.locator(`article[data-execution-item="${run.runId}:${itemId}"]`)
      await card.scrollIntoViewIfNeeded()
      await expect(card).toHaveAttribute('aria-label', '模型提供的思考')
      const details = card.locator('details').first()
      if (await details.count() && await details.evaluate(element => !(element as HTMLDetailsElement).open)) await details.locator('summary').first().click()
      await expect.poll(async () => normalize(await card.innerText())).toContain(normalize(text))
      checked.push({ itemId, type: 'reasoning', characters: text.length })
    }
    for (const [itemId, text] of replies) {
      const card = page.locator(`article[data-execution-item="${run.runId}:${itemId}"]`)
      await expect(card).toHaveAttribute('aria-label', '回复')
      const visible = normalize(await card.innerText())
      expect(visible).toContain(normalize(text))
      for (const [, thought] of reasoning) if (normalize(thought).length >= 24) expect(visible).not.toContain(normalize(thought))
      checked.push({ itemId, type: 'reply', characters: text.length })
    }

    // Tool: the text.replace card shows the model's actual content, the applied receipt and the real diff.
    const toolCards = cards.and(page.locator('article[aria-label="工具执行"]'))
    const editCards = toolCards.filter({ hasText: '工具：text.replace' })
    await expect(editCards).toHaveCount(1)
    const editCard = editCards.first()
    const editDetails = editCard.locator('details').first()
    await editCard.scrollIntoViewIfNeeded()
    if (await editDetails.evaluate(element => !(element as HTMLDetailsElement).open)) await editDetails.locator('summary').first().click()
    await expect.poll(() => editDetails.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true)
    await expect(editCard.getByRole('region', { name: '参数' })).toBeVisible()
    // The card shows the exact JSON the model sent; parse it rather than matching decoded lines.
    const shownJSON = async (name: string) => {
      const text = await editCard.getByRole('region', { name }).innerText()
      return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>
    }
    const shownInput = await shownJSON('参数')
    expect(shownInput.content).toBe(content)
    expect(shownInput.target).toBe((edit.input as { target: string }).target)
    await expect(editCard.getByRole('region', { name: '工具输出' })).toContainText('applied')
    const shownDiff = await shownJSON('实际差异')
    expect(shownDiff).toEqual({ before: '先预测😀', after: content })
    const diff = JSON.stringify(shownDiff)

    // Read-only: nothing was sent and the recorded workspace is unchanged.
    expect(readdirSync(runsDirectory).length).toBe(runFilesBefore)
    for (const [name, bytes] of Object.entries(workspaceBytes)) expect(readFileSync(join(workspace, name)).toString('base64')).toBe(bytes)
    expect(errors).toEqual([])
    const path = join(directory, 'm09-t01-real-task-evidence.json')
    writeFileSync(path, JSON.stringify({ caseId: 'M09-T01', source: 'output/g20/m06/real-first-visible/run-s5fbst', runId: run.runId,
      runStatus: run.status, tools: run.tools.map(tool => tool.name), checked, editContent: content, diff, runFilesBefore,
      runFilesAfter: readdirSync(runsDirectory).length, errors }, null, 2))
    await page.screenshot({ path: join(directory, 'expanded-cards.png') })
    await info.attach('M09-T01 real task cards', { path, contentType: 'application/json' })
  } finally { await closeSelectionApp(app) }
})
