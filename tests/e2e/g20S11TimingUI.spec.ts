import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import type { ExecutionTimingMark } from '../../src/main/workbench/execution/ExecutionEventStore'
import { answerG20VisionCapabilityProbe } from '../helpers/g20CapabilityProbeFixture'

const root = resolve(__dirname, '../..')

function timingTraces(profile: string): { conversationId: string; taskId: string; marks: ExecutionTimingMark[] }[] {
  const directory = join(profile, 'workbench-v2', 'events')
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => {
    const timing = join(directory, entry.name, 'timing')
    if (!existsSync(timing)) return []
    return readdirSync(timing).filter(name => name.endsWith('.json')).map(name =>
      JSON.parse(readFileSync(join(timing, name), 'utf8')) as { conversationId: string; taskId: string; marks: ExecutionTimingMark[] })
  })
}

function required(marks: ExecutionTimingMark[], stage: ExecutionTimingMark['stage']): ExecutionTimingMark {
  const found = marks.find(mark => mark.stage === stage)
  if (!found) throw new Error(`Missing ${stage}`)
  return found
}

test('S11 renderer click, PNG submission read/compile and first visible reply retain distinct monotonic clocks', async ({}, info) => {
  test.setTimeout(120_000)
  const output = join(root, 'output/g20/s11/timing-ui'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), profile = join(directory, 'profile')
  const image = join(directory, 'timing-image.png')
  const png = await sharp({ create: { width: 29, height: 17, channels: 4, background: '#377fc2' } }).png().toBuffer()
  writeFileSync(image, png)
  const requests: any[] = [], wireErrors: string[] = []
  let probes = 0
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/v1/models') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'fixture-s11-vision' }] }))
        return
      }
      let body = ''; for await (const chunk of request) body += chunk.toString()
      const payload = JSON.parse(body)
      const probe = await answerG20VisionCapabilityProbe(payload)
      if (probe !== null) probes++
      else requests.push(payload)
      const content = probe ?? 'S11 可见回复已到达。'
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ id: 'timing-reply', model: 'fixture-s11-vision', choices: [{ index: 0,
        delta: { role: 'assistant', content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    } catch (error) { wireErrors.push(String(error)); response.writeHead(500); response.end('fixture failed') }
  })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000)
    const rendererErrors: string[] = []; page.on('pageerror', error => rendererErrors.push(error.message))
    await expect(page.getByLabel('给创作助手发消息')).toBeVisible()
    await page.getByRole('button', { name: '切换模型', exact: true }).click()
    await page.getByRole('button', { name: '管理模型与连接…', exact: true }).click()
    await page.getByLabel('供应商标识', { exact: true }).fill('fixture-s11')
    await page.getByLabel('账号标识', { exact: true }).fill('local-fixture')
    await page.getByLabel('API 地址', { exact: true }).fill(endpoint)
    await page.getByLabel('API Key', { exact: true }).fill('fixture-local-not-secret')
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '连接设置已保存' })).toBeVisible()
    const settings = await page.evaluate(() => window.desktopAPI!.executionSettings!.read())
    const connectionId = settings.connections.find(entry => entry.connection.provider === 'fixture-s11')?.connection.id
    expect(connectionId).toBeTruthy()
    await page.getByText('高级：分别指定视觉和图片模型', { exact: true }).click()
    await page.getByLabel('对话与规划连接', { exact: true }).selectOption(connectionId!)
    await page.getByLabel('对话与规划模型', { exact: true }).selectOption('fixture-s11-vision')
    await page.getByLabel('视觉理解连接', { exact: true }).selectOption(connectionId!)
    await page.getByLabel('视觉理解模型', { exact: true }).selectOption('fixture-s11-vision')
    await page.getByRole('button', { name: '保存模型角色', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '模型角色已保存' })).toBeVisible()
    await page.getByRole('button', { name: '验证视觉理解视觉能力', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '视觉能力已验证' })).toBeVisible()
    await page.getByRole('button', { name: '关闭模型连接设置', exact: true }).click()
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }) }, image)
    const composer = page.locator('.attachment-composer')
    await composer.getByRole('button', { name: '添加', exact: true }).click(); await composer.getByRole('menuitem', { name: '添加附件（图片或文档）', exact: true }).click()
    await expect(composer.getByText('timing-image.png', { exact: true })).toBeVisible()
    const input = page.getByLabel('给创作助手发消息')
    await input.fill('描述附件图像')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect(page.getByText('S11 可见回复已到达。', { exact: true })).toBeVisible()
    const renderer = ['renderer.submit.clicked', 'renderer.send.invoked', 'renderer.first-visible'] as const
    const main = ['submit.received', 'submission.prepare.started', 'submission.attachments.started',
      'submission.attachments.finished', 'submission.prepare.finished', 'engine.prepare.started',
      'payload.compile.started', 'payload.compile.finished', 'request.prepared', 'request.dispatched',
      'provider.first-event', 'provider.first-content', 'run.ended'] as const
    const expectedStages: ExecutionTimingMark['stage'][] = [...renderer, ...main]
    await expect.poll(() => {
      const traces = timingTraces(profile).filter(value => value.marks.some(mark => mark.stage === 'renderer.submit.clicked'))
      if (traces.length !== 1) return expectedStages
      return expectedStages.filter(stage => !traces[0]!.marks.some(mark => mark.stage === stage))
    }).toEqual([])
    const trace = timingTraces(profile).find(value => value.marks.some(mark => mark.stage === 'renderer.submit.clicked'))!
    const marks = trace.marks
    for (const stages of [renderer, main]) {
      const sequence = stages.map(stage => required(marks, stage))
      expect(sequence.map(mark => mark.monotonicMs)).toEqual([...sequence.map(mark => mark.monotonicMs)].sort((a, b) => a - b))
      expect(new Set(sequence.map(mark => `${mark.process}:${mark.clockInstanceId}`)).size).toBe(1)
    }
    expect(required(marks, 'renderer.submit.clicked').process).toBe('renderer')
    expect(required(marks, 'submit.received').process).toBe('main')
    expect(required(marks, 'submit.received').detail).toMatchObject({ clockOffsetMethod: 'timeOrigin' })
    expect(Number.isFinite(required(marks, 'submit.received').detail?.clockOffsetEstimateMs)).toBe(true)
    expect(required(marks, 'submission.attachments.finished').detail).toMatchObject({ imageCount: 1,
      representationBytes: png.byteLength, outcome: 'completed' })
    expect(required(marks, 'payload.compile.finished').detail).toMatchObject({ imageCount: 1,
      imageBytes: png.byteLength, outcome: 'completed' })
    const imageParts = requests.flatMap(payload => payload.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : []))
      .filter((part: any) => part.type === 'image_url')
    expect(imageParts).toHaveLength(1)
    expect(createHash('sha256').update(Buffer.from(imageParts[0].image_url.url.split(',')[1], 'base64')).digest('hex'))
      .toBe(createHash('sha256').update(png).digest('hex'))
    expect(probes).toBe(1)
    expect(wireErrors).toEqual([]); expect(rendererErrors).toEqual([])
    await page.screenshot({ path: join(directory, 'first-visible-reply.png') })
    writeFileSync(join(directory, 'timing-evidence.json'), JSON.stringify({ conversationId: trace.conversationId, taskId: trace.taskId,
      marks, probes, providerRequests: requests.length, imageBytes: png.byteLength,
      notes: ['Cross-process timeOrigin offset is an estimate; monotonic durations are compared only inside each process.',
        'Attachment intake pixel decoding/resizing happens before this send trace; submission marks cover representation read and payload compilation.',
        'request.dispatched records provider adapter entry, not HTTP connection or byte send.',
        'renderer.first-visible is a visible text DOM observation after frame opportunities, not a GPU presentation acknowledgement.'] }, null, 2))
    await info.attach('s11-timing', { path: join(directory, 'timing-evidence.json'), contentType: 'application/json' })
    await info.attach('first-visible-reply', { path: join(directory, 'first-visible-reply.png'), contentType: 'image/png' })
  } catch (error) {
    const page = app.windows()[0]
    if (page) await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => undefined)
    writeFileSync(join(directory, 'failure.json'), JSON.stringify({ requests: requests.length, probes, wireErrors,
      traces: timingTraces(profile) }, null, 2))
    throw error
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
    server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  }
})
