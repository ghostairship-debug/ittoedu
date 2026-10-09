// @vitest-environment node
// Exercises the Main delivery service and actual renderer export producer through the build port.
// Electron IPC/preload routing and the approval UI are outside this test and remain Electron-only checks.
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { unzipSync } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentRuleEdits } from '../../src/shared/componentInteractionData'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { DocumentDeliveryService } from '../../src/main/workbench/delivery/DocumentDeliveryService'
import { DocumentDeliveryOperationStore } from '../../src/main/workbench/delivery/DocumentDeliveryOperationStore'
import { resolveExportDestination, resolveSaveDestination, workbenchExportWriter } from '../../src/main/workbench/workbenchDeliveryAdapters'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { executeDocumentDeliveryTool } from '../../src/core/tools/DocumentDeliveryTools'
import type { DocumentDeliveryServicePort } from '../../src/shared/workbench/toolPorts'
import type { ExecutionStart } from '../../src/shared/workbench/execution'

vi.mock('../../src/renderer/export/loadPlayerBundle', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { cwd } = await import('node:process')
  return { loadPlayerBundle: () => readFileSync(resolve(cwd(), 'dist-player/player.iife.js'), 'utf8') }
})

import { buildDocumentExport } from '../../src/renderer/workbench/delivery/buildDocumentExport'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const remove of cleanup.splice(0).reverse()) await remove()
})

const selection: ModelSelection = {
  model: 'fixture-model',
  connection: {
    id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
    baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account',
    auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' },
    billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' },
  },
}

function completed(
  request: ModelRequest,
  calls: Array<{ id: string; name: string; argumentsText: string }> = [],
  content = '已完成',
): Extract<ModelEvent, { type: 'response.completed' }> {
  return {
    requestId: request.requestId, sequence: 1, type: 'response.completed',
    responseId: `m24-${request.requestId}`, actualModel: 'fixture-model', nativeResponse: {},
    finishReason: calls.length ? 'tool_calls' : 'stop',
    toolCalls: calls,
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({
      id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText },
    })) } : {}) },
  }
}

function frozenDocuments(request: ModelRequest): Array<{
  documentId: string
  writable: Array<{ kind: string; target: string }>
}> {
  const content = String(request.messages[1]?.content ?? '')
  const separator = content.indexOf('：')
  if (separator < 0) throw new Error('运行消息中缺少冻结文档范围')
  return JSON.parse(content.slice(separator + 1)) as Array<{
    documentId: string
    writable: Array<{ kind: string; target: string }>
  }>
}

function interactionProject() {
  const project = createBlankCourseProjectV10('交付验收互动课')
  project.global.overlay = []; project.instances = {}
  project.definitions = { [TEXT_DEFINITION.id]: structuredClone(TEXT_DEFINITION) }
  const surface = project.surfaces[0]
  surface.childIds = ['m24-export-trigger', 'm24-export-answer']
  for (const [id, text, y] of [['m24-export-trigger', '点击查看答案', 100], ['m24-export-answer', '交互已执行', 220]] as const) {
    project.instances[id] = { id, definitionId: TEXT_DEFINITION.id,
      data: JSON.parse(JSON.stringify(createTextComponentData(text))),
      frame: { width: 420, height: 90, transform: [1, 0, 0, 1, 120, y] },
      ...(id === 'm24-export-answer' ? { playbackInitialVisibility: 'hidden' as const } : {}) }
  }
  return applyComponentOperation(project, captureComponentOperation(project, componentRuleEdits(project, { kind: 'surface', surfaceId: surface.id }, [{
    id: 'm24-export-reveal', enabled: true, trigger: { type: 'node.click', nodeId: 'm24-export-trigger' }, conditions: [],
    actions: [{ id: 'm24-export-show-answer', start: 'after-previous', delayMs: 0,
      action: { type: 'node.enter', nodeId: 'm24-export-answer', durationMs: 1, easing: 'linear', effect: 'none' } }],
  }])))
}

