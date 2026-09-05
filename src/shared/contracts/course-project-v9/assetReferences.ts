import {
  getComponentPropValue,
  mergeComponentProps,
} from '../../componentProps'
import type { ComponentPackageData } from '../component-v4/types'
import type {
  ComponentLayerItem,
  CourseProjectDocument,
  CourseRuntimeDefinition,
  CourseSurfaceDocument,
  FlowBlock,
  LayerItem,
  LayerItemOverride,
} from './types'

export type CourseAssetReferenceCertainty = 'direct' | 'conservative'

export type CourseAssetReferenceKind =
  | 'sound'
  | 'course-background'
  | 'slide-surface-background'
  | 'scene-background'
  | 'state-background'
  | 'flow-surface-background'
  | 'spatial-surface-background'
  | 'native-image'
  | 'native-video'
  | 'video-poster'
  | 'runtime-binding'
  | 'runtime-fallback'
  | 'runtime-content'
  | 'runtime-source'
  | 'component-fallback'
  | 'component-prop'
  | 'component-manifest-default'
  | 'component-runtime-source'
  | 'component-context-unavailable'
  | 'flow-media'

export interface CourseAssetReference {
  readonly assetId: string
  readonly kind: CourseAssetReferenceKind
  readonly certainty: CourseAssetReferenceCertainty
  readonly path: ReadonlyArray<string | number>
  readonly sceneId?: string
  readonly stateId?: string
  readonly layerItemId?: string
  readonly blockId?: string
  readonly packageId?: string
}

export interface MissingCourseComponentAssetContext {
  readonly packageId: string
  readonly version: string
  readonly path: ReadonlyArray<string | number>
  readonly sceneId?: string
  readonly stateId?: string
  readonly layerItemId?: string
  readonly blockId?: string
}

export interface CourseAssetReferenceAnalysis {
  readonly graph: ReadonlyMap<string, readonly CourseAssetReference[]>
  readonly missingComponentContexts: readonly MissingCourseComponentAssetContext[]
}

export interface CourseAssetReferenceOptions {
  readonly componentPackages?: Readonly<Record<string, ComponentPackageData>>
  /** Authoring deletion includes disabled runtimes; publishing may opt out. */
  readonly includeDisabledRuntimes?: boolean
}

interface ReferenceLocation {
  readonly path: ReadonlyArray<string | number>
  readonly sceneId?: string
  readonly stateId?: string
  readonly layerItemId?: string
  readonly blockId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function visitKnownAssetValues(
  value: unknown,
  knownAssetIds: ReadonlySet<string>,
  path: ReadonlyArray<string | number>,
  visit: (assetId: string, path: ReadonlyArray<string | number>) => void,
): void {
  if (typeof value === 'string') {
    if (knownAssetIds.has(value)) visit(value, path)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitKnownAssetValues(
      item,
      knownAssetIds,
      [...path, index],
      visit,
    ))
    return
  }
  if (!isRecord(value)) return
  Object.entries(value).forEach(([key, item]) => visitKnownAssetValues(
    item,
    knownAssetIds,
    [...path, key],
    visit,
  ))
}

function sourceAssetIds(
  source: string,
  knownAssetIds: ReadonlySet<string>,
): string[] {
  // Code is never executed. Decoded quoted literals conservatively retain
  // escaped known ids; substrings in identifiers do not block deletion.
  const found = new Set<string>()
  let index = 0
  while (index < source.length) {
    const quote = source[index]
    if (quote !== "'" && quote !== '"' && quote !== '`') {
      index += 1
      continue
    }
    let value = ''
    index += 1
    while (index < source.length) {
      const character = source[index]!
      if (character === quote) {
        index += 1
        if (knownAssetIds.has(value)) found.add(value)
        break
      }
      if (character !== '\\') {
        value += character
        index += 1
        continue
      }
      const escaped = source[index + 1]
      if (escaped === undefined) {
        index += 1
        continue
      }
      const simple: Readonly<Record<string, string>> = {
        b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0',
      }
      if (escaped in simple) {
        value += simple[escaped]!
        index += 2
      } else if (escaped === 'x' && /^[\da-f]{2}$/i.test(source.slice(index + 2, index + 4))) {
        value += String.fromCharCode(Number.parseInt(source.slice(index + 2, index + 4), 16))
        index += 4
      } else if (escaped === 'u' && /^[\da-f]{4}$/i.test(source.slice(index + 2, index + 6))) {
        value += String.fromCharCode(Number.parseInt(source.slice(index + 2, index + 6), 16))
        index += 6
      } else {
        value += escaped
        index += 2
      }
    }
  }
  return [...found]
}

