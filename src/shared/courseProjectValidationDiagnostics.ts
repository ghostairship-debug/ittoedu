import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  FlowBlock,
  LayerItem,
} from './courseProjectTypes'

export const COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION = 1 as const
export const COURSE_PROJECT_DIAGNOSTIC_TARGET_KINDS = [
  'project',
  'asset',
  'component-package',
  'location',
  'surface',
  'scene',
  'flow-block',
  'layer-item',
] as const

interface DiagnosticTargetBaseV1 {
  version: typeof COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION
  projectId: string
}

export type DiagnosticTargetV1 = DiagnosticTargetBaseV1 & (
  | { kind: 'project' }
  | { kind: 'asset'; assetId: string }
  | { kind: 'component-package'; packageId: string; packageVersion: string }
  | { kind: 'location'; locationId: string }
  | { kind: 'surface'; surfaceId: string }
  | { kind: 'scene'; surfaceId: string; sceneId: string }
  | { kind: 'flow-block'; surfaceId: string; blockId: string }
  | { kind: 'layer-item'; owner: 'global'; layerItemId: string }
  | {
      kind: 'layer-item'
      owner: 'surface'
      surfaceId: string
      layerItemId: string
    }
  | {
      kind: 'layer-item'
      owner: 'scene'
      surfaceId: string
      sceneId: string
      layerItemId: string
    }
  | {
      kind: 'layer-item'
      owner: 'world'
      surfaceId: string
      layerItemId: string
    }
)

export const COURSE_PROJECT_VALIDATION_FATAL_CODES = [
  'archive-invalid',
  'input-unreadable',
  'schema-invalid',
  'unsupported-project-version',
  'usage-error',
  'validation-failed',
] as const

export type CourseProjectValidationFatalCode =
  typeof COURSE_PROJECT_VALIDATION_FATAL_CODES[number]

export type CourseProjectValidationFindingCodeStatus =
  | 'active'
  | 'schema-shadowed'
  | 'archive-shadowed'
  | 'upstream-filtered'