function managedRemoteProject(url: string) {
  const project = createBlankCourseProjectV10('远程依赖离线拒绝')
  project.global.overlay = []; project.instances = {}; project.definitions = { [WEB_DEFINITION.id]: structuredClone(WEB_DEFINITION) }
  project.instances['m24-remote-html'] = { id: 'm24-remote-html', definitionId: WEB_DEFINITION.id,
    data: { html: `<!doctype html><html><body><img alt="远程图" src="${url}"></body></html>` },
    frame: { width: 640, height: 360, transform: [1, 0, 0, 1, 40, 40] } }
  project.surfaces[0].childIds = ['m24-remote-html']
  return project
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m24-delivery-'))
  cleanup.push(() => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const workspace = path.join(root, 'workspace')
  const exports = path.join(workspace, 'exports')
  await fs.mkdir(exports, { recursive: true })
  const host = new DocumentHostService(path.join(root, 'journal'))
  const saveWithFact = vi.spyOn(host, 'saveWithFact')
  const deliveries = new DocumentDeliveryService({
    documents: {
      read: documentId => host.registry.get(documentId).drain(),
      saveWithFact: (documentId, filename) => host.saveWithFact(documentId, filename),
      withFileLease: (documentId, work) => host.registry.get(documentId).withFileLease(lease => work(() => lease.read())),
    },
    operations: new DocumentDeliveryOperationStore(path.join(root, 'delivery-operations')),
    authorize: async ({ runId, operation }) => {
      if (host.tools.runFileAccess(runId)?.permission === 'read-only') throw new Error(`只读任务不能${operation === 'save' ? '保存' : '导出'}文件`)
    },
    resolveSaveDestination: ({ runId, snapshot, requested }) => resolveSaveDestination(runId, snapshot, requested, id => host.tools.runFileAccess(id)),
    resolveExportDestination: ({ runId, snapshot, requested, format, suggestedName }) =>
      resolveExportDestination(runId, snapshot, requested, suggestedName, format, id => host.tools.runFileAccess(id)),
    build: { build: (request, signal) => buildDocumentExport(request, signal, async () => { throw new Error('fixture contains only builtins') }, async () => {}) },
    writer: workbenchExportWriter,
  })
  host.tools.configureHostServices({ deliveries })
  return { root, workspace, exports, host, deliveries, saveWithFact }
}

async function bindTask(
  host: DocumentHostService,
  workspaceRoot: string,
  runId: string,
  document: DocumentSnapshot,
  permission: 'workspace' | 'read-only',
  writable: readonly { kind: 'document' }[] = [{ kind: 'document' }],
) {
  await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: document.documentId, writable }],
    fileAccess: { permission, workspaceRoot,
      ...(document.binding.kind === 'file' ? { boundPaths: { [document.documentId]: document.binding.path } } : {}) } })
}

async function saveEngine(provider: ModelProvider) {
  const h = await fixture()
  const filename = path.join(h.workspace, 'lesson.md')
  const beforeBytes = Buffer.from('# 原始内容\n', 'utf8')
  await fs.writeFile(filename, beforeBytes)
  const opened = await h.host.open(filename)
  const updatedSource = '# 已修改 ✓\n'
  const modified = await h.host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch,
    operationId: 'owner-edit-before-save-approval', baseRevision: opened.revision, actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: updatedSource, resources: opened.model.resources } } })
  expect(modified.status).toBe('applied')
  const current = await h.host.internalAPI.read(opened.documentId)
  const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools, provider,
    runs: new ExecutionRunStore(path.join(h.root, 'runs')), events: new ExecutionEventStore({ directory: path.join(h.root, 'events') }) })
  return { ...h, filename, beforeBytes, updatedSource, current, engine }
}

async function openAndInteract(browser: Awaited<ReturnType<typeof chromium.launch>>, filename: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const httpRequests: string[] = []
  const pageErrors: string[] = []
  page.on('request', request => { if (/^https?:/i.test(request.url())) httpRequests.push(request.url()) })
  page.on('pageerror', error => pageErrors.push(error.message))
  try {
    await page.goto(pathToFileURL(filename).href, { waitUntil: 'load' })
    const trigger = '[data-component-instance-id="m24-export-trigger"]'
    const answer = '[data-component-instance-id="m24-export-answer"]'
    await page.waitForSelector(trigger, { state: 'visible', timeout: 20_000 })
    await page.waitForFunction(selector => {
      const element = document.querySelector(selector)
      return !!element && getComputedStyle(element).visibility === 'visible'
    }, trigger, { timeout: 20_000 })
    expect(await page.locator(answer).isVisible()).toBe(false)
    await page.locator(trigger).click()
    await page.waitForSelector(answer, { state: 'visible', timeout: 10_000 })
    expect(await page.locator(answer).innerText()).toContain('交互已执行')
    expect(httpRequests).toEqual([])
    expect(pageErrors).toEqual([])
  } finally {
    await page.close()
  }
}

