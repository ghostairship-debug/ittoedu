const CHANGE_LIMIT = 200
const VALUE_LENGTH_LIMIT = 500

export type GenerationSemanticEntity =
  | 'project'
  | 'surface'
  | 'scene'
  | 'state'
  | 'layer-item'
  | 'flow-block'
  | 'location'
  | 'interaction'
  | 'navigation-guard'
  | 'course-state'
  | 'spatial-path'
  | 'spatial-relation'
  | 'camera-frame'
  | 'semantic-zoom'
  | 'print-entry'
  | 'design-token'
  | 'resource-asset'
  | 'resource-package'

export interface GenerationSemanticChangeTarget {
  entity: GenerationSemanticEntity
  id: string
  owner: 'project' | 'global' | 'surface' | 'scene' | 'state' | 'world' | 'flow' | 'resource'
  ownerKey: string
  impact: 'instance' | 'shared'
  name?: string
  surfaceId?: string
  locationId?: string
  stateId?: string
}

export interface GenerationPreviewChange {
  path: string
  before: string
  after: string
  kind: 'created' | 'deleted' | 'updated' | 'reordered'
  field?: string
  target?: GenerationSemanticChangeTarget
  truncated?: { before: boolean; after: boolean }
}

export interface GenerationSemanticComparisonScope {
  scope: string
  status: 'complete' | 'not-provided' | 'incomparable'
  reason?: string
}

export interface GenerationSemanticChanges {
  changes: GenerationPreviewChange[]
  omitted: number
  comparison: {
    status: 'complete' | 'partial'
    scopes: GenerationSemanticComparisonScope[]
  }
  truncation: {
    changeLimit: number
    valueLengthLimit: number
    omittedChanges: number
    truncatedValues: number
  }
}

/** Existing two-argument consumers can keep constructing their former narrow fixture. */
export interface LegacyGenerationSemanticChanges {
  changes: Array<Omit<GenerationPreviewChange, 'kind'> & { kind?: GenerationPreviewChange['kind'] }>
  omitted: number
  comparison?: GenerationSemanticChanges['comparison']
  truncation?: GenerationSemanticChanges['truncation']
}

export interface GenerationPreviewResourceState {
  readonly assetFiles?: Readonly<Record<string, Uint8Array>>
  readonly componentPackages?: Readonly<Record<string, unknown>>
}

export interface GenerationPreviewResourceFacts {
  readonly beforeResources?: GenerationPreviewResourceState
  readonly afterResources?: GenerationPreviewResourceState
}

type JsonRecord = Record<string, unknown>

interface IdentityIndex {
  readonly projectId: string
  readonly locations: readonly JsonRecord[]
}

interface WalkContext {
  readonly index: IdentityIndex
  readonly target?: GenerationSemanticChangeTarget
  readonly surfaceId?: string
  readonly surfaceType?: string
  readonly sceneId?: string
  readonly stateId?: string
}

interface EntityCollection {
  readonly id: (value: JsonRecord) => string | undefined
  readonly context: (value: JsonRecord, id: string, context: WalkContext) => WalkContext
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)
    ? value as JsonRecord
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function displayName(value: JsonRecord): string | undefined {
  return text(value.label) ?? text(value.name) ?? text(value.title)
}

function projectIndex(before: unknown, after: unknown): IdentityIndex {
  const source = [record(after), record(before)].find(value => value && value.schemaVersion === 9 && text(value.id))
  const locations = [record(after)?.locations, record(before)?.locations]
    .flatMap(value => Array.isArray(value) ? value : [])
    .map(value => record(value))
    .filter((value): value is JsonRecord => value !== undefined)
  return { projectId: text(source?.id) ?? 'project', locations }
}

function locationFor(context: WalkContext, input: {
  surfaceId?: string
  sceneId?: string
  stateId?: string
  blockId?: string
  cameraFrameId?: string
}): string | undefined {
  const exact = context.index.locations.find(location => (
    (!input.surfaceId || location.surfaceId === input.surfaceId)
    && (!input.sceneId || location.sceneId === input.sceneId)
    && (!input.stateId || location.stateId === input.stateId)
    && (!input.blockId || location.blockId === input.blockId)
    && (!input.cameraFrameId || location.cameraFrameId === input.cameraFrameId)
  ))
  return text(exact?.id)
}

function target(input: Omit<GenerationSemanticChangeTarget, 'impact'> & { impact?: 'instance' | 'shared' }): GenerationSemanticChangeTarget {
  return { ...input, impact: input.impact ?? 'instance' }
}

