import type { InteractionRule } from '../../interactionTypes'
import type {
  CourseLocation,
  CourseProjectDocument,
  CourseSurfaceDocument,
  FlowBlock,
  LayerItem,
  ScopedLayerItem,
  SlideSceneDocument,
} from './types'

export type CourseProjectPath = ReadonlyArray<string | number>

export interface CourseProjectVisitor {
  surface?(surface: CourseSurfaceDocument, path: CourseProjectPath): void
  scene?(scene: SlideSceneDocument, path: CourseProjectPath): void
  block?(block: FlowBlock, path: CourseProjectPath): void
  layerItem?(item: LayerItem, path: CourseProjectPath): void
  location?(location: CourseLocation, path: CourseProjectPath): void
}

export type CourseProjectReferenceKind =
  | 'asset'
  | 'component'
  | 'surface'
  | 'scene'
  | 'block'
  | 'camera-frame'
  | 'layer-item'
  | 'location'
  | 'course-state'
  | 'presentation-state'
  | 'sound'

export interface CourseProjectReference {
  kind: CourseProjectReferenceKind
  id: string
  path: CourseProjectPath
  version?: string
}

function walkBlocks(
  blocks: ReadonlyArray<FlowBlock>,
  path: CourseProjectPath,
  visitor: CourseProjectVisitor,
): void {
  blocks.forEach((block, index) => {
    const blockPath = [...path, index]
    visitor.block?.(block, blockPath)
    if (block.type === 'section') walkBlocks(block.blocks, [...blockPath, 'blocks'], visitor)
  })
}

export function visitCourseProject(
  project: CourseProjectDocument,
  visitor: CourseProjectVisitor,
): void {
  project.globalLayerItems.forEach((entry, index) => {
    visitor.layerItem?.(entry.item, ['globalLayerItems', index, 'item'])
  })
  project.locations.forEach((location, index) => {
    visitor.location?.(location, ['locations', index])
  })
  project.surfaces.forEach((surface, surfaceIndex) => {
    const surfacePath: CourseProjectPath = ['surfaces', surfaceIndex]
    visitor.surface?.(surface, surfacePath)
    surface.surfaceLayerItems.forEach((entry, index) => {
      visitor.layerItem?.(entry.item, [...surfacePath, 'surfaceLayerItems', index, 'item'])
    })
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene, sceneIndex) => {
        const scenePath = [...surfacePath, 'scenes', sceneIndex]
        visitor.scene?.(scene, scenePath)
        scene.layerItems.forEach((item, itemIndex) => {
          visitor.layerItem?.(item, [...scenePath, 'layerItems', itemIndex])
        })
      })
    } else if (surface.type === 'flow') {
      walkBlocks(surface.blocks, [...surfacePath, 'blocks'], visitor)
    } else {
      surface.world.layerItems.forEach((item, itemIndex) => {
        visitor.layerItem?.(item, [...surfacePath, 'world', 'layerItems', itemIndex])
      })
    }
  })
}

function addLayerReferences(
  item: LayerItem,
  path: CourseProjectPath,
  emit: (reference: CourseProjectReference) => void,
): void {
  if (item.kind === 'component') {
    emit({
      kind: 'component',
      id: item.component.packageId,
      version: item.component.version,
      path: [...path, 'component'],
    })
    if (item.staticFallbackAssetId) {
      emit({ kind: 'asset', id: item.staticFallbackAssetId, path: [...path, 'staticFallbackAssetId'] })
    }
    return
  }
  if (item.kind === 'runtime') {
    Object.entries(item.runtime.assets).forEach(([key, binding]) => {
      emit({ kind: 'asset', id: binding.assetId, path: [...path, 'runtime', 'assets', key, 'assetId'] })
    })
    Object.entries(item.runtime.nodeBindings ?? {}).forEach(([key, itemId]) => {
      emit({ kind: 'layer-item', id: itemId, path: [...path, 'runtime', 'nodeBindings', key] })
    })
    if (item.runtime.staticFallback) {
      emit({ kind: 'asset', id: item.runtime.staticFallback.assetId, path: [...path, 'runtime', 'staticFallback', 'assetId'] })
    }
    return
  }
  if (item.content.nativeType === 'image') {
    emit({ kind: 'asset', id: item.content.data.assetId, path: [...path, 'content', 'data', 'assetId'] })
  } else if (item.content.nativeType === 'video') {
    emit({ kind: 'asset', id: item.content.data.assetId, path: [...path, 'content', 'data', 'assetId'] })
    if (item.content.data.poster.assetId) {
      emit({ kind: 'asset', id: item.content.data.poster.assetId, path: [...path, 'content', 'data', 'poster', 'assetId'] })
    }
  } else if (item.content.nativeType === 'teacher-controller') {
    item.content.data.buttons.forEach((button, index) => {
      if (button.action.type === 'scene.go') {
        emit({ kind: 'scene', id: button.action.sceneId, path: [...path, 'content', 'data', 'buttons', index, 'action', 'sceneId'] })
      }
    })
  }
}

