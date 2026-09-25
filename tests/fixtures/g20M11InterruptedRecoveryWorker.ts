import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

type Point = 'generating' | 'applied-unsaved' | 'saving' | 'save-after-rename' | 'save-after-rename-later-edit' | 'save-as-after-link' | 'save-as-clean-after-link' | 'save-after-rename-resource'
const [directory, point] = process.argv.slice(2) as [string, Point]
const filename = path.join(directory, 'lesson.md')
const selection: ModelSelection = { model: 'local-fixture', connection: {
  id: 'local', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1',
  accountId: 'local', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' },
} }

function targetOf(request: ModelRequest): string {
  const references = JSON.parse(String(request.messages[1].content).split('：')[1]) as { writable: { target: string }[] }[]
  return references[0]!.writable[0]!.target
}

function complete(request: ModelRequest, target: string): Extract<ModelEvent, { type: 'response.completed' }> {
  const argumentsText = JSON.stringify({ target, content: 'APPLIED' })
  return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: 'fixture-response',
    actualModel: 'local-fixture', nativeResponse: {}, finishReason: 'tool_calls',
    assistant: { role: 'assistant', content: null, tool_calls: [{ id: 'fixture-call', type: 'function',
      function: { name: 'text.replace', arguments: argumentsText } }] },
    toolCalls: [{ id: 'fixture-call', name: 'text.replace', argumentsText }],
  }
}

function pause(data: Record<string, unknown>): Promise<never> {
  process.send?.({ type: 'kill-now', point, ...data })
  return new Promise(() => {})
}

async function waitFor(ready: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await ready()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`M11 fault barrier did not become ready: ${point}`)
}

async function main(): Promise<void> {
  if (!directory || !['generating', 'applied-unsaved', 'saving', 'save-after-rename', 'save-after-rename-later-edit', 'save-as-after-link', 'save-as-clean-after-link', 'save-after-rename-resource'].includes(point)) throw new Error('Invalid M11 fixture arguments')
  await fs.mkdir(directory, { recursive: true })
  const resource = point === 'save-after-rename-resource'
  await fs.writeFile(filename, resource ? '# Before\nOLD\n![asset](asset.png)\n' : '# Before\nOLD\n')
  if (resource) await fs.writeFile(path.join(directory, 'asset.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=', 'base64'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const document = await host.open(filename)

  if (point === 'saving' || point === 'save-after-rename' || point === 'save-after-rename-later-edit' || point === 'save-as-after-link' || point === 'save-as-clean-after-link' || point === 'save-after-rename-resource') {
    if (point !== 'save-as-clean-after-link') {
      const receipt = await host.internalAPI.dispatch({ documentId: document.documentId, epoch: document.epoch,
        baseRevision: document.revision, operationId: 'human-before-save', actor: 'human',
        mutation: { type: 'command', command: { type: 'markdown.replace', source: resource ? '# After\n![asset](asset.png)\n' : '# After\n' } } })
      if (receipt.status !== 'applied') throw new Error(`Save setup did not commit: ${JSON.stringify(receipt)}`)
    }
    const states: string[] = []
    host.subscribeSaves(fact => states.push(fact.status))
    const originalRename = fs.rename.bind(fs)
    fs.rename = (async (from, to) => {
      if (path.resolve(String(to)) === filename) {
        if (point === 'saving') await pause({ documentId: document.documentId, states, revision: 1,
          fileSource: await fs.readFile(filename, 'utf8') })
        if (point === 'save-after-rename-later-edit') {
          const later = await host.internalAPI.dispatch({ documentId: document.documentId, epoch: document.epoch,
            baseRevision: 1, operationId: 'human-during-save', actor: 'human',
            mutation: { type: 'command', command: { type: 'markdown.replace', source: '# After\nLATER\n' } } })
          if (later.status !== 'applied') throw new Error(`Concurrent edit did not commit: ${JSON.stringify(later)}`)
        }
        await originalRename(from, to)
        await pause({ documentId: document.documentId, states, revision: point === 'save-after-rename-later-edit' ? 2 : 1,
          fileSource: await fs.readFile(filename, 'utf8') })
      }
      return originalRename(from, to)
    }) as typeof fs.rename
    const saveAs = path.join(directory, 'save-as.md')
    const originalLink = fs.link.bind(fs)
    fs.link = (async (from, to) => {
      await originalLink(from, to)
      if ((point === 'save-as-after-link' || point === 'save-as-clean-after-link') && path.resolve(String(to)) === saveAs) {
        await pause({ documentId: document.documentId, states, revision: point === 'save-as-clean-after-link' ? 0 : 1,
          fileSource: await fs.readFile(saveAs, 'utf8'), originalFileSource: await fs.readFile(filename, 'utf8') })
      }
    }) as typeof fs.link
    await host.internalAPI.save(document.documentId,
      point === 'save-as-after-link' || point === 'save-as-clean-after-link' ? saveAs : undefined)
    throw new Error('Save fault barrier was not reached')
  }

  const edits = new EditSessionService(host.registry, host.tools)
  const runs = new ExecutionRunStore(path.join(directory, 'runs'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  let requestCount = 0
  const provider: ModelProvider = { async *stream(request) {
    requestCount += 1
    if (point === 'generating') {
      const raw = JSON.stringify({ target: targetOf(request), content: 'HALF PRODUCT' })
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0,
        id: 'partial-call', name: 'text.replace', argumentsDelta: raw.slice(0, -2) }
      await new Promise<never>(() => {})
    } else if (requestCount === 1) {
      yield complete(request, targetOf(request))
    } else {
      await new Promise<never>(() => {})
    }
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, edits, runs, events, provider })
  const started = await engine.start({ conversationId: 'm11-conversation', taskId: 'm11-task',
    instruction: 'Replace OLD', selection, documents: [{ documentId: document.documentId,
      writable: [{ kind: 'markdown-range', from: 9, to: 12 }] }] })
  await waitFor(async () => {
    const record = await runs.read(started.runId)
    const current = await host.internalAPI.read(document.documentId)
    return point === 'generating'
      ? requestCount === 1 && record?.requests[0]?.state === 'sending'
        && edits.list(document.documentId)[0]?.value === 'HALF PRODUCT'
        && current.revision === 0
      : requestCount === 2 && record?.requests[1]?.state === 'sending'
        && record.tools[0]?.result?.kind === 'document-operation'
        && record.tools[0].result.result.status === 'applied'
        && current.revision === 1 && current.undoDepth === 1
  })
  const current = await host.internalAPI.read(document.documentId)
  const record = (await runs.read(started.runId))!
  await pause({ documentId: document.documentId, runId: started.runId, requestCount,
    preview: edits.list(document.documentId).map(item => item.value),
    revision: current.revision, undoDepth: current.undoDepth,
    runStatus: record.status, requestStates: record.requests.map(item => item.state),
    fileSource: await fs.readFile(filename, 'utf8') })
}

void main().catch(error => { console.error(error); process.exitCode = 1 })
