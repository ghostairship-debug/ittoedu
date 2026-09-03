import { beforeEach, describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { selectRuntimeSourceAuthoringView } from '@/renderer/runtime/runtimeSourceAuthoringView'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import type {
  CourseProjectDocument,
  SlideSceneDocument,
} from '@/shared/courseProjectTypes'

const NOW = '2026-08-24T04:30:00.000Z'
const UNRELATED_LAYER_ID = 'unrelated-text'
const UNRELATED_ASSET_ID = 'asset-unrelated'
const UNRELATED_ASSET_BYTES = Uint8Array.from([7, 4, 7, 5, 5])

let sceneRuntimeId = ''
let globalRuntimeId = ''

function lifecycleProject(): CourseProjectDocument {
  const project = createBlankCourseProject({
    id: 'runtime-template-lifecycle',
    title: 'Runtime template lifecycle',
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
    idFactory: () => 'scene-lifecycle',
  })
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected Slide surface')
  const scene = surface.scenes[0]!
  scene.name = 'Unrelated scene name'
  scene.backgroundColor = '#fef3c7'
  scene.layerItems.push(
    sceneNodeToCourseLayerItem(createTextNode({
      id: UNRELATED_LAYER_ID,
      name: 'Unrelated text',
      text: 'Keep this layer exact',
      x: 32,
      y: 48,
    }), 3),
  )
  scene.presentation!.states[0]!.layerItemOverrides[UNRELATED_LAYER_ID] = {
    opacity: 0.75,
  }
  project.assets[UNRELATED_ASSET_ID] = {
    id: UNRELATED_ASSET_ID,
    filename: 'unrelated.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/unrelated.png',
    byteLength: UNRELATED_ASSET_BYTES.byteLength,
    width: 320,
    height: 180,
  }
  return courseProjectDocumentSchema.parse(project)
}

function createRuntimeTemplate(owner: 'scene' | 'global'): string {
  const scope = owner === 'global' ? 'global' : 'scene'
  useEditorStore.getState().setEditingScope(scope)
  const state = useEditorStore.getState()
  const project = selectActiveCourseProjectDocument(state)
  const locationId = selectActiveCourseLocationId(state)
  const sessionToken = state.courseAuthoringSession?.token
  if (!project || !locationId || !sessionToken) {
    throw new Error('missing Runtime template authoring session')
  }
  const view = selectRuntimeSourceAuthoringView({
    project,
    locationId,
    editingScope: scope,
    activeStateId: state.activePresentationStateId,
    sessionToken,
  })
  if (
    view.availability !== 'unavailable'
    || view.reason !== 'runtime-missing'
    || !view.creationTarget
  ) {
    throw new Error(`missing canonical ${owner} Runtime template target`)
  }
  const result = useEditorStore.getState().createRuntimeTemplateAtTarget(
    view.creationTarget,
  )
  if (!result.ok) throw new Error(result.reason)
  return result.feedback.itemId
}

function currentProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('missing active Course Project')
  return project
}

function currentScene(project = currentProject()): SlideSceneDocument {
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected Slide surface')
  return surface.scenes[0]!
}

function expectUnrelatedStatePreserved(): void {
  const state = useEditorStore.getState()
  const project = currentProject()
  const scene = currentScene(project)
  expect(project).toMatchObject({
    title: 'Runtime template lifecycle',
    assets: {
      [UNRELATED_ASSET_ID]: {
        filename: 'unrelated.png',
        byteLength: UNRELATED_ASSET_BYTES.byteLength,
      },
    },
  })
  expect(scene).toMatchObject({
    name: 'Unrelated scene name',
    backgroundColor: '#fef3c7',
  })
  expect(scene.layerItems.find((item) => item.layerItemId === UNRELATED_LAYER_ID))
    .toMatchObject({
      label: 'Unrelated text',
      kind: 'native',
      frame: { x: 32, y: 48 },
    })
  expect(scene.presentation?.states[0]?.layerItemOverrides[UNRELATED_LAYER_ID])
    .toEqual({ opacity: 0.75 })
  expect(state.courseAssetSidecar?.files[UNRELATED_ASSET_ID])
    .toEqual(UNRELATED_ASSET_BYTES)
  expect(state.componentPackages).toEqual({})
}

