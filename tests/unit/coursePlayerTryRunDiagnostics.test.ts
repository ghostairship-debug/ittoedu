import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  mountPublishedCourseTryRun,
  TRY_RUN_INTERACTION_DIAGNOSTIC_LIMIT,
} from '@/renderer/ui/coursePlayerTryRun'
import type { InteractionRule } from '@/shared/contracts/interaction-v1/types'
import { createAuthoringObservationController } from '@/renderer/authoring/generation/authoringObservation'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function mockClientSize(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
}

/** A valid V9 rule whose trigger the Published Interaction controller skips. */
function unsupportedRule(index: number): InteractionRule {
  return {
    id: `rule-unsupported-${index}`,
    enabled: true,
    trigger: { type: 'presentation.enter', stateId: 'state_initial' },
    conditions: [],
    actions: [{
      id: `step-${index}`,
      start: 'after-previous',
      delayMs: 0,
      action: { type: 'scene.replay' },
    }],
  }
}

function projectWithRules(rules: InteractionRule[]) {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Slide fixture required')
  surface.scenes[0]!.interactions.push(...rules)
  return project
}

function hostContainer(): HTMLElement {
  const container = document.createElement('div')
  mockClientSize(container, 1280, 720)
  document.body.append(container)
  return container
}

describe('try-run interaction diagnostics', () => {
  it('reports the real mount buffer overflow in its first observation', async () => {
    const project = projectWithRules(Array.from({ length: 60 }, (_, i) => unsupportedRule(i)))
    const root = hostContainer()
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 700, bottom: 500,
      width: 700, height: 500, toJSON: () => ({}) })
    const session = await mountPublishedCourseTryRun({ container: root, project, assetFiles: {}, components: {}, onInteractionDiagnostic() {} })
    const state = { document: project, sessionGeneration: 1, surfaceId: project.surfaces[0]!.id, locationId: project.startLocationId,
      stateId: null, selectedIds: [], draft: null, assetFiles: {} }
    const controller = createAuthoringObservationController({ read: () => state, prepareForEdit: () => ({ ok: true }),
      materializeDraft: () => ({ ok: true, snapshot: { project } }), waitForPaint: async () => {},
      captureImage: async () => ({ dataUrl: 'data:image/png;base64,AA==', width: 700, height: 500, capturedAt: Date.now() }) })
    try {
      const result = await controller.capture({ intent: 'discuss' })
      const evidence = JSON.parse(result.resourceFiles.find(file => file.path === 'observation/interaction-diagnostics.json')!.content)
      expect(evidence.truncated).toBe(true); expect(evidence.diagnostics).toHaveLength(50)
      expect(evidence.diagnostics[0].ruleId).toBe('rule-unsupported-10')
    } finally { controller.dispose(); await session.destroy() }
  })

  it('forwards rule-skip diagnostics to the callback and the bounded session buffer', async () => {
    const project = projectWithRules([unsupportedRule(1)])
    const onInteractionDiagnostic = vi.fn()
    const session = await mountPublishedCourseTryRun({
      container: hostContainer(),
      project,
      assetFiles: {},
      components: {},
      onInteractionDiagnostic,
    })
    try {
      await vi.waitFor(() => expect(onInteractionDiagnostic).toHaveBeenCalled())
      const diagnostic = onInteractionDiagnostic.mock.calls[0]![0]
      expect(diagnostic).toMatchObject({
        code: 'unsupported-trigger',
        ruleId: 'rule-unsupported-1',
        severity: 'warning',
        phase: 'execute',
      })
      const records = session.readInteractionDiagnostics()
      expect(records).toHaveLength(1)
      expect(typeof records[0]!.receivedAt).toBe('number')
      expect(records[0]!.diagnostic).toMatchObject({
        code: 'unsupported-trigger',
        ruleId: 'rule-unsupported-1',
      })
    } finally {
      await session.destroy()
    }
    expect(session.readInteractionDiagnostics()).toEqual([])
  })

  it('keeps only the most recent diagnostics inside the bounded buffer', async () => {
    const total = TRY_RUN_INTERACTION_DIAGNOSTIC_LIMIT + 10
    const project = projectWithRules(
      Array.from({ length: total }, (_, index) => unsupportedRule(index)),
    )
    const onInteractionDiagnostic = vi.fn()
    const session = await mountPublishedCourseTryRun({
      container: hostContainer(),
      project,
      assetFiles: {},
      components: {},
      onInteractionDiagnostic,
    })
    try {
      await vi.waitFor(() => expect(onInteractionDiagnostic).toHaveBeenCalledTimes(total))
      const records = session.readInteractionDiagnostics()
      expect(records).toHaveLength(TRY_RUN_INTERACTION_DIAGNOSTIC_LIMIT)
      expect(records[0]!.diagnostic.ruleId).toBe('rule-unsupported-10')
      expect(records[records.length - 1]!.diagnostic.ruleId).toBe(`rule-unsupported-${total - 1}`)
    } finally {
      await session.destroy()
    }
  })

  it('collects nothing and stays mountable when no diagnostics hook is supplied', async () => {
    const project = projectWithRules([unsupportedRule(1)])
    const session = await mountPublishedCourseTryRun({
      container: hostContainer(),
      project,
      assetFiles: {},
      components: {},
    })
    try {
      expect(session.readInteractionDiagnostics()).toEqual([])
    } finally {
      await session.destroy()
    }
  })
})