function withTarget(context: WalkContext, next: GenerationSemanticChangeTarget, extra: Partial<WalkContext> = {}): WalkContext {
  return { ...context, ...extra, target: next }
}

/** Only V9 contract collections are identity-aligned; arbitrary `id` fields remain ordered content. */
function entityCollection(property: string, parent: JsonRecord, context: WalkContext): EntityCollection | undefined {
  const projectOwner = () => ({ owner: 'project' as const, ownerKey: context.index.projectId })
  if (property === 'surfaces' && parent.schemaVersion === 9) return {
    id: value => text(value.id), context: (value, id, current) => withTarget(current,
      target({ entity: 'surface', id, ...projectOwner(), name: displayName(value), surfaceId: id,
        locationId: locationFor(current, { surfaceId: id }) }),
      { surfaceId: id, surfaceType: text(value.type), sceneId: undefined, stateId: undefined }),
  }
  if (property === 'locations' && parent.schemaVersion === 9) return {
    id: value => text(value.id), context: (value, id, current) => withTarget(current,
      target({ entity: 'location', id, ...projectOwner(), name: displayName(value), surfaceId: text(value.surfaceId), locationId: id,
        stateId: text(value.stateId) })),
  }
  if (property === 'navigationGuards' && parent.schemaVersion === 9) return {
    id: value => text(value.id), context: (value, id, current) => withTarget(current,
      target({ entity: 'navigation-guard', id, ...projectOwner(), name: displayName(value) })),
  }
  if (property === 'courseState' && parent.schemaVersion === 9) return {
    id: value => text(value.key), context: (value, id, current) => withTarget(current,
      target({ entity: 'course-state', id, ...projectOwner(), name: displayName(value) })),
  }
  if (property === 'globalLayerItems' && parent.schemaVersion === 9) return layerEntries('global', 'global')
  if (property === 'globalInteractions' && parent.schemaVersion === 9) return interactions('global', 'global')
  if ((property === 'fonts' || property === 'colors') && context.target?.entity === 'project') return {
    id: value => text(value.id), context: (value, id, current) => withTarget(current,
      target({ entity: 'design-token', id, owner: 'project', ownerKey: current.index.projectId, impact: 'shared', name: displayName(value) })),
  }
  if (property === 'scenes' && parent.type === 'slide' && context.surfaceId) return {
    id: value => text(value.id), context: (value, id, current) => withTarget(current,
      target({ entity: 'scene', id, owner: 'surface', ownerKey: `surface:${current.surfaceId}`, name: displayName(value),
        surfaceId: current.surfaceId, locationId: locationFor(current, { surfaceId: current.surfaceId, sceneId: id }) }),
      { sceneId: id, stateId: undefined }),
  }
  if (property === 'states' && text(parent.initialStateId) && context.sceneId) return {
    id: value => text(value.id), context: (value, id, current) => {
      const locationId = locationFor(current, { surfaceId: current.surfaceId, sceneId: current.sceneId, stateId: id })
        ?? locationFor(current, { surfaceId: current.surfaceId, sceneId: current.sceneId })
      return withTarget(current, target({ entity: 'state', id, owner: 'state', ownerKey: `state:${current.sceneId}:${id}`,
        name: displayName(value), surfaceId: current.surfaceId, locationId, stateId: id }), { stateId: id })
    },
  }
  if (property === 'surfaceLayerItems' && context.surfaceId) return layerEntries('surface', `surface:${context.surfaceId}`)
  if (property === 'layerItems' && context.sceneId) return layers('scene', `scene:${context.sceneId}`)
  if (property === 'layerItems' && context.surfaceType === 'spatial-2d' && context.surfaceId) return layers('world', `world:${context.surfaceId}`)
  if (property === 'interactions' && context.sceneId) return interactions('scene', `scene:${context.sceneId}`)
  if (property === 'blocks' && (parent.type === 'flow' || parent.type === 'section') && context.surfaceId) return flowBlocks()
  if (property === 'items' && parent.type === 'list' && context.surfaceId) return flowBlocks()
  if (property === 'paths' && context.surfaceType === 'spatial-2d' && context.surfaceId) return spatial('spatial-path')
  if (property === 'relations' && context.surfaceType === 'spatial-2d' && context.surfaceId) return spatial('spatial-relation')
  if (property === 'frames' && context.surfaceType === 'spatial-2d' && context.surfaceId) return {
    id: value => text(value.id), context: (value, id, current) => withTarget(current,
      target({ entity: 'camera-frame', id, owner: 'world', ownerKey: `world:${current.surfaceId}`, name: displayName(value),
        surfaceId: current.surfaceId, locationId: locationFor(current, { surfaceId: current.surfaceId, cameraFrameId: id }) })),
  }
  if (property === 'semanticZoom' && parent.type === 'spatial-2d' && context.surfaceId) return spatial('semantic-zoom')
  if (property === 'entries' && context.target?.entity === 'project') return {
    id: value => text(value.id), context: (value, id, current) => withTarget(current,
      target({ entity: 'print-entry', id, owner: 'project', ownerKey: current.index.projectId, name: displayName(value), surfaceId: text(value.surfaceId) })),
  }
  if (property === 'actions' && context.target?.entity === 'interaction') return {
    id: value => text(value.id), context: (value, id, current) => withTarget(current,
      target({ ...current.target!, id, name: displayName(value) })),
  }
  return undefined

  function layerEntries(owner: 'global' | 'surface', ownerKey: string): EntityCollection {
    return {
      id: value => text(record(value.item)?.layerItemId), context: (value, id, current) => {
        const item = record(value.item) ?? value
        return withTarget(current, target({ entity: 'layer-item', id, owner, ownerKey, name: displayName(item), surfaceId: current.surfaceId,
          locationId: owner === 'global' ? undefined : locationFor(current, { surfaceId: current.surfaceId }), stateId: current.stateId }))
      },
    }
  }
  function layers(owner: 'scene' | 'world', ownerKey: string): EntityCollection {
    return {
      id: value => text(value.layerItemId), context: (value, id, current) => withTarget(current,
        target({ entity: 'layer-item', id, owner, ownerKey, name: displayName(value), surfaceId: current.surfaceId,
          locationId: owner === 'scene'
            ? locationFor(current, { surfaceId: current.surfaceId, sceneId: current.sceneId, stateId: current.stateId })
              ?? locationFor(current, { surfaceId: current.surfaceId, sceneId: current.sceneId })
            : locationFor(current, { surfaceId: current.surfaceId }), stateId: current.stateId })),
    }
  }
  function interactions(owner: 'global' | 'scene', ownerKey: string): EntityCollection {
    return {
      id: value => text(value.id), context: (value, id, current) => withTarget(current,
        target({ entity: 'interaction', id, owner, ownerKey, name: displayName(value), surfaceId: current.surfaceId,
          locationId: owner === 'scene' ? locationFor(current, { surfaceId: current.surfaceId, sceneId: current.sceneId }) : undefined,
          stateId: current.stateId })),
    }
  }
  function flowBlocks(): EntityCollection {
    return {
      id: value => text(value.id), context: (value, id, current) => withTarget(current,
        target({ entity: 'flow-block', id, owner: 'flow', ownerKey: `flow:${current.surfaceId}`, name: displayName(value), surfaceId: current.surfaceId,
          locationId: locationFor(current, { surfaceId: current.surfaceId, blockId: id }) })),
    }
  }
  function spatial(entity: 'spatial-path' | 'spatial-relation' | 'semantic-zoom'): EntityCollection {
    return {
      id: value => text(value.id), context: (value, id, current) => withTarget(current,
        target({ entity, id, owner: 'world', ownerKey: `world:${current.surfaceId}`, name: displayName(value), surfaceId: current.surfaceId,
          locationId: locationFor(current, { surfaceId: current.surfaceId }) })),
    }
  }
}

