// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { ViewObservationDesktopService } from '../../src/main/workbench/observation/ViewObservationDesktopService'
import { registerIpcHandlers, unregisterIpcHandlers } from '../../src/main/ipc'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'
import type { ComponentCompilationResult } from '../../src/core/components/compilation/types'
import type { ViewObservationSnapshot } from '../../src/shared/workbench/viewObservation'

const state = vi.hoisted(() => ({ builds: 0, host: undefined as DocumentHostService | undefined,
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>() }))
vi.mock('../../src/main/workbench/componentCompilerRuntime', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/main/workbench/componentCompilerRuntime')>()
  return { ...actual, loadRuntimeEsbuild: async () => {
    const native = await actual.loadRuntimeEsbuild()
    return { ...native, build: (...args: Parameters<typeof native.build>) => { state.builds++; return native.build(...args) } }
  } }
})
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const { tmpdir } = await import('node:os')
  class Window extends EventEmitter {
    destroyed = false
    readonly webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {},
      executeJavaScript: async (source: string) => {
        const encoded = JSON.parse(source.slice(source.indexOf('(') + 1, -1)) as string
        const request = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
        return { locationId: request.locationId, stateId: request.stateId, structure: ['compiled capture'], diagnostics: request.diagnostics }
      },
      capturePage: async () => ({ getSize: () => ({ width: 320, height: 180 }), isEmpty: () => false, toPNG: () => Buffer.from('png') }),
    })
    async loadURL() {}
    isDestroyed() { return this.destroyed }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed') } }
  }
  return { BrowserWindow: Window, app: { getPath: tmpdir, getAppPath: tmpdir }, dialog: {},
    ipcMain: { removeHandler: (channel: string) => state.handlers.delete(channel),
      handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => state.handlers.set(channel, handler),
      on() {}, removeAllListeners() {}, removeListener() {} },
    session: { fromPartition: () => ({ protocol: { unhandle() {} }, clearStorageData: async () => undefined }) } }
})
vi.mock('../../src/main/workbench/workbenchToolServices', () => ({ installWorkbenchToolServices() {},
  disposeWorkbenchExportPort() {}, acceptWorkbenchExportBuildReply() {}, workbenchImageService() {}, workbenchImageSelection() {} }))
vi.mock('../../src/main/workbench/execution/ExecutionDesktopService', () => ({ executionDesktopService: () => new Promise(() => {}) }))
vi.mock('../../src/main/workbench/workspaceFilesDesktopService', () => ({ subscribeWorkspaceFilesChanges: () => new Promise(() => {}),
  attachHtmlPreviewHost: () => new Promise(() => {}), operateWorkspaceFiles() {} }))
vi.mock('../../src/main/protocols', () => ({ setHtmlPreviewProtocolHandler() {}, installEditorProtocol() {} }))
vi.mock('../../src/main/security', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/main/security')>(), configureRestrictedSession() {},
}))
vi.mock('../../src/main/workbench/documentHost', () => ({ documentHost: () => state.host! }))
vi.mock('../../src/main/diagnosticLog', () => ({ diagnosticLog: { append() {} }, exportDiagnosticReport() {} }))
vi.mock('../../src/main/workbench/images/ImageResultsDesktopService', () => ({ ImageResultsDesktopService: class {} }))
vi.mock('../../src/main/previewNetworkPolicy', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/main/previewNetworkPolicy')>(), mainPreviewNetworkPolicy: {},
}))

afterEach(() => {
  if (state.host) unregisterIpcHandlers()
  state.host = undefined
  state.handlers.clear()
})