export const COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER = [
  {
    code: 'asset-byte-length-mismatch',
    status: 'archive-shadowed',
    sections: ['exportPreflight'],
    note: 'V9 archive opening rejects declared asset byte-length mismatches before semantic reports run.',
  },
  {
    code: 'asset-bytes-missing',
    status: 'archive-shadowed',
    sections: ['exportPreflight'],
    note: 'V9 archive opening rejects missing declared asset bytes before export preflight runs.',
  },
  {
    code: 'asset-kind-mismatch',
    status: 'active',
    sections: ['projectHealth'],
    note: 'V9 references can point at an existing asset of the wrong media kind.',
  },
  {
    code: 'asset-metadata-missing',
    status: 'schema-shadowed',
    sections: ['exportPreflight'],
    note: 'Course Project V9 Schema rejects asset references without matching metadata.',
  },
  {
    code: 'asset-reference-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'State native overrides and manifest-declared component image props are not direct V9 Schema references.',
  },
  {
    code: 'asset-unused',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Reported only when no Runtime or Component executable consumer can hide a dynamic projectAssetUrl lookup.',
  },
  {
    code: 'component-asset-bytes-missing',
    status: 'archive-shadowed',
    sections: ['exportPreflight'],
    note: 'Component package parsing during archive opening rejects missing manifest asset bytes.',
  },
  {
    code: 'component-bytes-missing',
    status: 'archive-shadowed',
    sections: ['exportPreflight'],
    note: 'Archive opening requires and validates every declared component package before preflight.',
  },
  {
    code: 'component-hash-mismatch',
    status: 'archive-shadowed',
    sections: ['exportPreflight'],
    note: 'Archive opening verifies component content hashes before preflight.',
  },
  {
    code: 'component-manifest-identity-mismatch',
    status: 'archive-shadowed',
    sections: ['exportPreflight'],
    note: 'Archive opening verifies component manifest identity before preflight.',
  },
  {
    code: 'component-metadata-missing',
    status: 'schema-shadowed',
    sections: ['exportPreflight'],
    note: 'Course Project V9 Schema rejects component references without matching package metadata.',
  },
  {
    code: 'component-package-hash-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'The original selected-package sha256 is optional provenance distinct from required embedded contentSha256.',
  },
  {
    code: 'component-package-source-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'A human-readable component source label is optional V9 provenance.',
  },
  {
    code: 'component-package-unused',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Component usage is derived from every V9 layer owner and nested Flow component block.',
  },
  {
    code: 'component-protocol',
    status: 'archive-shadowed',
    sections: ['projectHealth'],
    note: 'Component package parsing during archive opening enforces Component API 4 first.',
  },
  {
    code: 'component-thumbnail-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Component thumbnailPath remains optional in V9 metadata.',
  },
  {
    code: 'controller-required-for-canvas',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Canvas controls require a delivery-visible global V9 teacher controller.',
  },
  {
    code: 'controller-scene-target-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Teacher-controller scene.go targets are not cross-checked by the V9 Schema.',
  },
  {
    code: 'controller-state-target-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Teacher-controller targetStateId is not cross-checked by the V9 Schema.',
  },
  {
    code: 'controller-visible-while-disabled',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Disabled outer controls can coexist with a delivery-visible global V9 teacher controller.',
  },
  {
    code: 'duplicate-stable-id',
    status: 'active',
    sections: ['projectHealth', 'stableIds'],
    note: 'The V9 Schema permits duplicate layer item ids in disjoint surface owners; this guard reports them.',
  },
  {
    code: 'global-interaction-state-target-partial',
    status: 'active',
    sections: ['projectHealth'],
    note: 'A global presentation.set target can exist in only some possible Slide scenes.',
  },
  {
    code: 'information-release-hidden-self-trigger',
    status: 'active',
    sections: ['projectHealth'],
    note: 'A schema-valid Slide item can begin hidden and rely on clicking itself for reveal.',
  },
  {
    code: 'information-release-hidden-unreachable',
    status: 'active',
    sections: ['projectHealth'],
    note: 'A schema-valid Slide item can begin hidden without a reachable declarative reveal path.',
  },
  {
    code: 'interaction-action-reference-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'animation.completed actionId references are not cross-checked by the V9 Schema.',
  },
  {
    code: 'interaction-animation-self-loop',
    status: 'active',
    sections: ['projectHealth'],
    note: 'A valid rule can retrigger from its own motion action completion.',
  },
  {
    code: 'interaction-enter-target-initially-visible',
    status: 'active',
    sections: ['projectHealth'],
    note: 'A valid node.enter target can already be visible before its reveal action.',
  },
  {
    code: 'interaction-node-type-mismatch',
    status: 'active',
    sections: ['projectHealth'],
    note: 'V9 Schema verifies layer existence but not Component/Video trigger and action target type.',
  },
  {
    code: 'interaction-scene-reference-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Interaction scene.go targets are not cross-checked by the V9 Schema.',
  },
  {
    code: 'interaction-state-reference-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Presentation trigger, condition and action state references are not cross-checked by the V9 Schema.',
  },
  {
    code: 'looping-video-ended-unreachable',
    status: 'active',
    sections: ['projectHealth'],
    note: 'A visible looping V9 video cannot naturally emit its configured ended trigger.',
  },
  {
    code: 'migration-marker',
    status: 'schema-shadowed',
    sections: ['projectHealth', 'migrationMarkers'],
    note: 'Legacy frame and runtime discriminators are rejected by the V9 Schema first.',
  },
  {
    code: 'online-remote-asset',
    status: 'upstream-filtered',
    sections: ['exportPreflight'],
    note: 'The validator invokes standalone HTML preflight in its offline-portable default, not online-lightweight mode.',
  },
  {
    code: 'online-remote-url-invalid',
    status: 'upstream-filtered',
    sections: ['exportPreflight'],
    note: 'The validator invokes standalone HTML preflight in its offline-portable default, not online-lightweight mode.',
  },
  {
    code: 'player-bundle-empty',
    status: 'upstream-filtered',
    sections: ['exportPreflight'],
    note: 'The validator supplies a non-empty sentinel bundle and explicitly filters this upstream-only guard.',
  },
  {
    code: 'presenter-command-unhandled',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Authored-command presenter mode can omit an enabled next or previous handler.',
  },
  {
    code: 'presenter-f5-browser-reserved',
    status: 'active',
    sections: ['projectHealth'],
    note: 'A schema-valid presenter key binding can use browser-reserved F5.',
  },
  {
    code: 'presenter-rules-bypassed',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Scene-navigation presenter strategy bypasses otherwise enabled authored presenter rules.',
  },
  {
    code: 'presenter-rules-disabled',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Presenter rules can be authored while presenter input is disabled.',
  },
  {
    code: 'project-schema-invalid',
    status: 'schema-shadowed',
    sections: ['exportPreflight'],
    note: 'Schema-invalid projects return unreadable before semantic or export sections are constructed.',
  },
  {
    code: 'published-interaction-action-unsupported',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Enabled V9 interaction rules can contain action families outside the current Published playback slice.',
  },
  {
    code: 'published-interaction-click-unbindable',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Published node.click binding is limited to auto-hit native text, image, formula and shape layer items.',
  },
  {
    code: 'published-interaction-condition-unsupported',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Enabled V9 interaction rules can contain condition families outside the current Published playback slice.',
  },
  {
    code: 'published-interaction-trigger-unsupported',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Enabled V9 interaction rules can contain trigger families outside the current Published playback slice.',
  },
  {
    code: 'runtime-node-reference-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Runtime nodeBindings are real V9 fields whose project layer-item targets are not checked by Schema.',
  },
  {
    code: 'runtime-protocol',
    status: 'schema-shadowed',
    sections: ['projectHealth'],
    note: 'Runtime protocol and API discriminators are enforced by the V9 Schema first.',
  },
  {
    code: 'runtime-static-fallback-missing',
    status: 'active',
    sections: ['projectHealth'],
    note: 'Enabled V9 runtimes may validly omit a staticFallback.',
  },
  {
    code: 'scene-id-duplicate',
    status: 'active',
    sections: ['projectHealth'],
    note: 'V9 Schema enforces scene ids per Slide surface, so cross-surface collisions remain possible.',
  },
  {
    code: 'sound-id-mismatch',
    status: 'active',
    sections: ['projectHealth'],
    note: 'V9 Schema does not require a sound record key to equal SoundDefinition.id.',
  },
  {
    code: 'static-export-info',
    status: 'upstream-filtered',
    sections: ['exportPreflight'],
    note: 'The invoked asset audit currently has no info producer; the mapper remains compatibility plumbing.',
  },
  {
    code: 'static-export-interactions-omitted',
    status: 'active',
    sections: ['exportPreflight'],
    note: 'PDF and PPTX preflight reports this for schema-valid projects containing interactions.',
  },
  {
    code: 'static-export-preflight',
    status: 'schema-shadowed',
    sections: ['exportPreflight'],
    note: 'Known no-page and invalid-source producers are rejected by the V9 Schema first; the catch remains a defensive fallback.',
  },
  {
    code: 'static-export-warning',
    status: 'archive-shadowed',
    sections: ['exportPreflight'],
    note: 'The invoked asset warning is preceded by archive byte validation and Published source gates.',
  },
  {
    code: 'v8-field',
    status: 'schema-shadowed',
    sections: ['projectHealth'],
    note: 'The strict Course Project V9 Schema rejects V8 root fields before semantic reports run.',
  },
  {
    code: 'video-click-interaction-conflict',
    status: 'active',
    sections: ['projectHealth'],
    note: 'A visible V9 video click surface can consume a declarative node.click trigger.',
  },
] as const satisfies ReadonlyArray<{
  code: string
  status: CourseProjectValidationFindingCodeStatus
  sections: readonly ('projectHealth' | 'exportPreflight' | 'stableIds' | 'migrationMarkers')[]
  note: string
}>