it('M24-T04: file.save waits for ask approval and returns bytes and savedRevision from the canonical host', async () => {
  const provider: ModelProvider = { async *stream(request) {
    if (request.messages.some(message => message.role === 'tool')) {
      yield completed(request, [], '保存已完成')
      return
    }
    const document = frozenDocuments(request)[0]
    const target = document?.writable.find(value => value.kind === 'document')?.target
    if (!target) throw new Error('模型请求没有整份文档写句柄')
    yield completed(request, [{ id: 'save-request', name: 'file.save', argumentsText: JSON.stringify({ target }) }], '')
  } }
  const h = await saveEngine(provider)
  let notify!: (event: { runId: string; callId: string; data: Record<string, unknown> }) => void
  const approvalReady = new Promise<{ runId: string; callId: string; data: Record<string, unknown> }>(resolve => { notify = resolve })
  h.engine.subscribe(event => {
    if (event.type === 'tool' && event.data.status === 'approval') notify({ runId: event.runId, callId: event.itemId, data: event.data })
  })
  const input: ExecutionStart = { conversationId: 'm24-ask-save', taskId: randomUUID(), instruction: '保存这份文档',
    selection, documents: [{ documentId: h.current.documentId, writable: [{ kind: 'document' }] }],
    permission: 'ask', workspaceRoot: h.workspace }
  const started = await h.engine.start(input)
  const eventOrEnd = await Promise.race([
    approvalReady.then(approval => ({ kind: 'approval' as const, approval })),
    h.engine.wait(started.runId).then(final => ({ kind: 'ended' as const, final })),
  ])
  if (eventOrEnd.kind === 'ended') throw new Error(`run ended before ask approval: ${eventOrEnd.final.status}; ${eventOrEnd.final.failure?.message ?? 'no failure message'}; ${JSON.stringify(eventOrEnd.final.tools)}`)
  const approval = eventOrEnd.approval
  expect(approval).toMatchObject({ runId: started.runId, data: { status: 'approval', approval: { reason: 'ask' } } })
  expect(await fs.readFile(h.filename)).toEqual(h.beforeBytes)
  expect(h.saveWithFact).not.toHaveBeenCalled()

  await h.engine.decide({ runId: started.runId, callId: approval.callId, decision: 'allow' })
  const final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  const tool = final.tools.find(item => item.call.name === 'file.save')
  expect(tool?.result).toMatchObject({ kind: 'read', data: { status: 'saved', savedRevision: h.current.revision,
    currentRevision: h.current.revision, dirty: false, path: h.filename } })
  expect(h.saveWithFact).toHaveBeenCalledTimes(1)
  const actualBytes = await fs.readFile(h.filename)
  expect(actualBytes).toEqual(Buffer.from(h.updatedSource, 'utf8'))
  if (tool?.result?.kind !== 'read') throw new Error('file.save 未返回真实读取回执')
  const receipt = tool.result.data as { fileVersion?: string }
  const saved = await h.host.internalAPI.read(h.current.documentId)
  expect(receipt.fileVersion).toBe(saved.binding.kind === 'file' ? saved.binding.version : undefined)
  expect(await fs.readFile(h.filename)).toEqual(actualBytes)
}, 20_000)

it('M24-T04: Main delivery authorization rejects a read-only save even for a clean document', async () => {
  const h = await fixture()
  const filename = path.join(h.workspace, 'readonly.md')
  const original = Buffer.from('# 原文\n', 'utf8')
  await fs.writeFile(filename, original)
  const snapshot = await h.host.open(filename)
  const runId = 'm24-read-only-save'
  await bindTask(h.host, h.workspace, runId, snapshot, 'read-only')
  const target = await h.host.tools.issueTarget(runId, snapshot.documentId, { kind: 'document' })
  const result = await h.host.tools.execute(runId, 'readonly-save-call', { name: 'file.save', input: { target } })
  expect(result).toMatchObject({ kind: 'error', code: 'delivery-rejected', message: expect.stringContaining('只读') })
  expect(h.saveWithFact).not.toHaveBeenCalled()
  expect(await fs.readFile(filename)).toEqual(original)
  await h.host.tools.stop(runId)
})

it('M24-T04: edits without file.save stay only in the document session', async () => {
  const h = await fixture()
  const filename = path.join(h.workspace, 'unsaved.md')
  const original = Buffer.from('第一行 OLD\n第二行\n', 'utf8')
  await fs.writeFile(filename, original)
  const snapshot = await h.host.open(filename)
  const provider: ModelProvider = { async *stream(request) {
    if (request.messages.some(message => message.role === 'tool')) {
      yield completed(request, [], '修改已应用')
      return
    }
    const document = frozenDocuments(request)[0]
    const range = document?.writable.find(value => value.kind === 'markdown-range')?.target
    if (!range) throw new Error('模型请求没有 Markdown 写入句柄')
    yield completed(request, [{ id: 'edit-only', name: 'text.replace', argumentsText: JSON.stringify({ target: range, content: '第一行 NEW\n第二行\n' }) }], '')
  } }
  const engine = new ExecutionEngine({ registry: h.host.registry, gateway: h.host.tools, provider,
    runs: new ExecutionRunStore(path.join(h.root, 'edit-only-runs')),
    events: new ExecutionEventStore({ directory: path.join(h.root, 'edit-only-events') }) })
  const started = await engine.start({ conversationId: 'm24-edit-only', taskId: randomUUID(), instruction: '只修改正文', selection,
    documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }, { kind: 'markdown-range', from: 0, to: original.toString('utf8').length }] }],
    permission: 'workspace', workspaceRoot: h.workspace })
  const final = await engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(final.tools.map(tool => tool.call.name)).toEqual(['text.replace'])
  expect(h.saveWithFact).not.toHaveBeenCalled()
  expect(await fs.readFile(filename)).toEqual(original)
  const current = await h.host.internalAPI.read(snapshot.documentId)
  expect(current).toMatchObject({ dirty: true, model: { source: '第一行 NEW\n第二行\n' } })
})