function addInteractionReferences(
  rules: ReadonlyArray<InteractionRule>,
  path: CourseProjectPath,
  emit: (reference: CourseProjectReference) => void,
): void {
  const add = (
    kind: CourseProjectReferenceKind,
    id: string,
    referencePath: CourseProjectPath,
  ): void => emit({ kind, id, path: referencePath })
  rules.forEach((rule, ruleIndex) => {
    const rulePath = [...path, ruleIndex]
    const trigger = rule.trigger
    if ('nodeId' in trigger) add('layer-item', trigger.nodeId, [...rulePath, 'trigger', 'nodeId'])
    if (trigger.type === 'presentation.enter') {
      add('presentation-state', trigger.stateId, [...rulePath, 'trigger', 'stateId'])
    } else if (trigger.type === 'audio.ended') {
      add('sound', trigger.soundId, [...rulePath, 'trigger', 'soundId'])
    }
    rule.conditions.forEach((condition, conditionIndex) => {
      if (condition.type === 'scene.in') {
        condition.sceneIds.forEach((sceneId, sceneIndex) => {
          add('scene', sceneId, [...rulePath, 'conditions', conditionIndex, 'sceneIds', sceneIndex])
        })
      } else if (condition.type === 'presentation.in') {
        condition.stateIds.forEach((stateId, stateIndex) => {
          add('presentation-state', stateId, [...rulePath, 'conditions', conditionIndex, 'stateIds', stateIndex])
        })
      } else {
        add('course-state', condition.key, [...rulePath, 'conditions', conditionIndex, 'key'])
      }
    })
    rule.actions.forEach((step, stepIndex) => {
      const action = step.action
      const actionPath = [...rulePath, 'actions', stepIndex, 'action']
      if (action.type === 'presentation.set') {
        add('presentation-state', action.stateId, [...actionPath, 'stateId'])
      } else if (action.type === 'scene.go') {
        add('scene', action.sceneId, [...actionPath, 'sceneId'])
        if (action.targetStateId) add('presentation-state', action.targetStateId, [...actionPath, 'targetStateId'])
      } else if ('nodeId' in action) {
        add('layer-item', action.nodeId, [...actionPath, 'nodeId'])
      } else if (action.type === 'audio.play') {
        add('sound', action.soundId, [...actionPath, 'soundId'])
      } else if (
        action.type === 'audio.pause'
        || action.type === 'audio.resume'
        || action.type === 'audio.stop'
        || action.type === 'audio.toggle-mute'
      ) {
        if (action.target.kind === 'sound') {
          add('sound', action.target.soundId, [...actionPath, 'target', 'soundId'])
        }
      } else if (action.type === 'course-state.set') {
        add('course-state', action.key, [...actionPath, 'key'])
      }
    })
  })
}

