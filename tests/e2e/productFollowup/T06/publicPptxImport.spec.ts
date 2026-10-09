import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import PptxGenJS from 'pptxgenjs'
import sharp from 'sharp'
import { openCourseProjectV10Archive } from '../../../../src/core/drivers/codecs/courseProjectV10Archive'
import { inspectOfficeContent } from '../../../../src/main/workbench/office/OfficeContentService'
import { BACKGROUND_E2E_ENV } from '../../../../src/main/windowVisibility'

const root = resolve(__dirname, '../../../..')
test('T06 public default PPTX import uses the actual converter and keeps text and image editable through save undo redo and cold reopen', async () => {
  test.setTimeout(180_000)
  const base = join(root, 'output/productFollowup/T06'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'public-pptx-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const checkpoints = join(directory, 'checkpoint.jsonl')
  const checkpoint = (phase: string, facts: unknown = {}) => appendFileSync(checkpoints, JSON.stringify({ time: new Date().toISOString(), process: 'test', phase, facts }) + '\n')
  const picture = await sharp({ create: { width: 80, height: 50, channels: 4, background: '#1188cc' } }).png().toBuffer()
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'
  const slide = pptx.addSlide()
  slide.addText('Teacher editable text', { x: .6, y: .5, w: 4, h: .7, fontSize: 28 })
  slide.addImage({ data: `data:image/png;base64,${picture.toString('base64')}`, x: 6, y: 1, w: 2, h: 1.25 })
  const source = join(workspace, 'source.pptx'); await pptx.writeFile({ fileName: source })
  let app: ElectronApplication | undefined
  try {
    checkpoint('launch.before')
    app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_CLI_DOGFOOD: '', [BACKGROUND_E2E_ENV]: '1' } })
    checkpoint('launch.returned'); await app.firstWindow(); checkpoint('firstWindow.returned')
    const facts = await app.evaluate(async (_electron, input) => {
      const path = process.getBuiltinModule('node:path'), fs = process.getBuiltinModule('node:fs')
      const { createRequire } = process.getBuiltinModule('node:module')
      const requireProduct = createRequire(path.join(input.root, 'package.json'))
      const log = (phase: string, facts: unknown = {}) => fs.appendFileSync(input.checkpoints, JSON.stringify({ time: new Date().toISOString(), process: 'main', phase, facts }) + '\n')
      log('evaluate.entered')
      const load = (file: string) => { log('module.load.before', { file }); const module = requireProduct(path.join(input.root, 'dist-electron', file)); log('module.load.returned', { file }); return module }
      const [{ documentHost }, { ExecutionEngine }, { ExecutionRunStore }, { ExecutionEventStore }, { DocumentHostService }] = await Promise.all([
        load('main/workbench/documentHost.js'), load('main/workbench/execution/ExecutionEngine.js'), load('main/workbench/execution/ExecutionRunStore.js'),
        load('main/workbench/execution/ExecutionEventStore.js'), load('main/workbench/DocumentHostService.js') ])
      const host = documentHost()
      const selection = { model: 'local-pptx-import', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
        baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
        capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' } } }
      let turn = 0, target = '', textPath = '', originalData: any, imported: any
      const last = (request: any) => JSON.parse([...request.messages].reverse().find(message => message.role === 'tool').content).data
      const finish = (request: any, name?: string, args?: unknown) => {
        const calls = name ? [{ id: `pptx-${turn}`, name, argumentsText: JSON.stringify(args) }] : []
        return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `response-${turn}`, actualModel: selection.model,
          nativeResponse: {}, finishReason: name ? 'tool_calls' : 'stop', toolCalls: calls, assistant: { role: 'assistant', content: name ? '' : '已导入并保存可编辑课件',
            ...(name ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
      }
      const provider = { async *stream(request: any) {
        turn++
        log('provider.turn', { turn, requestId: request.requestId, lastTool: [...request.messages].reverse().find((message: any) => message.role === 'tool') })
        if (turn === 1) {
          if (!(request.tools ?? []).some((tool: any) => tool.name === 'course.importPptx')) throw new Error('Default public PPTX import tool was hidden')
          yield finish(request, 'course.importPptx', { path: 'source.pptx', destination: 'editable.h5lesson' })
        } else if (turn === 2) {
          if (last(request).status !== 'saved') throw new Error(`Import receipt did not save: ${JSON.stringify(last(request))}`)
          yield finish(request, 'file.open', { path: 'editable.h5lesson' })
        } else if (turn === 3) { target = last(request).target; imported = await host.internalAPI.read(last(request).documentId); yield finish(request, 'project.list', { project: target }) }
        else if (turn === 4) {
          const files = last(request).files as Array<{ path: string }>
          textPath = files.find(file => file.path.endsWith('.data.json') && /Teacher editable text/.test(file.path))?.path ?? files.find(file => file.path.endsWith('.data.json'))?.path ?? ''
          if (!textPath) throw new Error('Imported course did not expose editable component data')
          yield finish(request, 'project.read', { project: target, path: textPath })
        } else if (turn === 5) {
          originalData = JSON.parse(last(request).content)
          if (!JSON.stringify(originalData).includes('Teacher editable text')) throw new Error(`Public text data was missing: ${JSON.stringify(originalData)}`)
          yield finish(request, 'object.update', { project: target, path: textPath, properties: { data: { content: { inlines: [{ type: 'text', text: 'Revised imported text' }] } } } })
        } else if (turn === 6) yield finish(request, 'file.save', { target })
        else yield finish(request)
      } }
      const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
        runs: new ExecutionRunStore(path.join(input.directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(input.directory, 'events') }) })
      log('engine.start.before')
      const started = await engine.start({ conversationId: 'pptx', taskId: 'public-import', instruction: '导入PPTX为新的可编辑课件，改写文字并保存。',
        documents: [], selection, permission: 'workspace', workspaceRoot: input.workspace })
      log('engine.start.returned', { runId: started.runId })
      const finished = await engine.wait(started.runId); log('engine.wait.returned', { status: finished.status, failure: finished.failure, tools: finished.tools })
      const snapshot = host.registry.list().find((value: import('../../../../src/shared/workbench/document').DocumentSnapshot) => value.binding.kind === 'file' && value.binding.path === path.join(input.workspace, 'editable.h5lesson'))
      if (!snapshot) return { status: finished.status, failure: finished.failure, tools: finished.tools, snapshot: null }
      const imageIds = Object.values(snapshot.model.project.instances).filter((instance: any) => snapshot.model.project.definitions[instance.definitionId]?.implementation?.key === 'guoling.image')
        .map((instance: any) => instance.id)
      const dispatch = async (type: 'undo' | 'redo') => {
        const current = await host.internalAPI.read(snapshot.documentId)
        return host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
          actor: 'human', operationId: `teacher-${type}`, mutation: { type } })
      }
      const undo = await dispatch('undo'), undone = await host.internalAPI.read(snapshot.documentId)
      const redo = await dispatch('redo'), redone = await host.internalAPI.read(snapshot.documentId)
      await host.saveToPath(snapshot.documentId)
      const cold = await new DocumentHostService(path.join(input.directory, 'cold')).open(path.join(input.workspace, 'editable.h5lesson'))
      return { status: finished.status, failure: finished.failure, tools: finished.tools, imported, snapshot, imageIds, undo, undone, redo, redone, cold, originalData, textPath }
    }, { root, directory, workspace, checkpoints })
    expect(facts.status, JSON.stringify(facts)).toBe('completed')
    expect(facts.tools.map((tool: any) => tool.call.name)).toEqual(['course.importPptx', 'file.open', 'project.list', 'project.read', 'object.update', 'file.save'])
    expect(facts.snapshot).toMatchObject({ dirty: false, undoDepth: 1, model: { kind: 'course-v10' } })
    expect(JSON.stringify(facts.snapshot.model.project.instances)).toContain('Revised imported text')
    if (!facts.snapshot || !facts.imageIds) throw new Error(`PPTX import did not create a saved document: ${JSON.stringify(facts)}`)
    expect(facts.imageIds.length).toBeGreaterThan(0)
    expect(Object.keys(facts.snapshot.model.resources.assets).length).toBeGreaterThan(0)
    for (const id of facts.imageIds) expect(facts.snapshot.model.project.instances[id]).toEqual(facts.imported.model.project.instances[id])
    expect(facts.undo).toMatchObject({ status: 'applied' }); expect(JSON.stringify(facts.undone.model.project.instances)).toContain('Teacher editable text')
    expect(facts.redo).toMatchObject({ status: 'applied' }); expect(facts.cold.model).toEqual(facts.redone.model)
    expect(JSON.stringify(inspectOfficeContent(new Uint8Array(readFileSync(source)), 'pptx'))).toContain('Teacher editable text')
    const archive = openCourseProjectV10Archive(new Uint8Array(readFileSync(join(workspace, 'editable.h5lesson'))))
    expect(JSON.stringify(archive.project.instances)).toContain('Revised imported text')
    writeFileSync(join(directory, 'facts.json'), JSON.stringify({ ...facts, paidCalls: 0 }, null, 2))
  } catch (error) {
    checkpoint('test.error.before-cleanup', { error: String(error), stack: error instanceof Error ? error.stack : undefined }); throw error
  } finally {
    const ownedProcess = app?.process(), ownProfile = `--user-data-dir=${join(directory, 'profile')}`
    checkpoint('cleanup.owned-process-tree.before', { pid: ownedProcess?.pid, profileMatches: ownedProcess?.spawnargs.includes(ownProfile) })
    try {
      if (ownedProcess?.pid && ownedProcess.exitCode === null && ownedProcess.signalCode === null && ownedProcess.spawnargs.includes(ownProfile)) {
        if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(ownedProcess.pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true })
        else ownedProcess.kill()
      }
    } catch (error) { checkpoint('cleanup.owned-process-tree.error', { error: String(error) }) }
    checkpoint('cleanup.owned-process-tree.returned', { pid: ownedProcess?.pid })
    checkpoint('cleanup.app.close.before'); await app?.close().catch(error => checkpoint('cleanup.app.close.error', { error: String(error) })); checkpoint('cleanup.app.close.returned')
  }
})
