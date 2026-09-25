import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { runDynamicCandidateHostSmoke } from '@/renderer/authoring/tools/dynamicCandidateAdmission'
import { AuthoringToolFailure } from '@/renderer/authoring/tools/executeAuthoringTool'
import type { CapturePublishedSurfaceOptions } from '@/player/surfaces/publishedCapture'

const probe = vi.hoisted(() => ({ mounts: 0, destroys: 0, failMount: 1, failDestroy: false, fallbackMarker: false as false | 'inactive' | 'target', activeSurfaceId: '', locationId: '', stateId: null as string | null }))
const capturePublishedSurfacePng = vi.hoisted(() => vi.fn<(
  options: CapturePublishedSurfaceOptions,
) => Promise<string>>(async () => 'data:image/png;base64,AA=='))
vi.mock('@/renderer/authoring/tools/dynamicCandidateFallbackAssets', () => ({ validateDynamicCandidateFallbackAssets: vi.fn(async () => {}) }))
vi.mock('@/renderer/export/course/buildPublishedCourse', () => ({ buildPublishedCourseV2Payload: vi.fn(() => ({})), collectPublishedCourseSourceIssues: vi.fn(() => []) }))
vi.mock('@/player/surfaces/publishedCapture', () => ({ waitForPublishedObservationReady: vi.fn(async () => {}), capturePublishedSurfacePng }))
vi.mock('@/player/surfaces/publishedDynamicUpdateProbe', () => ({
  exercisePublishedDynamicUpdates: vi.fn(async () => { if (probe.mounts === probe.failMount) throw new Error('updateProps rejected after sampled frames') }),
  exercisePublishedDynamicLifecycle: vi.fn(async () => {}),
}))
vi.mock('@/player/surfaces/publishedDynamicHosts', () => ({ createPublishedCourseSession: (_payload: unknown, options: { initialLocationId: string; initialPresentationStateId?: string }) => ({
  async mount(root: HTMLElement) { probe.locationId = options.initialLocationId; probe.stateId = options.initialPresentationStateId ?? null; probe.mounts++; const activeSlot = document.createElement('div'); activeSlot.dataset.courseSurfaceSlot = probe.activeSurfaceId; const element = document.createElement('div'); element.className = 'published-component-mount'; element.dataset.componentInstanceId = 'instance'; activeSlot.append(element); root.append(activeSlot); if (probe.fallbackMarker) { const slot = probe.fallbackMarker === 'inactive' ? document.createElement('div') : activeSlot; slot.dataset.courseSurfaceSlot = probe.fallbackMarker === 'inactive' ? 'hidden-surface' : probe.activeSurfaceId; const owner = document.createElement('section'); owner.dataset.surfaceId = slot.dataset.courseSurfaceSlot; owner.dataset.locationId = probe.fallbackMarker === 'inactive' ? 'hidden-location' : options.initialLocationId; const fallback = document.createElement('div'); fallback.className = 'published-component-fallback'; fallback.dataset.componentInstanceId = probe.fallbackMarker === 'inactive' ? 'hidden-instance' : 'instance'; fallback.dataset.componentPackageId = probe.fallbackMarker === 'inactive' ? 'hidden-package' : 'target-package'; fallback.hidden = probe.fallbackMarker === 'inactive'; owner.append(fallback); slot.append(owner); if (probe.fallbackMarker === 'inactive') root.append(slot) } },
  async goToObservationTarget(locationId: string, stateId?: string) { probe.locationId = locationId; probe.stateId = stateId ?? null; probe.mounts++ },
  readObservationState: () => ({ ready: true, locationId: probe.locationId, stateId: probe.stateId, stateVersion: 7, publicState: { speed: 0.5 } }),
  player: { suspendSurface: async () => ({ ok: true }), resumeSurface: async () => ({ ok: true }), captureSurface: async () => ({ ok: true }) },
  async destroy() { probe.destroys++; if (probe.failDestroy) throw new Error('destroy rejected') },
}) }))

beforeEach(() => { probe.mounts = 0; probe.destroys = 0; probe.failMount = 1; probe.failDestroy = false; probe.fallbackMarker = false; probe.activeSurfaceId = ''; capturePublishedSurfacePng.mockClear(); vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, toJSON() {} }); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D) })
afterEach(() => { vi.restoreAllMocks() })

