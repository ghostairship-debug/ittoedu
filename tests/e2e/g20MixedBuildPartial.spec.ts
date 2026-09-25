import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { componentPackageKey } from '../../src/core/drivers/codecs/archivePath'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'

const root = resolve(__dirname, '../..')
const packageId = 'com.example.v9-quiz'
const packageKey = componentPackageKey(packageId, '4.0.0')
const runtimePath = `components/${packageKey}/runtime.js`
const originalTitle = '嵌入组件'
const committedTitle = '已提交的课堂引入'
const modelName = 'fixture-s13-mixed-stop'
const chunk = (id: string, delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id, model: modelName,
  choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const toolResults = (payload: any) => payload.messages.filter((message: any) => message.role === 'tool')
  .map((message: any) => JSON.parse(message.content))
const wire = (payload: any, toolName: string) => {
  const name = modelToolWireName(toolName)
  const found = payload.tools.find((tool: any) => tool.function.name === name)
  if (!found) throw new Error(`missing tool: ${toolName}`)
  return found.function.name as string
}
function call(response: ServerResponse, id: string, calls: Array<{ id: string; name: string; input: unknown }>) {
  response.write(chunk(id, { role: 'assistant', tool_calls: calls.map((value, index) => ({ index, id: value.id,
    type: 'function', function: { name: value.name, arguments: JSON.stringify(value.input) } })) }, 'tool_calls'))
  response.end('data: [DONE]\n\n')
}

test('S13-T05 UI stop retains a committed course edit while an unadmitted Component build stays out of the saved project', async ({}, info) => {
  test.setTimeout(180_000)
  const output = join(root, 'output/g20/s13/mixed-build-partial'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const coursePath = join(workspace, '混合任务课件.h5lesson')
  const fixture = openCourseProjectArchive(new Uint8Array(readFileSync(join(root, 'tests/fixtures/course-project-v9/component.h5lesson'))))
  const project = structuredClone(fixture.project), fallbackMeta = project.assets['quiz-fallback']
  if (fallbackMeta?.kind !== 'image') throw new Error('Component fixture fallback is missing')
  const fallback = new Uint8Array(await sharp({ create: { width: 400, height: 240, channels: 4, background: '#dbeafe' } }).png().toBuffer())
  project.assets['quiz-fallback'] = { ...fallbackMeta, mimeType: 'image/png', byteLength: fallback.byteLength, width: 400, height: 240 }
  const baseline = { project, assetFiles: { ...fixture.assetFiles, 'quiz-fallback': fallback }, componentFiles: fixture.componentFiles }
  writeFileSync(coursePath, createCourseProjectArchive(baseline))
  const originalRuntimeBytes = baseline.componentFiles[packageKey]?.['runtime.js']
  if (!originalRuntimeBytes) throw new Error('Component runtime is missing')
  const originalRuntime = new TextDecoder().decode(originalRuntimeBytes)
  if (!originalRuntime || !originalRuntime.includes('CoursewareComponent.define')) throw new Error('Component runtime is missing')
  const stagedRuntime = `${originalRuntime}\n// Staged in the controlled build; never imported.\n`
  const originalHash = project.componentPackages[packageId]!.contentSha256

  const requests: any[] = [], serverErrors: string[] = [], issuedTools: string[] = []
  let requestNumber = 0, rootTarget = '', locationTarget = '', titleTarget = '', job = ''
  let releaseAdmissionGate!: () => void
  const admissionGate = new Promise<void>(resolveGate => { releaseAdmissionGate = resolveGate })
  const server = createServer(async (request, response) => {
    try {
      let body = ''; for await (const part of request) body += part.toString()
      const payload = JSON.parse(body); requests.push(payload); requestNumber += 1
      expect(request.method).toBe('POST'); expect(request.url).toBe('/v1/chat/completions'); expect(payload.model).toBe(modelName)
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const id = `s13-mixed-stop-${requestNumber}`, results = toolResults(payload)
      if (requestNumber === 1) {
        const fixed = payload.messages.find((message: any) => typeof message.content === 'string' && message.content.startsWith('本次固定文档与权限'))
        const references = JSON.parse(fixed.content.slice(fixed.content.indexOf('：') + 1))
        expect(references).toHaveLength(1); rootTarget = references[0].target
        issuedTools.push('listChildren:document')
        call(response, id, [{ id: 'list-document', name: wire(payload, 'listChildren'), input: { target: rootTarget } }])
      } else if (requestNumber === 2) {
        locationTarget = results.at(-1).data[0].target
        issuedTools.push('listChildren:location')
        call(response, id, [{ id: 'list-location', name: wire(payload, 'listChildren'), input: { target: locationTarget } }])
      } else if (requestNumber === 3) {
        titleTarget = results.at(-1).data.find((item: any) => item.label === 'slide-title')?.target
        expect(titleTarget).toBeTruthy(); issuedTools.push('read:title')
        call(response, id, [{ id: 'read-title', name: wire(payload, 'read'), input: { target: titleTarget, limit: 100 } }])
      } else if (requestNumber === 4) {
        expect(JSON.parse(results.at(-1).data.text).item.content.data.text).toBe(originalTitle)
        issuedTools.push('text.replace')
        call(response, id, [{ id: 'replace-title', name: wire(payload, 'text.replace'), input: { target: titleTarget, content: committedTitle } }])
      } else if (requestNumber === 5) {
        expect(results.at(-1)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
        // The original document handle has an old footprint after the edit. Read it to get a current build target.
        issuedTools.push('inspect:document')
        call(response, id, [{ id: 'inspect-document', name: wire(payload, 'inspect'), input: { target: rootTarget } }])
      } else if (requestNumber === 6) {
        expect(results.at(-1).data).toMatchObject({ kind: 'document', writable: true })
        rootTarget = results.at(-1).data.target
        issuedTools.push('tools.load:build')
        call(response, id, [{ id: 'load-build-tools', name: wire(payload, 'tools.load'), input: { families: ['build'] } }])
      } else if (requestNumber === 7) {
        expect(results.at(-1)).toMatchObject({ kind: 'read', data: { loaded: ['build'] } })
        issuedTools.push('build.create')
        call(response, id, [{ id: 'build-create', name: wire(payload, 'build.create'), input: { target: rootTarget } }])
      } else if (requestNumber === 8) {
        job = results.at(-1).data.job; expect(job).toBeTruthy()
        issuedTools.push('build.write')
        call(response, id, [{ id: 'build-write', name: wire(payload, 'build.write'), input: { job, path: runtimePath, content: stagedRuntime } }])
      } else if (requestNumber === 9) {
        expect(results.at(-1).data.status).toBe('editing')
        issuedTools.push('build.compile')
        call(response, id, [{ id: 'build-compile', name: wire(payload, 'build.compile'), input: { job, path: runtimePath, kind: 'component' } }])
      } else if (requestNumber === 10) {
        expect(results.at(-1).data).toMatchObject({ ok: true, stage: 'syntax-checked' })
        // Deterministic stop point: scratch exists and syntax compiled; build.check/admission has not begun.
        await admissionGate
        if (!response.destroyed) call(response, id, [{ id: 'build-check', name: wire(payload, 'build.check'), input: { job } }])
      } else throw new Error(`unexpected provider request ${requestNumber}`)
    } catch (error) {
      serverErrors.push(error instanceof Error ? error.stack ?? error.message : String(error))
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' })
      if (!response.destroyed) response.end('fixture provider assertion failed')
    }
  })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000)
    const rendererErrors: string[] = []; page.on('pageerror', error => rendererErrors.push(error.message))
    await page.evaluate(async ({ endpoint, modelName }) => {
      const settings = window.desktopAPI!.executionSettings!
      const connection = await settings.saveConnection({ apiKey: 'fixture-key-not-a-real-account', connection: {
        provider: 'fixture-controlled-http', protocol: 'openai-chat', baseURL: endpoint, accountId: 'local-fixture', authKind: 'api-key', billing: { kind: 'unknown' },
      } })
      await settings.saveProfile({ expectedRevision: 0, roles: {
        conversation: { connectionId: connection.connection.id, model: modelName }, vision: null, imageGenerate: null, imageEdit: null,
      } })
    }, { endpoint, modelName })
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.locator('.lesson-directory-tree')
    await expect(tree.getByRole('button', { name: '混合任务课件.h5lesson', exact: true })).toBeVisible()
    const prepared = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!, execution = window.desktopAPI!.execution!
      const course = await documents.open(input.coursePath)
      const space = await execution.workspace(input.workspace), conversation = space.conversations[0] ?? await execution.createConversation(space.workspace.workspaceId)
      const saved = await execution.draft({ workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: conversation.revision,
        text: '先修改本课件标题，再构建组件；尚未通过准入时停止。',
        documents: [{ documentId: course.documentId, epoch: course.epoch, revision: course.revision, writable: [{ kind: 'document' }] }], attachments: [] })
      return { workspaceId: space.workspace.workspaceId, conversationId: saved.conversationId, documentId: course.documentId,
        revision: course.revision, undoDepth: course.undoDepth }
    }, { workspace, coursePath })
    expect(prepared.undoDepth).toBe(0)
    await page.reload()
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue(/先修改本课件标题/)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect.poll(() => {
      if (serverErrors.length) throw new Error(serverErrors.join('\n'))
      return requests.length
    }, { timeout: 120_000 }).toBe(10)

    const beforeStop = await page.evaluate(async id => window.desktopAPI!.documents!.read(id), prepared.documentId)
    expect(beforeStop).toMatchObject({ revision: prepared.revision + 1, undoDepth: 1, dirty: true,
      model: { kind: 'course-v9', project: { componentPackages: { [packageId]: { contentSha256: originalHash } } } } })
    const title = (snapshot: any) => snapshot.model.project.surfaces[0].scenes[0].layerItems
      .find((item: any) => item.layerItemId === 'slide-title').content.data.text as string
    const runtime = (snapshot: any) => new TextDecoder().decode(snapshot.model.resources.components[packageKey]['runtime.js']) as string
    expect(title(beforeStop)).toBe(committedTitle); expect(runtime(beforeStop)).toBe(originalRuntime)
    const runId = await page.evaluate(async input => {
      const conversation = await window.desktopAPI!.execution!.conversation(input.workspaceId, input.conversationId)
      return conversation!.runIndex.builtinRunIds.at(-1)!
    }, prepared)
    await page.getByRole('button', { name: '停止', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(async id => window.desktopAPI!.execution!.run(id), runId))?.status).toBe('stopped')
    releaseAdmissionGate()
    const run = await page.evaluate(async id => window.desktopAPI!.execution!.run(id), runId)
    expect(run).toMatchObject({ status: 'stopped' })
    expect(run?.tools.map(tool => tool.call.name)).toEqual(['listChildren', 'listChildren', 'read', 'text.replace', 'inspect', 'tools.load',
      'build.create', 'build.write', 'build.compile'])
    expect(issuedTools).toEqual(['listChildren:document', 'listChildren:location', 'read:title', 'text.replace',
      'inspect:document', 'tools.load:build', 'build.create', 'build.write', 'build.compile'])
    expect(run?.tools.find(tool => tool.call.name === 'text.replace')?.result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(run?.tools.some(tool => tool.call.name === 'build.check' || tool.call.name === 'build.import')).toBe(false)
    const history = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!
      const edited = await documents.read(input.documentId)
      const undo = await documents.dispatch({ documentId: edited.documentId, epoch: edited.epoch, baseRevision: edited.revision,
        operationId: 's13-mixed-stop-undo', actor: 'human', mutation: { type: 'undo' } })
      const undone = await documents.read(input.documentId)
      const redo = await documents.dispatch({ documentId: undone.documentId, epoch: undone.epoch, baseRevision: undone.revision,
        operationId: 's13-mixed-stop-redo', actor: 'human', mutation: { type: 'redo' } })
      const redone = await documents.read(input.documentId)
      await documents.save(input.documentId); await documents.close(input.documentId)
      const reopened = await documents.open(input.coursePath)
      return { undo, undone, redo, redone, reopened }
    }, { ...prepared, coursePath })
    expect(history.undo).toMatchObject({ status: 'applied' }); expect(title(history.undone)).toBe(originalTitle)
    expect(history.undone.undoDepth).toBe(0); expect(runtime(history.undone)).toBe(originalRuntime)
    expect(history.redo).toMatchObject({ status: 'applied' }); expect(title(history.redone)).toBe(committedTitle)
    expect(history.redone.undoDepth).toBe(1); expect(runtime(history.redone)).toBe(originalRuntime)
    expect(history.reopened.dirty).toBe(false); expect(title(history.reopened)).toBe(committedTitle)
    expect(runtime(history.reopened)).toBe(originalRuntime)
    expect(history.reopened.model).toMatchObject({ kind: 'course-v9', project: { componentPackages: { [packageId]: { contentSha256: originalHash } } } })
    const disk = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    expect(new TextDecoder().decode(disk.componentFiles[packageKey]!['runtime.js'])).toBe(originalRuntime)
    expect(disk.project.componentPackages[packageId]!.contentSha256).toBe(originalHash)
    expect(rendererErrors).toEqual([]); expect(serverErrors).toEqual([])
    await expect(page.getByRole('article', { name: '任务结果' })).toContainText('已停止')
    // The terminal summary must tell a teacher both that the direct edit was kept and that the build is unfinished.
    const summary = page.getByRole('article', { name: '任务结果' })
    await expect(summary).toContainText('已保留')
    await expect(summary).toContainText('未完成')
    writeFileSync(join(directory, 'evidence.json'), JSON.stringify({ provider: 'fixture-controlled-http', model: modelName,
      stopPoint: 'after build.compile, before build.check/admission', issuedTools, runStatus: run?.status,
      document: { beforeStop: { revision: beforeStop.revision, undoDepth: beforeStop.undoDepth, title: title(beforeStop) },
        reopened: { revision: history.reopened.revision, title: title(history.reopened), dirty: history.reopened.dirty } },
      rendererErrors, serverErrors }, null, 2))
    await info.attach('mixed-build-partial-evidence', { path: join(directory, 'evidence.json'), contentType: 'application/json' })
  } catch (error) {
    releaseAdmissionGate()
    const page = app.windows()[0]
    if (page) await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
    writeFileSync(join(directory, 'failure.json'), JSON.stringify({ requests: requests.length, issuedTools, serverErrors }, null, 2))
    throw error
  } finally {
    releaseAdmissionGate()
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
    await app.close().catch(() => undefined)
    server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  }
})
