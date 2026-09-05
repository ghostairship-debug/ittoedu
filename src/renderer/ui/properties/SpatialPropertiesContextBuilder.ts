import type {
  CourseAuthoringSessionToken,
  CourseAuthoringTarget,
} from '../../authoring/courseAuthoringSession'
import { COURSE_AUTHORING_STALE_SESSION_REASON } from '../../authoring/courseAuthoringSession'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { CourseBackgroundFields } from '../../../shared/effectiveBackground'
import type {
  SpatialAuthoringIntent,
  SpatialAuthoringIntentInput,
  SpatialAuthoringReceipt,
  SpatialGraphSelection,
} from '../../authoring/spatialAuthoringIntents'
import type { SpatialWorldContentEditSession } from '../../authoring/spatialWorldAuthoring'
import {
  captureSpatialEditorAuthoringTarget,
  type SpatialEditorAuthoringTargetInput,
  type SpatialEditorView,
} from '../../course/spatialEditorView'
import type {
  SpatialPropertiesCommands,
  SpatialPropertiesContext,
} from './SpatialPropertiesPanel'

export type SpatialPropertiesOwnerResult =
  | { readonly status: 'inactive' }
  | {
      readonly status: 'stale'
      readonly reason: string
      readonly locationId: string
      readonly editingGlobal: boolean
    }
  | {
      readonly status: 'active'
      readonly locationId: string
      readonly editingGlobal: boolean
      readonly scope: 'global' | 'surface' | 'world'
      readonly graphSelection: SpatialGraphSelection | null
      readonly pageContext: SpatialPropertiesContext
      readonly graphContext: SpatialPropertiesContext | null
    }

function draftBindingKey(target: CourseAuthoringTarget): string {
  return JSON.stringify([
    target.projectId,
    target.documentRevision,
    target.sessionGeneration,
    target.surfaceType,
    target.locationId,
    target.surfaceId,
    target.owner,
    target.ownerKey,
    target.itemId,
    target.authoringAddress,
  ])
}

