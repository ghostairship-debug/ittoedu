import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { closeSelectionApp, launchSelectionApp } from '../../helpers/g20SelectionHarness'

test('actual Main Engine default HTML tools observe click and freshly observe one DOM change while source History stays zero and Stop prevents another click', async ({}, info) => {
  const root = resolve(__dirname, '../../../..'), output = join(root, 'output/content-revision/t07-public-html')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), filename = join(directory, 'counter.html')
  const source = '<!doctype html><html><head><meta charset="utf-8"><title>Public HTML counter</title></head>'
    + '<body><h1>Public counter</h1><p id="count">Count 0</p><button id="add">Add</button>'
    + '<script>let n=0;document.getElementById("add").onclick=()=>document.getElementById("count").textContent="Count "+(++n);</script></body></html>'
  writeFileSync(filename, source)
  let app: ElectronApplication | undefined
  try {
    app = await launchSelectionApp(directory)
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '新建会话', exact: true })).toBeEnabled()
    const facts = await app.evaluate(async ({ app }, input) => {
      // Same native CJS loader as g20HostTools: product singleton and configured
      // services in the actual Main process; no Main dynamic import or private handler.
      const { createRequire } = process.getBuiltinModule('node:module')
      const requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const { documentHost } = requireProduct('./dist-electron/main/workbench/documentHost.js') as typeof import('../../../../src/main/workbench/documentHost')
      const { ExecutionEngine } = requireProduct('./dist-electron/main/workbench/execution/ExecutionEngine.js') as typeof import('../../../../src/main/workbench/execution/ExecutionEngine')
      const { ExecutionRunStore } = requireProduct('./dist-electron/main/workbench/execution/ExecutionRunStore.js') as typeof import('../../../../src/main/workbench/execution/ExecutionRunStore')
      const { ExecutionEventStore } = requireProduct('./dist-electron/main/workbench/execution/ExecutionEventStore.js') as typeof import('../../../../src/main/workbench/execution/ExecutionEventStore')
      const fs = requireProduct('node:fs') as typeof import('node:fs')
      const host = documentHost(), initial = await host.internalAPI.open(input.filename)
      const observations: Array<{ source: string; generation: number; structure: string[]; image: { resourceId: string } }> = []
      const catalogs: string[][] = []
      let turns = 0, lateClickHandle = '', stoppedSignalObserved = false, imageDelivered = false
      let reachedFresh!: () => void
      const freshReady = new Promise<void>(done => { reachedFresh = done })
      const selection: import('../../../../src/shared/workbench/modelProvider').ModelSelection = {
        model: 'controlled-html-action', connection: { id: 'controlled', revision: 1, provider: 'controlled', protocol: 'openai-chat',
          baseURL: 'http://127.0.0.1:1/v1', accountId: 'controlled', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
          capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'unknown' } },
      }
      const offered = (request: import('../../../../src/shared/workbench/modelProvider').ModelRequest, name: string) => {
        if (!request.tools?.some(tool => tool.name === name)) throw new Error(`Actual default catalog lacks ${name}`)
        return name
      }
      const receipt = (request: import('../../../../src/shared/workbench/modelProvider').ModelRequest) => {
        const message = [...request.messages].reverse().find(message => message.role === 'tool')
        if (typeof message?.content !== 'string') throw new Error('Actual returned tool message required')
        const result = JSON.parse(message.content) as { kind: string; data: typeof observations[number] & { elements: Array<{ tag: string; role: string; label: string; handle: string }> } }
        if (result.kind !== 'read' || !result.data?.elements) throw new Error(`Real HTML observation required: ${JSON.stringify(result)}`)
        return result.data
      }
      const reply = (request: import('../../../../src/shared/workbench/modelProvider').ModelRequest, name: string, value: unknown): import('../../../../src/shared/workbench/modelProvider').ModelEvent => {
        const call = { id: `html-public-${turns}`, name: offered(request, name), argumentsText: JSON.stringify(value) }
        return { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: `html-response-${turns}`, actualModel: selection.model,
          finishReason: 'tool_calls', toolCalls: [call], nativeResponse: {}, assistant: { role: 'assistant', content: '',
            tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsText } }] } }
      }
      // The controlled provider reads only real requests, advertised tools and returned
      // DOM facts. It is never given a hidden path, selector, snapshotId or element handle.
      const provider: import('../../../../src/shared/workbench/modelProvider').ModelProvider = { async *stream(request, options) {
        turns++; catalogs.push(request.tools?.map(tool => tool.name) ?? [])
        if (turns === 1) {
          if (!JSON.stringify(request.messages).includes('counter.html')) throw new Error('Product context omitted the bound source document')
          offered(request, 'html.click')
          yield reply(request, 'html.observe', {}); return
        }
        const observed = receipt(request)
        observations.push({ source: observed.source, generation: observed.generation, structure: observed.structure, image: observed.image })
        imageDelivered ||= request.messages.some(message => Array.isArray(message.content)
          && message.content.some(part => part && typeof part === 'object' && 'type' in part && part.type === 'image_url'))
        if (turns === 2) {
          if (!observed.structure.join('\n').includes('Count 0')) throw new Error('Initial actual DOM state was not Count 0')
          const button = observed.elements.find(element => element.tag === 'button' && element.label === 'Add')
          if (!button?.handle) throw new Error('Actual observation did not return the Add button handle')
          yield reply(request, 'html.click', { handle: button.handle }); return
        }
        if (!observed.structure.join('\n').includes('Count 1') || observed.structure.join('\n').includes('Count 2'))
          throw new Error(`One click must produce exactly Count 1: ${JSON.stringify(observed.structure)}`)
        if (turns === 3) { yield reply(request, 'html.observe', {}); return }
        if (turns !== 4) throw new Error('Unexpected provider continuation')
        lateClickHandle = observed.elements.find(element => element.tag === 'button' && element.label === 'Add')?.handle ?? ''
        if (!lateClickHandle) throw new Error('Fresh observation must expose its current button handle')
        reachedFresh()
        await new Promise<void>(done => {
          if (options?.signal?.aborted) done()
          else options?.signal?.addEventListener('abort', () => done(), { once: true })
        })
        stoppedSignalObserved = true
        // A late provider event after the actual Stop must not replay the action.
        yield reply(request, 'html.click', { handle: lateClickHandle })
      } }
      const events = new ExecutionEventStore({ directory: `${input.directory}/events` })
      const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, files: host.agentFiles, provider,
        runs: new ExecutionRunStore(`${input.directory}/runs`), events })
      const started = await engine.start({ conversationId: 'public-html', taskId: 'one-dom-action', selection,
        instruction: '观察当前counter.html，点击Add一次，再重新观察确认Count 1；等待停止，不改源码。',
        documents: [{ documentId: initial.documentId, writable: [], selection: [{ kind: 'document' }] }], permission: 'read-only', workspaceRoot: input.directory })
      const completion = engine.wait(started.runId)
      const freshObserved = await Promise.race([freshReady.then(() => true), completion.then(() => false)])
      if (!freshObserved) {
        const ended = await completion
        return { freshObserved, status: ended.status, failure: ended.failure, tools: ended.tools, catalogs, observations }
      }
      const image = await host.tools.readObservationResource(started.runId, observations.at(-1)!.image.resourceId)
      fs.writeFileSync(`${input.directory}/fresh-dom.png`, image.bytes)
      await engine.stop(started.runId)
      const ended = await completion
      const afterStop = await host.tools.execute(started.runId, 'late-new-click-after-stop', { name: 'html.click', input: { handle: lateClickHandle } })
      const final = await host.internalAPI.read(initial.documentId)
      await events.flushPending()
      return { freshObserved, status: ended.status, failure: ended.failure, tools: ended.tools, turns, catalogs, observations,
        imageDelivered, stoppedSignalObserved, afterStop, initial, final }
    }, { filename, directory })
    await info.attach('Public HTML action facts', { body: JSON.stringify({
      scope: 'actual Main Engine, singleton Gateway and shared HTML preview; controlled provider; supplier not tested', ...facts,
    }, null, 2), contentType: 'application/json' })
    expect(facts.freshObserved, JSON.stringify(facts)).toBe(true)
    expect(facts.status, JSON.stringify(facts)).toBe('stopped')
    expect(facts.tools.map(tool => tool.call.name)).toEqual(['html.observe', 'html.click', 'html.observe'])
    expect(facts.observations).toHaveLength(3)
    expect(facts.observations[0].structure.join('\n')).toContain('Count 0')
    expect(facts.observations[2].structure.join('\n')).toContain('Count 1')
    expect(facts.observations[2].structure.join('\n')).not.toContain('Count 2')
    expect(facts.observations.every(observation => observation.source === 'isolated-html-preview')).toBe(true)
    expect(facts.turns).toBe(4)
    expect(facts.imageDelivered).toBe(true)
    expect(facts.stoppedSignalObserved).toBe(true)
    expect(facts.afterStop).toMatchObject({ kind: 'error', code: 'run-stopped' })
    expect(facts.final).toMatchObject({ revision: 0, undoDepth: 0, redoDepth: 0, dirty: false })
    expect(facts.final!.model).toEqual(facts.initial!.model)
    expect(readFileSync(filename, 'utf8')).toBe(source)
    await info.attach('Fresh real DOM Count 1 screenshot', { path: join(directory, 'fresh-dom.png'), contentType: 'image/png' })
  } finally { if (app) await closeSelectionApp(app) }
})