describe('dynamic admission acquired failure evidence', () => {
  it('retains sampled frames and only completed actions when later lifecycle work fails', async () => {
    const project = createBlankCourseProject(), before = document.body.childElementCount
    const error = await runDynamicCandidateHostSmoke(project, { assetFiles: {}, componentPackages: {} }, [{ locationId: project.startLocationId, instanceIds: ['instance'] }], false,
      { capturePort: { captureFrame: async () => ({ capturedAt: Date.now(), width: 1, height: 1, dataUrl: 'data:image/png;base64,AA==' }) } }).catch(value => value)
    expect(error).toBeInstanceOf(AuthoringToolFailure)
    expect(error.diagnostics).toEqual([{ code: 'dynamic-host-failed', message: 'updateProps rejected after sampled frames', path: ['locations', project.startLocationId, 'instances', 'instance'] }])
    expect(error.behaviorEvidence).toHaveLength(1)
    expect(error.behaviorEvidence[0]).toMatchObject({ status: 'observed', actions: [], semanticVerdict: 'requires-review' })
    expect(error.behaviorEvidence[0].frames).toHaveLength(3)
    expect(error.behaviorEvidence[0].frames.every((frame: { phase: string }) => frame.phase === 'running')).toBe(true)
    expect(probe.destroys).toBe(1); expect(document.body.childElementCount).toBe(before)
  })

  it('ignores fallback from an inactive surface while retaining target admission', async () => {
    const project = createBlankCourseProject(); probe.activeSurfaceId = project.surfaces[0].id; probe.fallbackMarker = 'inactive'; probe.failMount = 0
    const captures = await runDynamicCandidateHostSmoke(project, { assetFiles: {}, componentPackages: {} }, [{ locationId: project.startLocationId, instanceIds: ['instance'] }], false)
    expect(captures).toEqual([])
    expect(probe.destroys).toBe(1)
  })

  it('captures Flow candidates through the stable owner that holds the capture barrier', async () => {
    const project = createBlankFlowCourseProject(); probe.activeSurfaceId = project.surfaces[0].id; probe.failMount = 0
    await runDynamicCandidateHostSmoke(project, { assetFiles: {}, componentPackages: {} }, [{ locationId: project.startLocationId, instanceIds: ['instance'] }], false)
    expect(capturePublishedSurfacePng).toHaveBeenCalledOnce()
    const options = capturePublishedSurfacePng.mock.calls[0]![0]
    expect(options.layers).toHaveLength(1)
    expect(options.layers[0]!.element.dataset.courseSurfaceSlot).toBe(project.surfaces[0].id)
    expect(options.layers[0]!.element.querySelector('[data-component-instance-id="instance"]')).not.toBeNull()
  })

  it('reports target fallback ownership while retaining rejection', async () => {
    const project = createBlankCourseProject(); probe.activeSurfaceId = project.surfaces[0].id; probe.fallbackMarker = 'target'; probe.failMount = 0
    const error = await runDynamicCandidateHostSmoke(project, { assetFiles: {}, componentPackages: {} }, [{ locationId: project.startLocationId, instanceIds: ['instance'] }], false).catch(value => value)
    expect(error).toBeInstanceOf(AuthoringToolFailure)
    expect(error.diagnostics).toHaveLength(1)
    expect(error.diagnostics[0]).toMatchObject({ code: 'dynamic-host-failed', path: ['locations', project.startLocationId, 'instances', 'instance'] })
    expect(error.diagnostics[0].message).toContain('动态候选触发了静态后备：')
    expect(error.diagnostics[0].message).toContain('"instanceId":"instance"')
    expect(error.diagnostics[0].message).toContain(`"slotSurfaceId":"${project.surfaces[0].id}"`)
    expect(error.diagnostics[0].message).toContain(`"ownerLocationId":"${project.startLocationId}"`)
    expect(error.diagnostics[0].message).toContain('"isTargetInstance":true')
    expect(probe.destroys).toBe(1)
  })

  it('keeps earlier target observations alongside partial evidence from the failed target', async () => {
    const project = createBlankCourseProject(), observed = vi.fn(); probe.failMount = 2
    const error = await runDynamicCandidateHostSmoke(project, { assetFiles: {}, componentPackages: {} }, [1, 2].map(() => ({ locationId: project.startLocationId, instanceIds: ['instance'] })), false,
      { onBehaviorEvidence: observed, capturePort: { captureFrame: async () => ({ capturedAt: Date.now(), width: 1, height: 1, dataUrl: 'data:image/png;base64,AA==' }) } }).catch(value => value)
    expect(error).toBeInstanceOf(AuthoringToolFailure)
    expect(error.behaviorEvidence.map((item: { frames: unknown[] }) => item.frames.length)).toEqual([6, 1])
    expect(error.behaviorEvidence[0].actions).toEqual(['update-inputs', 'resize-and-restore', 'suspend', 'resume'])
    expect(observed).toHaveBeenCalledOnce(); expect(probe.destroys).toBe(1)
  })

  it('retains the original failed frames and diagnostic when cleanup also fails', async () => {
    const project = createBlankCourseProject(), before = document.body.childElementCount; probe.failDestroy = true
    const error = await runDynamicCandidateHostSmoke(project, { assetFiles: {}, componentPackages: {} }, [{ locationId: project.startLocationId, instanceIds: ['instance'] }], false,
      { capturePort: { captureFrame: async () => ({ capturedAt: Date.now(), width: 1, height: 1, dataUrl: 'data:image/png;base64,AA==' }) } }).catch(value => value)
    expect(error).toBeInstanceOf(AuthoringToolFailure)
    expect(error.diagnostics.map((item: { code: string }) => item.code)).toEqual(['dynamic-host-failed', 'dynamic-host-destroy-failed'])
    expect(error.behaviorEvidence[0].frames).toHaveLength(3)
    expect(document.body.childElementCount).toBe(before)
  })
})