function componentPackage(
  packages: CourseAssetReferenceOptions['componentPackages'],
  packageId: string,
  version: string,
): readonly [string, ComponentPackageData] | undefined {
  return Object.entries(packages ?? {}).find(([, data]) => (
    data.manifest.id === packageId && data.manifest.version === version
  ))
}

function mergeComponentOverrideProps(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const result = structuredClone(base) as Record<string, unknown>
  if (!override) return result
  Object.entries(override).forEach(([key, value]) => {
    const previous = result[key]
    result[key] = isRecord(previous) && isRecord(value)
      ? mergeComponentOverrideProps(previous, value)
      : structuredClone(value)
  })
  return result
}

/**
 * Complete V9 authoring asset closure. It never imports or projects a Legacy
 * Project/Scene and fails closed when a referenced component package is absent.
 */
export function analyzeCourseAssetReferences(
  project: CourseProjectDocument,
  options: CourseAssetReferenceOptions = {},
): CourseAssetReferenceAnalysis {
  const includeDisabledRuntimes = options.includeDisabledRuntimes ?? true
  const knownAssetIds = new Set([
    ...Object.keys(project.assets),
    ...Object.values(project.assets).map((asset) => asset.id),
  ])
  const mutableGraph = new Map<string, CourseAssetReference[]>()
  const referenceKeys = new Set<string>()
  const missingComponentContexts: MissingCourseComponentAssetContext[] = []

  const add = (
    assetId: string | null | undefined,
    kind: CourseAssetReferenceKind,
    certainty: CourseAssetReferenceCertainty,
    location: ReferenceLocation & { packageId?: string },
  ): void => {
    if (!assetId) return
    const reference: CourseAssetReference = {
      assetId,
      kind,
      certainty,
      path: [...location.path],
      ...(location.sceneId ? { sceneId: location.sceneId } : {}),
      ...(location.stateId ? { stateId: location.stateId } : {}),
      ...(location.layerItemId ? { layerItemId: location.layerItemId } : {}),
      ...(location.blockId ? { blockId: location.blockId } : {}),
      ...(location.packageId ? { packageId: location.packageId } : {}),
    }
    const key = JSON.stringify(reference)
    if (referenceKeys.has(key)) return
    referenceKeys.add(key)
    mutableGraph.set(assetId, [...(mutableGraph.get(assetId) ?? []), reference])
  }

  const scanRuntime = (
    runtime: CourseRuntimeDefinition,
    location: ReferenceLocation,
  ): void => {
    if (!includeDisabledRuntimes && !runtime.enabled) return
    Object.entries(runtime.assets).forEach(([key, binding]) => add(
      binding.assetId,
      'runtime-binding',
      'direct',
      { ...location, path: [...location.path, 'assets', key, 'assetId'] },
    ))
    add(runtime.staticFallback?.assetId, 'runtime-fallback', 'direct', {
      ...location,
      path: [...location.path, 'staticFallback', 'assetId'],
    })
    visitKnownAssetValues(
      runtime.content.values,
      knownAssetIds,
      [...location.path, 'content', 'values'],
      (assetId, path) => add(assetId, 'runtime-content', 'conservative', {
        ...location,
        path,
      }),
    )
    sourceAssetIds(runtime.source, knownAssetIds).forEach((assetId) => add(
      assetId,
      'runtime-source',
      'conservative',
      { ...location, path: [...location.path, 'source'] },
    ))
  }

  const scanComponent = (
    component: ComponentLayerItem['component'],
    props: Readonly<Record<string, unknown>>,
    location: ReferenceLocation,
  ): void => {
    const packageEntry = componentPackage(
      options.componentPackages,
      component.packageId,
      component.version,
    )
    if (!packageEntry) {
      visitKnownAssetValues(
        props,
        knownAssetIds,
        [...location.path, 'props'],
        (assetId, path) => add(assetId, 'component-prop', 'conservative', {
          ...location,
          packageId: component.packageId,
          path,
        }),
      )
      missingComponentContexts.push({
        packageId: component.packageId,
        version: component.version,
        path: [...location.path, 'component'],
        ...(location.sceneId ? { sceneId: location.sceneId } : {}),
        ...(location.stateId ? { stateId: location.stateId } : {}),
        ...(location.layerItemId ? { layerItemId: location.layerItemId } : {}),
        ...(location.blockId ? { blockId: location.blockId } : {}),
      })
      // Without the exact executable manifest/source, absence of an observed id
      // is not evidence that any known project asset is unused.
      knownAssetIds.forEach((assetId) => add(
        assetId,
        'component-context-unavailable',
        'conservative',
        {
          ...location,
          packageId: component.packageId,
          path: [...location.path, 'component'],
        },
      ))
      return
    }

    const [packageKey, data] = packageEntry
    const effectiveProps = mergeComponentProps(data.manifest, props)
    visitKnownAssetValues(
      effectiveProps,
      knownAssetIds,
      [...location.path, 'props'],
      (assetId, path) => add(assetId, 'component-prop', 'conservative', {
        ...location,
        packageId: component.packageId,
        path,
      }),
    )
    for (const property of data.manifest.editor?.properties ?? []) {
      if (property.type !== 'image') continue
      const assetId = getComponentPropValue(effectiveProps, property.key)
      if (typeof assetId !== 'string' || !assetId) continue
      const explicit = getComponentPropValue(props, property.key) !== undefined
      add(
        assetId,
        explicit ? 'component-prop' : 'component-manifest-default',
        'direct',
        explicit
          ? {
              ...location,
              packageId: component.packageId,
              path: [...location.path, 'props', ...property.key.split('.')],
            }
          : {
              ...location,
              packageId: component.packageId,
              path: ['componentPackages', packageKey, 'manifest', 'defaultProps', ...property.key.split('.')],
            },
      )
    }
    sourceAssetIds(data.runtimeSource, knownAssetIds).forEach((assetId) => add(
      assetId,
      'component-runtime-source',
      'conservative',
      {
        ...location,
        packageId: component.packageId,
        path: ['componentPackages', packageKey, 'runtimeSource'],
      },
    ))
  }

  const scanComponentOverride = (
    item: ComponentLayerItem,
    overrideProps: Readonly<Record<string, unknown>>,
    location: ReferenceLocation,
  ): void => {
    const propsPath = [...location.path, 'componentProps']
    visitKnownAssetValues(
      overrideProps,
      knownAssetIds,
      propsPath,
      (assetId, path) => add(assetId, 'component-prop', 'conservative', {
        ...location,
        packageId: item.component.packageId,
        path,
      }),
    )
    const packageEntry = componentPackage(
      options.componentPackages,
      item.component.packageId,
      item.component.version,
    )
    if (!packageEntry) return
    const [, data] = packageEntry
    const effectiveProps = mergeComponentProps(
      data.manifest,
      mergeComponentOverrideProps(item.props, overrideProps),
    )
    for (const property of data.manifest.editor?.properties ?? []) {
      if (property.type !== 'image') continue
      if (getComponentPropValue(overrideProps, property.key) === undefined) continue
      const assetId = getComponentPropValue(effectiveProps, property.key)
      if (typeof assetId !== 'string' || !assetId) continue
      add(assetId, 'component-prop', 'direct', {
        ...location,
        packageId: item.component.packageId,
        path: [...propsPath, ...property.key.split('.')],
      })
    }
  }

  const scanNative = (
    item: Extract<LayerItem, { kind: 'native' }>,
    location: ReferenceLocation,
  ): void => {
    if (item.content.nativeType === 'image') {
      add(item.content.data.assetId, 'native-image', 'direct', {
        ...location,
        path: [...location.path, 'content', 'data', 'assetId'],
      })
    } else if (item.content.nativeType === 'video') {
      add(item.content.data.assetId, 'native-video', 'direct', {
        ...location,
        path: [...location.path, 'content', 'data', 'assetId'],
      })
      add(item.content.data.poster.assetId, 'video-poster', 'direct', {
        ...location,
        path: [...location.path, 'content', 'data', 'poster', 'assetId'],
      })
    }
  }

  const scanNativeOverride = (
    item: Extract<LayerItem, { kind: 'native' }>,
    override: LayerItemOverride,
    location: ReferenceLocation,
  ): void => {
    const nativeData = override.nativeData
    if (!nativeData) return
    if (item.content.nativeType === 'image') {
      add(
        typeof nativeData.assetId === 'string' ? nativeData.assetId : undefined,
        'native-image',
        'direct',
        { ...location, path: [...location.path, 'nativeData', 'assetId'] },
      )
    } else if (item.content.nativeType === 'video') {
      add(
        typeof nativeData.assetId === 'string' ? nativeData.assetId : undefined,
        'native-video',
        'direct',
        { ...location, path: [...location.path, 'nativeData', 'assetId'] },
      )
      const poster = isRecord(nativeData.poster) ? nativeData.poster : undefined
      add(
        typeof poster?.assetId === 'string' ? poster.assetId : undefined,
        'video-poster',
        'direct',
        { ...location, path: [...location.path, 'nativeData', 'poster', 'assetId'] },
      )
    }
  }

  const scanLayer = (
    item: LayerItem,
    location: ReferenceLocation,
  ): void => {
    if (item.kind === 'native') {
      scanNative(item, location)
      return
    }
    if (item.kind === 'runtime') {
      scanRuntime(item.runtime, { ...location, path: [...location.path, 'runtime'] })
      return
    }
    add(item.staticFallbackAssetId, 'component-fallback', 'direct', {
      ...location,
      path: [...location.path, 'staticFallbackAssetId'],
    })
    scanComponent(
      item.component,
      item.props,
      location,
    )
  }

  const scanScopedLayers = (
    entries: ReadonlyArray<{ item: LayerItem }>,
    path: ReadonlyArray<string | number>,
  ): void => {
    entries.forEach((entry, index) => scanLayer(entry.item, {
      path: [...path, index, 'item'],
      layerItemId: entry.item.layerItemId,
    }))
  }

  const scanFlowBlocks = (
    blocks: readonly FlowBlock[],
    path: ReadonlyArray<string | number>,
  ): void => {
    blocks.forEach((block, index) => {
      const blockPath = [...path, index]
      if (block.type === 'media') {
        add(block.assetId, 'flow-media', 'direct', {
          path: [...blockPath, 'assetId'],
          blockId: block.id,
        })
      } else if (block.type === 'component') {
        add(block.staticFallbackAssetId, 'component-fallback', 'direct', {
          path: [...blockPath, 'staticFallbackAssetId'],
          blockId: block.id,
        })
        scanComponent(block.component, block.props, {
          path: blockPath,
          blockId: block.id,
        })
      } else if (block.type === 'section') {
        scanFlowBlocks(block.blocks, [...blockPath, 'blocks'])
      }
    })
  }

  Object.entries(project.media.audio.sounds).forEach(([soundKey, sound]) => add(
    sound.assetId,
    'sound',
    'direct',
    { path: ['media', 'audio', 'sounds', soundKey, 'assetId'] },
  ))
  add(project.backgroundAssetId, 'course-background', 'direct', { path: ['backgroundAssetId'] })
  scanScopedLayers(project.globalLayerItems, ['globalLayerItems'])

  const surfaceBackgroundKind: Record<CourseSurfaceDocument['type'], CourseAssetReferenceKind> = {
    slide: 'slide-surface-background',
    flow: 'flow-surface-background',
    'spatial-2d': 'spatial-surface-background',
  }
  project.surfaces.forEach((surface, surfaceIndex) => {
    const surfacePath: ReadonlyArray<string | number> = ['surfaces', surfaceIndex]
    scanScopedLayers(surface.surfaceLayerItems, [...surfacePath, 'surfaceLayerItems'])
    add(surface.backgroundAssetId, surfaceBackgroundKind[surface.type], 'direct', {
      path: [...surfacePath, 'backgroundAssetId'],
    })
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene, sceneIndex) => {
        const scenePath = [...surfacePath, 'scenes', sceneIndex]
        add(scene.backgroundAssetId, 'scene-background', 'direct', {
          path: [...scenePath, 'backgroundAssetId'],
          sceneId: scene.id,
        })
        scene.layerItems.forEach((item, itemIndex) => scanLayer(item, {
          path: [...scenePath, 'layerItems', itemIndex],
          sceneId: scene.id,
          layerItemId: item.layerItemId,
        }))
        scene.presentation?.states.forEach((state, stateIndex) => {
          const statePath = [...scenePath, 'presentation', 'states', stateIndex]
          add(state.backgroundAssetId, 'state-background', 'direct', {
            path: [...statePath, 'backgroundAssetId'],
            sceneId: scene.id,
            stateId: state.id,
          })
          Object.entries(state.layerItemOverrides).forEach(([layerItemId, override]) => {
            const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
            if (!item) return
            const location = {
              path: [...statePath, 'layerItemOverrides', layerItemId],
              sceneId: scene.id,
              stateId: state.id,
              layerItemId,
            }
            if (item.kind === 'native') {
              scanNativeOverride(item, override, location)
            } else if (item.kind === 'component' && override.componentProps) {
              scanComponentOverride(item, override.componentProps, location)
            }
          })
        })
      })
    } else if (surface.type === 'flow') {
      scanFlowBlocks(surface.blocks, [...surfacePath, 'blocks'])
    } else {
      surface.world.layerItems.forEach((item, itemIndex) => scanLayer(item, {
        path: [...surfacePath, 'world', 'layerItems', itemIndex],
        layerItemId: item.layerItemId,
      }))
    }
  })

  return {
    graph: new Map([...mutableGraph].map(([assetId, references]) => [
      assetId,
      Object.freeze(references.map((reference) => Object.freeze(reference))),
    ])),
    missingComponentContexts: Object.freeze(
      missingComponentContexts.map((context) => Object.freeze(context)),
    ),
  }
}
