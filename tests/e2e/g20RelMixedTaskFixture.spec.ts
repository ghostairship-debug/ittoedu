import { _electron as electron, chromium, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { summarizeRelMixedRun } from './helpers/g20RelMixedEvidence'

const root = resolve(__dirname, '../..'), model = 'fixture-text-model'
const runtimeSource = `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
  const button=document.createElement('button');let clicks=0;button.type='button';
  button.dataset.relMixedQuiz='true';button.textContent='显示答案';
  button.style.cssText='pointer-events:auto;width:100%;height:100%;font:28px sans-serif;cursor:pointer';
  button.onclick=()=>{button.textContent='答案：光合作用把光能转化为化学能 '+(++clicks)};
  ctx.dom.root.appendChild(button);return {destroy(){button.onclick=null;button.remove()}};
}});`
const item = {
  kind: 'runtime', layerItemId: 'rel-mixed-quiz', label: '光合作用互动测验',
  frame: { mode: 'absolute', x: 80, y: 440, width: 540, height: 150 }, order: 30,
  visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
  runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
    content: { values: {} }, assets: {}, source: runtimeSource },
}
const sse = (id: string, delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const results = (payload: any) => payload.messages.filter((entry: any) => entry.role === 'tool').map((entry: any) => JSON.parse(entry.content))
const wire = (payload: any, name: string) => {
  const result = payload.tools.find((entry: any) => entry.function.name === modelToolWireName(name))
  if (!result) throw new Error(`Tool not advertised: ${name}`)
  return result.function.name as string
}
function tools(response: ServerResponse, id: string, calls: { id: string; name: string; input: unknown }[]) {
  response.write(sse(id, { role: 'assistant', tool_calls: calls.map((call, index) => ({ index, id: call.id, type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.input) } })) }, 'tool_calls'))
  response.end('data: [DONE]\n\n')
}

