import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { m23Fixture } from './helpers/g20M23Fixtures'
import { closeM23, launchM23, m23Shot, openM23Html, writeM23Evidence } from './helpers/g20M23Harness'
import { setupSelectionUI } from './helpers/g20SelectionHarness'

async function duringReload<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read() }
  catch (error) {
    if (error instanceof Error && /Execution context was destroyed|Cannot find context|Frame was detached/.test(error.message)) return null
    throw error
  }
}

test('U08 edits source-owned third-party layout, shared CSS and program data, saves and reopens in the real host', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Real Electron host evidence requires Windows.')
  test.setTimeout(180_000)
  const fixture = m23Fixture('u08-source-edit')
  const filename = join(fixture.workspace, 'garden.html')
  writeFileSync(filename, readFileSync(resolve('tests/fixtures/html-source-edit/two-column.html'), 'utf8'))
  const facts: Record<string, unknown> = { case: 'U08', status: 'running' }
  let liveUrl = '', requests = 0
  const model = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error('Unexpected local observation fixture route')
    let raw = ''; for await (const chunk of request) raw += chunk
    const data = JSON.parse(raw) as { messages: Array<{ role: string; content?: unknown; tool_call_id?: string }>;
      tools?: Array<{ function: { name: string } }> }
    const event = (delta: unknown, finish: string) => `data: ${JSON.stringify({ id: 'u08-observe', model: 'fixture-selection',
      choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    requests++
    if (requests === 1) {
      const name = modelToolWireName('html.observe')
      if (!data.tools?.some(tool => tool.function.name === name)) throw new Error('The bound HTML did not expose its real observation tool')
      response.end(event({ role: 'assistant', tool_calls: [{ index: 0, id: 'u08-live-observe', type: 'function',
        function: { name, arguments: '{}' } }] }, 'tool_calls'))
    } else if (requests === 2) {
      const receipt = data.messages.find(message => message.role === 'tool' && message.tool_call_id === 'u08-live-observe')
      if (typeof receipt?.content !== 'string') throw new Error('Missing real HTML observation receipt')
      const result = JSON.parse(receipt.content) as { kind: string; data: { source: string; currentUrl: string;
        identity: { revision: number }; structure: string[]; image: { resourceId: string } } }
      if (result.kind !== 'read' || result.data.source !== 'live-html-preview' || result.data.currentUrl !== liveUrl
        || !result.data.structure.join('\n').includes('十四天观察计划') || !result.data.image.resourceId)
        throw new Error(`No current edited live HTML observation: ${JSON.stringify(result)}`)
      const actualImage = data.messages.some(message => Array.isArray(message.content)
        && message.content.some((part: { type?: string; image_url?: { url?: string } }) => part.type === 'image_url'
          && part.image_url?.url?.startsWith('data:image/png;base64,')))
      if (!actualImage) throw new Error('The current live PNG was not delivered to the local model fixture')
      facts.aiObservation = { source: result.data.source, currentUrl: result.data.currentUrl,
        revision: result.data.identity.revision, currentStructure: result.data.structure, imageDelivered: actualImage,
        channel: 'real Engine with local HTTP model fixture; no paid model' }
      response.end(event({ role: 'assistant', content: '已观察修改后的当前网页。' }, 'stop'))
    } else throw new Error('Unexpected additional observation fixture request')
  })().catch(error => {
    facts.modelFixtureError = String(error)
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: String(error) } }))
  }) })
  await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve))
  const address = model.address()
  if (!address || typeof address === 'string') throw new Error('Local model fixture address unavailable')
  let app: Awaited<ReturnType<typeof launchM23>>['app'] | undefined
  let page: Awaited<ReturnType<typeof launchM23>>['page'] | undefined
  let capture: Awaited<ReturnType<typeof launchM23>>['capture'] | undefined
  let failure: unknown
  try {
    const launched = await launchM23(fixture); app = launched.app; page = launched.page; capture = launched.capture
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1920, 1100))
    await setupSelectionUI(app, page, `http://127.0.0.1:${address.port}/v1`, fixture.workspace)
    let region = await openM23Html(page, 'garden.html')
    let preview = region.frameLocator('iframe[title="HTML 预览"]')
    const originalPreviewUrl = await region.locator('iframe[title="HTML 预览"]').getAttribute('src')
    await expect(preview.locator('#live-title')).toHaveText('七天观察计划')
    await region.getByRole('button', { name: '结构与样式', exact: true }).click()
    const inspector = region.getByRole('complementary', { name: 'HTML 结构与样式' })
    await inspector.getByRole('button', { name: '共享样式', exact: true }).click()
    await inspector.getByLabel('共享样式规则').selectOption({ label: 'main' })
    await inspector.getByLabel('共享 CSS 属性', { exact: true }).fill('grid-template-columns')
    await inspector.getByLabel('共享 CSS 属性值', { exact: true }).fill('2fr 1fr')
    await inspector.getByRole('button', { name: '应用样式', exact: true }).click()
    await expect.poll(async () => await duringReload(() => preview.locator('#garden').evaluate(element => {
      const cards = Array.from(element.children) as HTMLElement[]
      return cards[0]!.getBoundingClientRect().width / cards[1]!.getBoundingClientRect().width
    })) ?? 0).toBeGreaterThan(1.8)
    await inspector.getByLabel('共享样式规则').selectOption({ label: '.card' })
    await inspector.getByLabel('共享 CSS 属性', { exact: true }).fill('background')
    await inspector.getByLabel('共享 CSS 属性值', { exact: true }).fill('#fff8e6')
    await inspector.getByRole('button', { name: '应用样式', exact: true }).click()
    await expect.poll(() => duringReload(() => preview.locator('#left').evaluate(element => getComputedStyle(element).backgroundColor))).toBe('rgb(255, 248, 230)')
    await expect.poll(() => duringReload(() => preview.locator('#right').evaluate(element => getComputedStyle(element).backgroundColor))).toBe('rgb(255, 248, 230)')
    await inspector.getByRole('button', { name: '结构', exact: true }).click()
    await inspector.getByRole('button', { name: 'article#right.card', exact: true }).click()
    await inspector.getByLabel('元素 CSS 属性', { exact: true }).fill('padding')
    await inspector.getByLabel('元素 CSS 属性值', { exact: true }).fill('32px')
    await inspector.getByRole('button', { name: '应用样式', exact: true }).click()
    await expect.poll(() => duringReload(() => preview.locator('#right').evaluate(element => getComputedStyle(element).padding))).toBe('32px')
    await inspector.getByRole('button', { name: 'article#right.card', exact: true }).click()
    await inspector.getByRole('button', { name: '上移', exact: true }).click()
    await expect.poll(() => duringReload(() => preview.locator('#garden').evaluate(element => Array.from(element.children).map(child => child.id)))).toEqual(['right', 'left'])
    await inspector.getByRole('button', { name: '程序数据', exact: true }).click()
    await inspector.getByLabel('HTML 程序 JSON 数据').fill('{"title":"十四天观察计划","days":3}')
    await inspector.getByRole('button', { name: '应用数据', exact: true }).click()
    await expect(preview.locator('#live-title')).toHaveText('十四天观察计划')
    await expect(preview.locator('#days')).toHaveText('3')
    await expect(inspector.getByRole('button', { name: '应用数据', exact: true })).toBeEnabled()
    // Native capture makes the offscreen Windows OOPIF submit its hit-test surface.
    // The following interaction remains a real trusted mouse click.
    await m23Shot(fixture, page, info, 'u08-source-edited-before-interaction', app)
    facts.beforeProgramClick = await preview.locator('#next-day').evaluate(button => {
      const box = button.getBoundingClientRect()
      const probe: unknown[] = []
      for (const type of ['pointerdown', 'pointerup', 'click']) window.addEventListener(type, event => {
        const mouse = event as MouseEvent
        probe.push({ type, trusted: event.isTrusted, target: (event.target as Element)?.id,
          x: mouse.clientX, y: mouse.clientY, text: document.getElementById('days')?.textContent })
      }, { capture: true })
      Object.assign(window, { __u08ClickProbe: probe })
      return { ready: document.readyState, url: location.href, pointTarget: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.id,
        button: button.outerHTML, sourceData: document.getElementById('plan')?.textContent,
        rect: { x: box.x, y: box.y, width: box.width, height: box.height }, viewport: { width: innerWidth, height: innerHeight } }
    })
    await preview.getByRole('button', { name: '记录一天', exact: true }).click()
    facts.afterProgramClick = await preview.locator('#next-day').evaluate(() => ({
      probe: (window as Window & { __u08ClickProbe?: unknown[] }).__u08ClickProbe,
      value: document.getElementById('days')?.textContent, url: location.href,
    }))
    await expect(preview.locator('#days')).toHaveText('4')
    liveUrl = await region.locator('iframe[title="HTML 预览"]').getAttribute('src') ?? ''
    expect(liveUrl).not.toBe(originalPreviewUrl)
    expect(await app.evaluate(async ({ net }, url) => (await net.fetch(url)).status, originalPreviewUrl!)).toBe(404)
    await page.getByRole('button', { name: '新建会话', exact: true }).click()
    await page.getByLabel('给创作助手发消息', { exact: true }).fill('观察当前 garden.html，确认修改后的计划和当前互动。')
    await page.getByRole('button', { name: '添加', exact: true }).click()
    await page.getByRole('menu', { name: '添加内容' }).getByRole('menuitem', { name: '引用当前文档' }).click()
    await expect(page.locator('.execution-assistant__chip')).toContainText('garden.html')
    await page.getByRole('region', { name: '创作助手', exact: true }).getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('已观察修改后的当前网页。', { exact: true })).toBeVisible({ timeout: 45_000 })
    expect(requests).toBe(2)
    await expect(preview.locator('#days')).toHaveText('4')
    await region.getByRole('button', { name: '保存', exact: true }).click()
    await expect(region.locator('.lesson-document-status')).toHaveText('已保存')
    await page.getByRole('button', { name: '关闭 garden.html', exact: true }).click()
    region = await openM23Html(page, 'garden.html'); preview = region.frameLocator('iframe[title="HTML 预览"]')
    await expect(preview.locator('#live-title')).toHaveText('十四天观察计划')
    await expect(preview.locator('#days')).toHaveText('3')
    const observed = await preview.locator('#garden').evaluate(element => {
      const cards = Array.from(element.children) as HTMLElement[]
      return { order: cards.map(card => card.id), columns: getComputedStyle(element).gridTemplateColumns,
        widths: cards.map(card => card.getBoundingClientRect().width),
        backgrounds: cards.map(card => getComputedStyle(card).backgroundColor),
        paddings: cards.map(card => getComputedStyle(card).padding) }
    })
    facts.reopen = observed
    expect(observed.order).toEqual(['right', 'left'])
    expect(observed.widths[0]! / observed.widths[1]!).toBeGreaterThan(1.8)
    expect(observed.widths[0]! / observed.widths[1]!).toBeLessThan(2.2)
    expect(observed.backgrounds).toEqual(['rgb(255, 248, 230)', 'rgb(255, 248, 230)'])
    expect(observed.paddings).toEqual(['32px', '24px'])
    await m23Shot(fixture, page, info, 'u08-source-edit-reopened', app)
    await preview.getByRole('button', { name: '记录一天', exact: true }).click()
    await expect(preview.locator('#days')).toHaveText('4')
    facts.reopenInteraction = { sourceDays: 3, daysAfterRealClick: 4 }
    expect(readFileSync(filename, 'utf8')).not.toMatch(/data-courseware|html-preview-agent|courseware-preview:\/\//)
    facts.status = 'passed'
    expect(capture.pageErrors).toEqual([])
  } catch (error) {
    failure = error; facts.status = 'failed'
    if (page) await m23Shot(fixture, page, info, 'u08-source-edit-failure')
    throw error
  }
  finally {
    if (app && page && capture) {
      const evidence = await writeM23Evidence(fixture, page, app, capture, facts, failure)
      await info.attach('U08 evidence.json', { path: evidence, contentType: 'application/json' })
      await closeM23(app)
    }
    model.closeAllConnections()
    await new Promise<void>(resolve => model.close(() => resolve()))
  }
})
