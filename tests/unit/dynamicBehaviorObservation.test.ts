import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { operateDynamicAdmission } from '@/main/dynamicAdmission'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { registerPublishedComponentUpdateProbe, exercisePublishedDynamicUpdates, exercisePublishedDynamicLifecycle } from '@/player/surfaces/publishedDynamicUpdateProbe'

const state = vi.hoisted(() => ({ windows: [] as any[], hang: false, pending: 0, resolveRun: null as null | ((value: unknown) => void), rejectRun: null as null | ((error: Error) => void), clearStorage: vi.fn(async () => {}) }))
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='
vi.mock('@/main/protocols', () => ({ installEditorProtocol: vi.fn() }))
vi.mock('@/main/security', () => ({ configureRestrictedSession: vi.fn() }))
vi.mock('@/main/previewNetworkPolicy', () => ({ PreviewNetworkPolicy: class { replaceBaseOrigins() {} activateDocument() {} replacePreviewLease() {} allowsRequest() { return false } } }))
vi.mock('electron', () => ({ session: { fromPartition: () => ({ clearStorageData: state.clearStorage }) }, BrowserWindow: class {
  destroyed = false
  webContents = {
    setWindowOpenHandler: vi.fn(), on: vi.fn(), once: vi.fn(), getOSProcessId: () => 42,
    forcefullyCrashRenderer: vi.fn(() => state.rejectRun?.(new Error('renderer terminated'))),
    capturePage: vi.fn(async () => ({ toDataURL: () => png, getSize: () => ({ width: 1280, height: 720 }) })),
    executeJavaScript: vi.fn((source: string) => {
      if (source.startsWith('window.__COURSEWARE_ADMISSION_RUN__')) return new Promise((resolve, reject) => { state.resolveRun = resolve; state.rejectRun = reject; state.pending = state.hang ? 0 : 1 })
      if (source.startsWith('window.__COURSEWARE_ADMISSION_PENDING_FRAME__')) return Promise.resolve(state.pending ? { id: state.pending } : null)
      if (source.startsWith('window.__COURSEWARE_ADMISSION_ACCEPT_FRAME__')) {
        const match = source.match(/^window\.__COURSEWARE_ADMISSION_ACCEPT_FRAME__\(1,(.*)\)$/)!
        const frame = JSON.parse(match[1]!)
        if (frame.dataUrl !== png || frame.width !== 1280 || frame.height !== 720) throw new Error('Wrong compositor frame')
        state.pending = 0; state.resolveRun?.({ ok: true, message: 'fixture acknowledged compositor pixels' }); return Promise.resolve()
      }
      throw new Error('Unexpected worker entrypoint')
    }),
  }
  constructor(readonly options: unknown) { state.windows.push(this) }
  async loadURL() {}
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true }
} }))

beforeEach(() => { state.windows.length = 0; state.hang = false; state.pending = 0; state.resolveRun = null; state.rejectRun = null; state.clearStorage.mockClear() })

function request() {
  const project = createBlankCourseProject()
  return { operation: 'run' as const, id: crypto.randomUUID(), payload: { project, assetFiles: {}, componentFiles: {}, observeBehavior: true, verificationMode: 'full-admission' as const,
    targets: [{ locationId: project.startLocationId, instanceIds: ['fixture-instance'] }] } }
}
function owner() { return { once: vi.fn(), removeListener: vi.fn(), getOSProcessId: () => 1 } as unknown as WebContents }

describe('Hidden dynamic observation transport', () => {
  it('captures actual worker compositor output through only the fixed product handshake', async () => {
    const result = await operateDynamicAdmission(request(), owner(), 'http://localhost:5173/index.html')
    expect(result.ok).toBe(true); expect(result.processId).toBe(42)
    const worker = state.windows[0]!
    expect(worker.options).toMatchObject({ show: false, skipTaskbar: true, frame: false, useContentSize: true, webPreferences: { backgroundThrottling: false, sandbox: true, nodeIntegration: false } })
    expect(worker.webContents.capturePage).toHaveBeenCalledOnce(); expect(worker.destroyed).toBe(true); expect(state.clearStorage).toHaveBeenCalledOnce()
  })
  it('cancels a waiting worker without waiting for its frame or resetting its deadline', async () => {
    state.hang = true
    const input = request(), sender = owner(), pending = operateDynamicAdmission(input, sender, 'http://localhost:5173/index.html')
    await vi.waitFor(() => expect(state.resolveRun).not.toBeNull())
    await operateDynamicAdmission({ operation: 'cancel', id: input.id }, sender, 'http://localhost:5173/index.html')
    expect((await pending).ok).toBe(false)
    expect(state.windows[0]!.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce(); expect(state.windows[0]!.webContents.capturePage).not.toHaveBeenCalled()
  })
})

describe('Finite actions reuse the already mounted dynamic handle', () => {
  it('checks public props without resizing and pauses/resumes without hiding the surface', async () => {
    const root = document.createElement('div'), mount = document.createElement('div'); root.append(mount)
    const handle = { ok: true, updateProps: vi.fn(), resize: vi.fn(), waitForReady: vi.fn(async () => {}), suspend: vi.fn(), resume: vi.fn() }
    const unregister = registerPublishedComponentUpdateProbe(root, handle, () => ({ props: { speed: 0.5 }, width: 400, height: 300 }))
    await exercisePublishedDynamicUpdates(mount, { resize: false })
    expect(handle.updateProps).toHaveBeenCalledWith({ speed: 0.5 }); expect(handle.resize).not.toHaveBeenCalled()
    await exercisePublishedDynamicLifecycle(mount, 'suspend'); await exercisePublishedDynamicLifecycle(mount, 'resume')
    expect(handle.suspend).toHaveBeenCalledOnce(); expect(handle.resume).toHaveBeenCalledOnce(); expect(root.hidden).toBe(false)
    unregister()
    await expect(exercisePublishedDynamicLifecycle(mount, 'suspend')).rejects.toThrow('生命周期入口')
  })
})
