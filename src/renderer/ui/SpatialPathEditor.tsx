import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ComponentInstance, ComponentSpatialAuthoring } from '../../shared/contracts/component-platform'
type SpatialPathDocument = NonNullable<ComponentSpatialAuthoring['paths']>[number]
type SpatialPathStyle = NonNullable<SpatialPathDocument['style']>
type SpatialRelationDocument = NonNullable<ComponentSpatialAuthoring['relations']>[number]
type SpatialRelationKind = SpatialRelationDocument['kind']
import { BufferedInput, PropertyDraftBoundary } from './properties/PropertyControls'

const EMPTY_DRAFT_BINDINGS: ReadonlyMap<string, string> = new Map()

export type SpatialPathEditorMode = 'hidden' | 'page-section' | 'path' | 'relation'

export interface SpatialPathEditorProps {
  readonly surfaceTitle: string
  readonly worldInstances: readonly ComponentInstance[]
  readonly paths: readonly SpatialPathDocument[]
  readonly frames?: readonly ComponentSpatialAuthoring['frames'][number][]
  readonly relations: readonly SpatialRelationDocument[]
  readonly pageSection?: boolean
  readonly selectedPathId?: string | null
  readonly selectedRelationId?: string | null
  readonly disabled?: boolean
  readonly draftBindingKey?: string
  readonly pathDraftBindings?: ReadonlyMap<string, string>
  readonly relationDraftBindings?: ReadonlyMap<string, string>
  readonly onDraftStale?: () => void
  readonly onAddPath: (input: {
    title: string
    instanceIds: string[]
    frameIds?: string[]
    style?: SpatialPathStyle
  }) => void | Promise<unknown>
  readonly onRenamePath: (pathId: string, title: string) => void
  readonly onUpdatePathStyle: (pathId: string, style: SpatialPathStyle) => void
  readonly onReorderPathWaypoints?: (pathId: string, instanceIds: string[]) => void
  readonly onReorderPathFrames?: (pathId: string, frameIds: string[]) => void
  readonly onDeletePath: (pathId: string) => void
  readonly onAddRelation: (input: {
    sourceInstanceId: string
    targetInstanceId: string
    kind: SpatialRelationKind
    label?: string
  }) => void | Promise<unknown>
  readonly onUpdateRelationLabel: (relationId: string, label: string) => void
  readonly onUpdateRelationKind: (relationId: string, kind: SpatialRelationKind) => void
  readonly onDeleteRelation: (relationId: string) => void
}

const DASH_OPTIONS = ['solid', 'dashed', 'dotted'] as const

export function spatialPathEditorMode(props: {
  readonly pageSection?: boolean
  readonly selectedPathId?: string | null
  readonly selectedRelationId?: string | null
}): SpatialPathEditorMode {
  if (props.selectedPathId) return 'path'
  if (props.selectedRelationId) return 'relation'
  if (props.pageSection) return 'page-section'
  return 'hidden'
}