it('M24-T04: all three renderer exports write actual bytes which open and execute an interaction', async () => {
  const h = await fixture()
  const course = await h.host.internalAPI.create({ kind: 'course-v10', project: interactionProject(),
    resources: { assets: {}, components: {} } }, '互动验收.h5lesson')
  const runId = 'm24-three-format-export'
  await bindTask(h.host, h.workspace, runId, course, 'workspace')
  const browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'] })
  try {
    for (const format of ['html-offline', 'html-online', 'web-package'] as const) {
      const extension = format === 'web-package' ? '.zip' : '.html'
      const destination = path.join(h.exports, `${format}${extension}`)
      const receipt = await h.deliveries.export({ runId, operationId: `export-${format}`, requestDigest: `digest-${format}`,
        documentId: course.documentId, epoch: course.epoch, revision: course.revision, format, destination })
      expect(receipt).toMatchObject({ status: 'written', format, path: destination, exportedRevision: course.revision, currentRevision: course.revision })
      const bytes = await fs.readFile(destination)
      expect(receipt.fileVersion).toBe(createHash('sha256').update(bytes).digest('hex'))
      let htmlPath = destination
      if (format === 'web-package') {
        const archive = unzipSync(new Uint8Array(bytes))
        expect(Object.keys(archive)).toEqual(expect.arrayContaining(['index.html']))
        const packageRoot = path.join(h.exports, 'opened-web-package')
        for (const [relative, content] of Object.entries(archive)) {
          const target = path.join(packageRoot, ...relative.split('/'))
          await fs.mkdir(path.dirname(target), { recursive: true })
          await fs.writeFile(target, content)
        }
        htmlPath = path.join(packageRoot, 'index.html')
      }
      await openAndInteract(browser, htmlPath)
    }
  } finally {
    await browser.close()
    await h.host.tools.stop(runId)
  }
}, 30000)

it('M24-T04: offline export preserves a remote dependency and reports that it still requires network', async () => {
  const h = await fixture()
  const remoteUrl = 'https://media.example.test/lesson.png'
  const course = await h.host.internalAPI.create({ kind: 'course-v10', project: managedRemoteProject(remoteUrl),
    resources: { assets: {}, components: {} } }, '远程依赖.h5lesson')
  const runId = 'm24-offline-remote'
  await bindTask(h.host, h.workspace, runId, course, 'workspace')
  const destination = path.join(h.exports, 'remote-offline.html')
  const result = await h.deliveries.export({ runId, operationId: 'offline-remote', requestDigest: 'offline-remote-digest',
    documentId: course.documentId, epoch: course.epoch, revision: course.revision, format: 'html-offline', destination })
  expect(result).toMatchObject({ status: 'written', format: 'html-offline', warnings: expect.arrayContaining([expect.stringContaining(remoteUrl)]) })
  expect(result.warnings.join(' ')).toMatch(/离线.*网络/)
  expect(await fs.readFile(destination, 'utf8')).toContain(remoteUrl)
  await h.host.tools.stop(runId)
})

it('M24-T04: unsupported export formats return a readable reason without resolving or writing a target', async () => {
  const service: DocumentDeliveryServicePort = {
    save: vi.fn(async () => { throw new Error('unsupported-format test must not save') }),
    export: vi.fn(async () => { throw new Error('unsupported-format test must not export') }),
    lookup: vi.fn(async () => null),
  }
  const resolveHandle = vi.fn(async () => ({ documentId: 'doc', epoch: 'epoch', revision: 1 }))
  const result = await executeDocumentDeliveryTool(service, { runId: 'unsupported', operationId: 'unsupported-call',
    requestDigest: 'unsupported-digest', resolveHandle }, 'document.export', { target: 'doc', format: 'epub' })
  expect(result).toMatchObject({ kind: 'error', code: 'invalid-input', message: expect.stringContaining('pptx、pdf、docx') })
  expect(resolveHandle).not.toHaveBeenCalled()
  expect(service.export).not.toHaveBeenCalled()
  expect(service.lookup).not.toHaveBeenCalled()
})