test('REL-T11 local fixture: one built-in run creates from material, edits pages, generates an image, repairs a Runtime and exports', async ({}, info) => {
  test.setTimeout(360_000)
  const output = join(root, 'output/g20/rel-t11'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'fixture-')), workspace = join(directory, 'workspace')
  mkdirSync(workspace)
  const materialPath = join(workspace, '光合作用材料.md'), coursePath = join(workspace, '光合作用互动课件.h5lesson')
  const htmlPath = join(directory, '光合作用互动课件.html')
  writeFileSync(materialPath, '# 光合作用\n植物吸收阳光、二氧化碳和水，将光能转化为化学能，释放氧气。\n课堂目标：先预测，再点击互动揭示答案。')
  const picture = await sharp({ create: { width: 128, height: 96, channels: 4, background: '#22c55e' } }).png().toBuffer()
  const requestSteps: string[] = [], failures: string[] = []
  let turn = 0, course = '', rootTarget = '', surface = '', firstLocation = '', secondLocation = '', owner = '', imageResource = '', job = '', artifact = ''
  const server = createServer((request, response) => { void (async () => {
    let body = ''; for await (const part of request) body += part.toString()
    const payload = JSON.parse(body)
    if (request.url === '/backend-api/codex/images/generations') {
      expect(request.headers.authorization).toBe('Bearer fixture-image-access')
      expect(request.headers['chatgpt-account-id']).toBe('fixture-image-account')
      expect(payload.model).toBe('fixture-image-model')
      requestSteps.push('image.http')
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ created: 123, data: [{ b64_json: picture.toString('base64') }], output_format: 'png' }))
      return
    }
    expect(request.url).toBe('/v1/chat/completions'); expect(payload.model).toBe(model)
    turn++; const id = `rel-mixed-${turn}`, r = results(payload), last = r.at(-1)
    const send = (name: string, input: unknown) => { requestSteps.push(name); tools(response, id, [{ id: `${name}-${turn}`, name: wire(payload, name), input }]) }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    switch (turn) {
      case 1: send('file.open', { path: '光合作用材料.md' }); break
      case 2: send('read', { target: last.data.target }); break
      case 3:
        expect(last.data.text).toContain('光能转化为化学能')
        send('file.create', { name: '光合作用互动课件.h5lesson', kind: 'course-v9' }); break
      case 4:
        expect(last.data.operation.status).toBe('success'); course = last.data.documentId; rootTarget = last.data.target
        send('tools.load', { families: ['content', 'navigation', 'media', 'build'] }); break
      case 5: expect(last.data.loaded).toContain('build'); send('listChildren', { target: rootTarget }); break
      case 6:
        firstLocation = last.data.find((child: any) => child.kind === 'course-location')?.target
        surface = last.data.find((child: any) => child.kind === 'course-surface')?.target
        expect(firstLocation && surface).toBeTruthy()
        send('slide.create', { target: surface, title: '观察与解释' }); break
      case 7: expect(last.result.status).toBe('applied'); send('listChildren', { target: rootTarget }); break
      case 8:
        secondLocation = last.data.filter((child: any) => child.kind === 'course-location').at(-1)?.target
        expect(secondLocation).toBeTruthy(); send('listChildren', { target: firstLocation }); break
      case 9:
        owner = last.data.find((child: any) => child.kind === 'course-owner')?.target
        expect(owner).toBeTruthy(); send('native.insert', { target: owner, template: { nativeType: 'text',
          text: '先预测：植物怎样把阳光变成可储存的能量？', x: 80, y: 80, width: 1050, height: 130,
          style: { fontSize: 38, color: '#1e293b' } } }); break
      case 10: expect(last.result.status).toBe('applied'); send('listChildren', { target: secondLocation }); break
      case 11:
        owner = last.data.find((child: any) => child.kind === 'course-owner')?.target
        send('native.insert', { target: owner, template: { nativeType: 'text',
          text: '点击下方按钮后解释：光合作用将光能转化为化学能，并释放氧气。',
          x: 80, y: 80, width: 1080, height: 140, style: { fontSize: 32, color: '#1e293b' } } }); break
      case 12: expect(last.result.status).toBe('applied'); send('inspect', { target: rootTarget }); break
      case 13: rootTarget = last.data.target; send('image.generate', { target: rootTarget, prompt: '绿色叶片与阳光的简洁教学插图', output: { format: 'png' } }); break
      case 14:
        expect(last.data.status).toBe('ready'); imageResource = last.data.resources[0]?.resource
        expect(imageResource).toBeTruthy(); send('listChildren', { target: secondLocation }); break
      case 15:
        owner = last.data.find((child: any) => child.kind === 'course-owner')?.target
        send('media.insert', { target: owner, resource: imageResource, properties: { x: 780, y: 270, width: 360, height: 270, fit: 'contain' } }); break
      case 16: expect(last.result.status).toBe('applied'); send('inspect', { target: rootTarget }); break
      case 17: rootTarget = last.data.target; send('build.create', { target: rootTarget }); break
      case 18: job = last.data.job; expect(job).toBeTruthy(); send('build.read', { job, path: 'project.json', limit: 65536 }); break
      case 19: {
        const project = JSON.parse(last.data.content)
        const slide = project.surfaces.find((entry: any) => entry.type === 'slide')
        expect(slide.scenes.length).toBeGreaterThanOrEqual(2)
        const fallback = Object.values(project.assets).find((asset: any) => asset.kind === 'image') as { id?: string } | undefined
        expect(fallback?.id).toBeTruthy()
        slide.scenes.at(-1).layerItems.push({ ...item, runtime: { ...item.runtime,
          staticFallback: { assetId: fallback!.id, coverage: 'surface' } } })
        // Preserve the candidate between HTTP responses in this one controlled fixture.
        candidateProject = JSON.stringify(project)
        requestSteps.push('build.write:broken', 'build.compile:broken')
        tools(response, id, [
          { id: 'broken-runtime', name: wire(payload, 'build.write'), input: { job, path: 'runtime.js', content: 'CoursewareRuntime.define({create:function( })' } },
          { id: 'broken-compile', name: wire(payload, 'build.compile'), input: { job, path: 'runtime.js', kind: 'runtime' } },
        ]); break
      }
      case 20: expect(last.data.ok).toBe(false); send('build.logs', { job, after: 0, limit: 100 }); break
      case 21:
        expect(last.data.entries.some((entry: any) => entry.level === 'error')).toBe(true)
        requestSteps.push('build.write:repair', 'build.write:project', 'build.compile:repaired')
        tools(response, id, [
          { id: 'fix-runtime', name: wire(payload, 'build.write'), input: { job, path: 'runtime.js', content: runtimeSource } },
          { id: 'fix-project', name: wire(payload, 'build.write'), input: { job, path: 'project.json', content: candidateProject } },
          { id: 'fixed-compile', name: wire(payload, 'build.compile'), input: { job, path: 'runtime.js', kind: 'runtime' } },
        ]); break
      case 22: expect(last.data.ok).toBe(true); send('build.check', { job }); break
      case 23: expect(last.data.status).toBe('ready'); artifact = last.data.artifact; send('build.import', { job, artifact }); break
      case 24:
        expect(last.result.status).toBe('applied'); requestSteps.push('completed')
        response.end(sse(id, { role: 'assistant', content: '课件和互动已完成，可以导出。' }, 'stop') + 'data: [DONE]\n\n'); break
      default: throw new Error(`Unexpected model turn ${turn}`)
    }
  })().catch(error => { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)); response.destroy() }) })
  let candidateProject = ''
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const app = await electron.launch({ cwd: root, args: [join(root, 'tests/e2e/helpers/g20ImageResultsBootstrap.cjs'), `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', G20_IMAGE_HTTP_FIXTURE: endpoint, [BACKGROUND_E2E_ENV]: '1' } })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  const startedAt = Date.now()
  try {
    await app.evaluate(async () => { await (globalThis as any).__G20_IMAGE_RESULTS_FIXTURE__.ready })
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000)
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const prepared = await page.evaluate(async workspace => {
      const execution = window.desktopAPI!.execution!, space = await execution.workspace(workspace)
      const conversation = space.conversations[0] ?? await execution.createConversation(space.workspace.workspaceId)
      return { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId, revision: conversation.revision }
    }, workspace)
    const instruction = '读取光合作用材料，创建两页 V9 课件，加入文字和生成图片；构建可点击揭示答案的互动，先观察一次编译错误再修复、准入并导入。'
    const runId = await page.evaluate(async input => {
      const execution = window.desktopAPI!.execution!, submissionId = input.submissionId
      const sent = await execution.send({ workspaceId: input.prepared.workspaceId, conversationId: input.prepared.conversationId,
        expectedRevision: input.prepared.revision,
        submissionId, text: input.instruction, documents: [], attachments: [] })
      return sent.run?.runId ?? null
    }, { prepared, instruction, submissionId: randomUUID() })
    expect(runId).toBeTruthy()
    await expect.poll(async () => {
      if (failures.length) throw new Error(failures.join('\n'))
      const run = await page.evaluate(async id => window.desktopAPI!.execution!.run(id), runId!)
      return run && ['completed', 'partial', 'failed', 'stopped'].includes(run.status) ? run.status : null
    }, { timeout: 240_000, intervals: [1000, 2000] }).toBe('completed')
    const run = await page.evaluate(async id => window.desktopAPI!.execution!.run(id), runId!)
    const receipts = summarizeRelMixedRun(run!)
    expect(receipts.imageReady).toBe(true)
    expect(receipts.mediaLinked).toBe(true)
    expect(receipts.compile).toMatchObject({ failed: true, fixedAfterFailure: true })
    expect(receipts.build).toMatchObject({ checkReady: true, importAppliedAfterReady: true })
    expect(receipts.firstPass).toBe(false)
    expect(receipts.repairedSuccess).toBe(true)
    const snapshot = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), course)
    expect(run?.tools.map(entry => entry.call.name)).toEqual(expect.arrayContaining(['file.create', 'slide.create', 'native.insert', 'image.generate', 'media.insert', 'build.import']))
    expect(snapshot.model.kind).toBe('course-v9')
    if (snapshot.model.kind !== 'course-v9') throw new Error('Expected V9 course')
    expect(snapshot.model.project.locations.length).toBeGreaterThanOrEqual(2)
    expect(snapshot.model.project.surfaces.some(surface => surface.type === 'slide' && surface.scenes.some(scene => scene.layerItems.some(layer => layer.layerItemId === 'rel-mixed-quiz')))).toBe(true)
    await page.evaluate(async id => { await window.desktopAPI!.documents!.save(id); await window.desktopAPI!.documents!.close(id) }, course)
    const reopened = await page.evaluate(async filename => window.desktopAPI!.documents!.open(filename), coursePath)
    expect(reopened.dirty).toBe(false)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    expect(archive.project.locations.length).toBeGreaterThanOrEqual(2)
    const admitted = archive.project.surfaces.flatMap(surface => surface.type === 'slide'
      ? surface.scenes.flatMap(scene => scene.layerItems) : []).find(layer => layer.layerItemId === 'rel-mixed-quiz')
    if (admitted?.kind !== 'runtime') throw new Error('Runtime was not imported')
    const fallbackId = admitted.runtime.staticFallback?.assetId
    expect(fallbackId).toMatch(/^runtime-capture-/)
    const fallbackBytes = archive.assetFiles[fallbackId!]
    expect(fallbackBytes?.byteLength).toBeGreaterThan(100)
    expect((await sharp(fallbackBytes).metadata()).format).toBe('png')
    const tree = page.locator('.lesson-directory-tree')
    await tree.getByRole('button', { name: '光合作用互动课件.h5lesson', exact: true }).dblclick()
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, htmlPath)
    await page.getByTestId('export-menu-trigger').click()
    await page.getByTestId('export-single-html').click()
    const preflight = page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
    await expect(preflight).toContainText('0 个错误')
    await preflight.getByRole('button', { name: '继续导出' }).click()
    const sizeDialog = page.getByRole('alertdialog', { name: '单 HTML 文件较大' })
    if (await sizeDialog.isVisible().catch(() => false)) await sizeDialog.getByRole('button', { name: '仍导出单 HTML' }).click()
    await expect.poll(() => existsSync(htmlPath) ? readFileSync(htmlPath).byteLength : 0, { timeout: 120_000 }).toBeGreaterThan(100_000)
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ offline: true })
    const exported = await context.newPage(), errors: string[] = []
    exported.on('pageerror', error => errors.push(error.message))
    await exported.goto(pathToFileURL(htmlPath).href)
    await exported.keyboard.press('PageDown')
    const quiz = exported.locator('[data-rel-mixed-quiz="true"]')
    await expect(quiz).toHaveText('显示答案')
    await quiz.click()
    await expect(quiz).toContainText('光合作用把光能转化为化学能')
    expect(errors).toEqual([])
    const evidence = join(directory, 'evidence.json')
    writeFileSync(evidence, JSON.stringify({ caseId: 'REL-T11', route: 'local-fixture', paidRequests: 0,
      runId, runStatus: run?.status, requests: turn, toolSteps: requestSteps, serverFailures: failures,
      receipts,
      imageRequests: requestSteps.filter(step => step === 'image.http').length, revision: snapshot.revision,
      reopenedClean: !reopened.dirty, locations: snapshot.model.project.locations.length,
      exportedHtml: htmlPath, offlineInteraction: true, elapsedMs: Date.now() - startedAt,
      fixtureExecution: 'completed', repair: 'scripted compile error then model-side build repair', manualIntervention: ['test fixture setup', 'UI export after run'],
      charge: 0, scope: 'deterministic local fixture only; does not prove real-model quality' }, null, 2))
    await info.attach('REL-T11 local fixture evidence', { path: evidence, contentType: 'application/json' })
    await context.close()
  } finally {
    await browser?.close().catch(() => undefined)
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
    await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  }
})
