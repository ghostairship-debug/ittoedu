import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { runDynamicCandidateHostSmoke } from '@/renderer/authoring/tools/dynamicCandidateAdmission'
import type { DynamicBehaviorObservation, DynamicButtonCheck } from '@/shared/dynamicBehaviorObservation'

const probe = vi.hoisted(() => ({ locationId: '', stateId: null as string | null }))
vi.mock('@/renderer/authoring/tools/dynamicCandidateFallbackAssets', () => ({ validateDynamicCandidateFallbackAssets: vi.fn(async () => {}) }))
vi.mock('@/renderer/export/course/buildPublishedCourse', () => ({ buildPublishedCourseV2Payload: vi.fn(() => ({})), collectPublishedCourseSourceIssues: vi.fn(() => []) }))
vi.mock('@/player/surfaces/publishedCapture', () => ({ waitForPublishedObservationReady: vi.fn(async () => {}), capturePublishedSurfacePng: vi.fn(async () => 'data:image/png;base64,AA==') }))
vi.mock('@/player/surfaces/publishedDynamicUpdateProbe', () => ({
  exercisePublishedDynamicUpdates: vi.fn(async () => {}),
  exercisePublishedDynamicLifecycle: vi.fn(async () => {}),
}))
vi.mock('@/player/surfaces/publishedDynamicHosts', () => ({ createPublishedCourseSession: (_payload: unknown, options: { initialLocationId: string; initialPresentationStateId?: string }) => ({
  async mount(root: HTMLElement) {
    probe.locationId = options.initialLocationId
    probe.stateId = options.initialPresentationStateId ?? null
    const mount = document.createElement('div')
    mount.className = 'published-component-mount'
    mount.dataset.componentInstanceId = 'instance'
    const button = document.createElement('button')
    button.textContent = '继续'
    // The smoke host root is pointer-events:none; the real hit-test path sees
    // the component's own interactive control instead of the inherited value.
    button.style.pointerEvents = 'auto'
    mount.append(button)
    root.append(mount)
  },
  async goToObservationTarget(locationId: string, stateId?: string) { probe.locationId = locationId; probe.stateId = stateId ?? null },
  readObservationState: () => ({ ready: true, locationId: probe.locationId, stateId: probe.stateId, stateVersion: 7, publicState: {} }),
  player: { suspendSurface: async () => ({ ok: true }), resumeSurface: async () => ({ ok: true }), captureSurface: async () => ({ ok: true }) },
  async destroy() {},
}) }))

beforeEach(() => {
  probe.locationId = ''
  probe.stateId = null
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, toJSON() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => document.querySelector('.published-component-mount button'),
  })
})
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

async function runButtonCheck(buttonCheck: DynamicButtonCheck): Promise<DynamicBehaviorObservation[]> {
  const project = createBlankCourseProject()
  const evidence: DynamicBehaviorObservation[] = []
  await runDynamicCandidateHostSmoke(project, { assetFiles: {}, componentPackages: {} },
    [{ locationId: project.startLocationId, instanceIds: ['instance'] }], false, {
      buttonCheck,
      onBehaviorEvidence: values => evidence.push(...values),
      capturePort: {
        captureFrame: async () => ({ capturedAt: Date.now(), width: 1, height: 1, dataUrl: 'data:image/png;base64,AA==' }),
        clickAt: async () => { probe.locationId = 'location-destination'; probe.stateId = 'state-on' },
      },
    })
  return evidence
}

describe('button check destination expectation', () => {
  it.each([
    { expectLocationId: 'location-destination' },
    { expectStateId: 'state-on' },
  ])('checks only the explicitly supplied destination fields: %j', async expectation => {
    const evidence = await runButtonCheck({ version: 1, instanceId: 'instance', label: '继续', ...expectation })
    const destination = evidence[0]!.buttonClick!.destination!
    expect(destination.matched).toBe(true)
    expect(Object.hasOwn(destination, 'expectedLocationId')).toBe('expectLocationId' in expectation)
    expect(Object.hasOwn(destination, 'expectedStateId')).toBe('expectStateId' in expectation)
  })

  it('records a matched destination when the click reaches the expected location and state', async () => {
    const evidence = await runButtonCheck({ version: 1, instanceId: 'instance', label: '继续',
      expectLocationId: 'location-destination', expectStateId: 'state-on' })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]!.buttonClick?.destination).toEqual({
      expectedLocationId: 'location-destination',
      expectedStateId: 'state-on',
      actualLocationId: 'location-destination',
      actualStateId: 'state-on',
      matched: true,
    })
  })

  it('records a missed destination without failing the admission path', async () => {
    const evidence = await runButtonCheck({ version: 1, instanceId: 'instance', label: '继续',
      expectLocationId: 'location-elsewhere', expectStateId: null })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]!.buttonClick?.destination).toEqual({
      expectedLocationId: 'location-elsewhere',
      expectedStateId: null,
      actualLocationId: 'location-destination',
      actualStateId: 'state-on',
      matched: false,
    })
    expect(evidence[0]!.status).toBe('observed')
  })

  it('keeps the observe-only button check unchanged without expectations', async () => {
    const evidence = await runButtonCheck({ version: 1, instanceId: 'instance', label: '继续' })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]!.buttonClick).toBeDefined()
    expect(evidence[0]!.buttonClick).not.toHaveProperty('destination')
  })
})