export type CourseProjectValidationFindingCode =
  typeof COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER[number]['code']

export interface CourseProjectDiagnosticTargetHint {
  path?: ReadonlyArray<string | number>
  surfaceId?: string
  layerItemId?: string
}

function projectTarget(project: CourseProjectDocument): DiagnosticTargetV1 {
  return {
    version: COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
    kind: 'project',
    projectId: project.id,
  }
}

function targetBase(project: CourseProjectDocument): DiagnosticTargetBaseV1 {
  return {
    version: COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
    projectId: project.id,
  }
}

function pathIndex(value: string | number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function layerTarget(
  project: CourseProjectDocument,
  item: LayerItem,
  owner:
    | { kind: 'global' }
    | { kind: 'surface'; surfaceId: string }
    | { kind: 'scene'; surfaceId: string; sceneId: string }
    | { kind: 'world'; surfaceId: string },
): DiagnosticTargetV1 {
  const base = targetBase(project)
  if (owner.kind === 'global') {
    return { ...base, kind: 'layer-item', owner: 'global', layerItemId: item.layerItemId }
  }
  if (owner.kind === 'surface') {
    return {
      ...base,
      kind: 'layer-item',
      owner: 'surface',
      surfaceId: owner.surfaceId,
      layerItemId: item.layerItemId,
    }
  }
  if (owner.kind === 'scene') {
    return {
      ...base,
      kind: 'layer-item',
      owner: 'scene',
      surfaceId: owner.surfaceId,
      sceneId: owner.sceneId,
      layerItemId: item.layerItemId,
    }
  }
  return {
    ...base,
    kind: 'layer-item',
    owner: 'world',
    surfaceId: owner.surfaceId,
    layerItemId: item.layerItemId,
  }
}

function flowBlockFromPath(
  blocks: readonly FlowBlock[],
  path: ReadonlyArray<string | number>,
): FlowBlock | undefined {
  const findUniqueById = (
    candidates: readonly FlowBlock[],
    blockId: string,
  ): FlowBlock | undefined => {
    const matches: FlowBlock[] = []
    const visit = (entries: readonly FlowBlock[]): void => {
      for (const entry of entries) {
        if (entry.id === blockId) matches.push(entry)
        if (entry.type === 'section') visit(entry.blocks)
      }
    }
    visit(candidates)
    return matches.length === 1 ? matches[0] : undefined
  }

  let current = blocks
  let selected: FlowBlock | undefined
  for (let index = 0; index < path.length; index += 1) {
    if (path[index] !== 'blocks') continue
    const key = path[index + 1]
    selected = typeof key === 'number'
      ? current[pathIndex(key) ?? -1]
      : typeof key === 'string'
        ? findUniqueById(current, key)
        : undefined
    if (!selected) return undefined
    current = selected.type === 'section' ? selected.blocks : []
    index += 1
  }
  return selected
}

function targetFromSurfacePath(
  project: CourseProjectDocument,
  surface: CourseSurfaceDocument,
  path: ReadonlyArray<string | number>,
): DiagnosticTargetV1 | undefined {
  const base = targetBase(project)
  if (path[2] === 'surfaceLayerItems') {
    const itemIndex = pathIndex(path[3])
    const item = itemIndex === undefined ? undefined : surface.surfaceLayerItems[itemIndex]?.item
    if (item) return layerTarget(project, item, { kind: 'surface', surfaceId: surface.id })
    return undefined
  }
  if (surface.type === 'slide' && path[2] === 'scenes') {
    const sceneIndex = pathIndex(path[3])
    const scene = sceneIndex === undefined ? undefined : surface.scenes[sceneIndex]
    if (!scene) return undefined
    if (path[4] === 'layerItems') {
      const itemIndex = pathIndex(path[5])
      const item = itemIndex === undefined ? undefined : scene.layerItems[itemIndex]
      if (!item) return undefined
      return layerTarget(project, item, {
        kind: 'scene',
        surfaceId: surface.id,
        sceneId: scene.id,
      })
    }
    return { ...base, kind: 'scene', surfaceId: surface.id, sceneId: scene.id }
  }
  if (surface.type === 'flow' && path.includes('blocks')) {
    const block = flowBlockFromPath(surface.blocks, path.slice(2))
    if (block) {
      return { ...base, kind: 'flow-block', surfaceId: surface.id, blockId: block.id }
    }
    return undefined
  }
  if (surface.type === 'spatial-2d' && path[2] === 'world' && path[3] === 'layerItems') {
    const itemIndex = pathIndex(path[4])
    const item = itemIndex === undefined ? undefined : surface.world.layerItems[itemIndex]
    if (item) return layerTarget(project, item, { kind: 'world', surfaceId: surface.id })
    return undefined
  }
  return { ...base, kind: 'surface', surfaceId: surface.id }
}

function targetFromPath(
  project: CourseProjectDocument,
  path: ReadonlyArray<string | number> | undefined,
): DiagnosticTargetV1 | undefined {
  if (!path || path.length === 0) return undefined
  const base = targetBase(project)
  if (path[0] === 'assets' && typeof path[1] === 'string') {
    const asset = project.assets[path[1]]
    if (asset) return { ...base, kind: 'asset', assetId: asset.id }
  }
  if (path[0] === 'componentPackages' && typeof path[1] === 'string') {
    const component = project.componentPackages[path[1]]
    if (component) {
      return {
        ...base,
        kind: 'component-package',
        packageId: component.packageId,
        packageVersion: component.version,
      }
    }
  }
  if (path[0] === 'locations') {
    const index = pathIndex(path[1])
    const location = index === undefined ? undefined : project.locations[index]
    if (location) return { ...base, kind: 'location', locationId: location.id }
  }
  if (path[0] === 'globalLayerItems') {
    const index = pathIndex(path[1])
    const item = index === undefined ? undefined : project.globalLayerItems[index]?.item
    if (item) return layerTarget(project, item, { kind: 'global' })
  }
  if (path[0] === 'surfaces') {
    const index = pathIndex(path[1])
    const surface = index === undefined ? undefined : project.surfaces[index]
    if (surface) return targetFromSurfacePath(project, surface, path)
  }
  return undefined
}

function layerTargetsById(
  project: CourseProjectDocument,
  layerItemId: string,
): DiagnosticTargetV1[] {
  const targets: DiagnosticTargetV1[] = []
  project.globalLayerItems.forEach(({ item }) => {
    if (item.layerItemId === layerItemId) {
      targets.push(layerTarget(project, item, { kind: 'global' }))
    }
  })
  project.surfaces.forEach((surface) => {
    surface.surfaceLayerItems.forEach(({ item }) => {
      if (item.layerItemId === layerItemId) {
        targets.push(layerTarget(project, item, { kind: 'surface', surfaceId: surface.id }))
      }
    })
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => {
        scene.layerItems.forEach((item) => {
          if (item.layerItemId === layerItemId) {
            targets.push(layerTarget(project, item, {
              kind: 'scene',
              surfaceId: surface.id,
              sceneId: scene.id,
            }))
          }
        })
      })
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach((item) => {
        if (item.layerItemId === layerItemId) {
          targets.push(layerTarget(project, item, { kind: 'world', surfaceId: surface.id }))
        }
      })
    }
  })
  return targets
}

/**
 * Resolves a report hint only after the caller has a schema-valid V9 document.
 * Array indexes are consumed transiently; the returned identity contains only
 * stable Course Project V9 ids. Ambiguous or stale hints fall back to project.
 */
export function resolveSchemaValidCourseProjectDiagnosticTarget(
  project: CourseProjectDocument,
  hint: CourseProjectDiagnosticTargetHint,
): DiagnosticTargetV1 {
  const pathTarget = targetFromPath(project, hint.path)
  if (pathTarget) return pathTarget

  if (hint.layerItemId) {
    const matches = layerTargetsById(project, hint.layerItemId)
    if (matches.length === 1) return matches[0]!
    if (matches.length > 1) return projectTarget(project)
  }
  if (hint.surfaceId) {
    const surface = project.surfaces.find((candidate) => candidate.id === hint.surfaceId)
    if (surface) {
      return { ...targetBase(project), kind: 'surface', surfaceId: surface.id }
    }
  }
  return projectTarget(project)
}