function PathStyleFields({
  path,
  disabled,
  onUpdatePathStyle,
}: {
  path: SpatialPathDocument
  disabled?: boolean
  onUpdatePathStyle: (pathId: string, style: SpatialPathStyle) => void
}) {
  return (
    <div className="form-field">
      <label>
        <span>颜色</span>
        <input
          type="color"
          aria-label={`路径颜色 ${(path.title ?? path.id)}`}
          disabled={disabled}
          value={path.style?.color ?? '#3388ff'}
          onChange={(event) => onUpdatePathStyle(path.id, {
            ...path.style,
            color: event.currentTarget.value,
          })}
        />
      </label>
      <BufferedInput
        label={`路径线宽 ${(path.title ?? path.id)}`}
        type="number"
        min={0.5}
        step={0.5}
        disabled={disabled}
        value={path.style?.width ?? 2}
        onCommit={(width) => onUpdatePathStyle(path.id, { ...path.style, width: Number(width) })}
      />
      <label>
        <span>线型</span>
        <select
          className="form-input"
          aria-label={`路径线型 ${(path.title ?? path.id)}`}
          disabled={disabled}
          value={path.style?.dash ?? 'solid'}
          onChange={(event) => onUpdatePathStyle(path.id, {
            ...path.style,
            dash: event.currentTarget.value as SpatialPathStyle['dash'],
          })}
        >
          {DASH_OPTIONS.map((dash) => (
            <option value={dash} key={dash}>
              {dash === 'solid' ? '实线' : dash === 'dashed' ? '虚线' : '点线'}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

/**
 * Lightweight path/relation fields. Default render is hidden. R5-Z should
 * mount this as a collapsed Properties page segment or after a canvas hit on
 * a path/relation. Do not import into App / RightSidebar / PropertiesTab.
 */
export function SpatialPathEditor(props: SpatialPathEditorProps): React.JSX.Element | null {
  const mode = spatialPathEditorMode(props)
  if (mode === 'hidden') return null

  const {
    surfaceTitle,
    worldInstances,
    paths,
    frames = [],
    relations,
    selectedPathId,
    selectedRelationId,
    disabled = false,
    draftBindingKey = 'spatial-path-unbound',
    pathDraftBindings = EMPTY_DRAFT_BINDINGS,
    relationDraftBindings = EMPTY_DRAFT_BINDINGS,
    onDraftStale = () => undefined,
    onAddPath,
    onRenamePath,
    onUpdatePathStyle,
    onReorderPathWaypoints,
    onReorderPathFrames,
    onDeletePath,
    onAddRelation,
    onUpdateRelationLabel,
    onUpdateRelationKind,
    onDeleteRelation,
  } = props

  const [pathName, setPathName] = useState('')
  const [pathLayerItemIds, setPathLayerItemIds] = useState<string[]>([])
  const [pathSource, setPathSource] = useState<'instances' | 'frames'>('instances')
  const [pathFrameIds, setPathFrameIds] = useState<string[]>([])
  const [relationSourceId, setRelationSourceId] = useState('')
  const [relationTargetId, setRelationTargetId] = useState('')
  const [relationKind, setRelationKind] = useState<SpatialRelationKind>('arrow')
  const [relationLabel, setRelationLabel] = useState('')
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null)
  const activeBinding = useRef(draftBindingKey); activeBinding.current = draftBindingKey

  useEffect(() => {
    setPathName('')
    setPathLayerItemIds([])
    setPathFrameIds([])
    setPathSource('instances')
    setRelationSourceId('')
    setRelationTargetId('')
    setRelationKind('arrow')
    setRelationLabel('')
    setPending(false); setError(null)
  }, [draftBindingKey])
  const create = (submit: () => void | Promise<unknown>, accepted: () => void) => {
    if (pending) return
    const binding = draftBindingKey
    setPending(true); setError(null)
    let result: void | Promise<unknown>
    try { result = submit() } catch (failure) {
      setPending(false); setError(failure instanceof Error ? failure.message : String(failure)); return
    }
    void Promise.resolve(result).then(() => {
      if (activeBinding.current === binding) accepted()
    }, failure => {
      if (activeBinding.current === binding) setError(failure instanceof Error ? failure.message : String(failure))
    }).finally(() => { if (activeBinding.current === binding) setPending(false) })
  }

  const layerLabel = (instanceId: string): string => {
    const instance = worldInstances.find(item => item.id === instanceId)
    if (instance?.name?.trim()) return instance.name
    const data = instance?.data
    return data && typeof data === 'object' && !Array.isArray(data) && typeof data.title === 'string' ? data.title : instanceId
  }

  const canAddPath = pathName.trim().length > 0 && (pathSource === 'frames' ? pathFrameIds.length : pathLayerItemIds.length) > 0
  const canAddRelation = relationSourceId.length > 0
    && relationTargetId.length > 0
    && relationSourceId !== relationTargetId

  const selectedPath = selectedPathId
    ? paths.find((path) => path.id === selectedPathId)
    : undefined
  const selectedRelation = selectedRelationId
    ? relations.find((relation) => relation.id === selectedRelationId)
    : undefined

  const movePathWaypointAt = (path: SpatialPathDocument, fromIndex: number, direction: -1 | 1) => {
    if (!onReorderPathWaypoints) return
    const ids = [...(path.instanceIds ?? [])]
    const layerItemId = ids[fromIndex]
    const neighborId = ids[fromIndex + direction]
    if (!layerItemId || !neighborId) return
    ids[fromIndex] = neighborId
    ids[fromIndex + direction] = layerItemId
    onReorderPathWaypoints(path.id, ids)
  }
  const movePathFrameAt = (path: SpatialPathDocument, fromIndex: number, direction: -1 | 1) => {
    const ids = [...path.frameIds], toIndex = fromIndex + direction
    if (!onReorderPathFrames || !ids[fromIndex] || !ids[toIndex]) return
    const moved = ids[fromIndex]
    ids[fromIndex] = ids[toIndex]
    ids[toIndex] = moved
    onReorderPathFrames(path.id, ids)
  }

  const createPathForm = (
    <>
      {frames.length > 0 && <label className="form-field"><span>路径点类型</span>
        <select aria-label="路径点类型" className="form-input" value={pathSource} disabled={disabled || pending}
          onChange={event => setPathSource(event.currentTarget.value as 'instances' | 'frames')}>
          <option value="instances">世界对象</option><option value="frames">镜头停靠点</option>
        </select>
      </label>}
      <div className="form-field">
        <label htmlFor="spatial-path-name">路径名称</label>
        <input
          id="spatial-path-name"
          className="form-input"
          aria-label="路径名称"
          disabled={disabled || pending}
          value={pathName}
          maxLength={200}
          onChange={(event) => setPathName(event.currentTarget.value)}
        />
      </div>
      {pathSource === 'frames' ? frames.map(frame => <label className="property-hint" key={frame.id}>
        <input type="checkbox" disabled={disabled || pending} aria-label={`路径镜头 ${frame.title ?? frame.id}`} checked={pathFrameIds.includes(frame.id)}
          onChange={() => setPathFrameIds(current => current.includes(frame.id) ? current.filter(id => id !== frame.id) : [...current, frame.id])} />
        {frame.title ?? frame.id}
      </label>) : worldInstances.length === 0 ? (
        <p className="property-hint">当前空间表面还没有可作为路径点的世界图层。</p>
      ) : worldInstances.map((item) => (
        <label className="property-hint" key={item.id} data-layer-item-id={item.id}>
          <input
            type="checkbox"
            disabled={disabled || pending}
            checked={pathLayerItemIds.includes(item.id)}
            onChange={() => setPathLayerItemIds((current) => (
              current.includes(item.id)
                ? current.filter((id) => id !== item.id)
                : [...current, item.id]
            ))}
          />
          {layerLabel(item.id)}
        </label>
      ))}
      <button
        type="button"
        className="secondary-button"
        disabled={disabled || pending || !canAddPath}
        onClick={() => {
          create(() => onAddPath({
            title: pathName.trim(),
            instanceIds: pathSource === 'frames' ? [] : pathLayerItemIds,
            ...(pathSource === 'frames' ? { frameIds: pathFrameIds } : {}),
            style: { color: '#3388ff', width: 2, dash: 'solid' },
          }), () => {
            setPathName(''); setPathLayerItemIds([]); setPathFrameIds([])
          })
        }}
      >
        <Plus size={14} />添加路径
      </button>
    </>
  )

  const createRelationForm = (
    <>
      <label className="form-field">
        <span>起点</span>
        <select
          className="form-input"
          aria-label="关系起点"
          disabled={disabled || pending}
          value={relationSourceId}
          onChange={(event) => setRelationSourceId(event.currentTarget.value)}
        >
          <option value="">请选择起点</option>
          {worldInstances.map((item) => (
            <option value={item.id} key={item.id}>
              {layerLabel(item.id)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>终点</span>
        <select
          className="form-input"
          aria-label="关系终点"
          disabled={disabled || pending}
          value={relationTargetId}
          onChange={(event) => setRelationTargetId(event.currentTarget.value)}
        >
          <option value="">请选择终点</option>
          {worldInstances.map((item) => (
            <option value={item.id} key={item.id}>
              {layerLabel(item.id)}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>类型</span>
        <select
          className="form-input"
          aria-label="关系类型"
          disabled={disabled || pending}
          value={relationKind}
          onChange={(event) => setRelationKind(event.currentTarget.value as SpatialRelationKind)}
        >
          <option value="line">直线</option>
          <option value="arrow">箭头</option>
          <option value="bidirectional">双向箭头</option>
        </select>
      </label>
      <label className="form-field">
        <span>标签</span>
        <input
          className="form-input"
          aria-label="关系标签"
          disabled={disabled || pending}
          value={relationLabel}
          maxLength={500}
          onChange={(event) => setRelationLabel(event.currentTarget.value)}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={disabled || pending || !canAddRelation}
        onClick={() => {
          create(() => onAddRelation({
            sourceInstanceId: relationSourceId,
            targetInstanceId: relationTargetId,
            kind: relationKind,
            ...(relationLabel.trim() ? { label: relationLabel.trim() } : {}),
          }), () => { setRelationSourceId(''); setRelationTargetId(''); setRelationLabel('') })
        }}
      >
        <Plus size={14} />添加关系
      </button>
    </>
  )

  if (mode === 'path') {
    return (
      <section className="property-section" aria-label="路径" data-path-id={selectedPath?.id}>
        <h3 className="property-title">路径</h3>
        {!selectedPath ? (
          <p className="property-hint" role="status">找不到这条路径，请重新选择。</p>
        ) : (
          <PropertyDraftBoundary
            bindingKey={pathDraftBindings.get(selectedPath.id) ?? draftBindingKey}
            onStale={onDraftStale}
          >
            <BufferedInput
              label={`重命名路径 ${(selectedPath.title ?? selectedPath.id)}`}
              disabled={disabled}
              value={(selectedPath.title ?? selectedPath.id)}
              onCommit={(name) => onRenamePath(selectedPath.id, name)}
            />
            <p className="property-hint">
              {(selectedPath.instanceIds ?? []).map(layerLabel).join(' → ') || '未选择图层'}
            </p>
            {onReorderPathWaypoints && (selectedPath.instanceIds ?? []).map((layerItemId, index) => (
              <div className="form-field" key={`${selectedPath.id}-${layerItemId}-${index}`} data-layer-item-id={layerItemId}>
                <span>{layerLabel(layerItemId)}</span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled || index === 0}
                  aria-label={`上移路径点 ${layerLabel(layerItemId)}`}
                  onClick={() => movePathWaypointAt(selectedPath, index, -1)}
                >
                  上移
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled || index === (selectedPath.instanceIds ?? []).length - 1}
                  aria-label={`下移路径点 ${layerLabel(layerItemId)}`}
                  onClick={() => movePathWaypointAt(selectedPath, index, 1)}
                >
                  下移
                </button>
              </div>
            ))}
            {!(selectedPath.instanceIds?.length) && selectedPath.frameIds.map((frameId, index) => {
              const label = frames.find(frame => frame.id === frameId)?.title ?? frameId
              return <div className="form-field" key={`${selectedPath.id}:${index}`} data-camera-frame-id={frameId}>
                <span>{label}</span>
                <button type="button" className="secondary-button" disabled={disabled || !onReorderPathFrames || index === 0}
                  aria-label={`上移路径镜头 ${label}`} onClick={() => movePathFrameAt(selectedPath, index, -1)}>上移</button>
                <button type="button" className="secondary-button" disabled={disabled || !onReorderPathFrames || index === selectedPath.frameIds.length - 1}
                  aria-label={`下移路径镜头 ${label}`} onClick={() => movePathFrameAt(selectedPath, index, 1)}>下移</button>
              </div>
            })}
            <PathStyleFields
              path={selectedPath}
              disabled={disabled}
              onUpdatePathStyle={onUpdatePathStyle}
            />
            <button
              type="button"
              className="secondary-button secondary-button--danger"
              disabled={disabled}
              aria-label={`删除路径 ${(selectedPath.title ?? selectedPath.id)}`}
              onClick={() => onDeletePath(selectedPath.id)}
            >
              <Trash2 size={14} />删除路径
            </button>
          </PropertyDraftBoundary>
        )}
      </section>
    )
  }

  if (mode === 'relation') {
    return (
      <section className="property-section" aria-label="关系" data-relation-id={selectedRelation?.id}>
        <h3 className="property-title">关系</h3>
        {!selectedRelation ? (
          <p className="property-hint" role="status">找不到这条关系连线，请重新选择。</p>
        ) : (
          <PropertyDraftBoundary
            bindingKey={relationDraftBindings.get(selectedRelation.id) ?? draftBindingKey}
            onStale={onDraftStale}
          >
            <p className="property-hint">
              {layerLabel(selectedRelation.sourceInstanceId)}
              {' → '}
              {layerLabel(selectedRelation.targetInstanceId)}
            </p>
            <BufferedInput
              label={`关系标签 ${layerLabel(selectedRelation.sourceInstanceId)} → ${layerLabel(selectedRelation.targetInstanceId)}`}
              disabled={disabled}
              allowEmpty
              value={selectedRelation.label ?? ''}
              onCommit={(label) => onUpdateRelationLabel(selectedRelation.id, label)}
            />
            <select
              className="form-input"
              aria-label={`关系类型 ${layerLabel(selectedRelation.sourceInstanceId)} → ${layerLabel(selectedRelation.targetInstanceId)}`}
              disabled={disabled}
              value={selectedRelation.kind}
              onChange={(event) => onUpdateRelationKind(
                selectedRelation.id,
                event.currentTarget.value as SpatialRelationKind,
              )}
            >
              <option value="line">直线</option>
              <option value="arrow">箭头</option>
              <option value="bidirectional">双向箭头</option>
            </select>
            <button
              type="button"
              className="secondary-button secondary-button--danger"
              disabled={disabled}
              aria-label={`删除关系 ${layerLabel(selectedRelation.sourceInstanceId)} → ${layerLabel(selectedRelation.targetInstanceId)}`}
              onClick={() => onDeleteRelation(selectedRelation.id)}
            >
              <Trash2 size={14} />删除关系
            </button>
          </PropertyDraftBoundary>
        )}
      </section>
    )
  }

  return (
    <section className="property-section" aria-label="路径与关系">
      {error && <p className="property-hint" role="alert">{error}</p>}
      <details className="simple-advanced-properties">
        <summary>路径与关系</summary>
        <p className="property-hint">
          「{surfaceTitle}」的路径和关系会随课程保存。它们不是图层行，也不会进入通用叠放顺序。
        </p>
        {createPathForm}
        {paths.length === 0 ? (
          <p className="property-hint">还没有路径。</p>
        ) : paths.map((path) => (
          <div className="form-field" key={path.id} data-path-id={path.id}>
            <p className="property-hint">
              {(path.title ?? path.id)}
              {' · '}
              {path.instanceIds?.length ? path.instanceIds.map(layerLabel).join(' → ')
                : path.frameIds.map(id => frames.find(frame => frame.id === id)?.title ?? id).join(' → ')}
            </p>
            <button
              type="button"
              className="secondary-button secondary-button--danger"
              disabled={disabled}
              aria-label={`删除路径 ${(path.title ?? path.id)}`}
              onClick={() => onDeletePath(path.id)}
            >
              <Trash2 size={14} />删除
            </button>
          </div>
        ))}
        {createRelationForm}
        {relations.length === 0 ? (
          <p className="property-hint">还没有关系连线。</p>
        ) : relations.map((relation) => (
          <div className="form-field" key={relation.id} data-relation-id={relation.id}>
            <p className="property-hint">
              {layerLabel(relation.sourceInstanceId)}
              {' → '}
              {layerLabel(relation.targetInstanceId)}
            </p>
            <button
              type="button"
              className="secondary-button secondary-button--danger"
              disabled={disabled}
              aria-label={`删除关系 ${layerLabel(relation.sourceInstanceId)} → ${layerLabel(relation.targetInstanceId)}`}
              onClick={() => onDeleteRelation(relation.id)}
            >
              <Trash2 size={14} />删除
            </button>
          </div>
        ))}
      </details>
    </section>
  )
}