function createCommands(input: {
  readonly view: SpatialEditorView
  readonly sessionToken: CourseAuthoringSessionToken
  readonly contentEdit: SpatialWorldContentEditSession | null
  readonly showCameraFrames: boolean
  readonly playbackPathId: string | null
  readonly runIntent: (
    target: CourseAuthoringTarget,
    intent: SpatialAuthoringIntent,
  ) => SpatialAuthoringReceipt
  readonly reportError: (message: string) => void
}): SpatialPropertiesCommands {
  const capture = (target: SpatialEditorAuthoringTargetInput) => (
    captureSpatialEditorAuthoringTarget({
      view: input.view,
      sessionToken: input.sessionToken,
      target,
    })
  )
  const run = (target: SpatialEditorAuthoringTargetInput, intent: SpatialAuthoringIntentInput) => (
    input.runIntent(capture(target), {
      ...intent,
      expectedContentEdit: input.contentEdit,
    } as SpatialAuthoringIntent)
  )
  const world = (field: string, intent: SpatialAuthoringIntentInput) => (
    run({ kind: 'world', field }, intent)
  )
  const camera = (frameId: string, field: string, intent: SpatialAuthoringIntentInput) => (
    run({ kind: 'camera-frame', frameId, field }, intent)
  )
  const path = (pathId: string, field: string, intent: SpatialAuthoringIntentInput) => (
    run({ kind: 'path', pathId, field }, intent)
  )
  const relation = (relationId: string, field: string, intent: SpatialAuthoringIntentInput) => (
    run({ kind: 'relation', relationId, field }, intent)
  )
  const semantic = (ruleId: string, field: string, intent: SpatialAuthoringIntentInput) => (
    run({ kind: 'semantic-rule', ruleId, field }, intent)
  )
  return {
    setBackgroundColor: (backgroundColor) => run(
      { kind: 'surface', field: 'backgroundColor' },
      { kind: 'set-surface-background', backgroundColor },
    ),
    updateBackground: (patch) => run(
      { kind: 'surface', field: 'background' },
      { kind: 'set-surface-background-patch', patch },
    ),
    setShowCameraFrames: (show) => world('session.showCameraFrames', {
      kind: 'set-show-camera-frames',
      show,
      expectedShow: input.showCameraFrames,
    }),
    addCameraFrame: () => world('camera.frames', {
      kind: 'add-camera-frame',
      expectedCamera: input.view.sessionCamera,
    }),
    renameCameraFrame: (frameId, name) => camera(
      frameId,
      'camera.frames.name',
      { kind: 'rename-camera-frame', name },
    ),
    reorderCameraFrame: (frameId, toIndex) => camera(
      frameId,
      'camera.frames.order',
      {
        kind: 'reorder-camera-frame',
        toIndex,
        expectedFrameIds: input.view.camera.frames.map((frame) => frame.id),
      },
    ),
    deleteCameraFrame: (frameId) => camera(
      frameId,
      'camera.frames',
      { kind: 'delete-camera-frame' },
    ),
    setHome: () => world('camera.home', {
      kind: 'set-camera-home-from-session',
      expectedCamera: input.view.sessionCamera,
    }),
    updateActiveFromSession: () => {
      const frameId = input.view.camera.activeFrameId
      if (!frameId) return
      camera(frameId, 'camera.frames.pose', {
        kind: 'update-camera-frame-from-session',
        expectedCamera: input.view.sessionCamera,
      })
    },
    activateFrame: (frameId) => camera(
      frameId,
      'session.activeCameraFrameId',
      { kind: 'activate-camera-frame' },
    ),
    fitWorldContent: () => world('session.camera', {
      kind: 'fit-world-content',
      viewportWidth: 1280,
      viewportHeight: 720,
      expectedCamera: input.view.sessionCamera,
    }),
    setPlaybackPathId: (pathId) => world('session.playbackPathId', {
      kind: 'set-playback-path',
      pathId,
      expectedPathId: input.playbackPathId,
      ...(pathId
        ? { pathTarget: capture({ kind: 'path', pathId, field: 'world.paths' }) }
        : {}),
    }),
    addSemanticZoomRule: (rule) => world('semanticZoom', {
      kind: 'add-semantic-rule',
      rule,
    }),
    updateSemanticZoomRule: (ruleId, patch) => semantic(
      ruleId,
      Object.keys(patch).length === 1
        ? `semanticZoom.${Object.keys(patch)[0]}`
        : 'semanticZoom',
      { kind: 'update-semantic-rule', patch },
    ),
    deleteSemanticZoomRule: (ruleId) => semantic(
      ruleId,
      'semanticZoom',
      { kind: 'delete-semantic-rule' },
    ),
    addPath: (pathInput) => world('world.paths', { kind: 'add-path', input: pathInput }),
    renamePath: (pathId, name) => path(pathId, 'world.paths.name', {
      kind: 'rename-path',
      name,
    }),
    updatePathStyle: (pathId, style) => path(pathId, 'world.paths.style', {
      kind: 'update-path-style',
      style,
    }),
    reorderPathWaypoints: (pathId, layerItemIds) => path(
      pathId,
      'world.paths.layerItemIds',
      { kind: 'reorder-path-waypoints', layerItemIds },
    ),
    deletePath: (pathId) => path(pathId, 'world.paths', { kind: 'delete-path' }),
    addRelation: (relationInput) => world('world.relations', {
      kind: 'add-relation',
      input: relationInput,
    }),
    updateRelationLabel: (relationId, label) => relation(
      relationId,
      'world.relations.label',
      { kind: 'update-relation-label', label },
    ),
    updateRelationKind: (relationId, relationKind) => relation(
      relationId,
      'world.relations.kind',
      { kind: 'update-relation-kind', relationKind },
    ),
    deleteRelation: (relationId) => relation(
      relationId,
      'world.relations',
      { kind: 'delete-relation' },
    ),
    reportError: input.reportError,
  }
}

