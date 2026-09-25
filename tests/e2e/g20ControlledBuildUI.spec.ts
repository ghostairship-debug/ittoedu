import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { componentPackageKey } from '../../src/core/drivers/codecs/archivePath'
import { componentContentSha256 } from '../../src/shared/componentContentIntegrity'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'

const root = resolve(__dirname, '../..')
const packageId = 'com.example.v9-quiz', packageVersion = '4.0.0', instanceId = 'slide-quiz'
const packageKey = componentPackageKey(packageId, packageVersion)
const runtimePath = `components/${packageId}@${packageVersion}/runtime.js`
const validRuntime = `window.CoursewareComponent.define({
  id:'${packageId}',runtimeApiVersion:4,
  create:function(ctx){
    var button=document.createElement('button');button.type='button';button.textContent='显示答案';
    button.style.cssText='pointer-events:auto;width:100%;min-height:72px;border:0;border-radius:14px;background:#075985;color:white;font:28px sans-serif;cursor:pointer';
    var answer=document.createElement('p');answer.textContent='答案尚未显示';answer.style.cssText='font:24px sans-serif;color:#172554';
    button.onclick=function(){answer.textContent='正确答案：受控构建已通过真实宿主。'};
    ctx.dom.root.style.pointerEvents='auto';ctx.dom.root.replaceChildren(button,answer);
    return {update:function(){},resize:function(){},suspend:function(){},resume:function(){},destroy:function(){button.onclick=null;ctx.dom.root.replaceChildren()}};
  }
});`
const brokenRuntime = "window.CoursewareComponent.define({create:function("
const event = (id: string, delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id, model: 'fixture-controlled-build',
  choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const toolResults = (payload: any) => payload.messages.filter((message: any) => message.role === 'tool').map((message: any) => JSON.parse(message.content))
const wire = (payload: any, description: string) => {
  const found = payload.tools.find((tool: any) => tool.function.description.startsWith(description))
  if (!found) throw new Error(`missing tool: ${description}`)
  return found.function.name as string
}
function call(response: ServerResponse, id: string, calls: Array<{ id: string; name: string; input: unknown }>) {
  response.write(event(id, { role: 'assistant', tool_calls: calls.map((value, index) => ({ index, id: value.id, type: 'function',
    function: { name: value.name, arguments: JSON.stringify(value.input) } })) }, 'tool_calls'))
  response.end('data: [DONE]\n\n')
}
function done(response: ServerResponse, id: string) {
  response.write(event(id, { role: 'assistant', content: '组件源码已修复、通过独立宿主准入并正式导入。' }, 'stop'))
  response.end('data: [DONE]\n\n')
}

test('S13 real Engine repairs a controlled Component build, admits it in the real host and imports one reversible History entry', async ({}, info) => {
  test.setTimeout(300_000)
  const output = join(root, 'output/g20/b05/controlled-build-ui'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const coursePath = join(workspace, '受控构建课件.h5lesson')
  const sourceArchive = openCourseProjectArchive(new Uint8Array(readFileSync(join(root, 'tests/fixtures/course-project-v9/component.h5lesson'))))
  const fallback = new Uint8Array(await sharp({ create: { width: 400, height: 240, channels: 4, background: '#dbeafe' } }).png().toBuffer())
  const baselineProject = structuredClone(sourceArchive.project), fallbackMeta = baselineProject.assets['quiz-fallback']
  if (!fallbackMeta || fallbackMeta.kind !== 'image') throw new Error('component fixture fallback missing')
  baselineProject.assets['quiz-fallback'] = { ...fallbackMeta, mimeType: 'image/png', byteLength: fallback.byteLength, width: 400, height: 240 }
  const baselineArchive = { project: baselineProject, assetFiles: { ...sourceArchive.assetFiles, 'quiz-fallback': fallback },
    componentFiles: sourceArchive.componentFiles }
  writeFileSync(coursePath, createCourseProjectArchive(baselineArchive))
  const originalFiles = baselineArchive.componentFiles[packageKey]
  if (!originalFiles?.['runtime.js']) throw new Error('component fixture package missing')
  const candidateFiles = { ...originalFiles, 'runtime.js': new TextEncoder().encode(validRuntime) }
  const candidateHash = componentContentSha256(candidateFiles), originalHash = baselineArchive.project.componentPackages[packageId]!.contentSha256
  const candidateProject = structuredClone(baselineArchive.project)
  candidateProject.componentPackages[packageId]!.contentSha256 = candidateHash
  const candidateProjectJson = JSON.stringify(candidateProject)

  const requests: any[] = [], serverErrors: string[] = [], observedTools: string[] = []
  const buildEvidence: { compileFailure?: string; admissionLog?: string } = {}
  let requestNumber = 0, job = '', artifact = ''
  let releaseRepair!: () => void, releaseImport!: () => void
  const repairGate = new Promise<void>(resolveRepair => { releaseRepair = resolveRepair })
  const importGate = new Promise<void>(resolveImport => { releaseImport = resolveImport })
  const server = createServer(async (request, response) => {
    try {
      let body = ''; for await (const part of request) body += part.toString()
      const payload = JSON.parse(body); requests.push(payload); requestNumber += 1
      expect(request.method).toBe('POST'); expect(request.url).toBe('/v1/chat/completions'); expect(payload.model).toBe('fixture-controlled-build')
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const id = `controlled-build-${requestNumber}`, results = toolResults(payload)
      if (requestNumber === 1) {
        const fixed = payload.messages.find((message: any) => typeof message.content === 'string' && message.content.startsWith('本次固定文档与权限'))
        const references = JSON.parse(fixed.content.slice(fixed.content.indexOf('：') + 1))
        expect(references).toHaveLength(1); expect(references[0].name).toMatch(/\.h5lesson$/)
        observedTools.push('build.create')
        call(response, id, [{ id: 'build-create', name: wire(payload, '从有整份文档写权限'), input: { target: references[0].target } }])
      } else if (requestNumber === 2) {
        job = results.at(-1).data.job; expect(job).toBeTruthy(); observedTools.push('build.read:list')
        call(response, id, [{ id: 'build-list', name: wire(payload, '读取构建 scratch'), input: { job } }])
      } else if (requestNumber === 3) {
        expect(results.at(-1).data.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: runtimePath })]))
        observedTools.push('build.read:file')
        call(response, id, [{ id: 'build-read-runtime', name: wire(payload, '读取构建 scratch'), input: { job, path: runtimePath, limit: 65536 } }])
      } else if (requestNumber === 4) {
        expect(results.at(-1).data.content).toContain('CoursewareComponent.define'); observedTools.push('build.write:broken')
        call(response, id, [{ id: 'build-write-broken', name: wire(payload, '写入受管 scratch'), input: { job, path: runtimePath, content: brokenRuntime } }])
      } else if (requestNumber === 5) {
        expect(results.at(-1).data.status).toBe('editing'); observedTools.push('build.compile:broken')
        call(response, id, [{ id: 'build-compile-broken', name: wire(payload, '仅对指定 Component/Runtime'), input: { job, path: runtimePath, kind: 'component' } }])
      } else if (requestNumber === 6) {
        expect(results.at(-1).data).toMatchObject({ ok: false, stage: 'syntax-checked' }); observedTools.push('build.logs:failure')
        buildEvidence.compileFailure = results.at(-1).data.message
        call(response, id, [{ id: 'build-failure-logs', name: wire(payload, '分页读取构建日志'), input: { job, after: 0, limit: 100 } }])
      } else if (requestNumber === 7) {
        expect(results.at(-1).data.entries).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'syntax', level: 'error' })]))
        await repairGate
        observedTools.push('build.write:repair', 'build.write:project-hash')
        call(response, id, [
          { id: 'build-write-fixed', name: wire(payload, '写入受管 scratch'), input: { job, path: runtimePath, content: validRuntime } },
          { id: 'build-write-project', name: wire(payload, '写入受管 scratch'), input: { job, path: 'project.json', content: candidateProjectJson } },
        ])
      } else if (requestNumber === 8) {
        expect(results.slice(-2).every((result: any) => result.data.status === 'editing')).toBe(true); observedTools.push('build.compile:fixed')
        call(response, id, [{ id: 'build-compile-fixed', name: wire(payload, '仅对指定 Component/Runtime'), input: { job, path: runtimePath, kind: 'component' } }])
      } else if (requestNumber === 9) {
        expect(results.at(-1).data).toMatchObject({ ok: true, stage: 'syntax-checked' }); observedTools.push('build.check')
        call(response, id, [{ id: 'build-check', name: wire(payload, '执行正式协议、来源、资源闭包'), input: {
          job, buttonCheck: { version: 1, instanceId, label: '显示答案' },
        } }])
      } else if (requestNumber === 10) {
        expect(results.at(-1).data).toMatchObject({ status: 'ready', prepared: true, artifact: expect.any(String) })
        artifact = results.at(-1).data.artifact; observedTools.push('build.logs:admission')
        call(response, id, [{ id: 'build-admission-logs', name: wire(payload, '分页读取构建日志'), input: { job, after: 0, limit: 100 } }])
      } else if (requestNumber === 11) {
        expect(results.at(-1).data.entries).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'admission', level: 'info', message: expect.stringContaining('真实宿主准入完成') })]))
        buildEvidence.admissionLog = results.at(-1).data.entries.find((entry: any) => entry.stage === 'admission' && entry.level === 'info')?.message
        await importGate
        observedTools.push('build.import')
        call(response, id, [{ id: 'build-import', name: wire(payload, '导入已准入 artifact'), input: { job, artifact } }])
      } else if (requestNumber === 12) {
        expect(results.at(-1)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); done(response, id)
      } else throw new Error(`unexpected model request ${requestNumber}`)
    } catch (error) {
      serverErrors.push(error instanceof Error ? error.stack ?? error.message : String(error))
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' })
      response.end('fixture provider assertion failed')
    }
  })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  const admissionWindows = new Set<string>()
  app.on('window', worker => {
    const observe = () => { if (worker.url().includes('/admission.html')) admissionWindows.add(worker.url()) }
    observe(); worker.on('framenavigated', observe)
  })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000)
    const rendererErrors: string[] = []; page.on('pageerror', error => rendererErrors.push(error.message))
    await page.evaluate(async endpoint => {
      const settings = window.desktopAPI!.executionSettings!
      const connection = await settings.saveConnection({ apiKey: 'fixture-key-not-a-real-account', connection: {
        provider: 'fixture-controlled-http', protocol: 'openai-chat', baseURL: endpoint, accountId: 'local-fixture', authKind: 'api-key', billing: { kind: 'unknown' },
      } })
      await settings.saveProfile({ expectedRevision: 0, roles: {
        conversation: { connectionId: connection.connection.id, model: 'fixture-controlled-build' }, vision: null, imageGenerate: null, imageEdit: null,
      } })
    }, endpoint)
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.locator('.lesson-directory-tree')
    await expect(tree.getByRole('button', { name: '受控构建课件.h5lesson', exact: true })).toBeVisible()
    const prepared = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!, execution = window.desktopAPI!.execution!
      const course = await documents.open(input.coursePath)
      const space = await execution.workspace(input.workspace), conversation = space.conversations[0] ?? await execution.createConversation(space.workspace.workspaceId)
      const saved = await execution.draft({ workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: conversation.revision,
        text: '修复组件源码，读取错误后继续检查并正式导入；要求真实点击“显示答案”。',
        documents: [{ documentId: course.documentId, epoch: course.epoch, revision: course.revision, writable: [{ kind: 'document' }] }], attachments: [] })
      return { workspaceId: space.workspace.workspaceId, conversationId: saved.conversationId, documentId: course.documentId,
        revision: course.revision, undoDepth: course.undoDepth }
    }, { workspace, coursePath })
    expect(prepared.undoDepth).toBe(0)
    await page.reload()
    await tree.getByRole('button', { name: '受控构建课件.h5lesson', exact: true }).dblclick()
    await expect(page.locator('.canvas-viewport[data-observation-source="authoring"]')).toHaveAttribute('data-observation-ready', 'true')
    const trial = page.getByRole('button', { name: '当前位置试运行', exact: true })
    await trial.click(); await expect(trial).toHaveAttribute('aria-pressed', 'true')
    const liveHost = page.getByTestId('course-try-run-host'), liveAdapter = liveHost.locator('.slide-published-adapter')
    await expect(liveHost).toHaveAttribute('data-course-player-ready', 'true')
    const liveState = { locationId: await liveAdapter.getAttribute('data-location-id'), stateId: await liveAdapter.getAttribute('data-presentation-state-id') }
    expect(liveState.locationId).toBe('location-scene-1')
    await expect(liveHost.getByRole('button', { name: '显示答案', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue(/修复组件源码/)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(() => {
      if (serverErrors.length) throw new Error(serverErrors.join('\n'))
      return requests.length
    }).toBe(7)
    const failedCandidate = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), prepared.documentId)
    expect(failedCandidate).toMatchObject({ revision: prepared.revision, undoDepth: 0, dirty: false })
    expect(failedCandidate.model).toMatchObject({ kind: 'course-v9', project: { componentPackages: { [packageId]: { contentSha256: originalHash } } } })
    await expect(trial).toHaveAttribute('aria-pressed', 'true')
    await expect(liveAdapter).toHaveAttribute('data-location-id', liveState.locationId!)
    if (liveState.stateId === null) await expect(liveAdapter).not.toHaveAttribute('data-presentation-state-id')
    else await expect(liveAdapter).toHaveAttribute('data-presentation-state-id', liveState.stateId)
    releaseRepair()
    await expect.poll(() => {
      if (serverErrors.length) throw new Error(serverErrors.join('\n'))
      return requests.length
    }, { timeout: 120_000 }).toBe(11)
    await expect.poll(() => admissionWindows.size).toBeGreaterThan(0)
    const admittedButNotImported = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), prepared.documentId)
    expect(admittedButNotImported).toMatchObject({ revision: prepared.revision, undoDepth: 0, dirty: false })
    await expect(trial).toHaveAttribute('aria-pressed', 'true')
    await expect(liveHost).toHaveAttribute('data-course-player-ready', 'true')
    await expect(liveAdapter).toHaveAttribute('data-location-id', liveState.locationId!)
    if (liveState.stateId === null) await expect(liveAdapter).not.toHaveAttribute('data-presentation-state-id')
    else await expect(liveAdapter).toHaveAttribute('data-presentation-state-id', liveState.stateId)
    await expect(liveHost.getByRole('button', { name: '显示答案', exact: true })).toHaveCount(0)
    releaseImport()
    await expect.poll(async () => {
      if (serverErrors.length) throw new Error(serverErrors.join('\n'))
      return page.getByText('组件源码已修复、通过独立宿主准入并正式导入。', { exact: true }).isVisible()
    }, { timeout: 120_000 }).toBe(true)
    await expect.poll(() => requests.length).toBe(12); expect(serverErrors).toEqual([])
    expect(buildEvidence.compileFailure).toBeTruthy()
    expect(buildEvidence.admissionLog).toContain('真实宿主准入完成')

    const history = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!, model = (snapshot: any) => {
        if (snapshot.model.kind !== 'course-v9') throw new Error('expected course document')
        return snapshot.model
      }, source = (snapshot: any) => {
        const files = model(snapshot).resources.components[input.packageKey]
        return new TextDecoder().decode(files['runtime.js'])
      }
      const imported = await documents.read(input.documentId)
      const undo = await documents.dispatch({ documentId: imported.documentId, epoch: imported.epoch, baseRevision: imported.revision,
        operationId: 'controlled-build-undo', actor: 'human', mutation: { type: 'undo' } })
      const undone = await documents.read(input.documentId)
      const redo = await documents.dispatch({ documentId: undone.documentId, epoch: undone.epoch, baseRevision: undone.revision,
        operationId: 'controlled-build-redo', actor: 'human', mutation: { type: 'redo' } })
      const redone = await documents.read(input.documentId)
      await documents.save(input.documentId); await documents.close(input.documentId)
      const reopened = await documents.open(input.coursePath)
      return { imported: { undoDepth: imported.undoDepth, source: source(imported), hash: model(imported).project.componentPackages[input.packageId].contentSha256 },
        undo, undone: { undoDepth: undone.undoDepth, redoDepth: undone.redoDepth, source: source(undone), hash: model(undone).project.componentPackages[input.packageId].contentSha256 },
        redo, redone: { undoDepth: redone.undoDepth, redoDepth: redone.redoDepth, source: source(redone), hash: model(redone).project.componentPackages[input.packageId].contentSha256 },
        reopened: { documentId: reopened.documentId, dirty: reopened.dirty, source: source(reopened), hash: model(reopened).project.componentPackages[input.packageId].contentSha256 } }
    }, { ...prepared, packageId, packageKey, coursePath })
    expect(history.imported).toMatchObject({ undoDepth: 1, source: validRuntime, hash: candidateHash })
    expect(history.undo).toMatchObject({ status: 'applied' }); expect(history.undone).toMatchObject({ undoDepth: 0, redoDepth: 1, hash: originalHash })
    expect(history.undone.source).not.toBe(validRuntime)
    expect(history.redo).toMatchObject({ status: 'applied' }); expect(history.redone).toMatchObject({ undoDepth: 1, redoDepth: 0, source: validRuntime, hash: candidateHash })
    expect(history.reopened).toMatchObject({ dirty: false, source: validRuntime, hash: candidateHash })
    const reopenedArchive = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    expect(new TextDecoder().decode(reopenedArchive.componentFiles[packageKey]!['runtime.js'])).toBe(validRuntime)
    expect(reopenedArchive.project.componentPackages[packageId]!.contentSha256).toBe(candidateHash)

    await tree.getByRole('button', { name: '受控构建课件.h5lesson', exact: true }).dblclick()
    if (await trial.getAttribute('aria-pressed') !== 'true') {
      await expect(page.locator('.canvas-viewport[data-observation-source="authoring"]')).toHaveAttribute('data-observation-ready', 'true')
      await trial.click()
    }
    await expect(page.getByTestId('course-try-run-host')).toHaveAttribute('data-course-player-ready', 'true')
    await expect(page.getByRole('button', { name: '显示答案', exact: true })).toBeVisible()
    await expect(page.getByText('答案尚未显示', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '显示答案', exact: true }).click()
    await expect(page.getByText('正确答案：受控构建已通过真实宿主。', { exact: true })).toBeVisible()
    await page.screenshot({ path: join(directory, 'imported-component-click.png'), fullPage: true })
    expect(rendererErrors).toEqual([])
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ provider: 'fixture-controlled-http', model: 'fixture-controlled-build',
      requests: requests.length, observedTools, buildEvidence, admissionWindows: [...admissionWindows], liveState, originalHash, candidateHash, history, rendererErrors, serverErrors }, null, 2))
    await info.attach('controlled-build-evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
    await info.attach('imported-component-click', { path: join(directory, 'imported-component-click.png'), contentType: 'image/png' })
  } catch (error) {
    releaseRepair(); releaseImport()
    const page = app.windows()[0]
    if (page) await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
    writeFileSync(join(directory, 'failure.json'), JSON.stringify({ requests: requests.length, observedTools, buildEvidence, admissionWindows: [...admissionWindows], serverErrors }, null, 2))
    throw error
  } finally {
    releaseRepair(); releaseImport()
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
    server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  }
})