it('shares one native build across admission, registered IPC and isolated observation while retaining input and options keys', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-r2-main-compilation-'))
  try {
    state.builds = 0
    const host = state.host = new DocumentHostService(path.join(directory, 'recovery'))
    const project = createBlankCourseProjectV10('Shared Main compilation')
    const source = 'export const value=1; export default {mount(){return {update(){},dispose(){}}}};'
    project.definitions.custom = { id: 'custom', title: 'Program', role: 'content', implementation: {
      kind: 'source', language: 'javascript', workspace: { ownerId: 'shared', entry: 'main.js' },
    } }
    project.instances.a = { id: 'a', definitionId: 'custom', data: {} }
    project.surfaces[0].childIds = ['a']
    const opened = await host.internalAPI.create({ kind: 'course-v10', project, resources: {
      assets: {}, components: { shared: { 'main.js': new TextEncoder().encode(source) } },
    } }, 'compilation.h5lesson')
    await host.tools.beginRun({ runId: 'compilation', actor: 'agent', documents: [{ documentId: opened.documentId, writable: [{ kind: 'document' }] }],
      fileAccess: { permission: 'workspace', workspaceRoot: directory } })
    await host.tools.loadToolFamilies('compilation', ['content'])
    if (opened.model.kind !== 'course-v10') throw new Error('Expected V10')
    const sourceFile = componentProjectFiles(project, opened.model.resources)
      .find(file => file.binding?.kind === 'definition-source' && file.sourceFile?.path === 'main.js')!
    await host.tools.execute('compilation', 'read', { name: 'project.read', input: { path: sourceFile.path } })
    expect(await host.tools.execute('compilation', 'apply', { name: 'project.apply', input: {
      path: sourceFile.path, content: source.replace('value=1', 'value=2'),
    } })).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
    expect(state.builds).toBe(1)

    const snapshot = await host.internalAPI.read(opened.documentId) as ViewObservationSnapshot
    const implementation = snapshot.model.project.definitions.custom.implementation
    if (implementation.kind !== 'source') throw new Error('Expected source')
    const input = componentCompilationInput(snapshot.model.project, implementation, snapshot.model.resources)
    const frame = { detached: false, processId: 1, frameToken: 'main', url: 'http://localhost:5173/' }
    const sender = { mainFrame: frame, id: 1, once() {}, send() {} }
    const window = { isDestroyed: () => false, webContents: sender }
    registerIpcHandlers({ getMainWindow: () => window as never, getRendererEntryUrl: () => frame.url, appState: {} as never })
    const handle = state.handlers.get(IPC_CHANNELS.componentCompilation)!
    const invoke = async (value: typeof input) => {
      const reply = await handle({ sender, senderFrame: frame }, value) as { ok: boolean; value: ComponentCompilationResult }
      expect(reply.ok).toBe(true)
      return reply.value
    }
    expect(await invoke(input)).toMatchObject({ status: 'ready', cacheHit: true })
    const identity = { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
      locationId: project.surfaces[0].id, stateId: null, viewGeneration: 'r2-compiled' }
    for (let capture = 0; capture < 2; capture++) {
      const observation = new ViewObservationDesktopService({ rendererEntryUrl: frame.url, compilation: host.compilation })
      expect(await observation.captureIsolated({ identity, snapshot })).toMatchObject({ identity, diagnostics: [] })
    }
    expect(state.builds).toBe(1)
    const sameInputBuildCount = state.builds

    expect(await invoke({ ...input, files: { 'main.js': source.replace('value=1', 'value=3') } })).toMatchObject({ status: 'ready', cacheHit: false })
    expect(state.builds).toBe(2)
    expect(await invoke({ ...input, options: { minify: true, sourceMap: false } })).toMatchObject({ status: 'ready', cacheHit: false })
    expect(state.builds).toBe(3)
    expect(await invoke({ ...input, files: { 'main.js': 'export const =;' } })).toMatchObject({ status: 'failed',
      diagnostics: [expect.objectContaining({ severity: 'error', file: 'main.js' })] })
    expect(state.builds).toBe(4)
    process.stdout.write(JSON.stringify({ sameInputBuildCount, afterChangedInput: 2, afterChangedOptions: 3, afterInvalidInput: state.builds }) + '\n')
    unregisterIpcHandlers()
    state.host = undefined
    await host.operate({ type: 'close', documentId: opened.documentId, discardDirty: true })
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