function valuesEqual(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  if (seen.get(left) === right) return true
  seen.set(left, right)
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key)
    && valuesEqual(Reflect.get(left, key), Reflect.get(right, key), seen))
}

function byteSummary(value: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of value) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  return `${value.byteLength} bytes · fnv1a32:${hash.toString(16).padStart(8, '0')}`
}

/** Human-review display only. These paths never become a patch or a writer. */
export function describeGenerationChanges(before: unknown, after: unknown): LegacyGenerationSemanticChanges
export function describeGenerationChanges(before: unknown, after: unknown, resourceFacts: GenerationPreviewResourceFacts): GenerationSemanticChanges
export function describeGenerationChanges(
  before: unknown,
  after: unknown,
  resourceFacts: GenerationPreviewResourceFacts = {},
): GenerationSemanticChanges {
  const changes: GenerationPreviewChange[] = []
  let omitted = 0
  let truncatedValues = 0
  let documentComparable = true
  const index = projectIndex(before, after)
  const rootTarget = target({ entity: 'project', id: index.projectId, owner: 'project', ownerKey: index.projectId })

  const summarize = (value: unknown): { value: string; truncated: boolean } => {
    let summary: string
    if (value === undefined) summary = '不存在'
    else if (value instanceof Uint8Array) summary = byteSummary(value)
    else if (typeof value === 'string') summary = value
    else {
      try { summary = JSON.stringify(value) ?? String(value) }
      catch { summary = String(value) }
    }
    const truncated = summary.length > VALUE_LENGTH_LIMIT
    if (truncated) truncatedValues++
    return { value: truncated ? `${summary.slice(0, VALUE_LENGTH_LIMIT)}…` : summary, truncated }
  }

  const add = (input: Omit<GenerationPreviewChange, 'before' | 'after'> & { beforeValue: unknown; afterValue: unknown }) => {
    if (changes.length >= CHANGE_LIMIT) { omitted++; return }
    const beforeSummary = summarize(input.beforeValue)
    const afterSummary = summarize(input.afterValue)
    const { beforeValue: _before, afterValue: _after, ...rest } = input
    changes.push({ ...rest, before: beforeSummary.value, after: afterSummary.value,
      ...(beforeSummary.truncated || afterSummary.truncated
        ? { truncated: { before: beforeSummary.truncated, after: afterSummary.truncated } }
        : {}) })
  }

  const entityPath = (path: string, id: string) => `${path}[id=${JSON.stringify(id)}]`

  const walkEntityArray = (left: unknown[], right: unknown[], path: string, collection: EntityCollection, context: WalkContext) => {
    const materialize = (values: unknown[]) => values.map(value => {
      const item = record(value)
      return item ? { value, item, id: collection.id(item) } : { value, item: undefined, id: undefined }
    })
    const leftItems = materialize(left)
    const rightItems = materialize(right)
    const invalid = [...leftItems, ...rightItems].some(value => !value.item || !value.id)
      || new Set(leftItems.map(value => value.id)).size !== leftItems.length
      || new Set(rightItems.map(value => value.id)).size !== rightItems.length
    if (invalid) { documentComparable = false; return }
    const leftMap = new Map(leftItems.map(value => [value.id!, value]))
    const rightMap = new Map(rightItems.map(value => [value.id!, value]))
    for (const entry of leftItems) if (!rightMap.has(entry.id!)) {
      const next = collection.context(entry.item!, entry.id!, context)
      add({ path: entityPath(path, entry.id!), kind: 'deleted', target: next.target, beforeValue: entry.value, afterValue: undefined })
    }
    for (const entry of rightItems) if (!leftMap.has(entry.id!)) {
      const next = collection.context(entry.item!, entry.id!, context)
      add({ path: entityPath(path, entry.id!), kind: 'created', target: next.target, beforeValue: undefined, afterValue: entry.value })
    }
    const common = new Set(leftItems.filter(value => rightMap.has(value.id!)).map(value => value.id!))
    const leftOrder = leftItems.map(value => value.id!).filter(id => common.has(id))
    const rightOrder = rightItems.map(value => value.id!).filter(id => common.has(id))
    if (leftOrder.some((id, position) => rightOrder[position] !== id)) {
      const rightPositions = new Map(rightOrder.map((id, position) => [id, position]))
      leftOrder.forEach((id, position) => {
        const afterPosition = rightPositions.get(id)!
        if (position === afterPosition) return
        const next = collection.context(rightMap.get(id)!.item!, id, context)
        add({ path: `${entityPath(path, id)}.$order`, kind: 'reordered', field: '$order', target: next.target,
          beforeValue: position, afterValue: afterPosition })
      })
    }
    for (const entry of leftItems) {
      const paired = rightMap.get(entry.id!)
      if (!paired) continue
      walk(entry.value, paired.value, entityPath(path, entry.id!), collection.context(paired.item ?? entry.item!, entry.id!, context))
    }
  }

  const walkRecordEntities = (left: JsonRecord, right: JsonRecord, path: string, context: WalkContext, kind: 'asset' | 'package' | 'override') => {
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const owner = kind === 'override' ? 'state' as const : 'resource' as const
      const entity = kind === 'override' ? 'layer-item' as const : kind === 'asset' ? 'resource-asset' as const : 'resource-package' as const
      const changeTarget = target({ entity, id, owner, ownerKey: kind === 'override' ? context.target?.ownerKey ?? `state:${context.stateId}` : 'resource',
        impact: kind === 'override' ? 'instance' : 'shared', surfaceId: context.surfaceId,
        locationId: context.target?.locationId, stateId: context.stateId })
      walk(left[id], right[id], `${path}.${id}`, withTarget(context, changeTarget))
    }
  }

  const walk = (left: unknown, right: unknown, path: string, context: WalkContext) => {
    if (Object.is(left, right)) return
    if (left instanceof Uint8Array && right instanceof Uint8Array) {
      if (!valuesEqual(left, right)) add({ path, kind: 'updated', field: path.split('.').at(-1), target: context.target, beforeValue: left, afterValue: right })
      return
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        walk(left[index], right[index], path ? `${path}.${index}` : String(index), context)
      }
      return
    }
    const leftRecord = record(left)
    const rightRecord = record(right)
    if (leftRecord && rightRecord) {
      for (const key of new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])) {
        const nextPath = path ? `${path}.${key}` : key
        const leftValue = leftRecord[key]
        const rightValue = rightRecord[key]
        if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
          const collection = entityCollection(key, rightRecord, context) ?? entityCollection(key, leftRecord, context)
          if (collection) walkEntityArray(leftValue, rightValue, nextPath, collection, context)
          else for (let index = 0; index < Math.max(leftValue.length, rightValue.length); index++) {
            walk(leftValue[index], rightValue[index], `${nextPath}.${index}`, context)
          }
        } else if (key === 'assets' && leftRecord.schemaVersion === 9 && rightRecord.schemaVersion === 9 && record(leftValue) && record(rightValue)) {
          walkRecordEntities(record(leftValue)!, record(rightValue)!, nextPath, context, 'asset')
        } else if (key === 'componentPackages' && leftRecord.schemaVersion === 9 && rightRecord.schemaVersion === 9 && record(leftValue) && record(rightValue)) {
          walkRecordEntities(record(leftValue)!, record(rightValue)!, nextPath, context, 'package')
        } else if (key === 'layerItemOverrides' && context.target?.entity === 'state' && record(leftValue) && record(rightValue)) {
          walkRecordEntities(record(leftValue)!, record(rightValue)!, nextPath, context, 'override')
        } else walk(leftValue, rightValue, nextPath, context)
      }
      return
    }
    add({ path, kind: left === undefined ? 'created' : right === undefined ? 'deleted' : 'updated', field: path.split('.').at(-1),
      target: context.target, beforeValue: left, afterValue: right })
  }

  walk(before, after, '', { index, target: rootTarget })

  const compareResources = (property: 'assetFiles' | 'componentPackages', entity: 'resource-asset' | 'resource-package') => {
    const left = resourceFacts.beforeResources?.[property]
    const right = resourceFacts.afterResources?.[property]
    const scope = property === 'assetFiles' ? 'resource-assets' : 'resource-packages'
    if (left === undefined && right === undefined) return { scope, status: 'not-provided' as const, reason: 'resource snapshots were not supplied' }
    if (left === undefined || right === undefined) return { scope, status: 'incomparable' as const, reason: 'one resource snapshot is missing' }
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const beforeValue = left[id]
      const afterValue = right[id]
      if (valuesEqual(beforeValue, afterValue)) continue
      add({ path: `$resources.${property}.${id}`, kind: beforeValue === undefined ? 'created' : afterValue === undefined ? 'deleted' : 'updated',
        field: property, target: target({ entity, id, owner: 'resource', ownerKey: 'resource', impact: 'shared' }), beforeValue, afterValue })
    }
    return { scope, status: 'complete' as const }
  }

  const scopes: GenerationSemanticComparisonScope[] = [
    { scope: 'document', status: documentComparable ? 'complete' : 'incomparable',
      ...(documentComparable ? {} : { reason: 'a formal entity collection is missing unique stable identities' }) },
    compareResources('assetFiles', 'resource-asset'),
    compareResources('componentPackages', 'resource-package'),
  ]
  return {
    changes,
    omitted,
    comparison: { status: scopes.every(scope => scope.status === 'complete') ? 'complete' : 'partial', scopes },
    truncation: { changeLimit: CHANGE_LIMIT, valueLengthLimit: VALUE_LENGTH_LIMIT, omittedChanges: omitted, truncatedValues },
  }
}
