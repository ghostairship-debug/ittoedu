import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { runDynamicCandidateHostSmoke } from '@/renderer/authoring/tools/dynamicCandidateAdmission'
import { AuthoringToolFailure } from '@/renderer/authoring/tools/executeAuthoringTool'

const probe = vi.hoisted(() => ({ mounts: 0, destroys: 0, failMount: 1, failDestroy: false }))
vi.mock('@/renderer/authoring/tools/dynamicCandidateFallbackAssets', () => ({ validateDynamicCandidateFallbackAssets: vi.fn(async () => {}) }))
vi.mock('@/renderer/export/course/buildPublishedCourse', () => ({ buildPublishedCourseV2Payload: vi.fn(() => ({})), collectPublishedCourseSourceIssues: vi.fn(() => []) }))
vi.mock('@/player/surfaces/publishedCapture', () => ({ waitForPublishedObservationReady: vi.fn(async () => {}), capturePublishedSurfacePng: vi.fn(async () => 'data:image/png;base64,AA==') }))
vi.mock('@/player/surfaces/publishedDynamicUpdateProbe', () => ({
  exercisePublishedDynamicUpdates: vi.fn(async () => { if (probe.mounts === probe.failMount) throw new Error('updateProps rejected after sampled frames') }),
  exercisePublishedDynamicLifecycle: vi.fn(async () => {}),
}))
vi.mock('@/player/surfaces/publishedDynamicHosts', () => ({ createPublishedCourseSession: () => ({
  async mount(root: HTMLElement) { probe.mounts++; const element = document.createElement('div'); element.className = 'published-component-mount'; element.dataset.componentInstanceId = 'instance'; root.append(element) },
  readObservationState: () => ({ ready: true, stateVersion: 7, publicState: { speed: 0.5 } }),
  player: { suspendSurface: async () => ({ ok: true }), resumeSurface: async () => ({ ok: true }), captureSurface: async () => ({ ok: true }) },
  async destroy() { probe.destroys++; if (probe.failDestroy) throw new Error('destroy rejected') },
}) }))

beforeEach(() => { probe.mounts = 0; probe.destroys = 0; probe.failMount = 1; probe.failDestroy = false; vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D) })
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

  it('keeps earlier target observations alongside partial evidence from the failed target', async () => {
    const project = createBlankCourseProject(), observed = vi.fn(); probe.failMount = 2
    const error = await runDynamicCandidateHostSmoke(project, { assetFiles: {}, componentPackages: {} }, [1, 2].map(() => ({ locationId: project.startLocationId, instanceIds: ['instance'] })), false,
      { onBehaviorEvidence: observed, capturePort: { captureFrame: async () => ({ capturedAt: Date.now(), width: 1, height: 1, dataUrl: 'data:image/png;base64,AA==' }) } }).catch(value => value)
    expect(error).toBeInstanceOf(AuthoringToolFailure)
    expect(error.behaviorEvidence.map((item: { frames: unknown[] }) => item.frames.length)).toEqual([6, 3])
    expect(error.behaviorEvidence[0].actions).toEqual(['update-inputs', 'resize-and-restore', 'suspend', 'resume'])
    expect(observed).toHaveBeenCalledOnce(); expect(probe.destroys).toBe(2)
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