/** Traverses references without guessing inside arbitrary component props. */
export function visitCourseProjectReferences(
  project: CourseProjectDocument,
  emit: (reference: CourseProjectReference) => void,
): void {
  emit({ kind: 'location', id: project.startLocationId, path: ['startLocationId'] })
  Object.entries(project.media.audio.sounds).forEach(([key, sound]) => {
    emit({ kind: 'asset', id: sound.assetId, path: ['media', 'audio', 'sounds', key, 'assetId'] })
  })
  const addVisibilityReferences = (
    entries: ReadonlyArray<ScopedLayerItem>,
    path: CourseProjectPath,
  ): void => {
    entries.forEach((entry, entryIndex) => {
      entry.visibility.locationIds.forEach((locationId, locationIndex) => {
        emit({
          kind: 'location',
          id: locationId,
          path: [...path, entryIndex, 'visibility', 'locationIds', locationIndex],
        })
      })
    })
  }
  addVisibilityReferences(project.globalLayerItems, ['globalLayerItems'])
  addInteractionReferences(project.globalInteractions, ['globalInteractions'], emit)
  visitCourseProject(project, {
    layerItem: (item, path) => addLayerReferences(item, path, emit),
    location: (location, path) => {
      emit({ kind: 'surface', id: location.surfaceId, path: [...path, 'surfaceId'] })
      if (location.kind === 'slide-scene') {
        emit({ kind: 'scene', id: location.sceneId, path: [...path, 'sceneId'] })
      } else if (location.kind === 'flow-block') {
        emit({ kind: 'block', id: location.blockId, path: [...path, 'blockId'] })
      } else {
        emit({ kind: 'camera-frame', id: location.cameraFrameId, path: [...path, 'cameraFrameId'] })
      }
    },
    scene: (scene, path) => {
      addInteractionReferences(scene.interactions, [...path, 'interactions'], emit)
      if (scene.backgroundAssetId) {
        emit({ kind: 'asset', id: scene.backgroundAssetId, path: [...path, 'backgroundAssetId'] })
      }
      scene.presentation?.states.forEach((state, index) => {
        if (state.backgroundAssetId) {
          emit({ kind: 'asset', id: state.backgroundAssetId, path: [...path, 'presentation', 'states', index, 'backgroundAssetId'] })
        }
        Object.keys(state.layerItemOverrides).forEach((itemId) => {
          emit({ kind: 'layer-item', id: itemId, path: [...path, 'presentation', 'states', index, 'layerItemOverrides', itemId] })
        })
        state.layerItemOrder?.forEach((itemId, itemIndex) => {
          emit({ kind: 'layer-item', id: itemId, path: [...path, 'presentation', 'states', index, 'layerItemOrder', itemIndex] })
        })
      })
    },
    block: (block, path) => {
      if (block.type === 'media') {
        emit({ kind: 'asset', id: block.assetId, path: [...path, 'assetId'] })
      } else if (block.type === 'component') {
        emit({ kind: 'component', id: block.component.packageId, version: block.component.version, path: [...path, 'component'] })
        emit({ kind: 'asset', id: block.staticFallbackAssetId, path: [...path, 'staticFallbackAssetId'] })
      }
    },
    surface: (surface, path) => {
      addVisibilityReferences(surface.surfaceLayerItems, [...path, 'surfaceLayerItems'])
      if (surface.type === 'spatial-2d') {
        surface.semanticZoom.forEach((rule, ruleIndex) => {
          rule.layerItemIds.forEach((itemId, itemIndex) => {
            emit({ kind: 'layer-item', id: itemId, path: [...path, 'semanticZoom', ruleIndex, 'layerItemIds', itemIndex] })
          })
        })
      }
    },
  })
  project.navigationGuards.forEach((guard, guardIndex) => {
    ;[...(guard.fromLocationIds ?? []), ...guard.toLocationIds].forEach((locationId, index) => {
      emit({ kind: 'location', id: locationId, path: ['navigationGuards', guardIndex, 'locations', index] })
    })
    guard.conditions.forEach((condition, conditionIndex) => {
      emit({ kind: 'course-state', id: condition.key, path: ['navigationGuards', guardIndex, 'conditions', conditionIndex, 'key'] })
    })
  })
  project.mixedPrintPlan?.entries.forEach((entry, entryIndex) => {
    const path: CourseProjectPath = ['mixedPrintPlan', 'entries', entryIndex]
    emit({ kind: 'surface', id: entry.surfaceId, path: [...path, 'surfaceId'] })
    if (entry.kind === 'slide-scenes') {
      entry.sceneIds.forEach((sceneId, sceneIndex) => {
        emit({ kind: 'scene', id: sceneId, path: [...path, 'sceneIds', sceneIndex] })
      })
    } else if (entry.kind === 'spatial-frames') {
      entry.cameraFrameIds.forEach((frameId, frameIndex) => {
        emit({ kind: 'camera-frame', id: frameId, path: [...path, 'cameraFrameIds', frameIndex] })
      })
    }
  })
}

export function collectCourseProjectReferences(
  project: CourseProjectDocument,
): CourseProjectReference[] {
  const references: CourseProjectReference[] = []
  visitCourseProjectReferences(project, (reference) => references.push(reference))
  return references
}
