import { describe, expect, it } from 'vitest'
import type { AuthoringToolDestinationV1, AuthoringToolTargetWireV1 } from '@/shared/authoringToolContract'
import type { CourseProjectDocument, LayerItem } from '@/shared/courseProjectTypes'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import {
  activateSlidePresentationState,
  makeSlideAuthoringTarget,
  openSlideAuthoringSession,
  selectSlideLayers,
} from '@/renderer/course/slideAuthoringBackend'
import { commitSlideMultiLayerIntentAtTargets } from '@/renderer/course/v9SlideContentCommands'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { layerEditTool } from '@/renderer/authoring/tools/layerEditTool'
import { executeAuthoringTool } from '@/renderer/authoring/tools/executeAuthoringTool'
import {
  commitEditorTransactionToAuthoringHistory,
  createResourceAwareAuthoringHistory,
} from '@/renderer/authoring/resourceAwareAuthoringHistory'
import { applyEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'

function textItem(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  order: number,
  input: { readonly locked?: boolean; readonly rotation?: number } = {},
): LayerItem {
  return sceneNodeToCourseLayerItem(createTextNode({
    id,
    name: id,
    text: id,
    x,
    y,
    width,
    height,
    locked: input.locked,
    rotation: input.rotation,
  }), order)
}

function fixture(): CourseProjectDocument {
  const project = createBlankCourseProject({
    id: 'u06-layout',
    now: '2026-09-17T00:00:00.000Z',
    includeDefaultController: false,
    controls: 'none',
    idFactory: () => 'scene',
  })
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('Expected Slide fixture')
  project.componentPackages['example.layout'] = {
    packageId: 'example.layout',
    version: '4.0.0',
    name: 'Layout component',
    manifestPath: 'components/example.layout/manifest.json',
    runtimePath: 'components/example.layout/runtime.js',
    contentSha256: '0'.repeat(64),
  }
  const scene = surface.scenes[0]!
  scene.layerItems = [
    textItem('native-a', 40, 40, 160, 80, 0),
    {
      kind: 'component',
      layerItemId: 'component-b',
      label: 'Component B',
      order: 1,
      visible: true,
      locked: false,
      rotation: 18,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
      frame: { mode: 'absolute', x: 450, y: 230, width: 220, height: 120 },
      component: { packageId: 'example.layout', version: '4.0.0' },
      props: { title: 'B' },
    },
    textItem('locked-c', 760, 320, 140, 70, 2, { locked: true, rotation: -12 }),
    textItem('untouched-d', 1000, 500, 120, 60, 3),
  ]
  const state = scene.presentation!.states[0]!
  state.layerItemOverrides = {
    'native-a': { frame: { x: 90, y: 120 } },
    'component-b': { frame: { x: 470, y: 260 } },
    'locked-c': { frame: { x: 790, y: 340 } },
  }
  return project
}

function projection(project: CourseProjectDocument, owner: 'scene' | 'global' = 'scene') {
  return projectEffectiveLayers({
    project,
    locationId: project.startLocationId,
    stateId: 'state_initial',
    owner,
  })
}

function wireTargets(
  project: CourseProjectDocument,
  ids: readonly string[],
  owner: 'scene' | 'global' = 'scene',
): AuthoringToolTargetWireV1[] {
  const view = projection(project, owner)
  return ids.map((itemId) => {
    const row = view.unifiedRows.find((candidate) => candidate.id === itemId)
    if (!row) throw new Error(`Missing row ${itemId}`)
    return {
      projectId: project.id,
      documentRevision: project.revision,
      revisionPolicy: { kind: 'exact' },
      sessionGeneration: 4,
      surfaceType: 'slide',
      surfaceId: view.surfaceId,
      locationId: view.locationId,
      stateId: view.stateId,
      owner,
      ownerKey: row.ownerKey,
      itemId,
      authoringAddress: row.authoringAddress,
    }
  })
}

function effectiveFrames(project: CourseProjectDocument, ids: readonly string[]) {
  const rows = projection(project).unifiedRows
  return Object.fromEntries(ids.map((id) => [id, rows.find((row) => row.id === id)!.frame]))
}

function toolHarness(project: CourseProjectDocument) {
  let history = createResourceAwareAuthoringHistory(project)
  const steps: EditorTransactionStep[] = []
  return {
    document: () => history.present,
    steps,
    run(input: unknown, target: AuthoringToolTargetWireV1) {
      const destination: AuthoringToolDestinationV1 = { kind: 'update', target }
      return executeAuthoringTool({
        version: 1,
        requestId: `u06-${steps.length}`,
        tool: layerEditTool.name,
        destination,
        input,
      }, layerEditTool, {
        readDocument: () => history.present,
        validateDestination: () => null,
        commit(step) {
          history = commitEditorTransactionToAuthoringHistory(history, step)
          steps.push(step)
          return true
        },
      })
    },
  }
}

describe('formal multi-layer layout', () => {
  it('U06-layout-parity shares rotated, locked, mixed Native/Component named-state planning between UI and AI', async () => {
    const original = fixture()
    const ids = ['native-a', 'component-b', 'locked-c'] as const

    let uiSession = openSlideAuthoringSession(structuredClone(original))
    const activated = activateSlidePresentationState(uiSession, 'state_initial')
    if (!activated.ok || !activated.nextSession) throw new Error(activated.reason)
    const selected = selectSlideLayers(activated.nextSession, { nodeIds: [...ids] })
    if (!selected.ok || !selected.nextSession) throw new Error(selected.reason)
    uiSession = selected.nextSession
    const uiResult = commitSlideMultiLayerIntentAtTargets(uiSession, {
      targets: ids.map((id) => makeSlideAuthoringTarget(uiSession, id, 'item')),
      intent: { kind: 'align', mode: 'top' },
    }, { expectedRevision: original.revision, now: '2026-09-17T01:00:00.000Z' })
    expect(uiResult.ok, uiResult.reason).toBe(true)
    const uiDocument = uiResult.nextSession!.history.present

    const aiProject = structuredClone(original)
    const targets = wireTargets(aiProject, ids)
    const ai = toolHarness(aiProject)
    const receipt = await ai.run({
      operation: 'align',
      targets,
      mode: 'top',
      primaryTarget: targets[0],
    }, targets[0]!)
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    expect(ai.steps).toHaveLength(1)

    expect(effectiveFrames(ai.document(), [...ids, 'untouched-d'])).toEqual(
      effectiveFrames(uiDocument, [...ids, 'untouched-d']),
    )
    expect(effectiveFrames(ai.document(), ['locked-c', 'untouched-d'])).toEqual(
      effectiveFrames(original, ['locked-c', 'untouched-d']),
    )
    const surface = ai.document().surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('Expected Slide result')
    expect(surface.scenes[0]!.layerItems.find((item) => item.layerItemId === 'native-a')!.frame).toEqual(
      original.surfaces[0]!.type === 'slide'
        ? original.surfaces[0]!.scenes[0]!.layerItems.find((item) => item.layerItemId === 'native-a')!.frame
        : null,
    )
    expect(surface.scenes[0]!.presentation!.states[0]!.layerItemOverrides['component-b']!.frame).toBeDefined()
  })

  it('U06-atomic-roundtrip validates the primary target, rejects cross-plane targets without a write, and commits one undoable transaction', async () => {
    const invalidProject = fixture()
    invalidProject.globalLayerItems.push(
      { item: textItem('global-underlay', 20, 20, 100, 50, 0), plane: 'underlay', visibility: { mode: 'all', locationIds: [] } },
      { item: textItem('global-overlay', 300, 100, 100, 50, 1), plane: 'overlay', visibility: { mode: 'all', locationIds: [] } },
    )
    const crossPlaneTargets = wireTargets(invalidProject, ['global-underlay', 'global-overlay'], 'global')
    const invalid = toolHarness(invalidProject)
    const invalidBefore = structuredClone(invalid.document())
    const crossPlane = await invalid.run({
      operation: 'align',
      targets: crossPlaneTargets,
      mode: 'left',
      primaryTarget: crossPlaneTargets[0],
    }, crossPlaneTargets[0]!)
    expect(crossPlane.status).toBe('failed')
    expect(crossPlane.diagnostics[0]?.message).toContain('同一 Owner 和平面')
    expect(invalid.steps).toHaveLength(0)
    expect(invalid.document()).toEqual(invalidBefore)

    const project = fixture()
    const ids = ['native-a', 'component-b', 'untouched-d'] as const
    const targets = wireTargets(project, ids)
    const valid = toolHarness(project)
    const badPrimary = { ...targets[0]!, itemId: 'not-in-targets' }
    const rejected = await valid.run({
      operation: 'align',
      targets,
      mode: 'middle',
      primaryTarget: badPrimary,
    }, targets[0]!)
    expect(rejected.status).toBe('failed')
    expect(valid.steps).toHaveLength(0)

    const receipt = await valid.run({ operation: 'distribute', targets, axis: 'horizontal' }, targets[0]!)
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    expect(valid.steps).toHaveLength(1)
    const reopened = courseProjectDocumentSchema.parse(JSON.parse(JSON.stringify(valid.document())))
    expect(effectiveFrames(reopened, ids)).toEqual(effectiveFrames(valid.document(), ids))
    const undone = applyEditorTransactionStep({
      document: valid.document(),
      resources: { assetFiles: {}, componentPackages: {} },
    }, valid.steps[0]!, 'inverse')
    expect(undone.document).toEqual(project)
  })
})
