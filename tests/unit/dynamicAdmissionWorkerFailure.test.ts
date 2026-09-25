import { describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { dynamicBehaviorObservationSchema } from '@/shared/dynamicBehaviorObservation'
import { AuthoringToolFailure } from '@/renderer/authoring/tools/executeAuthoringTool'

const smoke = vi.hoisted(() => vi.fn())
vi.mock('@/renderer/authoring/tools/dynamicCandidateAdmission', () => ({ runDynamicCandidateHostSmoke: smoke }))
vi.mock('@/shared/fonts/installBundledFontFaces', () => ({ installBundledFontFaces: vi.fn() }))
vi.mock('@/shared/fonts/ensureBundledFonts', () => ({ ensureBundledFonts: vi.fn(async () => {}) }))
import '@/renderer/authoring/generation/admissionWorker'

describe('dynamic worker failure result', () => {
  it('returns acquired observations after worker teardown errors and does not duplicate structured smoke evidence', async () => {
    const project = createBlankCourseProject(), input = { project, assetFiles: {}, componentFiles: {}, targets: [{ locationId: project.startLocationId, instanceIds: ['instance'] }] }
    const evidence = dynamicBehaviorObservationSchema.parse({ version: 1, status: 'observed', mode: 'public-props', projectId: project.id, documentRevision: project.revision,
      locationId: project.startLocationId, stateId: null, instanceIds: ['instance'], sourceIdentities: { instance: 'source' }, actions: ['update-inputs'], elapsedMs: 1, semanticVerdict: 'requires-review',
      frames: [{ phase: 'running', elapsedMs: 1, capturedAt: 1, stateVersion: 1, publicState: {}, width: 1, height: 1, dataUrl: 'data:image/png;base64,AA==' }] })
    const run = Reflect.get(window, '__COURSEWARE_ADMISSION_RUN__') as (value: unknown) => Promise<unknown>
    smoke.mockImplementationOnce(async (_project, _resources, _targets, _captures, options) => { options.onBehaviorEvidence([evidence]); throw new Error('teardown rejected') })
    expect(await run(input)).toEqual({ ok: false, message: 'teardown rejected', behaviorEvidence: [evidence] })
    const diagnostics = [{ code: 'dynamic-host-failed', message: 'later target rejected', path: ['instances', 'instance'] }]
    smoke.mockImplementationOnce(async (_project, _resources, _targets, _captures, options) => { options.onBehaviorEvidence([evidence]); throw new AuthoringToolFailure(diagnostics, [evidence]) })
    expect(await run(input)).toMatchObject({ ok: false, diagnostics, behaviorEvidence: [evidence] })
    expect(Reflect.get(window, '__COURSEWARE_ADMISSION_PENDING_FRAME__')()).toBeNull()
  })
})
