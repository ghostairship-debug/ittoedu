import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../../src/main/windowVisibility'
import { modelToolWireName } from '../../../src/main/workbench/providers/OpenAIChatProvider'
import { CourseV9Driver } from '../../../src/core/drivers/CourseV9Driver'
import { createBlankCourseProject } from '../../../src/core/course/createCourseProject'
import { createBlankFlowSurface } from '../../../src/core/tools/flowDocumentModel'
import { courseProjectDocumentSchema } from '../../../src/shared/courseProjectSchema'
import { createNamedSelectionFixture } from '../../helpers/g20NamedSelectionFixture'
import type { DocumentSnapshot } from '../../../src/shared/workbench/document'

export const markdownSource = '# 选区检查\n\n甲段：先预测😀，再观察。\n\n乙段：保持原样。\n'
const root = resolve(__dirname, '../../..')
interface Reference { documentId: string; writable: { kind: string; target: string }[]; selection: { kind: string; target: string }[] }
interface Request { model: string; messages: { role: string; content: string; tool_call_id?: string }[]; tools: { function: { name: string } }[] }
export interface SelectionRound {
  id: string; kind: string; replacement: string; references?: Reference[]; readText?: string
  /** A main-chat reference under the default level also carries one whole-document write; inline edits never do. */
  documentWritable?: boolean
  held: boolean; returned?: unknown; error?: string; release(): void
  multi?: { replacements: string[]; targets: string[]; readTexts: string[]; results: unknown[] }
}
const event = (delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id: 'selection-fixture', model: 'fixture-selection', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

/** Real HTTP/SSE. The only edits are tools consumed by the real Engine/Gateway. */
export async function selectionServer() {
  const rounds: SelectionRound[] = [], requests: Request[] = []
  let current: { round: SelectionRound; wait: Promise<void>; step: number; target?: string } | undefined
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-selection' }] })); return }
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected local fixture route ${request.method} ${request.url}`)
      let body = ''; for await (const chunk of request) body += chunk.toString()
      const data: Request = JSON.parse(body); requests.push(data)
      if (!current) throw new Error('No armed selection round')
      const active = current, { round } = active
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const tool = (name: string, args: unknown, id: string) => {
        const wire = modelToolWireName(name)
        if (!data.tools.some(item => item.function.name === wire)) throw new Error(`Missing real tool ${name}`)
        response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: wire, arguments: JSON.stringify(args) } }] }, 'tool_calls'))
      }
      const step = active.step++
      if (round.multi) {
        const multi = round.multi
        if (step === 0) {
          const prefix = '本次固定文档与权限（切换界面不改变它们）：'
          const frozen = data.messages.find(message => typeof message.content === 'string' && message.content.startsWith(prefix))
          if (!frozen) throw new Error('Missing Engine frozen document message')
          round.references = JSON.parse(frozen.content.slice(prefix.length))
          const reference = round.references?.[0]
          if (round.references?.length !== 1 || reference?.selection.length !== multi.replacements.length || reference.writable.length !== multi.replacements.length ||
              !reference.writable.every(target => target.kind === round.kind)) throw new Error('Multi-selection was not frozen as exact writable targets')
          multi.targets = reference.writable.map(target => target.target)
          tool('read', { target: multi.targets[0], limit: 100 }, `${round.id}-read-0`)
        } else {
          const index = Math.floor((step - 1) / 2)
          if (index >= multi.targets.length) throw new Error('Unexpected extra multi-selection request')
          if (step % 2 === 1) {
            const message = data.messages.find(message => message.role === 'tool' && message.tool_call_id === `${round.id}-read-${index}`)
            const result = message ? JSON.parse(message.content) : null
            if (result?.kind !== 'read' || typeof result.data?.text !== 'string' || result.data.truncated) throw new Error(`Exact multi-selection read ${index} failed`)
            multi.readTexts.push(result.data.text)
            tool('text.replace', { target: multi.targets[index], content: multi.replacements[index] }, `${round.id}-edit-${index}`)
          } else {
            const message = data.messages.find(message => message.role === 'tool' && message.tool_call_id === `${round.id}-edit-${index}`)
            const result = message ? JSON.parse(message.content) : null
            multi.results.push(result)
            if (result?.kind !== 'document-operation' || result.result?.status !== 'applied') throw new Error(`Multi-selection edit ${index} failed: ${JSON.stringify(result)}`)
            if (index + 1 < multi.targets.length) tool('read', { target: multi.targets[index + 1], limit: 100 }, `${round.id}-read-${index + 1}`)
            else {
              round.returned = multi.results
              response.write(event({ role: 'assistant', content: `${round.id} 已返回正式结果。` }, 'stop'))
            }
          }
        }
        response.end('data: [DONE]\n\n')
        return
      }
      if (step === 0) {
        const prefix = '本次固定文档与权限（切换界面不改变它们）：'
        const frozen = data.messages.find(message => typeof message.content === 'string' && message.content.startsWith(prefix))
        if (!frozen) throw new Error('Missing Engine frozen document message')
        round.references = JSON.parse(frozen.content.slice(prefix.length))
        const writable = round.references?.[0]?.writable ?? [], exact = writable.filter(target => target.kind === round.kind)
        const extra = writable.filter(target => target.kind !== round.kind)
        if (round.references?.length !== 1 || exact.length !== 1 || extra.length !== (round.documentWritable ? 1 : 0) || extra.some(target => target.kind !== 'document'))
          throw new Error(round.documentWritable ? 'Main-chat reference did not freeze the selection plus exactly one whole-document write' : 'Local edit did not freeze exactly one expected writable range/object')
        active.target = exact[0]!.target
        tool('read', { target: active.target, limit: 100 }, `${round.id}-read`)
      } else if (active.step === 2) {
        const message = data.messages.find(message => message.role === 'tool' && message.tool_call_id === `${round.id}-read`)
        const result = message ? JSON.parse(message.content) : null
        if (result?.kind !== 'read' || typeof result.data?.text !== 'string' || result.data.truncated) throw new Error('Exact target read failed or was truncated')
        round.readText = result.data.text
        const args = JSON.stringify({ target: active.target, content: round.replacement }), wire = modelToolWireName('text.replace')
        if (!data.tools.some(item => item.function.name === wire)) throw new Error('Missing text.replace')
        // Incomplete final parameter keeps canonical content untouched until release.
        response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id: `${round.id}-edit`, type: 'function', function: { name: wire, arguments: args.slice(0, -2) } }] }))
        round.held = true; await active.wait
        response.write(event({ tool_calls: [{ index: 0, function: { arguments: args.slice(-2) } }] }, 'tool_calls'))
      } else if (active.step === 3) {
        const result = data.messages.find(message => message.role === 'tool' && message.tool_call_id === `${round.id}-edit`)
        round.returned = result ? JSON.parse(result.content) : null
        response.write(event({ role: 'assistant', content: `${round.id} 已返回正式结果。` }, 'stop'))
      } else throw new Error('Unexpected extra fixture request')
      response.end('data: [DONE]\n\n')
    } catch (error) {
      if (current) current.round.error = String(error)
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: String(error) } }))
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, rounds, requests,
    arm(id: string, kind: string, replacement: string, options: { documentWritable?: boolean } = {}) {
      if (current && !current.round.returned) throw new Error('Previous round has not returned')
      let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve })
      const round: SelectionRound = { id, kind, replacement, held: false, release, ...(options.documentWritable ? { documentWritable: true } : {}) }; rounds.push(round)
      current = { round, wait, step: 0 }; return round
    },
    armMulti(id: string, kind: string, replacements: string[]) {
      if (current && !current.round.returned) throw new Error('Previous round has not returned')
      if (replacements.length < 2) throw new Error('Multi-selection fixture needs at least two replacements')
      const round: SelectionRound = { id, kind, replacement: '', held: false, release() {}, multi: { replacements, targets: [], readTexts: [], results: [] } }
      rounds.push(round); current = { round, wait: Promise.resolve(), step: 0 }; return round
    },
    async close() { for (const round of rounds) round.release(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}

export function selectionFixtures() {
  const base = join(root, 'output/g20/m04'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'selection-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  writeFileSync(join(workspace, 'selection.md'), markdownSource)
  const driver = new CourseV9Driver(), named = createNamedSelectionFixture()
  writeFileSync(join(workspace, 'named-selection.h5lesson'), driver.serialize(named.model))
  const flow = createBlankFlowSurface({ id: 'selection-flow', title: '选区讲义', headingId: 'flow-heading', paragraphId: 'flow-a' })
  flow.surface.blocks[1] = { id: 'flow-a', type: 'paragraph', content: { inlines: [{ type: 'text', text: '甲段：先预测😀，再观察。' }] } }
  flow.surface.blocks.push({ id: 'flow-b', type: 'paragraph', content: { inlines: [{ type: 'text', text: '乙段：保持原样。' }] } })
  const flowProject = courseProjectDocumentSchema.parse({ ...createBlankCourseProject({ includeDefaultController: false, controls: 'none' }), surfaces: [flow.surface], locations: [flow.location], startLocationId: flow.location.id })
  writeFileSync(join(workspace, 'flow.h5lesson'), driver.serialize({ kind: 'course-v9', project: flowProject, resources: { assets: {}, components: {} } }))
  const worldItems = structuredClone(named.scene.layerItems)
  worldItems[0].layerItemId = 'world-a'; worldItems[0].frame = { ...worldItems[0].frame, x: 80, y: 80, width: 400, height: 90 }
  worldItems[1].layerItemId = 'world-b'; worldItems[1].frame = { ...worldItems[1].frame, x: 80, y: 240, width: 400, height: 90 }
  const spatialProject = courseProjectDocumentSchema.parse({ ...createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
    locations: [{ id: 'spatial-home', label: '选区画布', kind: 'spatial-camera', surfaceId: 'selection-spatial', cameraFrameId: 'spatial-home' }], startLocationId: 'spatial-home',
    surfaces: [{ id: 'selection-spatial', type: 'spatial-2d', title: '选区画布', backgroundColor: '#ffffff', surfaceLayerItems: [],
      world: { bounds: { mode: 'infinite' }, layerItems: worldItems, paths: [], relations: [] }, camera: { home: { x: 0, y: 0, zoom: 1 }, frames: [{ id: 'spatial-home', name: '全景', x: 0, y: 0, zoom: 1 }] }, semanticZoom: [] }] })
  writeFileSync(join(workspace, 'spatial.h5lesson'), driver.serialize({ kind: 'course-v9', project: spatialProject, resources: { assets: {}, components: {} } }))
  return { directory, workspace, named }
}

export async function launchSelectionApp(directory: string) {
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))
  return app
}
export async function setupSelectionUI(app: ElectronApplication, page: Page, endpoint: string, workspace: string) {
  await page.getByRole('button', { name: '切换模型', exact: true }).click()
  await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
  await page.getByLabel('供应商标识', { exact: true }).fill('fixture-selection')
  await page.getByLabel('账号标识', { exact: true }).fill('local-selection')
  await page.getByLabel('API 地址', { exact: true }).fill(endpoint)
  await page.getByLabel('API Key', { exact: true }).fill('fixture-only-no-real-account')
  await page.getByRole('button', { name: '保存连接', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()
  const settings = await page.evaluate(() => window.desktopAPI.executionSettings!.read())
  await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
  await page.getByLabel('对话与规划连接', { exact: true }).selectOption(settings.connections[0].connection.id)
  await page.getByLabel('对话与规划模型', { exact: true }).selectOption('fixture-selection')
  await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
  await expect(page.getByText('模型角色已保存', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, workspace)
  await page.getByLabel('切换工作空间', { exact: true }).click()
  await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
}
export async function openSelectionFile(page: Page, workspace: string, name: string): Promise<DocumentSnapshot> {
  const back = page.getByRole('button', { name: '返回轻量编辑', exact: true })
  if (await back.isVisible()) await back.click()
  await page.locator('.lesson-directory-tree').getByRole('button', { name, exact: true }).dblclick()
  await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toHaveAttribute('aria-selected', 'true')
  const filename = join(workspace, name)
  // Observation only: do not open or inject a renderer selection via IPC.
  await expect.poll(() => page.evaluate(async filename => (await window.desktopAPI.documents!.list()).some(item => item.binding.kind === 'file' && item.binding.path.toLowerCase() === filename.toLowerCase()), filename)).toBe(true)
  return page.evaluate(async filename => (await window.desktopAPI.documents!.list()).find(item => item.binding.kind === 'file' && item.binding.path.toLowerCase() === filename.toLowerCase())!, filename)
}
export const readSelectionDocument = (page: Page, id: string) => page.evaluate(id => window.desktopAPI.documents!.read(id), id)

/** Reads text geometry only. The actual browser selection is made by mouse, never Range.addRange/PM/controller injection. */
export async function selectVisibleText(page: Page, editor: Locator, text: string) {
  const card = page.getByLabel('当前编辑目标', { exact: true })
  // Collapse the floating card without dismissing its pinned target. Its public
  // close button has a different accessible name and would clear that target.
  if (await card.isVisible()) await card.getByRole('button', { name: '保留目标', exact: true }).click()
  await editor.scrollIntoViewIfNeeded()
  const points = await editor.evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const from = (node.textContent ?? '').indexOf(text)
      if (from < 0) continue
      const start = document.createRange(), end = document.createRange()
      start.setStart(node, from); start.setEnd(node, from + 1)
      end.setStart(node, from + text.length - 1); end.setEnd(node, from + text.length)
      const a = start.getBoundingClientRect(), b = end.getBoundingClientRect()
      return { ax: a.left + 0.1, ay: a.top + a.height / 2, bx: b.right - 0.1, by: b.top + b.height / 2 }
    }
    throw new Error(`No visible text ${text}`)
  }, text)
  await page.mouse.move(points.ax, points.ay); await page.mouse.down()
  await page.mouse.move(points.bx, points.by, { steps: 10 }); await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text)
}
export async function heldRound(round: SelectionRound) {
  await expect.poll(() => round.error ?? round.held).toBe(true)
  expect(round.references?.[0].selection.map(item => item.kind)).toEqual([round.kind])
}
export async function finishRound(page: Page, round: SelectionRound) {
  round.release()
  await expect(page.getByText(`${round.id} 已返回正式结果。`, { exact: true })).toBeVisible()
  expect(round.error).toBeUndefined()
  expect(round.returned).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
}
export async function closeSelectionApp(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
  await app.close().catch(() => {})
}