function hasSceneRuntime(project = currentProject()): boolean {
  return currentScene(project).layerItems.some(
    (item) => item.layerItemId === sceneRuntimeId && item.kind === 'runtime',
  )
}

function hasGlobalRuntime(project = currentProject()): boolean {
  return project.globalLayerItems.some(
    (entry) => entry.item.layerItemId === globalRuntimeId && entry.item.kind === 'runtime',
  )
}

beforeEach(() => {
  useEditorStore.getState().loadCourseProject(lifecycleProject(), null, {
    [UNRELATED_ASSET_ID]: UNRELATED_ASSET_BYTES,
  })
  sceneRuntimeId = createRuntimeTemplate('scene')
  globalRuntimeId = createRuntimeTemplate('global')
  useEditorStore.getState().setEditingScope('scene')
})

describe('Runtime template lifecycle through unified layer deletion', () => {
  it('structurally deletes the base scene carrier and restores/reapplies it with undo/redo', () => {
    const store = useEditorStore.getState()
    store.setActivePresentationState(null)
    store.setEditingScope('scene')
    store.selectNode(sceneRuntimeId)

    expect(useEditorStore.getState().selectedNodeIds).toEqual([sceneRuntimeId])
    store.deleteSelectedNodes()

    expect(hasSceneRuntime()).toBe(false)
    expect(hasGlobalRuntime()).toBe(true)
    expectUnrelatedStatePreserved()

    useEditorStore.getState().undo()
    expect(hasSceneRuntime()).toBe(true)
    expect(hasGlobalRuntime()).toBe(true)
    expectUnrelatedStatePreserved()

    useEditorStore.getState().redo()
    expect(hasSceneRuntime()).toBe(false)
    expect(hasGlobalRuntime()).toBe(true)
    expectUnrelatedStatePreserved()
  })

  it('hides an inherited scene carrier in a named state without deleting its base identity', () => {
    const store = useEditorStore.getState()
    store.setActivePresentationState('state_initial')
    store.selectNode(sceneRuntimeId)
    store.deleteSelectedNodes()

    expect(hasSceneRuntime()).toBe(true)
    expect(currentScene().presentation?.states[0]?.layerItemOverrides[sceneRuntimeId])
      .toEqual({ visible: false })
    expect(hasGlobalRuntime()).toBe(true)
    expectUnrelatedStatePreserved()

    useEditorStore.getState().undo()
    expect(hasSceneRuntime()).toBe(true)
    expect(currentScene().presentation?.states[0]?.layerItemOverrides[sceneRuntimeId])
      .toBeUndefined()
    expectUnrelatedStatePreserved()

    useEditorStore.getState().redo()
    expect(hasSceneRuntime()).toBe(true)
    expect(currentScene().presentation?.states[0]?.layerItemOverrides[sceneRuntimeId])
      .toEqual({ visible: false })
    expectUnrelatedStatePreserved()
  })

  it('structurally deletes the global carrier even while a named scene state is active', () => {
    const store = useEditorStore.getState()
    store.setActivePresentationState('state_initial')
    store.setEditingScope('global')
    store.selectNode(globalRuntimeId)

    expect(useEditorStore.getState()).toMatchObject({
      activePresentationStateId: 'state_initial',
      editingScope: 'global',
      selectedNodeIds: [globalRuntimeId],
    })
    store.deleteSelectedNodes()

    expect(hasGlobalRuntime()).toBe(false)
    expect(hasSceneRuntime()).toBe(true)
    expectUnrelatedStatePreserved()

    useEditorStore.getState().undo()
    expect(hasGlobalRuntime()).toBe(true)
    expect(hasSceneRuntime()).toBe(true)
    expectUnrelatedStatePreserved()

    useEditorStore.getState().redo()
    expect(hasGlobalRuntime()).toBe(false)
    expect(hasSceneRuntime()).toBe(true)
    expectUnrelatedStatePreserved()
  })
})