function buildContext(input: {
  readonly kind: SpatialPropertiesContext['kind']
  readonly view: SpatialEditorView
  readonly course: CourseBackgroundFields
  readonly assets: Readonly<Record<string, AssetMeta>>
  readonly sessionToken: CourseAuthoringSessionToken
  readonly contentEdit: SpatialWorldContentEditSession | null
  readonly showCameraFrames: boolean
  readonly playbackPathId: string | null
  readonly graphSelection: SpatialGraphSelection | null
  readonly commands: SpatialPropertiesCommands
  readonly professionalInteraction?: SpatialPropertiesContext['professionalInteraction']
}): SpatialPropertiesContext {
  const capture = (target: SpatialEditorAuthoringTargetInput) => (
    captureSpatialEditorAuthoringTarget({
      view: input.view,
      sessionToken: input.sessionToken,
      target,
    })
  )
  return {
    kind: input.kind,
    view: input.view,
    course: input.course,
    assets: input.assets,
    sessionCamera: input.view.sessionCamera,
    showCameraFrames: input.showCameraFrames,
    playbackPathId: input.playbackPathId,
    selectedPathId: input.graphSelection?.kind === 'path'
      ? input.graphSelection.id
      : null,
    selectedRelationId: input.graphSelection?.kind === 'relation'
      ? input.graphSelection.id
      : null,
    draftBindings: {
      surface: draftBindingKey(capture({ kind: 'surface', field: 'surface' })),
      cameraFrames: new Map(input.view.camera.frames.map((frame) => [
        frame.id,
        draftBindingKey(capture({
          kind: 'camera-frame',
          frameId: frame.id,
          field: 'camera.frames',
        })),
      ])),
      paths: new Map(input.view.worldGraph.paths.map((entry) => [
        entry.pathId,
        draftBindingKey(capture({
          kind: 'path',
          pathId: entry.pathId,
          field: 'world.paths',
        })),
      ])),
      relations: new Map(input.view.worldGraph.relations.map((entry) => [
        entry.relationId,
        draftBindingKey(capture({
          kind: 'relation',
          relationId: entry.relationId,
          field: 'world.relations',
        })),
      ])),
      semanticRules: new Map(input.view.visibilityRules.map((rule) => [
        rule.id,
        draftBindingKey(capture({
          kind: 'semantic-rule',
          ruleId: rule.id,
          field: 'semanticZoom',
        })),
      ])),
    },
    commands: input.commands,
    professionalInteraction: input.professionalInteraction,
  }
}

export function buildSpatialPropertiesOwner(input: {
  readonly view: SpatialEditorView | null
  readonly course: CourseBackgroundFields
  readonly assets: Readonly<Record<string, AssetMeta>>
  readonly scope: 'global' | 'surface' | 'world'
  readonly selectionIds: readonly string[]
  readonly showCameraFrames: boolean
  readonly contentEdit: SpatialWorldContentEditSession | null
  readonly graphSelection: SpatialGraphSelection | null
  readonly playbackPathId: string | null
  readonly authoringToken: CourseAuthoringSessionToken | null
  readonly runIntent: (
    target: CourseAuthoringTarget,
    intent: SpatialAuthoringIntent,
  ) => SpatialAuthoringReceipt
  readonly reportError: (message: string) => void
  readonly professionalInteraction?: SpatialPropertiesContext['professionalInteraction']
}): SpatialPropertiesOwnerResult {
    const { view } = input
    if (!view) return { status: 'inactive' }
    const editingGlobal = input.scope === 'global'
    const token = input.authoringToken
    if (
      !token
      || token.surfaceType !== 'spatial-2d'
      || token.locationId !== view.locationId
      || token.revision !== view.revision
    ) {
      return {
        status: 'stale',
        reason: COURSE_AUTHORING_STALE_SESSION_REASON,
        locationId: view.locationId,
        editingGlobal,
      }
    }
    const graphTargetExists = !input.graphSelection || (
      input.graphSelection.kind === 'path'
        ? view.worldGraph.paths.some((entry) => entry.pathId === input.graphSelection!.id)
        : view.worldGraph.relations.some((entry) => entry.relationId === input.graphSelection!.id)
    )
    if (!graphTargetExists) {
      return {
        status: 'stale',
        reason: '所选空间关系已失效，请重新选择。',
        locationId: view.locationId,
        editingGlobal,
      }
    }
    const commands = createCommands({
      view,
      sessionToken: token,
      contentEdit: input.contentEdit,
      showCameraFrames: input.showCameraFrames,
      playbackPathId: input.playbackPathId,
      runIntent: input.runIntent,
      reportError: input.reportError,
    })
    const pageContext = buildContext({
      kind: 'spatial-page',
      view,
      course: input.course,
      assets: input.assets,
      sessionToken: token,
      contentEdit: input.contentEdit,
      showCameraFrames: input.showCameraFrames,
      playbackPathId: input.playbackPathId,
      graphSelection: null,
      commands,
      professionalInteraction: input.professionalInteraction,
    })
    return {
      status: 'active',
      locationId: view.locationId,
      editingGlobal,
      scope: input.scope,
      graphSelection: input.graphSelection,
      pageContext,
      graphContext: input.graphSelection
        ? buildContext({
            kind: 'spatial-graph',
            view,
            course: input.course,
            assets: input.assets,
            sessionToken: token,
            contentEdit: input.contentEdit,
            showCameraFrames: input.showCameraFrames,
            playbackPathId: input.playbackPathId,
            graphSelection: input.graphSelection,
            commands,
            professionalInteraction: input.professionalInteraction,
          })
        : null,
    }
}
